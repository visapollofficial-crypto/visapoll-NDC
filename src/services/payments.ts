import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/config";

export type Method = "bkash" | "nagad";
export type PayStatus = "initiated" | "pending" | "verified" | "failed" | "expired";
export interface Payment {
  id: string; uid: string; method: Method; amount: number; paidAmount?: number; months?: number; currency: string;
  status: PayStatus; failureReason?: string | null; trxId?: string; senderNumber?: string;
  createdAt: { toMillis(): number }; subscriptionEnd?: { toMillis(): number }; verifiedAt?: { toMillis(): number };
}
export interface PaymentRequest { paymentId: string; method: Method; amount: number; sendTo: string; expiresAt: number }

export const createPaymentRequest = (method: Method) =>
  httpsCallable<{ method: Method }, PaymentRequest>(functions, "createPaymentRequest")({ method }).then((r) => r.data);
export const submitPaymentProof = (paymentId: string, trxId: string, senderNumber: string) =>
  httpsCallable<unknown, { status: string }>(functions, "submitPaymentProof")({ paymentId, trxId, senderNumber }).then((r) => r.data);
export const cancelPayment = (paymentId: string) => httpsCallable(functions, "cancelPayment")({ paymentId });
export const adminReviewPayment = (paymentId: string, decision: "approve" | "reject") =>
  httpsCallable(functions, "adminReviewPayment")({ paymentId, decision });

export const methodName = (m: Method) => (m === "bkash" ? "bKash" : "Nagad");

/** Plain-language explanation for every failure the server can record. */
export const FAILURE_TEXT: Record<string, { title: string; help: string }> = {
  trx_not_found: { title: "We couldn't find your payment", help: "No matching transaction reached us. Check the transaction ID and that you paid to the right number, then try again. If money left your account, contact the admin with your transaction ID." },
  amount_too_low: { title: "The amount was less than the price", help: "The payment was smaller than the subscription price. Send the full amount and try again. If you already sent less, contact the admin." },
  sender_mismatch: { title: "The sender number didn't match", help: "The number you entered isn't the number the payment came from. Use the exact bKash/Nagad number you paid from." },
  trx_already_used: { title: "This transaction ID was already used", help: "Each transaction can only be used once. If you think this is a mistake, contact the admin." },
  trx_too_old: { title: "This payment is too old", help: "The transaction was made too long before this request. Make a new payment and try again." },
  expired: { title: "The payment request expired", help: "You didn't submit the transaction ID in time. Nothing was charged by us. Start again when you're ready." },
  cancelled: { title: "You cancelled this payment", help: "Nothing was changed on your account." },
  rejected_by_admin: { title: "The admin couldn't confirm this payment", help: "The payment wasn't found in our account. If money left your account, contact the admin with your transaction ID." },
};
