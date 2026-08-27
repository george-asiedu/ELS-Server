import { PrismaClient } from "../generated/prisma-client/client";
import { getTenantContext } from "./context";

// Models that carry a `studioId` discriminator and MUST be scoped to a studio.
// Anything not listed here (Studio, StudioBranding, StudioContent,
// StudioSettings, FeatureRequest — the platform models) is never auto-scoped
// and is managed explicitly by platform/super-admin code.
const SCOPED_MODELS = new Set<string>([
  "User",
  "Profile",
  "Appointment",
  "Service",
  "ServiceAddOn",
  "Payment",
  "PaymentSettings",
  "Review",
  "Gallery",
  "Category",
  "BusinessHours",
  "BlockedDate",
  "ContactInfo",
  "LoyaltyPoints",
  "LoyaltyTransaction",
  "ReferralCode",
  "Referral",
  "Product",
  "ProductCategory",
  "Cart",
  "CartItem",
  "Order",
  "OrderItem",
  "ReferralOrderReward",
  "CommerceSettings",
  "PromoBanner",
]);

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Flatten a `findUnique`-style where (WhereUniqueInput) into a `findFirst`-safe
 * where. Composite unique keys are passed as a single nested object, e.g.
 * `{ cartId_productId: { cartId, productId } }`, which `findFirst` rejects —
 * so we spread those members up to the top level. Composite keys are the only
 * where entries named with an underscore (joined field names), which no scalar
 * field in this schema uses.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toFindFirstWhere = (where: any, studioId: string) => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where ?? {})) {
    if (
      key.includes("_") &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      Object.assign(out, value);
    } else {
      out[key] = value;
    }
  }
  out.studioId = studioId;
  return out;
};

/**
 * Prisma client extension that transparently scopes every query on a
 * tenant-owned model to the current studio (from AsyncLocalStorage):
 *
 *  - reads/writes over many rows get `where.studioId` injected;
 *  - creates get `data.studioId` injected;
 *  - unique-target ops (findUnique/update/delete/upsert) — which can't take a
 *    non-unique field in `where` — are re-dispatched against the raw client
 *    with an ownership check so they can never touch another studio's row.
 *
 * It fails closed: a scoped model queried with no studio context throws, so a
 * forgotten context can't silently leak data across studios. Super admins
 * bypass scoping. The `raw` (un-extended) client is used for the internal
 * re-dispatches so this never recurses.
 */
export const tenantExtension = (raw: PrismaClient) => ({
  name: "tenant-scope",
  query: {
    $allModels: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async $allOperations({ model, operation, args, query }: any) {
        if (!SCOPED_MODELS.has(model)) return query(args);

        const ctx = getTenantContext();
        if (ctx?.superAdmin) return query(args);

        const studioId = ctx?.studioId;
        if (!studioId) {
          throw new Error(
            `Tenant scope missing for ${model}.${operation}: this query must run within a studio context.`,
          );
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delegate = (raw as any)[lcFirst(model)];
        const a = args ?? {};

        switch (operation) {
          case "findUnique":
          case "findUniqueOrThrow": {
            const res = await delegate.findFirst({
              ...a,
              where: toFindFirstWhere(a.where, studioId),
            });
            if (!res && operation === "findUniqueOrThrow") {
              throw new Error(`No ${model} found`);
            }
            return res;
          }

          case "findFirst":
          case "findFirstOrThrow":
          case "findMany":
          case "count":
          case "aggregate":
          case "groupBy":
          case "updateMany":
          case "deleteMany":
            return query({ ...a, where: { ...(a.where ?? {}), studioId } });

          case "create":
            return query({ ...a, data: { ...(a.data ?? {}), studioId } });

          case "createMany": {
            const data = Array.isArray(a.data)
              ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                a.data.map((d: any) => ({ ...d, studioId }))
              : { ...a.data, studioId };
            return query({ ...a, data });
          }

          case "update":
          case "delete": {
            // Can't add studioId to a unique `where`; verify ownership first.
            const owned = await delegate.findFirst({
              where: toFindFirstWhere(a.where, studioId),
              select: { id: true },
            });
            if (!owned) throw new Error(`No ${model} found in this studio`);
            return query(a);
          }

          case "upsert": {
            const owned = await delegate.findFirst({
              where: toFindFirstWhere(a.where, studioId),
              select: { id: true },
            });
            if (owned) {
              return delegate.update({ where: a.where, data: a.update });
            }
            return delegate.create({ data: { ...(a.create ?? {}), studioId } });
          }

          default:
            return query(a);
        }
      },
    },
  },
});
