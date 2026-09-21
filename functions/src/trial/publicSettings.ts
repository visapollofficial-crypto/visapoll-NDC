import { onCall } from "firebase-functions/v2/https";
import { REGION } from "../lib/admin";
import { loadSettings } from "../lib/settings";

/** Only the settings the UI legitimately needs (price, trial length). */
export const getPublicSettings = onCall({ region: REGION }, async () => {
  const s = await loadSettings();
  return {
    subscriptionPriceBDT: s.subscriptionPriceBDT, freeTrialDurationDays: s.freeTrialDurationDays,
    methods: { bkash: s.paymentsEnabled && !!s.bkashNumber, nagad: s.paymentsEnabled && !!s.nagadNumber },
  };
});
