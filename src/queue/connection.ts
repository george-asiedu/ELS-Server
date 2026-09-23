import IORedis from "ioredis";
import { env } from "../config/env.config";

// A single shared ioredis connection for every BullMQ Queue/Worker in the app.
// Created lazily and only once REDIS_URL is configured — queues are entirely
// optional infrastructure (see queue/README.md for the degraded-mode behavior
// when this is null).
let connection: IORedis | null = null;
let attempted = false;

export const getRedisConnection = (): IORedis | null => {
  if (attempted) return connection;
  attempted = true;

  if (!env.redisUrl) return null;

  // BullMQ requires these two options on the connection it's given.
  connection = new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  connection.on("error", (err) => {
    console.error("Redis connection error (queues degraded):", err.message);
  });
  return connection;
};

export const isQueueEnabled = (): boolean => Boolean(env.redisUrl);
