import { PrismaClient } from "../generated/prisma-client/client";
import { tenantExtension } from "./tenantExtension";

// Builds the pair of clients the app uses: `raw` is the plain PrismaClient
// (used for lifecycle + internal re-dispatch), `db` is the tenant-scoped client
// every service queries through.
export const createTenantClient = () => {
  const raw = new PrismaClient({} as never);
  const db = raw.$extends(tenantExtension(raw));
  return { raw, db };
};

export type TenantClients = ReturnType<typeof createTenantClient>;
export type RawDb = TenantClients["raw"];
export type TenantDb = TenantClients["db"];
