export type ServiceCategoryInput = "NAILS" | "LASHES" | "HAIR";

export interface CreateServiceInput {
  name: string;
  category: ServiceCategoryInput;
  description?: string;
  price: number;
  duration: string;
  popular?: boolean;
  active?: boolean;
  imageUrl?: string;
}

export interface UpdateServiceInput {
  name?: string;
  category?: ServiceCategoryInput;
  description?: string;
  price?: number;
  duration?: string;
  popular?: boolean;
  active?: boolean;
  imageUrl?: string;
}
