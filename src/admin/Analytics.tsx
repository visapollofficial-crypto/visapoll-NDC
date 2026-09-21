import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase/config";
import { BarChart, HBars, LineChart } from "../components/charts";
import { friendlyError } from "../services/api";

type Bucket = Record<string, { correct: number; total: number }>;
interface Day {
  date: string; activeStudents: number; weeklyActive: number; totalStudents: number; newStudents: number; quizAttempts: number; quizParticipants: number;
  examAttempts: number; practiceAttempts: number; avgScore: number | null; subjects: Bucket; topics: Bucket; paymentsVerified: number; revenue: number;
  posts: number; aiRequests: number; subscriptions: { trial: number; paid: number; expired: number; none: number };
}
const short = (d: string) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const rank = (b: Bucket, min: number) => Object.entries(b).filter(([, v]) => v.total >= min).map(([name, v]) => ({ name, pct: Math.round((v.correct / v.total) * 100), note: `${v.total} answers` })).sort((a, b) => a.pct - b.pct);

export default function Analytics() {
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => getDocs(query(collection(db, "analyticsDaily"), orderBy("date", "desc"), limit(30)))
    .then((s) => setDays(s.docs.map((d) => d.data() as Day).reverse())).catch(() => setError("Couldn't load analytics.")), []);
  useEffect(() => { load(); }, [load]);

  async function refresh(n: number) {
    setBusy(true); setMsg(""); setError("");
    try { await httpsCallable(functions, "adminRefreshAnalytics", { timeout: 300_000 })({ days: n }); await load(); setMsg(n > 1 ? `Rebuilt the last ${n} days.` : "Updated."); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  const v = useMemo(() => {
    if (!days?.length) return null;
    const last = days[days.length - 1];
    const sub: Bucket = {}, top: Bucket = {};
    days.forEach((d) => {
      Object.entries(d.subjects ?? {}).forEach(([k, x]) => { sub[k] = sub[k] ?? { correct: 0, total: 0 }; sub[k].correct += x.correct; sub[k].total += x.total; });
      Object.entries(d.topics ?? {}).forEach(([k, x]) => { top[k] = top[k] ?? { correct: 0, total: 0 }; top[k].correct += x.correct; top[k].total += x.total; });
    });
    const s = last.subscriptions;
    const past = s.paid + s.expired;
    return {
      last, sub: rank(sub, 10), weak: rank(top, 20).filter((t) => t.pct < 70).slice(0, 8),
      revenue30: days.reduce((a, d) => a + (d.revenue ?? 0), 0), payments30: days.reduce((a, d) => a + (d.paymentsVerified ?? 0), 0),
      conversion: past ? Math.round((s.paid / past) * 100) : null,
      engagement: last.totalStudents ? Math.round((last.weeklyActive / last.totalStudents) * 100) : 0,
      subBars: [["Paid", s.paid], ["On trial", s.trial], ["Expired", s.expired], ["No plan yet", s.none]].map(([name, n]) => ({ name: String(name), pct: last.totalStudents ? Math.round((Number(n) / last.totalStudents) * 100) : 0, note: `${n} students` })),
    };
  }, [days]);

  return (
    <>
      <div className="composer-bar">
        <button className="btn ghost" disabled={busy} onClick={() => refresh(1)}>{busy ? "Working…" : "Refresh now"}</button>
        <button className="btn ghost" disabled={busy} onClick={() => confirm("Rebuild the last 30 days? This can take a minute.") && refresh(30)}>Rebuild 30 days</button>
        <span className="muted small">Summaries are anonymous and update every night.</span>
      </div>
      {msg && <p role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {days === null && !error && <div className="post skeleton-card" />}
      {days?.length === 0 && <p className="muted" style={{ marginTop: "1rem" }}>No summaries yet. Press <strong>Rebuild 30 days</strong> once to create the first charts. They update automatically every night after that.</p>}

      {v && (
        <>
          <section className="grid" style={{ margin: "1rem 0" }}>
            <div className="tile"><span>Active today</span><strong className="stat">{v.last.activeStudents}</strong></div>
            <div className="tile"><span>Active this week</span><strong className="stat">{v.last.weeklyActive}</strong></div>
            <div className="tile"><span>Weekly engagement</span><strong className="stat">{v.engagement}%</strong></div>
            <div className="tile"><span>Total students</span><strong className="stat">{v.last.totalStudents}</strong></div>
            <div className="tile"><span>Revenue (30 days)</span><strong className="stat">{v.revenue30} BDT</strong></div>
            <div className="tile"><span>Paid share after trial</span><strong className="stat">{v.conversion === null ? "n/a" : `${v.conversion}%`}</strong></div>
          </section>

          <section className="panel"><h2>Daily active students</h2><LineChart data={days!.map((d) => ({ label: short(d.date), value: d.activeStudents }))} label="Active students per day, last 30 days" /></section>
          <section className="panel"><h2>Quiz participation <span className="muted small">(attempts per day)</span></h2><BarChart data={days!.map((d) => ({ label: short(d.date), value: d.quizAttempts }))} label="Quiz attempts per day" /></section>
          <section className="panel"><h2>Average score</h2><LineChart data={days!.map((d) => ({ label: short(d.date), value: d.avgScore }))} max={100} unit="%" label="Average quiz score per day" /></section>
          <section className="panel"><h2>New students</h2><BarChart data={days!.map((d) => ({ label: short(d.date), value: d.newStudents }))} label="New students per day" /></section>
          <section className="panel"><h2>Payments <span className="muted small">({v.payments30} verified in 30 days)</span></h2><BarChart data={days!.map((d) => ({ label: short(d.date), value: d.revenue }))} unit=" BDT" label="Revenue per day in BDT" /></section>
          <section className="panel"><h2>Students by plan <span className="muted small">(latest)</span></h2><HBars rows={v.subBars} warnBelow={0} goodFrom={101} /></section>
          <section className="panel"><h2>Subject performance <span className="muted small">(30 days, weakest first)</span></h2><HBars rows={v.sub} /></section>
          <section className="panel"><h2>Topics students struggle with</h2><p className="muted small">Useful for planning revision classes. Whole-class numbers only; no student is named.</p><HBars rows={v.weak} /></section>
        </>
      )}
    </>
  );
}
