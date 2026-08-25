import { env } from "../config/env.config";
import { ApiError } from "../middleware/apiError";

const PAYSTACK_BASE = "https://api.paystack.co";

interface InitializeArgs {
  email: string;
  amountPesewas: number; // GHS subunit (amount * 100)
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
  // Split settlement: the studio's subaccount. When set, Paystack routes the
  // studio's share to it and keeps the platform's percentage_charge.
  subaccount?: string | null;
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

// Mobile-money charge lifecycle status from POST /charge and /charge/submit_otp.
export interface PaystackChargeData {
  status: string; // "send_otp" | "pay_offline" | "pending" | "success" | "failed" | "timeout"
  reference: string;
  display_text?: string;
  message?: string;
}

export interface PaystackBank {
  name: string;
  code: string;
  currency: string;
  type: string;
}

const authHeaders = () => ({
  Authorization: `Bearer ${env.paystack.secretKey}`,
  "Content-Type": "application/json",
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as {
    status: boolean;
    message: string;
    data: T;
  };
  if (!res.ok || !json.status) {
    throw new ApiError(json.message || "Paystack request failed", 502);
  }
  return json.data;
};

export const paystack = {
  async initialize(args: InitializeArgs): Promise<InitializeResult> {
    return call<InitializeResult>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: args.email,
        amount: args.amountPesewas,
        currency: "GHS",
        reference: args.reference,
        callback_url: args.callbackUrl,
        metadata: args.metadata ?? {},
        ...(args.subaccount ? { subaccount: args.subaccount } : {}),
      }),
    });
  },

  async verify(reference: string): Promise<PaystackVerifyData> {
    return call<PaystackVerifyData>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
  },

  // ---- Mobile money direct charge (Ghana): prompts the user's phone ----

  async chargeMobileMoney(args: {
    email: string;
    amountPesewas: number;
    reference: string;
    phone: string;
    provider: string; // "mtn" | "vod" | "tgo"
    subaccount?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<PaystackChargeData> {
    return call<PaystackChargeData>("/charge", {
      method: "POST",
      body: JSON.stringify({
        email: args.email,
        amount: args.amountPesewas,
        currency: "GHS",
        reference: args.reference,
        mobile_money: { phone: args.phone, provider: args.provider },
        metadata: args.metadata ?? {},
        ...(args.subaccount ? { subaccount: args.subaccount } : {}),
      }),
    });
  },

  async submitOtp(args: {
    reference: string;
    otp: string;
  }): Promise<PaystackChargeData> {
    return call<PaystackChargeData>("/charge/submit_otp", {
      method: "POST",
      body: JSON.stringify({ reference: args.reference, otp: args.otp }),
    });
  },

  // ---- Subaccounts (per-studio split settlement) ----

  async listMobileMoneyBanks(): Promise<PaystackBank[]> {
    return call<PaystackBank[]>(
      "/bank?currency=GHS&type=mobile_money",
    );
  },

  async createSubaccount(args: {
    businessName: string;
    settlementBank: string; // momo provider bank code
    accountNumber: string; // momo number
    percentageCharge: number; // platform's cut
    primaryContactEmail?: string;
  }): Promise<{ subaccount_code: string }> {
    return call<{ subaccount_code: string }>("/subaccount", {
      method: "POST",
      body: JSON.stringify({
        business_name: args.businessName,
        settlement_bank: args.settlementBank,
        account_number: args.accountNumber,
        percentage_charge: args.percentageCharge,
        ...(args.primaryContactEmail
          ? { primary_contact_email: args.primaryContactEmail }
          : {}),
      }),
    });
  },

  async updateSubaccount(
    code: string,
    args: {
      businessName?: string;
      settlementBank?: string;
      accountNumber?: string;
      percentageCharge?: number;
    },
  ): Promise<{ subaccount_code: string }> {
    return call<{ subaccount_code: string }>(
      `/subaccount/${encodeURIComponent(code)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          ...(args.businessName ? { business_name: args.businessName } : {}),
          ...(args.settlementBank
            ? { settlement_bank: args.settlementBank }
            : {}),
          ...(args.accountNumber
            ? { account_number: args.accountNumber }
            : {}),
          ...(args.percentageCharge !== undefined
            ? { percentage_charge: args.percentageCharge }
            : {}),
        }),
      },
    );
  },
};
