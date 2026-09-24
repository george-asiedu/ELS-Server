import { createHash } from "crypto";
import { Request } from "express";

export interface LoginDeviceMetadata {
  deviceId?: string;
  userAgent?: string;
  ipAddress?: string;
}

export const getLoginDeviceMetadata = (req: Request): LoginDeviceMetadata => {
  const rawDeviceId = req.get("x-device-id")?.trim();
  const userAgent = req.get("user-agent")?.slice(0, 256);
  const ipAddress = req.ip?.slice(0, 64);
  // Browser clients provide a persistent random ID. For API clients that omit
  // it, use a conservative UA/IP fingerprint; it can produce false new-device
  // alerts if their network address changes.
  const fallback = [userAgent ?? "", ipAddress ?? ""].join("|");
  const deviceId = rawDeviceId && /^[a-f0-9-]{36}$/i.test(rawDeviceId)
    ? rawDeviceId
    : fallback !== "|"
      ? `api:${createHash("sha256").update(fallback).digest("hex")}`
      : undefined;

  return {
    ...(deviceId ? { deviceId } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(ipAddress ? { ipAddress } : {}),
  };
};
