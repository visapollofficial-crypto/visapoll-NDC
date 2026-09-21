import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db, REGION } from "../lib/admin";
import { audienceUids, notifyUsers } from "../lib/notify";

const dhaka = (ms: number, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", ...o }).format(ms);
const dayKey = (ms: number) => dhaka(ms, { year: "numeric", month: "2-digit", day: "2-digit" });
const hourOf = (ms: number) => Number(dhaka(ms, { hour: "2-digit", hour12: false })) % 24;

/** Sets a flag exactly once, even if two scheduler runs overlap. Returns true only for the run that flipped it. */
async function claim(ref: FirebaseFirestore.DocumentReference, flags: string[]): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (flags.every((f) => s.get(f) === true)) return false;
    tx.update(ref, Object.fromEntries(flags.map((f) => [f, true])));
    return true;
  });
}

/**
 * Every 5 minutes:
 *  - morning-of reminder ("starts today at 8:00 pm") from 8 AM Dhaka time
 *  - 15-minute reminder
 *  - "answers are available" after an exam closes (only when the quiz reveals answers after close)
 */
export const quizNotifications = onSchedule({ schedule: "every 5 minutes", region: REGION }, async () => {
  const now = Date.now();

  const upcoming = await db.collection("quizzes").where("status", "==", "published")
    .where("startAt", ">", Timestamp.fromMillis(now)).where("startAt", "<", Timestamp.fromMillis(now + 36 * 3600_000)).get();
  for (const d of upcoming.docs) {
    const q = d.data();
    if (q.type !== "weekly") continue;
    const start = (q.startAt as Timestamp).toMillis();
    const mins = (start - now) / 60_000;
    const time = dhaka(start, { hour: "numeric", minute: "2-digit", hour12: true });
    const audience = () => audienceUids({ scope: "department", departments: q.departments });

    if (mins <= 15) {
      if (await claim(d.ref, ["reminder15Sent", "reminderDaySent"])) {
        await notifyUsers(await audience(), { type: "quiz", title: "Quiz starts in 15 minutes", body: `${q.title} starts at ${time}. Get ready.`, link: `/quiz/${d.id}` });
      }
    } else if (dayKey(start) === dayKey(now) && hourOf(now) >= 8) {
      if (await claim(d.ref, ["reminderDaySent"])) {
        await notifyUsers(await audience(), { type: "quiz", title: "Weekly Model Quiz today", body: `${q.title} starts today at ${time}.`, link: `/quiz/${d.id}` });
      }
    }
  }

  const closed = await db.collection("quizzes").where("status", "==", "published")
    .where("endAt", "<", Timestamp.fromMillis(now)).where("endAt", ">", Timestamp.fromMillis(now - 3 * 3600_000)).get();
  for (const d of closed.docs) {
    const q = d.data();
    if (q.type !== "weekly" || q.revealAnswers !== "after_close") continue;
    if (!(await claim(d.ref, ["closedNotified"]))) continue;
    const takers = await db.collection("quizResults").where("quizId", "==", d.id).where("mode", "==", "exam").get();
    await notifyUsers(takers.docs.map((r) => r.get("uid") as string), { type: "result", title: "Answers are now available", body: `The exam "${q.title}" has closed. Open your result to see the correct answers and explanations.`, link: "/results" });
  }
});
