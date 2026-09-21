export type Method = "bkash" | "nagad";

/** Last 11 digits, so "+8801712345678" and "01712345678" compare equal. */
export const normPhone = (s: string): string => s.replace(/\D/g, "").slice(-11);
export const normTrx = (s: string): string => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export interface ParsedSms { method: Method; trxId: string; amount: number; sender: string | null }

/**
 * Reads a "money received" SMS from bKash or Nagad. Only RECEIVED messages count.
 * SMS wording changes over time, so anything that can't be read is saved for an admin to look at
 * (see unparsedSms) instead of being guessed at.
 */
export function parseSms(message: string, from?: string): ParsedSms | null {
  const text = message.replace(/\s+/g, " ").trim();
  const f = (from ?? "").toLowerCase();
  if (!/receiv/i.test(text)) return null;
  const method: Method | null =
    /nagad/i.test(f) || /nagad/i.test(text) || /txn\s?id/i.test(text) ? "nagad"
    : /bkash/i.test(f) || /bkash/i.test(text) || /trx\s?id/i.test(text) ? "bkash" : null;
  if (!method) return null;

  const money = /(?:received|amount:?)\s*(?:tk\.?|bdt|৳)\s?([\d,]+(?:\.\d{1,2})?)/i.exec(text) ?? /(?:tk\.?|bdt|৳)\s?([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  const trx = /(?:trx\s?id|txn\s?id|transaction\s?id)\s*[:#-]?\s*([A-Z0-9]{6,14})/i.exec(text);
  if (!money || !trx) return null;
  const amount = Number(money[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const sender = /\b(01[3-9]\d{8})\b/.exec(text);
  return { method, trxId: normTrx(trx[1]), amount, sender: sender ? sender[1] : null };
}

/** Removes balance details before anything is stored. */
export const scrub = (raw: string): string => raw.replace(/balance\s*:?\s*(?:tk\.?|bdt|৳)?\s*[\d,]+(?:\.\d+)?/gi, "balance …").slice(0, 300);
