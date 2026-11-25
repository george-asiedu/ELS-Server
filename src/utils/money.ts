// Money helpers. Amounts are GHS floats rounded to the pesewa; Paystack wants
// whole pesewas. Kept in one place so every service rounds the same way.

/** Round a GHS amount to 2 decimal places (the nearest pesewa). */
export const round2 = (ghs: number): number => Math.round(ghs * 100) / 100;

/** GHS to whole pesewas, for Paystack. */
export const toPesewas = (ghs: number): number => Math.round(ghs * 100);

/** Whole pesewas (as Paystack reports them) back to GHS. */
export const fromPesewas = (pesewas: number): number =>
  Math.round(pesewas) / 100;
