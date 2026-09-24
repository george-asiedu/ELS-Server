import jwt from "jsonwebtoken";
import { createTenantClient } from "../tenant/tenantClient";
import { loginToken } from "../utils/helper";
import { Payload } from "../models/user";

const MAX_ACTIVE_SESSIONS = 3;
const { raw } = createTenantClient();

/** Mint and persist one revocable login session, evicting the oldest device. */
export const createLoginSession = async (user: Payload) => {
  const tokens = loginToken(user);
  const decoded = jwt.decode(tokens.accessToken);
  if (!decoded || typeof decoded === "string" || !decoded.exp) {
    throw new Error("Could not determine access token expiry");
  }

  const now = new Date();
  const expiresAt = new Date(decoded.exp * 1000);
  // Serializable isolation prevents concurrent logins from both observing a
  // free slot and leaving more than three sessions active.
  await raw.$transaction(async (tx) => {
    await tx.authSession.deleteMany({
      where: { userId: user.id, expiresAt: { lte: now } },
    });
    await tx.authSession.create({
      data: {
        id: tokens.sessionId,
        userId: user.id,
        studioId: user.studioId ?? null,
        expiresAt,
      },
    });
    const active = await tx.authSession.findMany({
      where: { userId: user.id, expiresAt: { gt: now } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const evicted = active.slice(MAX_ACTIVE_SESSIONS).map(({ id }) => id);
    if (evicted.length) {
      await tx.authSession.deleteMany({ where: { id: { in: evicted } } });
    }
  }, { isolationLevel: "Serializable" });

  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
};

export const isActiveLoginSession = async (sessionId: string, userId: string) => {
  const session = await raw.authSession.findUnique({ where: { id: sessionId } });
  return Boolean(session && session.userId === userId && session.expiresAt > new Date());
};

export const revokeLoginSessions = async (userId: string) => {
  await raw.authSession.deleteMany({ where: { userId } });
};

export const revokeLoginSession = async (sessionId: string, userId: string) => {
  await raw.authSession.deleteMany({ where: { id: sessionId, userId } });
};

export const revokeStudioLoginSessions = async (studioId: string) => {
  await raw.authSession.deleteMany({ where: { studioId } });
};
