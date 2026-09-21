import { Link } from "react-router-dom";
import { useQuizStats } from "../hooks/useQuizStats";

export default function Results() {
  const { rows, stats, error } = useQuizStats();
  return (
    <>
      <header className="page-head"><h1>My results</h1><span className="composer-bar"><Link className="btn ghost" to="/insights">Insights</Link><Link className="btn ghost" to="/quiz">Quizzes</Link></span></header>
      {error && <p className="error" role="alert">Couldn't load your results.</p>}
      {rows === null && !error && <div className="post skeleton-card" />}
      {rows?.length === 0 && <p className="muted">You haven't taken a quiz yet. Your scores will appear here.</p>}
      {stats && (
        <section className="grid" style={{ marginBottom: "1rem" }}>
          <div className="tile"><span>Quizzes taken</span><strong className="stat">{stats.total}</strong></div>
          <div className="tile"><span>Average</span><strong className="stat">{stats.avg}%</strong></div>
          <div className="tile"><span>Highest</span><strong className="stat">{stats.best}%</strong></div>
          <div className="tile"><span>Day streak</span><strong className="stat">{stats.streak}</strong></div>
          <div className="tile"><span>Needs revision</span><strong>{stats.weak.length ? stats.weak.map((w) => `${w.k} (${w.pct}%)`).join(", ") : "Nothing flagged yet"}</strong></div>
        </section>
      )}
      {rows?.map((r) => (
        <Link key={r.id} to={`/results/${r.id}`} className="tile material" style={{ marginBottom: ".7rem" }}>
          <span className="small">{r.mode === "exam" ? "Exam" : "Practice"} · {"toMillis" in r.submittedAt ? new Date(r.submittedAt.toMillis()).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}</span>
          <strong>{r.quizTitle}</strong>
          <span>{r.score} / {r.maxScore} ({r.percent}%)</span>
        </Link>
      ))}
    </>
  );
}
