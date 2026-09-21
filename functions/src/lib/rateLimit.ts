import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin";

/** Fixed-window limiter backed by Firestore. Throws resource-exhausted when exceeded. */
export async function rateLimit(key: string, max: number, windowSec: number): Promise<void> {
  const ref = db.doc(`rateLimits/${key.replace(/[/.:]/g, "_")}`);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data() as { count: number; windowStart: number } | undefined;
    if (!d || now - d.windowStart > windowSec * 1000) {
      tx.set(ref, { count: 1, windowStart: now });
    } else if (d.count >= max) {
      throw new HttpsError("resource-exhausted", "Too many attempts. Please try again later.");
    } else {
      tx.update(ref, { count: d.count + 1 });
    }
  });
}
