import type { ValidateFunction } from "ajv";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { errorMessage } from "./helper";

/**
 * Validate `data` with a compiled AJV schema, or reject the request with a 400
 * carrying the readable message and AJV's error list. Narrows `data` to the
 * schema's type on success, like calling the validator directly would.
 */
export function assertValid<T>(
  validate: ValidateFunction<T>,
  data: unknown,
): asserts data is T {
  if (!validate(data)) {
    throw new ApiError(
      errorMessage(validate.errors) ?? "Invalid request",
      HttpCode.BAD_REQUEST,
      validate.errors ?? [],
    );
  }
}
