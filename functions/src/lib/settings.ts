import { db } from "./admin";

export interface SystemSettings {
  freeTrialEnabled: boolean;
  freeTrialDurationDays: number;
  oneTrialPerVerifiedStudent: boolean;
  requireStudentVerification: boolean;
  requireFaceVerification: boolean;
  subscriptionPriceBDT: number;
  paymentsEnabled: boolean;
  bkashNumber: string;
  nagadNumber: string;
}

export const DEFAULT_SETTINGS: SystemSettings = {
  freeTrialEnabled: true,
  freeTrialDurationDays: 30,
  oneTrialPerVerifiedStudent: true,
  requireStudentVerification: true,
  requireFaceVerification: false,
  subscriptionPriceBDT: 300,
  paymentsEnabled: false,
  bkashNumber: "",
  nagadNumber: "",
};

/** Admin-editable settings (settings/system) merged over safe defaults. */
export async function loadSettings(): Promise<SystemSettings> {
  const snap = await db.doc("settings/system").get();
  return { ...DEFAULT_SETTINGS, ...(snap.exists ? (snap.data() as Partial<SystemSettings>) : {}) };
}
