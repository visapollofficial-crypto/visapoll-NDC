import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/config";
import { useQuizStats } from "../hooks/useQuizStats";
import { BarChart, HBars, LineChart } from "../components/charts";
import { friendlyError } from "../services/api";

interface Insight { needsMore?: boolean; have?: number; insights: string[]; suggestedRevision: string[]; aiUsed: boolean; generatedAt: number }
type Bucket = Record<string, { correct: number; total: number }>;
const fold = (into: Bucket, from?: Bucket) => Object.entries(from ?? {}).forEach(([k, v]) => { into[k] = into[k] ?? { correct: 0, total: 0 }; into[k].correct += v.correct; into[k].total += v.total; });
const rowsOf = (b: Bucket, min = 3) => Object.entries(b).filter(([, v]) => v.total >= min).map(([name, v]) => ({ name, pct: Math.round((v.correct / v.total) * 100), note: `${v.total} answered` })).sort((a, b) => a.pct - b.pct);

export default function Insights() {
  const { rows, stats } = useQuizStats();
  const [ai, setAi] = useState<Insight | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    httpsCallable<void, Insight>(functions, "learningInsights", { timeout: 90_000 })().then((r) => setAi(r.data)).catch((e) => { setError(friendlyError(e)); setAi(null); });
  }, []);

  const d = useMemo(() => {
    if (!rows?.length) return null;
    const chrono = [...rows].reverse();
    const topics: Bucket = {}, subjects: Bucket = {}, diff: Bucket = {};
    let secs = 0, qs = 0, skipped = 0;
    rows.forEach((r) => { fold(topics, r.topics); fold(subjects, r.subjects); fold(diff, r.difficulty); secs += r.timeUsedSec; qs += r.total; skipped += r.skipped; });
    const date = (r: (typeof rows)[number]) => ("toMillis" in r.submittedAt ? new Date(r.submittedAt.toMillis()).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
    return {
      trend: chrono.slice(-15).map((r) => ({ label: date(r), value: r.percent })),
      topics: rowsOf(topics), subjects: rowsOf(subjects), diff: rowsOf(diff, 3),
      accuracy: qs ? Math.round((rows.reduce((a, r) => a + r.correct, 0) / qs) * 100) : 0,
      secPerQ: qs ? Math.round(secs / qs) : 0, skipped: qs ? Math.round((skipped / qs) * 100) : 0,
      weekly: (() => {
        const weeks: Record<string, number> = {};
        rows.forEach((r) => { if ("toMillis" in r.submittedAt) { const t = new Date(r.submittedAt.toMillis()); t.setDate(t.getDate() - t.getDay()); const k = t.toLocaleDateString(undefined, { day: "numeric", month: "short" }); weeks[k] = (weeks[k] ?? 0) + 1; } });
        return Object.entries(weeks).reverse().slice(-8).map(([label, value]) => ({ label, value }));
      })(),
    };
  }, [rows]);

  return (
    <>
      <header className="page-head"><h1>My learning insights</h1><Link className="btn ghost" to="/results">All results</Link></header>
      <p className="muted small">Private to you. Based only on your quiz activity. These are study tips, not an assessment of you as a person.</p>

      {rows === null && <div className="post skeleton-card" />}
      {rows?.length === 0 && <p className="muted">Take your first quiz to see your progress here.</p>}

      {stats && d && (
        <>
          <section className="grid" style={{ marginBottom: "1.25rem" }}>
            <div className="tile"><span>Average score</span><strong className="stat">{stats.avg}%</strong></div>
            <div className="tile"><span>Answer accuracy</span><strong className="stat">{d.accuracy}%</strong></div>
            <div className="tile"><span>Avg time per question</span><strong className="stat">{d.secPerQ}s</strong></div>
            <div className="tile"><span>Questions skipped</span><strong className="stat">{d.skipped}%</strong></div>
            <div className="tile"><span>Day streak</span><strong className="stat">{stats.streak}</strong></div>
          </section>

          <section className="panel">
            <h2>Study tips</h2>
            {ai === undefined && <div className="skeleton-bar" />}
            {ai?.needsMore && <p className="muted">Finish {3 - (ai.have ?? 0)} more quiz{3 - (ai.have ?? 0) === 1 ? "" : "zes"} to unlock personalised tips.</p>}
            {ai && !ai.needsMore && (
              <>
                <ul className="tips">{ai.insights.map((t, i) => <li key={i}>{t}</li>)}</ul>
                {ai.suggestedRevision.length > 0 && <><h3>What to revise</h3><ul className="tips">{ai.suggestedRevision.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
                <p className="ai-note small muted">{ai.aiUsed ? "Tips written by AI from your quiz numbers. " : ""}They are suggestions for studying, and may not be perfect. Updated {new Date(ai.generatedAt).toLocaleDateString()}.</p>
              </>
            )}
            {error && <p className="muted small">Tips are unavailable right now. Your charts below still work.</p>}
          </section>

          <section className="panel"><h2>Score trend</h2><LineChart data={d.trend} max={100} unit="%" label="Score percentage of your most recent quizzes" /></section>
          <section className="panel"><h2>Quizzes per week</h2><BarChart data={d.weekly} label="Number of quizzes you took each week" /></section>
          {d.subjects.length > 0 && <section className="panel"><h2>By subject</h2><HBars rows={d.subjects} /></section>}
          <section className="panel"><h2>By topic <span className="muted small">(weakest first)</span></h2><HBars rows={d.topics.slice(0, 10)} /></section>
          {d.diff.length > 0 && <section className="panel"><h2>By difficulty</h2><HBars rows={d.diff} /></section>}
        </>
      )}
    </>
  );
}
