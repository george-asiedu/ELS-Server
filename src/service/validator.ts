import Ajv, { JSONSchemaType } from "ajv";
import addErrors from "ajv-errors";
import { CreateServiceInput, UpdateServiceInput } from "./serviceModels";

const ajv = new Ajv({ allErrors: true, strict: true, removeAdditional: false });
addErrors(ajv);

const createServiceSchema: JSONSchemaType<CreateServiceInput> = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    category: { type: "string", enum: ["NAILS", "LASHES", "HAIR"] },
    description: { type: "string", nullable: true, maxLength: 1000 },
    price: { type: "number", minimum: 0 },
    duration: { type: "string", minLength: 1, maxLength: 40 },
    popular: { type: "boolean", nullable: true },
    active: { type: "boolean", nullable: true },
    imageUrl: { type: "string", nullable: true },
  },
  required: ["name", "category", "price", "duration"],
  additionalProperties: false,
  errorMessage: {
    properties: {
      name: "Name is required",
      category: "Category must be NAILS or LASHES",
      price: "Price must be a positive number",
      duration: "Duration is required",
    },
  },
};

const updateServiceSchema: JSONSchemaType<UpdateServiceInput> = {
  type: "object",
  properties: {
    name: { type: "string", nullable: true, minLength: 1, maxLength: 120 },
    category: { type: "string", nullable: true, enum: ["NAILS", "LASHES", "HAIR"] },
    description: { type: "string", nullable: true, maxLength: 1000 },
    price: { type: "number", nullable: true, minimum: 0 },
    duration: { type: "string", nullable: true, minLength: 1, maxLength: 40 },
    popular: { type: "boolean", nullable: true },
    active: { type: "boolean", nullable: true },
    imageUrl: { type: "string", nullable: true },
  },
  required: [],
  additionalProperties: false,
};

export const validateCreateService = ajv.compile(createServiceSchema);
export const validateUpdateService = ajv.compile(updateServiceSchema);
