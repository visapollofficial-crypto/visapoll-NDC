import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/guard";
import { normalizeStudentId } from "../lib/identity";

const Row = z.object({
  studentId: z.string().trim().min(3).max(30),
  fullName: z.string().trim().min(2).max(80),
  department: z.enum(["Science", "Commerce", "Humanities"]),
  session: z.string().trim().regex(/^\d{4}(-\d{2,4})?$/),
});

/** Import up to 400 roster rows per call. This list is what verification is matched against. */
export const importRoster = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = z.object({ rows: z.array(Row).min(1).max(400) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Some rows are invalid. Check the ID, department and session format.");
  const batch = db.batch();
  for (const r of parsed.data.rows) {
    batch.set(db.doc(`studentRoster/${normalizeStudentId(r.studentId)}`), { fullName: r.fullName, department: r.department, session: r.session, active: true });
  }
  await batch.commit();
  await audit(uid, "roster_imported", "studentRoster", { count: parsed.data.rows.length });
  return { imported: parsed.data.rows.length };
});
