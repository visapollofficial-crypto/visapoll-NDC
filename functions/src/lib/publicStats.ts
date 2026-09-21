import { db } from "./admin";

/** Numbers a student chose to make public (only when scoreVisibility = "public"). No topics, no answers. */
export async function computePublicStats(uid: string): Promise<{ quizzes: number; avg: number; best: number }> {
  const rs = await db.collection("quizResults").where("uid", "==", uid).orderBy("submittedAt", "desc").limit(50).get();
  const pcts = rs.docs.map((d) => d.get("percent") as number);
  return { quizzes: pcts.length, avg: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0, best: pcts.length ? Math.max(...pcts) : 0 };
}
