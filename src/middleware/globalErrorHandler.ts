import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";
import { HttpCode } from "../models/status_codes";
import { ApiError } from "./apiError";

// What a customer sees when something breaks on our side. Never leaks a stack,
// a driver message, or a table name — those go to the logs under `reference`,
// which the user is told to quote to support.
const FALLBACK_MESSAGE =
  "Something went wrong on our end and your request didn't go through. " +
  "Nothing was charged. Please try again in a moment.";

// Infrastructure failures a user can actually act on. Anything not listed here
// falls through to FALLBACK_MESSAGE rather than exposing the raw error.
const friendlyFor = (err: Error): ApiError | null => {
  const name = (err as { name?: string }).name ?? "";
  // Prisma is inconsistent: query errors expose `code` (P2002, P2025) while
  // PrismaClientInitializationError exposes `errorCode` (P1001 — server
  // unreachable, which is exactly the case we most want to phrase kindly).
  const code =
    (err as { code?: string }).code ??
    (err as { errorCode?: string }).errorCode ??
    "";

  if (name === "JsonWebTokenError") {
    return new ApiError(
      "Your session isn't valid. Please sign in again.",
      HttpCode.UNAUTHORIZED_ACCESS,
    );
  }
  if (name === "TokenExpiredError") {
    return new ApiError(
      "Your session has expired. Please sign in again.",
      HttpCode.UNAUTHORIZED_ACCESS,
    );
  }
  if (name === "SyntaxError" && (err as { status?: number }).status === 400) {
    return new ApiError(
      "We couldn't read that request. Please refresh the page and try again.",
      HttpCode.BAD_REQUEST,
    );
  }
  if ((err as { status?: number }).status === 413) {
    return new ApiError(
      "That file is too large. Please upload something smaller and try again.",
      HttpCode.PAYLOAD_TOO_LARGE,
    );
  }

  // Prisma: only the cases with a safe, specific user-facing meaning.
  if (code === "P2002") {
    return new ApiError(
      "That already exists. Please use a different value and try again.",
      HttpCode.CONFLICT,
    );
  }
  if (code === "P2025") {
    return new ApiError(
      "We couldn't find what you were looking for. It may have been removed.",
      HttpCode.NOT_FOUND,
    );
  }
  // Database unreachable / connection pool exhausted.
  if (code === "P1001" || code === "P1002" || code === "P2024") {
    return new ApiError(
      "We're having trouble reaching our servers right now. " +
        "Please try again in a few moments.",
      HttpCode.BAD_GATEWAY,
    );
  }

  // Serverless Postgres (Neon) cold starts surface as an initialization error,
  // sometimes with no code attached at all.
  if (name === "PrismaClientInitializationError") {
    return new ApiError(
      "We're having trouble reaching our servers right now. " +
        "Please try again in a few moments.",
      HttpCode.BAD_GATEWAY,
    );
  }

  // Upstream (Paystack, S3, email) unreachable.
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"].includes(code)) {
    return new ApiError(
      "We couldn't reach a service we depend on. " +
        "Please try again in a few moments.",
      HttpCode.BAD_GATEWAY,
    );
  }

  return null;
};

export const globalErrorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  let error: Error = err;

  if (!(error instanceof ApiError)) {
    error = friendlyFor(error) ?? error;
  }

  const isKnown = error instanceof ApiError;
  const appError = isKnown ? (error as ApiError) : null;
  const statusCode = appError?.statusCode ?? HttpCode.INTERNAL_SERVER_ERROR;

  // A 5xx is our fault and is never explained to the user in detail. Tag it so
  // the log line and the user's message share one id they can quote to support.
  const isServerFault = statusCode >= 500;
  const reference = isServerFault ? randomUUID().slice(0, 8).toUpperCase() : null;

  if (isServerFault) {
    console.error(
      JSON.stringify({
        level: "error",
        reference,
        method: req.method,
        path: req.originalUrl,
        statusCode,
        message: err.message,
        stack: err.stack,
      }),
    );
  }

  // 4xx messages are written for users already (they come from ApiError call
  // sites), so they pass through. 5xx never does.
  const message = isServerFault
    ? FALLBACK_MESSAGE
    : (appError?.message ?? FALLBACK_MESSAGE);

  res.status(statusCode).json({
    status: statusCode >= 500 ? "error" : "fail",
    message,
    ...(reference ? { reference } : {}),
    // Stacks are for local debugging only, and only on our own faults.
    ...(process.env.NODE_ENV === "development" && isServerFault
      ? { debug: { message: err.message, stack: err.stack } }
      : {}),
  });
};
