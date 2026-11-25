import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";

// One password rule for every place a password is chosen: customer signup,
// studio onboarding, password reset, profile change and the super admin's
// reset. Before this, each place had its own copy and they disagreed (the
// reset/profile rule only accepted @$!%*?& as special characters and rejected
// any other character), so a password accepted at signup could be refused on
// reset. The web app uses the same rule (src/lib/passwordPolicy.ts).
//
// A "special" character is anything that is not a letter or a digit, which is
// what the web app has always checked. The maximum is bcrypt's 72-byte input
// limit: anything longer would be silently truncated when hashed.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

/** For JSON-schema (AJV) validators. Length is checked separately. */
export const PASSWORD_PATTERN =
  "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z\\d]).+$";

export const PASSWORD_RULE_MESSAGE =
  "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.";

const PASSWORD_RE = new RegExp(PASSWORD_PATTERN);

export const isStrongPassword = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= PASSWORD_MIN_LENGTH &&
  value.length <= PASSWORD_MAX_LENGTH &&
  PASSWORD_RE.test(value);

/** Throws a 400 with the rule when the password doesn't meet it. */
export const assertStrongPassword = (value: unknown): string => {
  if (!isStrongPassword(value)) {
    throw new ApiError(PASSWORD_RULE_MESSAGE, HttpCode.BAD_REQUEST);
  }
  return value;
};
