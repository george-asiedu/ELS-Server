import { Connection } from "../db/dbConnection";

export interface AuditActor {
  id?: string | null;
  email?: string;
  role?: string;
}

export interface AuditEntry {
  actor?: AuditActor | undefined;
  action: string;
  targetType?: string | undefined;
  targetId?: string | undefined;
  studioId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Records an append-only trail of platform/admin actions. Writes are
 * best-effort: an audit failure must never break the action being recorded.
 * AuditLog isn't tenant-scoped, so this works in both the super-admin (platform)
 * and studio-admin request contexts.
 */
export class AuditService extends Connection {
  public async record(entry: AuditEntry): Promise<void> {
    try {
      await this.auditLog.create({
        data: {
          actorId: entry.actor?.id ?? null,
          actorEmail: entry.actor?.email ?? "unknown",
          actorRole: entry.actor?.role ?? "unknown",
          action: entry.action,
          ...(entry.targetType ? { targetType: entry.targetType } : {}),
          ...(entry.targetId ? { targetId: entry.targetId } : {}),
          ...(entry.studioId ? { studioId: entry.studioId } : {}),
          ...(entry.metadata
            ? { metadata: entry.metadata as object }
            : {}),
        },
      });
    } catch (error) {
      console.error("Audit log write failed:", error);
    }
  }

  public async list(opts: {
    limit?: number | undefined;
    studioId?: string | undefined;
    action?: string | undefined;
    // Prefix match, e.g. "payment." to return every payment-related entry.
    actionPrefix?: string | undefined;
  }) {
    const take = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const where: {
      studioId?: string;
      action?: string | { startsWith: string };
    } = {};
    if (opts.studioId) where.studioId = opts.studioId;
    if (opts.action) where.action = opts.action;
    else if (opts.actionPrefix) where.action = { startsWith: opts.actionPrefix };

    const logs = await this.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
    });
    return { message: "Audit logs", data: logs };
  }
}
