// Category is now a slug referencing the Category collection.
export interface CreateServiceInput {
  name: string;
  category: string;
  description?: string;
  price: number;
  promoPrice?: number | null;
  duration: string;
  popular?: boolean;
  active?: boolean;
  imageUrl?: string;
}

export interface UpdateServiceInput {
  name?: string;
  category?: string;
  description?: string;
  price?: number;
  promoPrice?: number | null;
  duration?: string;
  popular?: boolean;
  active?: boolean;
  imageUrl?: string;
}
