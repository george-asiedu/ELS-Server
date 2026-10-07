import { HttpCode } from "../models/status_codes";

export class ApiError extends Error {
  public readonly status: string;
  public readonly statusCode: HttpCode;
  public readonly isOperational: boolean;
  // Field-level detail for a failed request validation, returned to the
  // client alongside the message (see utils/validation.ts).
  public readonly errors: readonly unknown[] | undefined;

  constructor(
    message: string,
    statusCode: HttpCode,
    errors?: readonly unknown[],
  ) {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype);

    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.statusCode = statusCode;
    this.isOperational = true;
    this.errors = errors;

    Error.captureStackTrace(this, this.constructor);
  }
}
