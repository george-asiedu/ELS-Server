import { PrismaClient } from "../generated/prisma-client/client";
import { tenantExtension } from "./tenantExtension";

// Builds the pair of clients the app uses: `raw` is the plain PrismaClient
// (used for lifecycle + internal re-dispatch), `db` is the tenant-scoped client
// every service queries through.
const build = () => {
  const raw = new PrismaClient({} as never);
  const db = raw.$extends(tenantExtension(raw));
  return { raw, db };
};

let shared: ReturnType<typeof build> | null = null;

/**
 * The process-wide client pair, built once.
 *
 * Every service extends Connection, whose constructor calls this — and services
 * are constructed at module load AND as fields of other services, ~55 times
 * across the app. Returning a fresh PrismaClient each time meant ~55
 * independent connection pools against one database, which exhausts a hosted
 * Postgres (Neon) connection allowance and surfaces as P2024 "timed out
 * fetching a new connection from the connection pool" under no real load at
 * all.
 *
 * A single client is also what Prisma expects: it pools internally and is safe
 * to share across the whole process. The tenant extension holds no per-request
 * state — scoping is read from AsyncLocalStorage at query time (see
 * tenant/context.ts) — so one extended client serves every tenant correctly.
 */
export const createTenantClient = () => {
  shared ??= build();
  return shared;
};

/** Fresh, unshared clients. Only for tests that need pool isolation. */
export const createIsolatedTenantClient = build;

export type TenantClients = ReturnType<typeof build>;
export type RawDb = TenantClients["raw"];
export type TenantDb = TenantClients["db"];
