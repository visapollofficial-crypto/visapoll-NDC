import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db, REGION } from "../lib/admin";

const Input = z.object({ targetUid: z.string().min(1), role: z.enum(["student", "moderator", "admin"]) });

/** Admins can grant student/moderator; only a superadmin can grant admin. Always audit-logged. */
export const adminSetRole = onCall({ region: REGION }, async (request) => {
  const callerRole = request.auth?.token.role as string | undefined;
  if (!request.auth || !["admin", "superadmin"].includes(callerRole ?? "")) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  const parsed = Input.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { targetUid, role } = parsed.data;
  if (role === "admin" && callerRole !== "superadmin") {
    throw new HttpsError("permission-denied", "Only a superadmin can grant admin access.");
  }
  const target = await getAuth().getUser(targetUid);
  if (target.customClaims?.role === "superadmin") {
    throw new HttpsError("permission-denied", "Superadmin roles cannot be changed here.");
  }
  await getAuth().setCustomUserClaims(targetUid, { role });
  await db.collection("auditLogs").add({
    adminId: request.auth.uid,
    action: "role_changed",
    target: targetUid,
    detail: { role },
    result: "success",
    at: Timestamp.now(),
  });
  return { ok: true };
});
