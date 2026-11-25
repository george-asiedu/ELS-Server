import Ajv, { JSONSchemaType } from "ajv";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from "../passwordPolicy";
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
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
      pattern: PASSWORD_PATTERN,
      errorMessage: {
        type: "Password must be a string",
        minLength: PASSWORD_RULE_MESSAGE,
        maxLength: `Password must not exceed ${PASSWORD_MAX_LENGTH} characters`,
        pattern: PASSWORD_RULE_MESSAGE,
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
