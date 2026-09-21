import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { db, REGION } from "../lib/admin";
import { computePublicStats } from "../lib/publicStats";

/** Keeps the sanitised publicProfiles/{uid} in sync. Email, phone and verification data never appear. */
export const syncPublicProfile = onDocumentWritten({ document: "users/{uid}", region: REGION }, async (event) => {
  const after = event.data?.after.data();
  const ref = db.doc(`publicProfiles/${event.params.uid}`);
  if (!after) {
    await ref.delete().catch(() => undefined);
    return;
  }
  const isPublic = after.scoreVisibility === "public";
  await ref.set(
    {
      displayName: after.fullName,
      nameLower: String(after.fullName).toLowerCase(),
      department: after.department,
      session: after.session,
      photoURL: after.photoURL ?? null,
      scoreVisibility: after.scoreVisibility,
      publicStats: isPublic ? await computePublicStats(event.params.uid) : FieldValue.delete(),
    },
    { merge: true }
  );
});

/** After each finished quiz, refresh the public numbers, but only for students who chose to share them. */
export const refreshPublicStats = onDocumentCreated({ document: "quizResults/{id}", region: REGION }, async (event) => {
  const uid = event.data?.get("uid") as string | undefined;
  if (!uid) return;
  const ref = db.doc(`publicProfiles/${uid}`);
  if ((await ref.get()).get("scoreVisibility") !== "public") return;
  await ref.set({ publicStats: await computePublicStats(uid) }, { merge: true });
});
