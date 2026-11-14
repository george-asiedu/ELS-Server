import { randomInt } from "crypto";
import { Connection, TenantTx } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { paystack, PaystackVerifyData } from "../payment/paystackClient";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { brandFromStudio, firstName, storefrontFallbackBrand } from "../notifications/brand";
import { renderShell, button, esc, brandColor } from "../notifications/design/shell";
import { env } from "../config/env.config";
import { getTenantContext, runWithTenant } from "../tenant/context";
import { createTenantClient } from "../tenant/tenantClient";
import { studioLink } from "../utils/studioLink";
import { safeClientOrigin } from "../utils/helper";

// Gift cards (a GHS balance) and packages (sessions of one service), bought
// online through Paystack like any other payment, then used with a code when
// booking or checking out, or redeemed in person by the studio.

const { raw } = createTenantClient();
const r2 = (n: number) => Math.round(n * 100) / 100;
const MIN_GIFT = 20;
const MAX_GIFT = 10000;
export const VOUCHER_REF_PREFIX = "VCH-";
export const isVoucherReference = (ref: string) => ref.startsWith(VOUCHER_REF_PREFIX);

// No 0/O or 1/I, so a code read out over the phone can't be misheard.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = (prefix: "GIFT" | "PACK") => {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${prefix}-${part()}-${part()}`;
};
export const normalizeCode = (raw: unknown) =>
  typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "") : "";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const email = (v: unknown) => {
  const e = str(v, 120).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
};

export class VoucherService extends Connection {
  private notifications = new NotificationService();

  // ---- Buying

  private async startPurchase(data: {
    kind: "GIFT_CARD" | "PACKAGE";
    price: number;
    balance: number;
    packageOfferId?: string;
    serviceId?: string;
    sessions?: number;
    buyerUserId?: string;
    buyerName: string;
    buyerEmail: string;
    recipientName?: string | null;
    recipientEmail?: string | null;
    message?: string | null;
    origin?: string;
  }) {
    const reference = `${VOUCHER_REF_PREFIX}${await this.makeReference(data.kind === "GIFT_CARD" ? "GFT" : "PKG")}`;
    const split = await this.paystackChargeFor(data.price);
    await this.voucher.create({
      data: {
        kind: data.kind,
        code: newCode(data.kind === "GIFT_CARD" ? "GIFT" : "PACK"),
        price: data.price,
        processingFee: split.processingFee,
        reference,
        balance: data.balance,
        ...(data.packageOfferId ? { packageOfferId: data.packageOfferId } : {}),
        ...(data.serviceId ? { serviceId: data.serviceId } : {}),
        sessionsTotal: data.sessions ?? 0,
        sessionsLeft: data.sessions ?? 0,
        ...(data.buyerUserId ? { buyerUserId: data.buyerUserId } : {}),
        buyerName: data.buyerName,
        buyerEmail: data.buyerEmail,
        recipientName: data.recipientName ?? null,
        recipientEmail: data.recipientEmail ?? null,
        message: data.message ?? null,
      },
    });
    const init = await paystack.initialize({
      email: data.buyerEmail,
      reference,
      callbackUrl: `${safeClientOrigin(data.origin)}/gift-cards/callback`,
      metadata: { kind: "voucher" },
      ...split,
    });
    return {
      message: "Payment started",
      data: {
        authorizationUrl: init.authorization_url,
        accessCode: init.access_code,
        reference,
        amount: split.amountPesewas / 100,
        processingFee: split.processingFee,
        email: data.buyerEmail,
        subaccount: split.subaccount,
        publicKey: env.paystack.publicKey,
      },
    };
  }

  private buyer(input: Record<string, unknown>) {
    const buyerName = str(input.buyerName, 80);
    const buyerEmail = email(input.buyerEmail);
    if (!buyerName) throw new ApiError("Enter your name", 400);
    if (!buyerEmail) throw new ApiError("Enter a valid email for your receipt", 400);
    return { buyerName, buyerEmail };
  }

  public async buyGiftCard(input: Record<string, unknown>, userId?: string, origin?: string) {
    const amount = r2(Number(input.amount));
    if (!Number.isFinite(amount) || amount < MIN_GIFT || amount > MAX_GIFT)
      throw new ApiError(`Choose an amount from GHS ${MIN_GIFT} to GHS ${MAX_GIFT.toLocaleString("en-GB")}`, 400);
    const recipientEmail = input.recipientEmail ? email(input.recipientEmail) : null;
    if (input.recipientEmail && !recipientEmail) throw new ApiError("Enter a valid email for the person receiving it", 400);
    return this.startPurchase({
      kind: "GIFT_CARD",
      price: amount,
      balance: amount,
      ...this.buyer(input),
      ...(userId ? { buyerUserId: userId } : {}),
      recipientName: str(input.recipientName, 80) || null,
      recipientEmail,
      message: str(input.message, 300) || null,
      ...(origin ? { origin } : {}),
    });
  }

  public async buyPackage(input: Record<string, unknown>, userId?: string, origin?: string) {
    const offer = await this.packageOffer.findUnique({ where: { id: str(input.packageId, 64) } });
    if (!offer || !offer.active) throw new ApiError("That package isn't available", 404);
    return this.startPurchase({
      kind: "PACKAGE",
      price: offer.price,
      balance: 0,
      packageOfferId: offer.id,
      serviceId: offer.serviceId,
      sessions: offer.sessions,
      ...this.buyer(input),
      ...(userId ? { buyerUserId: userId } : {}),
      ...(origin ? { origin } : {}),
    });
  }

  /** Called from the payment page and the webhook. Activates once. */
  public async finalizeByReference(reference: string, data?: PaystackVerifyData) {
    const v = await raw.voucher.findUnique({ where: { reference } });
    if (!v) return null;
    if (v.status !== "PENDING") return v;
    const vd = data ?? (await paystack.verify(reference));
    if (vd.status !== "success") return v;
    const expected = Math.round((v.price + v.processingFee) * 100);
    if (Math.abs(Number(vd.amount) - expected) > 0.5) {
      console.warn(`Voucher ${reference}: expected ${expected} pesewas, Paystack reported ${vd.amount}`);
      return v;
    }
    const updated = await raw.voucher.updateMany({
      where: { id: v.id, status: "PENDING" },
      data: { status: "ACTIVE", paidAt: vd.paid_at ? new Date(vd.paid_at) : new Date() },
    });
    if (updated.count === 1 && v.studioId) {
      await runWithTenant({ studioId: v.studioId } as never, () => this.sendCode(v.id)).catch((e) =>
        console.warn("Voucher email failed:", (e as Error).message),
      );
    }
    return raw.voucher.findUnique({ where: { id: v.id } });
  }

  public async verify(reference: string) {
    const v = await this.finalizeByReference(reference);
    if (!v) throw new ApiError("Purchase not found", 404);
    return { message: v.status === "ACTIVE" ? "Payment confirmed" : "Payment not confirmed yet", data: this.publicView(v) };
  }

  /** The code goes to the recipient (gift card) or the buyer (package). */
  private async sendCode(id: string) {
    const v = await this.voucher.findUniqueOrThrow({ where: { id } });
    const studio = await this.currentStudioBranding(v.studioId ?? undefined);
    if (!studio) return;
    const brand = brandFromStudio(studio, storefrontFallbackBrand);
    const service = v.serviceId ? await this.service.findUnique({ where: { id: v.serviceId }, select: { name: true } }) : null;
    const gift = v.kind === "GIFT_CARD";
    const to = gift ? (v.recipientEmail ?? v.buyerEmail) : v.buyerEmail;
    const name = gift ? (v.recipientName ?? v.buyerName) : v.buyerName;
    const fromSomeoneElse = gift && v.recipientEmail && v.recipientEmail !== v.buyerEmail;
    const codeBox = `<p style="margin: 20px 0; padding: 16px; border: 1px dashed #C9CED6; text-align: left; font-family: 'Courier New', monospace; font-size: 22px; font-weight: bold; letter-spacing: 2px;">${esc(v.code)}</p>`;
    const subject = gift
      ? fromSomeoneElse
        ? `${v.buyerName} sent you a GHS ${v.price.toFixed(2)} gift card for ${studio.name}`
        : `Your GHS ${v.price.toFixed(2)} gift card for ${studio.name}`
      : `Your ${service?.name ?? "package"} package at ${studio.name}`;
    const html = renderShell({
      brand,
      previewText: gift ? `Use code ${v.code} when you book or buy.` : `${v.sessionsTotal} sessions, ready to book.`,
      documentType: gift ? "Gift card" : "Package",
      bodyHtml: gift
        ? `<h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">Hi ${esc(firstName(name))}, here's your gift card</h1>
           <p style="margin: 0 0 8px; font-size: 15px; line-height: 1.6; color: #333;">
             ${fromSomeoneElse ? `${esc(v.buyerName)} has sent you a gift card worth <strong>GHS ${v.price.toFixed(2)}</strong> to spend at ${esc(studio.name)}.` : `Your gift card worth <strong>GHS ${v.price.toFixed(2)}</strong> for ${esc(studio.name)} is ready.`}
           </p>
           ${v.message ? `<p style="margin: 12px 0; padding: 12px 16px; background: #F5F6F7; font-size: 15px; line-height: 1.6; color: #333;">"${esc(v.message)}"</p>` : ""}
           ${codeBox}
           <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #545B64;">Enter this code when you book or check out, or show it at ${esc(studio.name)}. Anything you don't spend stays on the card for next time.</p>
           ${button("Use it now", studioLink(studio.slug, "/"), brandColor(brand))}`
        : `<h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">Thank you, ${esc(firstName(name))}</h1>
           <p style="margin: 0 0 8px; font-size: 15px; line-height: 1.6; color: #333;">
             Your package of <strong>${v.sessionsTotal} ${esc(service?.name ?? "")} sessions</strong> at ${esc(studio.name)} is paid for.
           </p>
           ${codeBox}
           <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #545B64;">Enter this code when you book ${esc(service?.name ?? "the service")}, and each booking uses one session.</p>
           ${button("Book a session", studioLink(studio.slug, v.serviceId ? `/book?service=${v.serviceId}` : "/book"), brandColor(brand))}`,
    });
    await this.notifications.send({
      template: NotificationTemplate.VOUCHER_DELIVERED,
      to,
      subject,
      html,
      studioId: v.studioId,
      entityType: "Voucher",
      entityId: v.id,
    });
  }

  private publicView(v: {
    kind: string;
    code: string;
    status: string;
    price: number;
    balance: number;
    sessionsLeft: number;
    sessionsTotal: number;
    serviceId: string | null;
    recipientEmail: string | null;
    buyerEmail: string;
  }) {
    return {
      kind: v.kind,
      status: v.status,
      price: v.price,
      balance: v.balance,
      sessionsLeft: v.sessionsLeft,
      sessionsTotal: v.sessionsTotal,
      serviceId: v.serviceId,
      // Where the code was sent (the code itself only goes by email).
      sentTo: v.kind === "GIFT_CARD" ? (v.recipientEmail ?? v.buyerEmail) : v.buyerEmail,
    };
  }

  // ---- Using

  /** What a code is worth here: for the booking page and checkout. */
  public async check(rawCode: unknown, serviceId?: unknown) {
    const code = normalizeCode(rawCode);
    const v = code ? await this.voucher.findFirst({ where: { code } }) : null;
    if (!v || v.status === "PENDING") throw new ApiError("That code isn't valid", 404);
    if (v.status === "USED" || (v.kind === "GIFT_CARD" ? v.balance <= 0 : v.sessionsLeft <= 0))
      throw new ApiError("That code has been used up", 400);
    if (v.kind === "PACKAGE" && typeof serviceId === "string" && serviceId && v.serviceId !== serviceId)
      throw new ApiError("That package is for a different service", 400);
    const service = v.serviceId ? await this.service.findUnique({ where: { id: v.serviceId }, select: { name: true } }) : null;
    return {
      data: {
        code: v.code,
        kind: v.kind,
        balance: v.balance,
        sessionsLeft: v.sessionsLeft,
        serviceId: v.serviceId,
        serviceName: service?.name ?? null,
      },
    };
  }

  /**
   * Take value from a code inside the caller's transaction. Returns how much it
   * covered (GHS). Gift cards cover up to their balance; a package covers the
   * whole price of its service and uses one session.
   */
  public async redeem(
    tx: Pick<TenantTx, "voucher">,
    rawCode: unknown,
    use: { amount: number; serviceId?: string },
  ): Promise<{ voucherId: string; covered: number }> {
    const code = normalizeCode(rawCode);
    const v = await tx.voucher.findFirst({ where: { code, status: "ACTIVE" } });
    if (!v) throw new ApiError("That gift card or package code isn't valid", 400);
    if (v.kind === "PACKAGE") {
      if (!use.serviceId || use.serviceId !== v.serviceId) throw new ApiError("That package is for a different service", 400);
      const res = await tx.voucher.updateMany({
        where: { id: v.id, sessionsLeft: { gt: 0 } },
        data: { sessionsLeft: { decrement: 1 }, ...(v.sessionsLeft <= 1 ? { status: "USED" } : {}) },
      });
      if (res.count !== 1) throw new ApiError("That package has no sessions left", 400);
      return { voucherId: v.id, covered: r2(use.amount) };
    }
    const covered = r2(Math.min(v.balance, use.amount));
    if (covered <= 0) throw new ApiError("That gift card has no balance left", 400);
    const res = await tx.voucher.updateMany({
      where: { id: v.id, balance: { gte: covered } },
      data: { balance: { decrement: covered }, ...(v.balance - covered <= 0.004 ? { status: "USED" } : {}) },
    });
    if (res.count !== 1) throw new ApiError("That gift card has just been used. Check its balance and try again.", 409);
    return { voucherId: v.id, covered };
  }

  /** Give back what a cancelled booking or order took from a code. */
  public async restore(voucherId: string, covered: number) {
    const v = await this.voucher.findUnique({ where: { id: voucherId } });
    if (!v || covered <= 0) return;
    await this.voucher.update({
      where: { id: v.id },
      data:
        v.kind === "PACKAGE"
          ? { sessionsLeft: { increment: 1 }, status: "ACTIVE" }
          : { balance: { increment: covered }, status: "ACTIVE" },
    });
  }

  // ---- Admin

  public async list() {
    const data = await this.voucher.findMany({ where: { status: { not: "PENDING" } }, orderBy: { createdAt: "desc" }, take: 200 });
    return { data };
  }

  /** In person: take an amount off a gift card, or use a package session. */
  public async redeemInPerson(id: string, amountRaw: unknown) {
    const v = await this.voucher.findUnique({ where: { id } });
    if (!v || v.status === "PENDING") throw new ApiError("Not found", 404);
    const amount = v.kind === "GIFT_CARD" ? r2(Number(amountRaw)) : 0;
    if (v.kind === "GIFT_CARD" && (!(amount > 0) || amount > v.balance))
      throw new ApiError(`Enter an amount up to GHS ${v.balance.toFixed(2)}`, 400);
    await this.withAdvisoryLock(`voucher:${v.id}`, (tx) =>
      this.redeem(tx, v.code, { amount: v.kind === "GIFT_CARD" ? amount : 0, ...(v.serviceId ? { serviceId: v.serviceId } : {}) }),
    );
    return { message: v.kind === "GIFT_CARD" ? `GHS ${amount.toFixed(2)} taken off the gift card` : "One session used" };
  }

  public async listOffers(activeOnly: boolean) {
    const data = await this.packageOffer.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: { createdAt: "asc" },
    });
    return { data };
  }

  public async saveOffer(id: string | null, input: Record<string, unknown>) {
    const serviceId = str(input.serviceId, 64);
    const service = await this.service.findUnique({ where: { id: serviceId }, select: { name: true } });
    if (!service) throw new ApiError("Pick a service", 400);
    const sessions = Math.trunc(Number(input.sessions));
    const price = r2(Number(input.price));
    if (!(sessions >= 2 && sessions <= 50)) throw new ApiError("A package has 2 to 50 sessions", 400);
    if (!(price > 0)) throw new ApiError("Enter a price", 400);
    const data = {
      serviceId,
      sessions,
      price,
      name: str(input.name, 80) || `${sessions} × ${service.name}`,
      active: input.active === undefined ? true : input.active === true,
    };
    const offer = id ? await this.packageOffer.update({ where: { id }, data }) : await this.packageOffer.create({ data });
    return { message: "Saved", data: offer };
  }

  public async removeOffer(id: string) {
    await this.packageOffer.delete({ where: { id } });
    return { message: "Package removed. Ones already bought still work." };
  }

  /** The current studio, for webhook-free contexts that need it. */
  public currentStudioId() {
    return getTenantContext()?.studioId ?? null;
  }
}
