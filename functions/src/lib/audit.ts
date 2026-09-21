import { Timestamp } from "firebase-admin/firestore";
import { db } from "./admin";

/** Append-only record of admin actions. Clients can never write here. */
export const audit = (adminId: string, action: string, target: string, detail: Record<string, unknown> = {}, result = "success") =>
  db.collection("auditLogs").add({ adminId, action, target, detail, result, at: Timestamp.now() });
