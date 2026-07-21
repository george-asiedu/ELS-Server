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
}

export interface UpdateAppointmentStatusInput {
  status: AppointmentStatusInput;
}
