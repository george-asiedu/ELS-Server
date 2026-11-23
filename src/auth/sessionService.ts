import jwt from "jsonwebtoken";
import { createTenantClient } from "../tenant/tenantClient";
import {
  TX_OPTIONS,
  isRetryableTransactionError,
} from "../db/transactionOptions";
import { loginToken } from "../utils/helper";
import { Payload } from "../models/user";
import { createHash } from "crypto";
import { bumpVersion, cached } from "../cache/cache";
import { LoginDeviceMetadata } from "./loginDevice";

const MAX_ACTIVE_SESSIONS = 3;
const { raw } = createTenantClient();

/** Mint and persist one revocable login session, evicting the oldest device. */
export const createLoginSession = async (
  user: Payload,
  device?: LoginDeviceMetadata,
) => {
  const tokens = loginToken(user);
  const decoded = jwt.decode(tokens.accessToken);
  if (!decoded || typeof decoded === "string" || !decoded.exp) {
    throw new Error("Could not determine access token expiry");
  }

  const now = new Date();
  const expiresAt = new Date(decoded.exp * 1000);
  // Serializable isolation prevents concurrent logins from both observing a
  // free slot and leaving more than three sessions active.
  const saveSession = () =>
    raw.$transaction(
      async (tx) => {
        await tx.authSession.deleteMany({
          where: { userId: user.id, expiresAt: { lte: now } },
        });

        let isNewDevice = false;
        if (device?.deviceId) {
          const deviceKey = createHash("sha256")
            .update(device.deviceId)
            .digest("hex");
          const known = await tx.authDevice.findUnique({
            where: { userId_deviceKey: { userId: user.id, deviceKey } },
          });
          if (known) {
            await tx.authDevice.update({
              where: { id: known.id },
              data: { lastSeenAt: now },
            });
          } else {
            const [knownDeviceCount, priorSessionCount] = await Promise.all([
              tx.authDevice.count({ where: { userId: user.id } }),
              tx.authSession.count({
                where: { userId: user.id, expiresAt: { gt: now } },
              }),
            ]);
            isNewDevice = knownDeviceCount > 0 || priorSessionCount > 0;
            await tx.authDevice.create({
              data: {
                userId: user.id,
                deviceKey,
                firstSeenAt: now,
                lastSeenAt: now,
              },
            });
          }
          // Replace this browser's prior session so repeated logins on one device
          // do not consume slots intended for other devices.
          await tx.authSession.deleteMany({
            where: {
              userId: user.id,
              deviceKey: createHash("sha256")
                .update(device.deviceId)
                .digest("hex"),
            },
          });
        }

        await tx.authSession.create({
          data: {
            id: tokens.sessionId,
            userId: user.id,
            studioId: user.studioId ?? null,
            ...(device?.deviceId
              ? {
                  deviceKey: createHash("sha256")
                    .update(device.deviceId)
                    .digest("hex"),
                }
              : {}),
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
        return isNewDevice;
      },
      { isolationLevel: "Serializable", ...TX_OPTIONS },
    );

  let isNewDevice: boolean | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      isNewDevice = await saveSession();
      break;
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  if (isNewDevice === undefined)
    throw new Error("Could not create login session");
  // A login can evict an older session on another device.
  await bumpVersion(`user-sessions:${user.id}`);

  return {
    token: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    },
    isNewDevice,
    deviceKey: device?.deviceId
      ? createHash("sha256").update(device.deviceId).digest("hex")
      : tokens.sessionId,
  };
};

export const isActiveLoginSession = async (
  sessionId: string,
  userId: string,
) => {
  // Checked on every signed-in request. Sign-outs bump the user's version, so
  // a revoked session stops working right away, not after the TTL.
  const expiresAt = await cached(
    `session:${sessionId}`,
    60,
    [`user-sessions:${userId}`],
    async () => {
      const session = await raw.authSession.findUnique({
        where: { id: sessionId },
      });
      return session?.userId === userId ? session.expiresAt.getTime() : 0;
    },
  );
  return expiresAt > Date.now();
};

const SESSION_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Keep an active user signed in: once a token is past half its life, issue a
 * fresh one for the same session. A session never outlives 3 days from sign-in,
 * then the user signs in again. Returns null when no renewal is due.
 */
export const renewLoginSession = async (decoded: {
  sub: string;
  email: string;
  role: Payload["role"];
  studioId?: string | null;
  jti: string;
  iat: number;
  exp: number;
}) => {
  const nowSeconds = Date.now() / 1000;
  if (nowSeconds < decoded.iat + (decoded.exp - decoded.iat) / 2) return null;
  const session = await raw.authSession.findUnique({
    where: { id: decoded.jti },
  });
  if (!session) return null;
  const cap = session.createdAt.getTime() + SESSION_LIFETIME_MS;
  const maxSeconds = Math.floor((cap - Date.now()) / 1000);
  if (maxSeconds <= 60) return null;
  const { accessToken } = loginToken(
    {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      studioId: decoded.studioId ?? null,
    },
    decoded.jti,
    Math.min(decoded.exp - decoded.iat, maxSeconds),
  );
  const fresh = jwt.decode(accessToken) as { exp: number };
  await raw.authSession.update({
    where: { id: decoded.jti },
    data: { expiresAt: new Date(fresh.exp * 1000) },
  });
  await bumpVersion(`user-sessions:${decoded.sub}`);
  return accessToken;
};

export const revokeLoginSessions = async (userId: string) => {
  await raw.authSession.deleteMany({ where: { userId } });
  await bumpVersion(`user-sessions:${userId}`);
};

export const forgetLoginDevices = async (userId: string) => {
  await raw.authDevice.deleteMany({ where: { userId } });
};

export const revokeLoginSession = async (sessionId: string, userId: string) => {
  await raw.authSession.deleteMany({ where: { id: sessionId, userId } });
  await bumpVersion(`user-sessions:${userId}`);
};

export const revokeStudioLoginSessions = async (studioId: string) => {
  const users = await raw.user.findMany({
    where: { studioId },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  await raw.authSession.deleteMany({ where: { studioId } });
  await bumpVersion(...userIds.map((id) => `user-sessions:${id}`));
  if (userIds.length) {
    await raw.authDevice.deleteMany({ where: { userId: { in: userIds } } });
  }
};
