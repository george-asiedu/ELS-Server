import { AsyncLocalStorage } from "async_hooks";

// The tenant a request is operating within. `studioId` scopes every query to
// one studio; `superAdmin` bypasses scoping entirely for platform-wide access.
export interface TenantContext {
  studioId: string | null;
  superAdmin: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

// Run `fn` (and everything it awaits) with the given tenant context attached.
// The tenant Prisma extension reads this to scope queries.
export const runWithTenant = <T>(ctx: TenantContext, fn: () => T): T =>
  storage.run(ctx, fn);

export const getTenantContext = (): TenantContext | undefined =>
  storage.getStore();

// For platform/super-admin work that must see across all studios.
export const runAsSuperAdmin = <T>(fn: () => T): T =>
  storage.run({ studioId: null, superAdmin: true }, fn);

// For scripts/jobs that must operate within a single studio outside a request.
export const runInStudio = <T>(studioId: string, fn: () => T): T =>
  storage.run({ studioId, superAdmin: false }, fn);
