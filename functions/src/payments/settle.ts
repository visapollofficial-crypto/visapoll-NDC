import { Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { notifyUsers } from "../lib/notify";
import { normPhone } from "../lib/payments";

const DAY = 86_400_000;
export type Outcome = "verified" | "pending" | "failed" | "noop";

/**
 * THE only place a subscription is activated by a payment. It runs on the server, in one transaction:
 *  - auto mode: the payment must match an SMS the server itself received (same TrxID, amount >= price, same sender number)
 *  - manual mode: an admin has confirmed it in their own bKash/Nagad app
 * A TrxID can be used exactly once. The browser never influences the outcome.
 */
export async function settlePayment(paymentId: string, verifiedBy: "auto" | string): Promise<Outcome> {
  const now = Timestamp.now();
  const manual = verifiedBy !== "auto";
  let uidForNotify = "";
  let detail: { outcome: Outcome; reason?: string; end?: number } = { outcome: "noop" };

  await db.runTransaction(async (tx) => {
    const payRef = db.doc(`payments/${paymentId}`);
    const payS = await tx.get(payRef);
    const pay = payS.data();
    if (!pay || !["initiated", "pending"].includes(pay.status) || !pay.trxId) return;
    uidForNotify = pay.uid;

    const incRef = db.doc(`incomingPayments/${pay.method}_${pay.trxId}`);
    const subRef = db.doc(`subscriptions/${pay.uid}`);
    const [inc, sub] = await Promise.all([tx.get(incRef), tx.get(subRef)]);

    const fail = (reason: string) => { tx.update(payRef, { status: "failed", failureReason: reason, failedAt: now }); detail = { outcome: "failed", reason }; };
    let paid: number = pay.amount;

    if (!manual) {
      if (!inc.exists) { detail = { outcome: "pending" }; return; }        // SMS hasn't arrived yet
      const d = inc.data()!;
      if (d.used) return fail("trx_already_used");
      if (d.amount < pay.amount) return fail("amount_too_low");
      if (!d.sender) { detail = { outcome: "pending" }; return; }           // can't check the sender, an admin must approve
      if (normPhone(d.sender) !== pay.senderNumber) return fail("sender_mismatch");
      if (d.receivedAt.toMillis() < pay.createdAt.toMillis() - DAY) return fail("trx_too_old");
      paid = d.amount;
    }

    const months = Math.max(1, Math.min(12, Math.floor(paid / pay.amount)));
    const current = sub.exists && ["trial", "active"].includes(sub.get("status")) && sub.get("endsAt") ? (sub.get("endsAt") as Timestamp).toMillis() : 0;
    const startMs = Math.max(now.toMillis(), current); // paying early stacks on top of the remaining time
    const endMs = startMs + months * 30 * DAY;

    tx.update(payRef, {
      status: "verified", paidAmount: paid, months, verifiedBy, verifiedAt: now, failureReason: null,
      subscriptionStart: Timestamp.fromMillis(startMs), subscriptionEnd: Timestamp.fromMillis(endMs),
    });
    tx.set(subRef, { status: "active", endsAt: Timestamp.fromMillis(endMs), plan: "premium_monthly", lastPaymentId: paymentId, warned3d: false, updatedAt: now }, { merge: true });
    if (inc.exists) tx.update(incRef, { used: true, usedBy: paymentId });
    detail = { outcome: "verified", end: endMs };
  });

  if (detail.outcome === "verified") {
    await notifyUsers([uidForNotify], { type: "subscription", title: "Payment successful", body: `Your subscription is active until ${new Date(detail.end!).toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka" })}.`, link: `/payment/success?pid=${paymentId}` });
  } else if (detail.outcome === "failed") {
    await notifyUsers([uidForNotify], { type: "subscription", title: "Payment could not be confirmed", body: "Open the payment to see why and try again.", link: `/payment/failure?pid=${paymentId}` });
  }
  return detail.outcome;
}

/** Marks a payment failed with a reason the failure page can explain. */
export async function failPayment(paymentId: string, reason: string, allowed: string[] = ["initiated", "pending"]): Promise<boolean> {
  const ref = db.doc(`payments/${paymentId}`);
  const uid = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || !allowed.includes(s.get("status"))) return null;
    tx.update(ref, { status: reason === "expired" ? "expired" : "failed", failureReason: reason, failedAt: Timestamp.now() });
    return s.get("uid") as string;
  });
  if (uid && reason !== "cancelled") {
    await notifyUsers([uid], { type: "subscription", title: "Payment could not be confirmed", body: "Open the payment to see why and try again.", link: `/payment/failure?pid=${paymentId}` });
  }
  return !!uid;
}
