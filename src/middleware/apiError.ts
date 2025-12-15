import { HttpCode } from "../models/status_codes";

export class ApiError extends Error {
  public readonly status: string;
  public readonly statusCode: HttpCode;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: HttpCode) {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype);

    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}
