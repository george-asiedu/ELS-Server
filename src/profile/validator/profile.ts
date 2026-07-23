import Ajv, { JSONSchemaType } from "ajv";
import addFormats from "ajv-formats";
import addErrors from "ajv-errors";
import { Email, Password, Profile } from "../../models/user";

const ajv = new Ajv({ allErrors: true, strict: true, removeAdditional: false });
addErrors(ajv);
addFormats(ajv);

const profileSchema: JSONSchemaType<Profile> = {
  type: "object",
  properties: {
    fullName: {
      type: "string",
      nullable: true,
      minLength: 2,
      maxLength: 100,
      errorMessage: {
        type: "Full name must be a string",
        minLength: "Full name must be at least 2 characters long",
        maxLength: "Full name must be at most 100 characters long"
      }
    },
    email: {
      type: "string",
      nullable: true,
      format: "email",
      errorMessage: {
        type: "Email must be a string",
        format: "Email must be a valid email address"
      }
    },
    phone: {
      type: "string",
      nullable: true,
      pattern: "^[0-9+()\\-\\s]{7,20}$",
      errorMessage: {
        type: "Phone number must be a string",
        pattern: "Please enter a valid phone number"
      }
    },
    avatar: {
      type: "string",
      nullable: true,
      pattern: "^(https?://)?(www\\.)?[a-zA-Z0-9\\-]+(\\.[a-zA-Z]{2,})+(/[a-zA-Z0-9\\-_]+)*$",
      errorMessage: {
        type: "Avatar URL must be a string",
        pattern: "Avatar URL must be a valid URL"
      }
    },
    location: {
      type: "string",
      nullable: true,
      pattern: "^[a-zA-Z0-9\\s,]+$",
      errorMessage: {
        type: "Location must be a string",
        pattern: "Location must contain only letters, numbers, spaces, and commas"
      }
    }
  },
  additionalProperties: false,
  errorMessage: {
    type: 'Invalid request payload',
    properties: {
      fullName: "Full name must be 2-100 characters",
      email: "Email must be a valid email address",
      phone: "Please enter a valid phone number",
      avatar: "Avatar URL must be a valid URL",
      location: "Location must contain only letters, numbers, spaces, and commas"
    }
  }
}

const emailSchema: JSONSchemaType<Email> = {
  type: "object",
  properties: {
    email: {
      type: "string",
      format: "email",
      errorMessage: {
        type: "Email must be a string",
        format: "Email must be a valid email address"
      }
    }
  },
  required: ["email"],
  additionalProperties: false,
  errorMessage: {
    type: 'Invalid request payload',
    properties: {
      email: "Email must be a valid email address"
    }
  }
}

const passwordSchema: JSONSchemaType<Password> = {
  type: "object",
  properties: {
    password: {
      type: "string",
      minLength: 8,
      maxLength: 50,
      pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]+$",
      errorMessage: {
        type: "Password must be a string",
        minLength: "Password must be at least 8 characters long",
        maxLength: "Password must be at most 50 characters long",
        pattern: "Password must contain at least one lowercase letter, one uppercase letter, one digit, and one special character"
      }
    }
  },
  required: ["password"],
  additionalProperties: false,
  errorMessage: {
    type: 'Invalid request payload',
    properties: {
      password: "Password must contain at least one lowercase letter, one uppercase letter, one digit, and one special character"
    }
  }
}

export const validateProfile = ajv.compile(profileSchema);
export const validateEmail = ajv.compile(emailSchema);
export const validatePassword = ajv.compile(passwordSchema);
