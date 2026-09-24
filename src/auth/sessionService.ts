import jwt from "jsonwebtoken";
import { createTenantClient } from "../tenant/tenantClient";
import { loginToken } from "../utils/helper";
import { Payload } from "../models/user";
import { createHash } from "crypto";
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
  const saveSession = () => raw.$transaction(async (tx) => {
    await tx.authSession.deleteMany({
      where: { userId: user.id, expiresAt: { lte: now } },
    });

    let isNewDevice = false;
    if (device?.deviceId) {
      const deviceKey = createHash("sha256").update(device.deviceId).digest("hex");
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
          data: { userId: user.id, deviceKey, firstSeenAt: now, lastSeenAt: now },
        });
      }
      // Replace this browser's prior session so repeated logins on one device
      // do not consume slots intended for other devices.
      await tx.authSession.deleteMany({
        where: {
          userId: user.id,
          deviceKey: createHash("sha256").update(device.deviceId).digest("hex"),
        },
      });
    }

    await tx.authSession.create({
      data: {
        id: tokens.sessionId,
        userId: user.id,
        studioId: user.studioId ?? null,
        ...(device?.deviceId
          ? { deviceKey: createHash("sha256").update(device.deviceId).digest("hex") }
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
  }, { isolationLevel: "Serializable" });

  let isNewDevice: boolean | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      isNewDevice = await saveSession();
      break;
    } catch (error) {
      const retryable = typeof error === "object" && error !== null &&
        "code" in error && error.code === "P2034";
      if (!retryable || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  if (isNewDevice === undefined) throw new Error("Could not create login session");

  return {
    token: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
    isNewDevice,
    deviceKey: device?.deviceId
      ? createHash("sha256").update(device.deviceId).digest("hex")
      : tokens.sessionId,
  };
};

export const isActiveLoginSession = async (sessionId: string, userId: string) => {
  const session = await raw.authSession.findUnique({ where: { id: sessionId } });
  return Boolean(session && session.userId === userId && session.expiresAt > new Date());
};

export const revokeLoginSessions = async (userId: string) => {
  await raw.authSession.deleteMany({ where: { userId } });
};

export const forgetLoginDevices = async (userId: string) => {
  await raw.authDevice.deleteMany({ where: { userId } });
};

export const revokeLoginSession = async (sessionId: string, userId: string) => {
  await raw.authSession.deleteMany({ where: { id: sessionId, userId } });
};

export const revokeStudioLoginSessions = async (studioId: string) => {
  const users = await raw.user.findMany({ where: { studioId }, select: { id: true } });
  const userIds = users.map(({ id }) => id);
  await raw.authSession.deleteMany({ where: { studioId } });
  if (userIds.length) {
    await raw.authDevice.deleteMany({ where: { userId: { in: userIds } } });
  }
};
