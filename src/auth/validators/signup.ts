import Ajv, { JSONSchemaType } from "ajv";
import addFormats from "ajv-formats";
import addErrors from "ajv-errors";
import { Signup } from "../../models/user";

const ajv = new Ajv({ allErrors: true, strict: true, removeAdditional: false });
addErrors(ajv);
addFormats(ajv);

const signupSchema: JSONSchemaType<Signup> = {
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
    fullName: {
      type: "string",
      nullable: true,
      minLength: 2,
      maxLength: 100,
      errorMessage: {
        type: "Full name must be a string",
        minLength: "Full name must be at least 2 characters long",
        maxLength: "Full name must be at most 100 characters long",
      },
    },
    phone: {
      type: "string",
      nullable: true,
      minLength: 7,
      maxLength: 20,
      errorMessage: {
        type: "Phone must be a string",
        minLength: "Please enter a valid phone number",
        maxLength: "Please enter a valid phone number",
      },
    },
    referralCode: {
      type: "string",
      nullable: true,
      maxLength: 40,
      errorMessage: {
        type: "Referral code must be a string",
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

export const validateSignup = ajv.compile(signupSchema);
