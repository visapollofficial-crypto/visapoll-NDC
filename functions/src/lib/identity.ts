import { createHmac } from "crypto";

/** Canonical form of a student ID: NFKC, uppercase, letters/digits only. */
export const normalizeStudentId = (raw: string): string =>
  raw.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Canonical form of a name for roster comparison. */
export const normalizeName = (raw: string): string =>
  raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Keyed hash of the verified identity. Student IDs are low-entropy, so a plain
 * hash would be trivially reversible; the HMAC pepper lives in Secret Manager
 * and never reaches a client.
 */
export const identityHash = (pepper: string, normalizedId: string): string =>
  createHmac("sha256", pepper).update(normalizedId).digest("hex");
