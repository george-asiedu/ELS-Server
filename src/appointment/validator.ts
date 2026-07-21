import Ajv, { JSONSchemaType } from "ajv";
import addErrors from "ajv-errors";
import {
  CreateAppointmentInput,
  UpdateAppointmentStatusInput,
} from "./appointmentModels";

const ajv = new Ajv({ allErrors: true, strict: true, removeAdditional: false });
addErrors(ajv);

const createAppointmentSchema: JSONSchemaType<CreateAppointmentInput> = {
  type: "object",
  properties: {
    fullName: { type: "string", minLength: 2, maxLength: 100 },
    phone: { type: "string", minLength: 7, maxLength: 20 },
    email: { type: "string", nullable: true, maxLength: 120 },
    serviceId: { type: "string", minLength: 1 },
    appointmentDate: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      errorMessage: { pattern: "Date must be in yyyy-MM-dd format" },
    },
    appointmentTime: { type: "string", minLength: 1, maxLength: 20 },
    notes: { type: "string", nullable: true, maxLength: 1000 },
  },
  required: ["fullName", "phone", "serviceId", "appointmentDate", "appointmentTime"],
  additionalProperties: false,
  errorMessage: {
    properties: {
      fullName: "Full name is required",
      phone: "A valid phone number is required",
      serviceId: "Please select a service",
      appointmentTime: "Please select a time",
    },
  },
};

const updateStatusSchema: JSONSchemaType<UpdateAppointmentStatusInput> = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"],
    },
  },
  required: ["status"],
  additionalProperties: false,
  errorMessage: {
    properties: { status: "Invalid appointment status" },
  },
};

export const validateCreateAppointment = ajv.compile(createAppointmentSchema);
export const validateUpdateStatus = ajv.compile(updateStatusSchema);
