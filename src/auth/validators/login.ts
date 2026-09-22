import Ajv, { JSONSchemaType } from "ajv";
import addFormats from "ajv-formats";
import addErrors from "ajv-errors";
import { Login } from "../../models/user";

const ajv = new Ajv({ allErrors: true, strict: true, removeAdditional: false });
addErrors(ajv);
addFormats(ajv);

const loginSchema: JSONSchemaType<Login> = {
  type: "object",
  properties: {
    email: {
      type: "string",
      format: "email",
      errorMessage: {
        type: "Email must be a string",
        format: "Email must be a valid email address",
      },
    },
    // Login only checks that a password was provided — it must NOT re-apply the
    // signup complexity rules, or an account whose (valid) password predates a
    // rule change, or was set through a flow with different rules, could never
    // sign in. Correctness is decided by the hash comparison in the service.
    password: {
      type: "string",
      minLength: 1,
      errorMessage: {
        type: "Password must be a string",
        minLength: "Password is required",
      },
    },
  },
  required: ["email", "password"],
  additionalProperties: false,
  errorMessage: {
    required: {
      email: "Email is required",
      password: "Password is required",
    },
    additionalProperties: "No additional properties allowed",
  },
};

export const validateLogin = ajv.compile(loginSchema);
