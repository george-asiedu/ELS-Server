import { env } from "../config/env.config";
import { ApiError } from "../middleware/apiError";

const PAYSTACK_BASE = "https://api.paystack.co";

interface InitializeArgs {
  email: string;
  amountPesewas: number; // GHS subunit (amount * 100)
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

interface InitializeResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackVerifyData {
  status: string; // "success" | "failed" | "abandoned" | ...
  reference: string;
  amount: number; // pesewas
  id: number;
  channel: string | null;
  currency: string;
  paid_at: string | null;
}

const authHeaders = () => ({
  Authorization: `Bearer ${env.paystack.secretKey}`,
  "Content-Type": "application/json",
});

export const paystack = {
  async initialize(args: InitializeArgs): Promise<InitializeResult> {
    const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        email: args.email,
        amount: args.amountPesewas,
        currency: "GHS",
        reference: args.reference,
        callback_url: args.callbackUrl,
        metadata: args.metadata ?? {},
      }),
    });
    const json = (await res.json()) as {
      status: boolean;
      message: string;
      data: InitializeResult;
    };
    if (!res.ok || !json.status) {
      throw new ApiError(json.message || "Failed to initialize payment", 502);
    }
    return json.data;
  },

  async verify(reference: string): Promise<PaystackVerifyData> {
    const res = await fetch(
      `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: authHeaders() },
    );
    const json = (await res.json()) as {
      status: boolean;
      message: string;
      data: PaystackVerifyData;
    };
    if (!res.ok || !json.status) {
      throw new ApiError(json.message || "Failed to verify payment", 502);
    }
    return json.data;
  },
};
