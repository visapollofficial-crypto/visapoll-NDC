import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin";

/** Server-side check that the caller has a running trial or paid plan. */
export async function assertPremium(uid: string): Promise<void> {
  const sub = (await db.doc(`subscriptions/${uid}`).get()).data();
  const ok = sub && ["trial", "active"].includes(sub.status) && sub.endsAt && sub.endsAt.toMillis() > Date.now();
  if (!ok) throw new HttpsError("permission-denied", "An active trial or subscription is required.");
}
