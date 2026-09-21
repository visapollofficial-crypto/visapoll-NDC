import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import type { Result } from "../services/quiz";

export type ResultRow = Result & { id: string };

/** The student's recent results plus totals, average, best, streak of active days, and topics to revise. */
export function useQuizStats() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!user) return;
    getDocs(query(collection(db, "quizResults"), where("uid", "==", user.uid), orderBy("submittedAt", "desc"), limit(50)))
      .then((s) => setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as Result) })))).catch(() => setError(true));
  }, [user]);

  const stats = useMemo(() => {
    if (!rows?.length) return null;
    const pcts = rows.map((r) => r.percent);
    const topics: Record<string, { c: number; t: number }> = {};
    rows.forEach((r) => Object.entries(r.topics).forEach(([k, v]) => { topics[k] = topics[k] ?? { c: 0, t: 0 }; topics[k].c += v.correct; topics[k].t += v.total; }));
    const ranked = Object.entries(topics).filter(([, v]) => v.t >= 3).map(([k, v]) => ({ k, pct: Math.round((v.c / v.t) * 100) })).sort((a, b) => a.pct - b.pct);
    // Streak = consecutive days (ending today or yesterday) with at least one quiz.
    const days = new Set(rows.map((r) => new Date("toMillis" in r.submittedAt ? r.submittedAt.toMillis() : 0).toDateString()));
    let streak = 0; const d = new Date();
    if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
    while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
    return { total: rows.length, avg: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length), best: Math.max(...pcts), streak, weak: ranked.slice(0, 3).filter((x) => x.pct < 70) };
  }, [rows]);

  return { rows, stats, error };
}
