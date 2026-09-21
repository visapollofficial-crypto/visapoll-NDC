import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/guard";
import { loadSettings } from "../lib/settings";

export const adminGetSettings = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);
  return loadSettings();
});

const Input = z.object({
  freeTrialEnabled: z.boolean(),
  freeTrialDurationDays: z.number().int().min(0).max(365),
  oneTrialPerVerifiedStudent: z.boolean(),
  requireStudentVerification: z.boolean(),
  requireFaceVerification: z.boolean(),
  subscriptionPriceBDT: z.number().int().min(1).max(100000),
  paymentsEnabled: z.boolean(),
  bkashNumber: z.string().regex(/^(01[3-9]\d{8})?$/),
  nagadNumber: z.string().regex(/^(01[3-9]\d{8})?$/),
});

export const adminSaveSettings = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = Input.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check the values and try again.");
  const before = await loadSettings();
  await db.doc("settings/system").set(parsed.data);
  await audit(uid, "settings_changed", "settings/system", { before, after: parsed.data });
  return { ok: true };
});
