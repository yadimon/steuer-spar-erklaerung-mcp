export type ReceiptEditField = "title" | "date" | "documentNumber" | "amount" | "vatRate" | "net" | "note";

export class ReceiptUpdateError extends Error {
  constructor(message: string, readonly kind = "postcondition-failed", readonly outcomeUnknown = false) { super(message); }
}

function amountCents(value: unknown): bigint | null {
  let text = String(value);
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/u.test(text)) text = text.replaceAll(".", "");
  const match = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/u.exec(text);
  if (!match) return null;
  const magnitude = BigInt(match[2]!) * 100n + BigInt((match[3] ?? "").padEnd(2, "0") || "0");
  return match[1] ? -magnitude : magnitude;
}

export function equalValue(field: ReceiptEditField, actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (field === "amount") {
    const left = amountCents(actual), right = amountCents(expected);
    return left !== null && right !== null && left === right;
  }
  return actual === expected;
}

export function rawValue(field: ReceiptEditField, value: unknown): string {
  if (field === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value))) return String(value);
    const [year, month, day] = String(value).split("-");
    return `${day}.${month}.${year}`;
  }
  if (field === "amount") {
    if (value === "") return "";
    const cents = amountCents(value);
    if (cents === null) throw new ReceiptUpdateError("Receipt amount is not an exact decimal.", "bad-args");
    const magnitude = cents < 0n ? -cents : cents;
    return `${cents < 0n ? "-" : ""}${magnitude / 100n},${String(magnitude % 100n).padStart(2, "0")}`;
  }
  return String(value);
}
