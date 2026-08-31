/**
 * Create the four subscription plans on Paystack (Standard/Premium ×
 * Monthly/Yearly), then print the plan codes to put in .env
 * (PAYSTACK_PLAN_STANDARD_MONTHLY, …). Idempotent-ish: Paystack allows duplicate
 * plan names, so run once; re-running creates new plans.
 *
 * Amounts are configurable via env (GHS), with sensible defaults:
 *   PLAN_STANDARD_MONTHLY=150 PLAN_STANDARD_YEARLY=1500
 *   PLAN_PREMIUM_MONTHLY=350  PLAN_PREMIUM_YEARLY=3500
 *
 *   npx ts-node prisma/createPlans.ts
 */
import "dotenv/config";

const SECRET = process.env.PAYSTACK_SECRET_KEY;
const ghs = (v: string | undefined, def: number) => Math.round((Number(v) || def) * 100);

const PLANS = [
  { key: "STANDARD_MONTHLY", name: "Zuri Standard (Monthly)", interval: "monthly", amount: ghs(process.env.PLAN_STANDARD_MONTHLY, 150) },
  { key: "STANDARD_YEARLY", name: "Zuri Standard (Yearly)", interval: "annually", amount: ghs(process.env.PLAN_STANDARD_YEARLY, 1500) },
  { key: "PREMIUM_MONTHLY", name: "Zuri Premium (Monthly)", interval: "monthly", amount: ghs(process.env.PLAN_PREMIUM_MONTHLY, 350) },
  { key: "PREMIUM_YEARLY", name: "Zuri Premium (Yearly)", interval: "annually", amount: ghs(process.env.PLAN_PREMIUM_YEARLY, 3500) },
];

async function main() {
  if (!SECRET) throw new Error("PAYSTACK_SECRET_KEY is required");
  console.log("Creating Paystack plans...\n");
  for (const p of PLANS) {
    const res = await fetch("https://api.paystack.co/plan", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: p.name,
        amount: p.amount,
        interval: p.interval,
        currency: "GHS",
      }),
    });
    const json = (await res.json()) as {
      status: boolean;
      message: string;
      data?: { plan_code: string };
    };
    if (!res.ok || !json.status) {
      console.error(`  ✗ ${p.key}: ${json.message}`);
      continue;
    }
    console.log(`PAYSTACK_PLAN_${p.key}=${json.data?.plan_code}`);
  }
  console.log("\nCopy the lines above into your .env.");
}

main().catch((e) => {
  console.error("createPlans failed:", e);
  process.exitCode = 1;
});
