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
    password: {
      type: "string",
      minLength: 8,
      maxLength: 32,
      pattern:
        "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*()_+\\-=[\\]{};'\"\\\\|,.<>/?]).+$",
      errorMessage: {
        type: "Password must be a string",
        minLength: "Password must be at least 8 characters long",
        maxLength: "Password must not exceed 32 characters",
        pattern:
          "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
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
