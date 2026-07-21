import Ajv, { JSONSchemaType } from "ajv";
import addErrors from "ajv-errors";
import { ApproveReviewInput, CreateReviewInput } from "./reviewModels";

const ajv = new Ajv({ allErrors: true, strict: true, removeAdditional: false });
addErrors(ajv);

const createReviewSchema: JSONSchemaType<CreateReviewInput> = {
  type: "object",
  properties: {
    rating: { type: "integer", minimum: 1, maximum: 5 },
    content: { type: "string", minLength: 10, maxLength: 500 },
    serviceId: { type: "string", nullable: true },
  },
  required: ["rating", "content"],
  additionalProperties: false,
  errorMessage: {
    properties: {
      rating: "Rating must be between 1 and 5",
      content: "Review must be between 10 and 500 characters",
    },
  },
};

const approveReviewSchema: JSONSchemaType<ApproveReviewInput> = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
  },
  required: ["approved"],
  additionalProperties: false,
};

export const validateCreateReview = ajv.compile(createReviewSchema);
export const validateApproveReview = ajv.compile(approveReviewSchema);
