export type AppointmentStatusInput =
  | "PENDING"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED";

export interface CreateAppointmentInput {
  fullName: string;
  phone: string;
  email?: string;
  serviceId: string;
  appointmentDate: string; // yyyy-MM-dd
  appointmentTime: string;
  notes?: string;
  // Multipart field — "true" to apply the customer's loyalty points as a discount.
  applyPoints?: string;
}

export interface UpdateAppointmentStatusInput {
  status: AppointmentStatusInput;
}
