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
    firstName: {
      type: "string",
      nullable: true,
      minLength: 3,
      maxLength: 50,
      pattern: "^[a-zA-Z]+$",
      errorMessage: {
        type: "First name must be a string",
        minLength: "First name must be at least 3 characters long",
        maxLength: "First name must be at most 50 characters long",
        pattern: "First name must contain only letters"
      }
    },
    lastName: {
      type: "string",
      minLength: 3,
      nullable: true,
      maxLength: 50,
      pattern: "^[a-zA-Z]+$",
      errorMessage: {
        type: "First name must be a string",
        minLength: "First name must be at least 3 characters long",
        maxLength: "Last name must be at most 50 characters long",
        pattern: "Last name must contain only letters"
      }
    },
    phone: {
      type: "string",
      nullable: true,
      pattern: "^[0-9]{10}$",
      errorMessage: {
        type: "Phone number must be a string",
        pattern: "Phone number must be a 10-digit number"
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
      firstName: "First name must contain only letters",
      lastName: "Last name must contain only letters",
      phone: "Phone number must be a 10-digit number",
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
