export const MIN_QUANTITY: number = 1;
export const MAX_QUANTITY: number = 100_000;
export const DEFAULT_QUANTITY: string = "1";

export function parseQuantity(rawQuantity: string): number | null {
  const trimmed: string = rawQuantity.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

export function validateQuantity(rawQuantity: string): string | null {
  const quantity: number | null = parseQuantity(rawQuantity);
  if (quantity === null || quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
    return "Enter a whole number from 1 to 100,000.";
  }
  return null;
}

export function stepQuantity(rawQuantity: string, delta: 1 | -1): string {
  const quantity: number | null = parseQuantity(rawQuantity);
  if (quantity === null) {
    return String(MIN_QUANTITY);
  }
  return String(Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, quantity + delta)));
}
