import { randomBytes } from "crypto";
import {
  CursorPage,
  cursorPageArgs,
  cursorPageResult,
} from "../utils/cursorPagination";
import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { env } from "../config/env.config";
import { paystack, PaystackVerifyData } from "../payment/paystackClient";
import { LedgerService } from "../ledger/ledgerService";
import { safeClientOrigin } from "../utils/helper";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { billIssued, billReceipt } from "../notifications/templates/shop";
import {
  brandFromStudio,
  firstName,
  storefrontFallbackBrand,
} from "../notifications/brand";
import { ghs, receiptNumber } from "../notifications/format";
import { buildReceiptPdf } from "../notifications/receiptPdf";
import { notifyStudioAdmins } from "../push/pushService";
import { runWithTenant } from "../tenant/context";
import { createTenantClient } from "../tenant/tenantClient";
import { studioLink } from "../utils/studioLink";
import { round2 } from "../utils/money";

// Bills for walk-ins. The owner builds one, the customer pays through its link
// on their own phone, and it stays on record: paid online, paid in cash, or
// cancelled. Online payments go through the same Paystack split and ledger as
// bookings and orders.

const { raw } = createTenantClient();
const bad = (m: string, c = 400) => new ApiError(m, c);

export interface BillLine {
  name: string;
  quantity: number;
  unitPrice: number;
  kind: "service" | "product" | "custom";
}

const cleanLines = (v: unknown): BillLine[] => {
  if (!Array.isArray(v) || v.length < 1 || v.length > 30)
    throw bad("Add between 1 and 30 lines to the bill");
  return v.map((l) => {
    const name = String(l?.name ?? "")
      .trim()
      .slice(0, 80);
    const quantity = Math.trunc(Number(l?.quantity));
    const unitPrice = round2(Number(l?.unitPrice));
    if (!name) throw bad("Every line needs a name");
    if (!(quantity >= 1 && quantity <= 99))
      throw bad(`Quantity for "${name}" should be between 1 and 99`);
    if (!(unitPrice >= 0 && unitPrice <= 100000))
      throw bad(`Price for "${name}" isn't valid`);
    const kind =
      l?.kind === "service" || l?.kind === "product" ? l.kind : "custom";
    return { name, quantity, unitPrice, kind };
  });
};

const newNumber = () => {
  const d = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `BILL-${d}-${randomBytes(2).toString("hex").toUpperCase()}`;
};

export class BillService extends Connection {
  private ledger = new LedgerService();
  private notifications = new NotificationService();

  // ---- Studio side

  public async create(
    input: Record<string, unknown>,
    createdByUserId?: string,
  ) {
    const customerName = String(input.customerName ?? "")
      .trim()
      .slice(0, 80);
    if (!customerName) throw bad("Enter the customer's name");
    const items = cleanLines(input.items);
    const total = round2(
      items.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
    );
    if (!(total > 0)) throw bad("The bill comes to nothing");
    const customerEmail =
      String(input.customerEmail ?? "")
        .trim()
        .toLowerCase() || null;
    if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))
      throw bad("That email address doesn't look right");
    const customerPhone =
      String(input.customerPhone ?? "")
        .trim()
        .slice(0, 30) || null;
    // Tie it to the customer's account when they have one here.
    const account = customerEmail
      ? await this.user.findFirst({
          where: {
            email: { equals: customerEmail, mode: "insensitive" },
            role: "CUSTOMER",
          },
          select: { id: true },
        })
      : null;
    const bill = await this.bill.create({
      data: {
        number: newNumber(),
        customerName,
        customerPhone,
        customerEmail,
        ...(account ? { userId: account.id } : {}),
        items: items as never,
        total,
        note:
          String(input.note ?? "")
            .trim()
            .slice(0, 300) || null,
        token: randomBytes(18).toString("base64url"),
        ...(createdByUserId ? { createdByUserId } : {}),
      },
    });
    const withLink = await this.withLink(bill);
    await this.emailBill(bill, withLink.payUrl);
    return {
      message: bill.customerEmail
        ? "Bill created and emailed to the customer"
        : "Bill created",
      data: withLink,
    };
  }

  /** The bill goes to the customer's inbox too, when they gave an email. */
  private async emailBill(
    bill: {
      id: string;
      number: string;
      customerName: string;
      customerEmail: string | null;
      items: unknown;
      total: number;
      note: string | null;
      studioId: string | null;
    },
    payUrl: string | null,
  ) {
    if (!bill.customerEmail || !payUrl) return;
    try {
      const studio = await this.currentStudioBranding();
      const lines = (
        bill.items as { name: string; quantity: number; unitPrice: number }[]
      ).map((i) => ({
        name: i.name,
        quantity: i.quantity,
        total: ghs(i.unitPrice * i.quantity),
      }));
      const { subject, html } = billIssued(
        brandFromStudio(studio, storefrontFallbackBrand),
        {
          customerFirstName: firstName(bill.customerName),
          studioName: studio?.name ?? "the business",
          number: bill.number,
          lines,
          total: ghs(bill.total),
          note: bill.note,
          payUrl,
        },
      );
      await this.notifications.send({
        template: NotificationTemplate.BILL_ISSUED,
        to: bill.customerEmail,
        subject,
        html,
        studioId: bill.studioId,
        entityType: "Bill",
        entityId: bill.id,
      });
    } catch (e) {
      console.warn("Couldn't email the bill:", (e as Error).message);
    }
  }

  /** The pay link for a bill, on the business's own address. */
  private async withLink<T extends { token: string }>(bill: T) {
    const studio = await this.currentStudioBranding();
    return {
      ...bill,
      payUrl: studio ? studioLink(studio.slug, `/pay/${bill.token}`) : null,
    };
  }

  /**
   * One page of bills, newest first, optionally of one status. Totals and
   * counts come from the database over every bill, not just this page, so
   * they stay right however many bills there are.
   */
  public async list(status: string | undefined, page: CursorPage) {
    const where: { status?: "UNPAID" | "PAID" | "VOID" } =
      status === "UNPAID" || status === "PAID" || status === "VOID"
        ? { status }
        : {};
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0); // Ghana is on GMT (UTC+0)
    const [rows, byStatus, today] = await Promise.all([
      this.bill.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...cursorPageArgs(page),
      }),
      this.bill.groupBy({
        by: ["status"],
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.bill.groupBy({
        by: ["paidVia"],
        where: { status: "PAID", paidAt: { gte: startOfToday } },
        _sum: { total: true },
        _count: { _all: true },
      }),
    ]);
    const takenToday = (via: string[]) =>
      round2(
        today
          .filter((g) => via.includes(g.paidVia ?? "paystack"))
          .reduce((n, g) => n + (g._sum.total ?? 0), 0),
      );
    const { data, pagination } = cursorPageResult(rows, page);
    const withLinks = await Promise.all(data.map((b) => this.withLink(b)));
    const of = (s: string) => byStatus.find((g) => g.status === s);
    const counts = {
      UNPAID: of("UNPAID")?._count._all ?? 0,
      PAID: of("PAID")?._count._all ?? 0,
      VOID: of("VOID")?._count._all ?? 0,
    };
    return {
      message: "Bills",
      data: withLinks,
      pagination,
      totals: {
        unpaid: round2(of("UNPAID")?._sum.total ?? 0),
        paid: round2(of("PAID")?._sum.total ?? 0),
      },
      // What was taken today, by how it was paid.
      today: {
        cash: takenToday(["cash"]),
        counter: takenToday(["momo", "card"]),
        online: takenToday(["paystack"]),
        count: today.reduce((n, g) => n + g._count._all, 0),
      },
      counts: { ...counts, ALL: counts.UNPAID + counts.PAID + counts.VOID },
    };
  }

  public async void(id: string) {
    const bill = await this.bill.findUnique({ where: { id } });
    if (!bill) throw bad("Bill not found", 404);
    if (bill.status !== "UNPAID")
      throw bad("Only an unpaid bill can be cancelled");
    return {
      message: "Bill cancelled",
      data: await this.bill.update({ where: { id }, data: { status: "VOID" } }),
    };
  }

  /**
   * The customer paid at the counter instead: cash, Mobile Money to the
   * owner's own number, or a card machine. For cash the owner can enter what
   * was handed over, and the change is worked out and kept in the note. The
   * customer gets a receipt by email when they gave one.
   */
  public async markPaidOffline(
    id: string,
    method: unknown,
    note: unknown,
    received?: unknown,
  ) {
    const bill = await this.bill.findUnique({ where: { id } });
    if (!bill) throw bad("Bill not found", 404);
    if (bill.status !== "UNPAID")
      throw bad("This bill isn't waiting for payment");
    const via = method === "momo" || method === "card" ? method : "cash";
    const parts: string[] = [];
    const given = Number(received);
    if (via === "cash" && received !== undefined && received !== "") {
      if (!Number.isFinite(given) || given < bill.total)
        throw bad(`The cash received must be at least ${ghs(bill.total)}`);
      parts.push(
        `Received ${ghs(given)}${given > bill.total ? `, change ${ghs(round2(given - bill.total))}` : ""}`,
      );
    }
    const typed = String(note ?? "")
      .trim()
      .slice(0, 120);
    if (typed) parts.push(typed);
    const updated = await this.bill.update({
      where: { id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        paidVia: via,
        paidNote: parts.join(". ").slice(0, 200) || null,
      },
    });
    // A receipt for the customer; the admin who took the money knows already.
    await this.afterPaid(updated, { via, notifyAdmins: false });
    return {
      message: updated.customerEmail
        ? "Marked as paid and the receipt was emailed"
        : "Marked as paid",
      data: updated,
    };
  }

  /** Email an unpaid bill to the customer again, with its pay link. */
  public async remind(id: string) {
    const bill = await this.bill.findUnique({ where: { id } });
    if (!bill) throw bad("Bill not found", 404);
    if (bill.status !== "UNPAID")
      throw bad("Only a bill that is waiting for payment can be sent again");
    if (!bill.customerEmail)
      throw bad(
        "This bill has no email address. Send the link on WhatsApp instead",
      );
    const withLink = await this.withLink(bill);
    await this.emailBill(bill, withLink.payUrl);
    return { message: `Reminder sent to ${bill.customerEmail}` };
  }

  // ---- Customer side (by the secret in the link)

  private async byToken(token: string) {
    const bill = await this.bill.findFirst({ where: { token } });
    if (!bill) throw bad("This payment link isn't valid", 404);
    return bill;
  }

  public async publicView(token: string) {
    const bill = await this.byToken(token);
    const studio = await this.currentStudioBranding();
    const split =
      bill.status === "UNPAID"
        ? await this.paystackChargeFor(bill.total)
        : null;
    return {
      message: "Bill",
      data: {
        number: bill.number,
        business: studio?.name ?? "",
        customerName: bill.customerName,
        customerEmail: bill.customerEmail,
        items: bill.items,
        total: bill.total,
        processingFee: split?.processingFee ?? bill.processingFee,
        note: bill.note,
        status: bill.status,
        paidAt: bill.paidAt,
      },
    };
  }

  public async startPayment(token: string, rawEmail: unknown, origin?: string) {
    const bill = await this.byToken(token);
    if (bill.status !== "UNPAID")
      throw bad(
        bill.status === "PAID"
          ? "This bill is already paid"
          : "This bill was cancelled",
      );
    const email = String(rawEmail ?? bill.customerEmail ?? "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw bad("Enter your email so we can send your receipt");
    const reference = await this.makeReference("BILL");
    const split = await this.paystackChargeFor(bill.total);
    await this.bill.update({
      where: { id: bill.id },
      data: {
        reference,
        processingFee: split.processingFee,
        ...(bill.customerEmail ? {} : { customerEmail: email }),
      },
    });
    await this.ledger.openAttempt({
      reference,
      expectedAmount: bill.total,
      processingFee: split.processingFee,
      billId: bill.id,
      customerEmail: email,
      customerName: bill.customerName,
    });
    const init = await paystack.initialize({
      email,
      reference,
      callbackUrl: `${safeClientOrigin(origin)}/pay/${token}`,
      metadata: { billId: bill.id, billNumber: bill.number, kind: "bill" },
      ...split,
    });
    return {
      message: "Payment started",
      data: {
        authorizationUrl: init.authorization_url,
        reference,
        total: split.amountPesewas / 100,
        processingFee: split.processingFee,
        publicKey: env.paystack.publicKey,
      },
    };
  }

  /** Mobile Money for a bill, from the pay page itself (no redirect). */
  public async chargeMomo(
    token: string,
    rawEmail: unknown,
    phone: string,
    provider: string,
  ) {
    const bill = await this.byToken(token);
    if (bill.status !== "UNPAID")
      throw bad(
        bill.status === "PAID"
          ? "This bill is already paid"
          : "This bill was cancelled",
      );
    const email = String(rawEmail ?? bill.customerEmail ?? "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw bad("Enter your email so we can send your receipt");
    const reference = await this.makeReference("BILL");
    const split = await this.paystackChargeFor(bill.total);
    await this.bill.update({
      where: { id: bill.id },
      data: {
        reference,
        processingFee: split.processingFee,
        ...(bill.customerEmail ? {} : { customerEmail: email }),
      },
    });
    await this.ledger.openAttempt({
      reference,
      expectedAmount: bill.total,
      processingFee: split.processingFee,
      billId: bill.id,
      customerEmail: email,
      customerName: bill.customerName,
    });
    const res = await paystack.chargeMobileMoney({
      email,
      reference,
      phone,
      provider,
      metadata: { billId: bill.id, billNumber: bill.number, kind: "bill" },
      ...split,
    });
    return {
      message: "Charge started",
      data: {
        reference,
        status: res.status,
        displayText: res.display_text ?? res.message ?? null,
        amount: split.amountPesewas / 100,
        processingFee: split.processingFee,
      },
    };
  }

  /** On return from Paystack: check the payment with them, then mark the bill paid. */
  public async verifyPayment(token: string, reference: string) {
    const bill = await this.byToken(token);
    if (bill.status === "PAID") return this.publicView(token);
    if (!reference || (bill.reference && bill.reference !== reference))
      throw bad("That payment doesn't belong to this bill");
    const data = await paystack.verify(reference);
    await this.settle(bill.id, reference, data);
    return this.publicView(token);
  }

  /** Webhook path: no signed-in studio, so it works from the attempt. */
  public static async finalizeByReference(reference: string) {
    const attempt = await raw.paymentAttempt.findUnique({
      where: { reference },
    });
    if (!attempt?.billId || !attempt.studioId) return null;
    const data = await paystack.verify(reference);
    return runWithTenant({ studioId: attempt.studioId } as never, async () => {
      await new BillService().settle(attempt.billId!, reference, data);
      return true;
    });
  }

  /** Mark paid only when Paystack's own numbers match what we asked for. */
  private async settle(
    billId: string,
    reference: string,
    data: PaystackVerifyData,
  ) {
    const bill = await this.bill.findUnique({ where: { id: billId } });
    if (!bill || bill.status === "PAID") return;
    const attempt = await this.ledger.findAttempt(reference);
    if (!attempt) throw bad("Payment not found", 404);
    if (data.status !== "success") {
      if (data.status === "failed" || data.status === "abandoned")
        await this.ledger.settleAttempt(reference, data, {
          status: "FAILED",
          failureReason: String(data.status),
        });
      throw bad("Your payment hasn't gone through yet");
    }
    const check = this.ledger.assertAmountMatches(
      attempt.expectedAmount + attempt.processingFee,
      attempt.currency,
      data,
    );
    if (!check.ok) {
      // Anything other than the exact amount is refused, over or under. The
      // bill stays unpaid; what Paystack took has to be sorted out by hand.
      const wanted = Math.round(
        (attempt.expectedAmount + attempt.processingFee) * 100,
      );
      const over = Number(data.amount) > wanted;
      await this.ledger.settleAttempt(reference, data, {
        status: "FAILED",
        failureReason: `${over ? "Overpaid" : "Underpaid"}: ${check.reason}`,
      });
      if (bill.studioId)
        await notifyStudioAdmins(
          bill.studioId,
          {
            template: "BILL_AMOUNT_MISMATCH",
            entityId: `${bill.id}:${reference}`,
            entityType: "Bill",
          },
          {
            title: over ? "Bill overpaid" : "Bill underpaid",
            body: `${bill.number}: Paystack took GHS ${(Number(data.amount) / 100).toFixed(2)} but the bill is GHS ${(wanted / 100).toFixed(2)}. It was not marked paid. Refund it from Paystack (reference ${reference}).`,
            url: "/admin/bills",
          },
        ).catch(() => 0);
      throw bad(
        over
          ? "You paid more than this bill. It wasn't counted, and the business has been told to refund you. Please don't pay again."
          : "The amount paid doesn't match this bill, so it wasn't counted. Please contact the business.",
      );
    }
    await this.ledger.settleAttempt(reference, data, { status: "SUCCESS" });
    // Claim it once: a webhook and the customer's return can race.
    const claimed = await this.bill.updateMany({
      where: { id: billId, status: "UNPAID" },
      data: {
        status: "PAID",
        paidAt: new Date(),
        paidVia: "paystack",
        reference,
      },
    });
    if (claimed.count === 0) return;
    await this.afterPaid(bill);
  }

  private async afterPaid(
    bill: {
      id: string;
      number: string;
      customerName: string;
      customerEmail: string | null;
      items: unknown;
      total: number;
      processingFee?: number;
      studioId: string | null;
    },
    opts: { via?: string; notifyAdmins?: boolean } = {},
  ) {
    const methodLabel =
      opts.via === "cash"
        ? "Cash"
        : opts.via === "momo"
          ? "Mobile Money (paid to the business)"
          : opts.via === "card"
            ? "Card machine"
            : "Online payment";
    try {
      if (bill.studioId && opts.notifyAdmins !== false)
        await notifyStudioAdmins(
          bill.studioId,
          { template: "BILL_PAID", entityId: bill.id, entityType: "Bill" },
          {
            title: "Bill paid",
            body: `${bill.customerName} paid ${ghs(bill.total)} (${bill.number}).`,
            url: "/admin/bills",
          },
        );
      if (bill.customerEmail) {
        const studio = await this.currentStudioBranding();
        const lines = (
          bill.items as { name: string; quantity: number; unitPrice: number }[]
        ).map((i) => ({
          name: i.name,
          quantity: i.quantity,
          total: ghs(i.unitPrice * i.quantity),
        }));
        const { subject, html } = billReceipt(
          brandFromStudio(studio, storefrontFallbackBrand),
          {
            customerFirstName: firstName(bill.customerName),
            studioName: studio?.name ?? "the business",
            number: bill.number,
            lines,
            total: ghs(bill.total),
            paidOn: new Date().toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            }),
          },
        );
        // The receipt travels as a PDF, like every other payment receipt.
        const fee = bill.processingFee ?? 0;
        const pdf = buildReceiptPdf({
          studioName: studio?.name ?? "Zuri",
          primaryColor: studio?.primaryColor ?? null,
          title: "Payment receipt",
          receiptNumber: receiptNumber("RCP", bill.id),
          issuedAt: new Date(),
          heading: `Bill ${bill.number}`,
          lines: [
            { label: "Customer", value: bill.customerName },
            ...(
              bill.items as {
                name: string;
                quantity: number;
                unitPrice: number;
              }[]
            ).map((i) => ({
              label: `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ""}`,
              value: ghs(i.unitPrice * i.quantity),
            })),
            ...(fee > 0
              ? [{ label: "Payment processing fee", value: ghs(fee) }]
              : []),
            {
              label: "Amount paid",
              value: ghs(bill.total + fee),
              strong: true,
            },
          ],
          amountPaid: ghs(bill.total + fee),
          reference: bill.id,
          paymentMethod: methodLabel,
          paidToEmail: studio?.email ?? null,
          status: "PAID",
        });
        await this.notifications.send({
          template: NotificationTemplate.BILL_RECEIPT,
          to: bill.customerEmail,
          subject,
          html,
          studioId: bill.studioId,
          entityType: "Bill",
          entityId: bill.id,
          attachments: [
            {
              filename: pdf.filename,
              content: pdf.base64,
              contentType: "application/pdf",
            },
          ],
        });
      }
    } catch (e) {
      console.warn("Bill follow-up failed:", (e as Error).message);
    }
  }
}
