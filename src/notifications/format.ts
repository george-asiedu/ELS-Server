// Pre-format currency before it reaches a template — see notifications/types.ts
// (MoneyLine.value is a string, not a number) for why: our provider has no
// expression language to do this on the render side.
export const ghs = (amount: number): string => `GHS ${amount.toFixed(2)}`;
