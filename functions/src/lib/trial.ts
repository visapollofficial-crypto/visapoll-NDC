import type { SystemSettings } from "./settings";

export type TrialStatus = "granted" | "already_used" | "not_verified" | "disabled" | "blocked";

/** Single source of truth for "does this identity get a free trial?" */
export function computeTrialStatus(
  verified: boolean,
  ent: { trialUsed?: boolean; blocked?: boolean } | undefined,
  s: SystemSettings
): TrialStatus {
  if (!verified) return "not_verified";
  if (ent?.blocked) return "blocked";
  if (!s.freeTrialEnabled) return "disabled";
  if (s.oneTrialPerVerifiedStudent && ent?.trialUsed) return "already_used";
  return "granted";
}
