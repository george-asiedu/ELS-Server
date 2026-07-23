export interface CreateReviewInput {
  rating: number;
  content: string;
  serviceId?: string;
  appointmentId?: string;
}

export interface ApproveReviewInput {
  approved: boolean;
}
