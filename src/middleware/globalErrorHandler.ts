import { Request, Response, NextFunction } from "express";
import { HttpCode } from "../models/status_codes";
import { ApiError } from "./apiError";

export const globalErrorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  let error = err;
  console.error("🔥 Original Error:", err);

  if (typeof err === "object" && err !== null && "name" in err) {
    const name = (err as any).name;
    if (name === "JsonWebTokenError") {
      error = new ApiError("Token is invalid", HttpCode.UNAUTHORIZED_ACCESS);
    } else if (name === "TokenExpiredError") {
      error = new ApiError("Token expired", HttpCode.UNAUTHORIZED_ACCESS);
    }
  }

  if (!(error instanceof ApiError)) {
      // CAPTURE THE ORIGINAL MESSAGE AND STACK BEFORE OVERWRITING
      const originalMessage = error.message || "An unexpected error occurred";
      const originalStack = error.stack;
  
      error = new ApiError(
        originalMessage, // Use the real error message in Dev
        HttpCode.INTERNAL_SERVER_ERROR,
      );
      
      // Restore the original stack trace so you can debug
      if(originalStack) error.stack = originalStack;
    }

  const nodeEnv = process.env.NODE_ENV || "development";
  const appError = error as ApiError;

  if (nodeEnv === "development") {
    res.status(appError.statusCode).json({
      status: appError.status,
      message: appError.message,
      stack: appError.stack,
    });
  } else {
    if (appError.isOperational) {
      res.status(appError.statusCode).json({
        status: appError.status,
        message: appError.message,
      });
    } else {
      console.error("ERROR", appError);
      res.status(500).json({
        status: "Error",
        message: "Something went wrong",
      });
    }
  }
};
