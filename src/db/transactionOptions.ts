/**
 * Limits for interactive transactions.
 *
 * Prisma's defaults wait 2s for a connection and give a transaction 5s to
 * finish. The database is a network hop away (Neon, ~250ms per round trip
 * measured from Accra) and a suspended Neon compute can take a few seconds to
 * wake, so a perfectly healthy ten-query transaction could be cut off part way
 * and fail with "Transaction not found" (P2028).
 */
export const TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 20_000,
} as const;

/**
 * Errors where the transaction rolled back and running it again is safe:
 * a serialization conflict (P2034) or a transaction that was closed before it
 * finished, e.g. by a timeout (P2028).
 */
export const isRetryableTransactionError = (error: unknown): boolean => {
  const code = (error as { code?: string } | null)?.code;
  return code === "P2034" || code === "P2028";
};
