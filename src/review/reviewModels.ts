export interface CreateReviewInput {
  rating: number;
  content: string;
  serviceId?: string;
}

export interface ApproveReviewInput {
  approved: boolean;
}
