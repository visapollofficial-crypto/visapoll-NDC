import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

/** Sensitive operations (verification, trials, settings, content) are admin-only. */
export function requireAdmin(req: CallableRequest): { uid: string; role: string } {
  const uid = req.auth?.uid;
  const role = req.auth?.token.role as string | undefined;
  if (!uid || !role || !["admin", "superadmin"].includes(role)) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return { uid, role };
}
