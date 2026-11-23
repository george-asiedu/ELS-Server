import { Request, Response, Router } from "express";
import { ApiError } from "../middleware/apiError";
import { authenticate, requireAdmin } from "../middleware/auth";
import { createTenantClient } from "../tenant/tenantClient";
import { runWithTenant } from "../tenant/context";
import { notifyStudioAdmins, notifyUsers } from "../push/pushService";
import { OrderService } from "./orderService";

// Deliveries. The rider gets a link (no account): it shows where to go and who
// to call, and the order is marked delivered when the rider enters the
// customer's handover code. A failed attempt is reported with a reason. At the
// counter, staff confirm a pickup with the same code.

const { raw } = createTenantClient();
const router: Router = Router();
const orders = new OrderService();
const MAX_TRIES = 5;

const findByToken = async (token: string) => {
  const order = await raw.order.findUnique({ where: { riderToken: token }, include: { items: true } });
  if (!order || !order.riderTokenExpires || order.riderTokenExpires < new Date())
    throw new ApiError("This delivery link has expired or already been used", 404);
  return order;
};

// Wrong codes are counted per order so a code can't be guessed.
const tries = new Map<string, number>();

/** What the rider needs: address, who to call, what's in the bag. */
router.get("/:token", async (req: Request, res: Response) => {
  const o = await findByToken(String(req.params.token));
  const studio = o.studioId ? await raw.studio.findUnique({ where: { id: o.studioId }, select: { name: true } }) : null;
  return res.status(200).json({
    data: {
      orderNumber: o.orderNumber,
      shop: studio?.name ?? "",
      customerName: o.customerName,
      phone: o.deliveryPhone ?? o.customerPhone,
      address: o.deliveryAddress,
      note: o.deliveryNote,
      eta: o.deliveryEta,
      zone: o.deliveryZone,
      slot: o.deliverySlot,
      items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, size: i.size, color: i.color })),
      status: o.status,
      failedReason: o.deliveryFailReason,
    },
  });
});

router.post("/:token/delivered", async (req: Request, res: Response) => {
  const o = await findByToken(String(req.params.token));
  const code = String(req.body?.code ?? "").trim();
  const used = tries.get(o.id) ?? 0;
  if (used >= MAX_TRIES) throw new ApiError("Too many wrong codes. Ask the shop to confirm the delivery.", 429);
  if (!o.handoverCode || code !== o.handoverCode) {
    tries.set(o.id, used + 1);
    throw new ApiError("That code isn't right. Ask the customer for the 4-digit code in their order.", 400);
  }
  tries.delete(o.id);
  await runWithTenant({ studioId: o.studioId } as never, () => orders.updateStatus(o.id, "FULFILLED"));
  if (o.studioId)
    await notifyStudioAdmins(
      o.studioId,
      { template: "ORDER_DELIVERED", entityId: o.id, entityType: "Order" },
      { title: "Delivered", body: `Order ${o.orderNumber} was delivered to ${o.customerName ?? "the customer"}.`, url: "/admin/orders" },
    ).catch(() => 0);
  return res.status(200).json({ message: "Marked as delivered. Thank you." });
});

router.post("/:token/failed", async (req: Request, res: Response) => {
  const o = await findByToken(String(req.params.token));
  const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim().slice(0, 200) : "No reason given";
  await raw.order.update({ where: { id: o.id }, data: { deliveryFailedAt: new Date(), deliveryFailReason: reason } });
  if (o.studioId)
    await notifyStudioAdmins(
      o.studioId,
      { template: "ORDER_DELIVERY_FAILED", entityId: `${o.id}:${Date.now()}`, entityType: "Order" },
      { title: "Delivery didn't happen", body: `Order ${o.orderNumber}: ${reason}`, url: "/admin/orders" },
    ).catch(() => 0);
  if (o.userId)
    await notifyUsers([o.userId], {
      title: "We couldn't deliver your order",
      body: `Order ${o.orderNumber}: ${reason}. The shop will be in touch to arrange another time.`,
      url: "/account?tab=orders",
    }).catch(() => 0);
  return res.status(200).json({ message: "Reported. The shop has been told." });
});

/** Admin, at the counter: the customer shows their code to collect a pickup. */
export const handoverRouter: Router = Router();
handoverRouter.post("/:id/handover", authenticate, requireAdmin, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const o = await raw.order.findUnique({ where: { id } });
  if (!o || o.studioId !== req.studioId) throw new ApiError("Order not found", 404);
  const used = tries.get(o.id) ?? 0;
  if (used >= MAX_TRIES) throw new ApiError("Too many wrong codes. Check the customer's order page with them.", 429);
  if (!o.handoverCode || String(req.body?.code ?? "").trim() !== o.handoverCode) {
    tries.set(o.id, used + 1);
    throw new ApiError("That code doesn't match this order", 400);
  }
  tries.delete(o.id);
  return res.status(200).json(await orders.updateStatus(o.id, "FULFILLED"));
});

export default router;
