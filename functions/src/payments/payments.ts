import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/guard";
import { normPhone, normTrx, parseSms, scrub, type Method } from "../lib/payments";
import { rateLimit } from "../lib/rateLimit";
import { PAYMENT_WEBHOOK_SECRET } from "../lib/secrets";
import { loadSettings } from "../lib/settings";
import { failPayment, settlePayment } from "./settle";

const MIN = 60_000, HOUR = 3_600_000;
const PENDING_TIMEOUT = 12 * HOUR;

/** Step 1: student picks bKash or Nagad. The amount comes from admin settings, never from the browser. */
export const createPaymentRequest = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({ method: z.enum(["bkash", "nagad"]) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Choose bKash or Nagad.");
  const method = parsed.data.method as Method;
  await rateLimit(`payreq_${uid}`, 15, 3600);

  const s = await loadSettings();
  const sendTo = method === "bkash" ? s.bkashNumber : s.nagadNumber;
  if (!s.paymentsEnabled || !sendTo) throw new HttpsError("failed-precondition", "This payment method isn't available right now. Please try again later.");

  const user = (await db.doc(`users/${uid}`).get()).data();
  if (!user) throw new HttpsError("failed-precondition", "Finish registration first.");

  const open = await db.collection("payments").where("uid", "==", uid).where("status", "in", ["initiated", "pending"]).get();
  const now = Date.now();
  if (open.docs.some((d) => d.get("status") === "pending")) throw new HttpsError("failed-precondition", "You already have a payment being confirmed. Please wait for the result.");
  const reuse = open.docs.find((d) => d.get("method") === method && d.get("expiresAt").toMillis() > now);
  if (reuse) return { paymentId: reuse.id, method, amount: reuse.get("amount"), sendTo, expiresAt: reuse.get("expiresAt").toMillis() };

  const ref = db.collection("payments").doc();
  const expiresAt = Timestamp.fromMillis(now + 30 * MIN);
  await ref.set({ uid, method, amount: s.subscriptionPriceBDT, currency: "BDT", status: "initiated", createdAt: Timestamp.fromMillis(now), expiresAt });
  return { paymentId: ref.id, method, amount: s.subscriptionPriceBDT, sendTo, expiresAt: expiresAt.toMillis() };
});

/** Step 2: student says which transaction is theirs. The server (not the browser) decides if it is real. */
export const submitPaymentProof = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({
    paymentId: z.string().min(1).max(40),
    trxId: z.string().trim().min(6).max(20),
    senderNumber: z.string().trim().regex(/^(\+?88)?01[3-9]\d{8}$/, "Enter the mobile number you paid from."),
  }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Check the details and try again.");
  await rateLimit(`payproof_${uid}`, 10, 3600);

  const trxId = normTrx(parsed.data.trxId);
  if (trxId.length < 6 || trxId.length > 14) throw new HttpsError("invalid-argument", "That doesn't look like a valid transaction ID.");
  const senderNumber = normPhone(parsed.data.senderNumber);

  const payRef = db.doc(`payments/${parsed.data.paymentId}`);
  const early = await db.runTransaction(async (tx) => {
    const pay = (await tx.get(payRef)).data();
    if (!pay || pay.uid !== uid) throw new HttpsError("not-found", "Payment not found.");
    if (pay.status !== "initiated") throw new HttpsError("failed-precondition", "This payment was already submitted.");
    if (pay.expiresAt.toMillis() < Date.now()) { tx.update(payRef, { status: "expired", failureReason: "expired", failedAt: Timestamp.now() }); return "expired"; }

    // One TrxID can only ever belong to one payment.
    const idem = db.doc(`paymentIdempotency/${pay.method}_${trxId}`);
    const seen = await tx.get(idem);
    if (seen.exists && seen.get("paymentId") !== parsed.data.paymentId) {
      tx.update(payRef, { status: "failed", failureReason: "trx_already_used", failedAt: Timestamp.now(), trxId, senderNumber });
      return "used";
    }
    tx.set(idem, { uid, paymentId: parsed.data.paymentId, createdAt: Timestamp.now() });
    tx.update(payRef, { trxId, senderNumber, status: "pending", submittedAt: Timestamp.now() });
    return "ok";
  });
  if (early === "expired") throw new HttpsError("failed-precondition", "This payment request expired. Please start again.");
  if (early === "used") return { status: "failed" };

  // If the matching SMS has already reached the server, this confirms instantly.
  const outcome = await settlePayment(parsed.data.paymentId, "auto");
  return { status: outcome === "noop" ? "pending" : outcome };
});

export const cancelPayment = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const id = z.string().min(1).max(40).parse(request.data?.paymentId);
  const pay = (await db.doc(`payments/${id}`).get()).data();
  if (!pay || pay.uid !== uid) throw new HttpsError("not-found", "Payment not found.");
  await failPayment(id, "cancelled", ["initiated"]);
  return { ok: true };
});

/**
 * Receives "money received" SMS messages forwarded from the admin's phone (any SMS-forwarding app that can POST JSON).
 * Protected by a shared secret. It stores the parsed transaction and instantly confirms any waiting payment.
 */
export const paymentSmsWebhook = onRequest({ region: REGION, secrets: [PAYMENT_WEBHOOK_SECRET], cors: false }, async (req, res) => {
  const given = Buffer.from(String(req.get("x-webhook-secret") ?? ""));
  const want = Buffer.from(PAYMENT_WEBHOOK_SECRET.value());
  if (req.method !== "POST" || want.length === 0 || given.length !== want.length || !timingSafeEqual(given, want)) { res.status(401).send("unauthorized"); return; }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const message = String(b.message ?? b.body ?? b.text ?? b.sms ?? "").slice(0, 1000);
  const from = String(b.from ?? b.sender ?? "");
  const p = parseSms(message, from);
  const now = Timestamp.now();

  if (!p) {
    // Not a recognisable "received" message: keep a scrubbed copy for admin review (sent/cash-out messages are ignored by the parser).
    if (/receiv/i.test(message)) await db.collection("unparsedSms").add({ from: from.slice(0, 40), raw: scrub(message), at: now });
    res.status(200).json({ ok: true, parsed: false });
    return;
  }

  const ref = db.doc(`incomingPayments/${p.method}_${p.trxId}`);
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(ref)).exists) tx.set(ref, { method: p.method, trxId: p.trxId, amount: p.amount, sender: p.sender, receivedAt: now, used: false });
  });
  const waiting = (await db.doc(`paymentIdempotency/${p.method}_${p.trxId}`).get()).get("paymentId") as string | undefined;
  if (waiting) await settlePayment(waiting, "auto");
  res.status(200).json({ ok: true, parsed: true });
});

/** Every 5 minutes: retry pending payments, time out unconfirmed ones, expire unpaid requests, clean up old SMS records. */
export const reconcilePayments = onSchedule({ schedule: "every 5 minutes", region: REGION }, async () => {
  const now = Date.now();
  const pending = await db.collection("payments").where("status", "==", "pending").limit(200).get();
  for (const d of pending.docs) {
    const out = await settlePayment(d.id, "auto").catch(() => "noop");
    if (out === "pending" && now - (d.get("submittedAt") as Timestamp).toMillis() > PENDING_TIMEOUT) await failPayment(d.id, "trx_not_found", ["pending"]);
  }
  const stale = await db.collection("payments").where("status", "==", "initiated").where("expiresAt", "<", Timestamp.fromMillis(now)).limit(200).get();
  for (const d of stale.docs) await failPayment(d.id, "expired", ["initiated"]);

  const oldIn = await db.collection("incomingPayments").where("receivedAt", "<", Timestamp.fromMillis(now - 90 * 24 * HOUR)).limit(200).get();
  const oldSms = await db.collection("unparsedSms").where("at", "<", Timestamp.fromMillis(now - 30 * 24 * HOUR)).limit(200).get();
  const batch = db.batch();
  [...oldIn.docs, ...oldSms.docs].forEach((d) => batch.delete(d.ref));
  await batch.commit();
});

/** Admin decision for a pending payment (checked in their own bKash/Nagad app). Always audit-logged. */
export const adminReviewPayment = onCall({ region: REGION }, async (request) => {
  const { uid: adminId } = requireAdmin(request);
  const parsed = z.object({ paymentId: z.string().min(1).max(40), decision: z.enum(["approve", "reject"]) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { paymentId, decision } = parsed.data;
  const pay = (await db.doc(`payments/${paymentId}`).get()).data();
  if (!pay || pay.status !== "pending") throw new HttpsError("failed-precondition", "Only payments waiting for confirmation can be reviewed.");
  if (decision === "approve") {
    const out = await settlePayment(paymentId, adminId);
    await audit(adminId, "payment_approved", paymentId, { uid: pay.uid, method: pay.method, trxId: pay.trxId, outcome: out });
  } else {
    await failPayment(paymentId, "rejected_by_admin", ["pending"]);
    await audit(adminId, "payment_rejected", paymentId, { uid: pay.uid, method: pay.method, trxId: pay.trxId });
  }
  return { ok: true };
});

