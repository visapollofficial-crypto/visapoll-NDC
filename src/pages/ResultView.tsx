import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getResult, fmtTime, type ReviewItem, type Result } from "../services/quiz";
import { Loader } from "../components/Loader";

export default function ResultView() {
  const { id } = useParams();
  const [data, setData] = useState<{ result: Result; revealed: boolean; review: ReviewItem[] | null } | null | undefined>(undefined);
  useEffect(() => { if (id) getResult(id).then(setData).catch(() => setData(null)); }, [id]);

  if (data === undefined) return <Loader />;
  if (data === null) return <><Link to="/results">← Results</Link><p className="muted">This result isn't available.</p></>;
  const { result: r, revealed, review } = data;
  const topics = Object.entries(r.topics).map(([t, v]) => ({ t, pct: Math.round((v.correct / v.total) * 100), ...v })).sort((a, b) => a.pct - b.pct);
  const weak = topics.filter((x) => x.pct < 60), strong = topics.filter((x) => x.pct >= 80);

  return (
    <>
      <Link to="/results">← Results</Link>
      <header className="page-head" style={{ marginTop: ".8rem" }}><h1>{r.quizTitle}</h1><span className="badge">{r.mode === "exam" ? "Exam" : "Practice"}</span></header>
      {r.autoSubmitted && <p className="notice">Time ran out, so your saved answers were submitted automatically.</p>}
      <section className="grid">
        <div className="tile"><span>Score</span><strong className="stat">{r.score} / {r.maxScore}</strong></div>
        <div className="tile"><span>Percentage</span><strong className="stat">{r.percent}%</strong></div>
        <div className="tile"><span>Correct / wrong / skipped</span><strong>{r.correct} / {r.wrong} / {r.skipped}</strong></div>
        <div className="tile"><span>Time used</span><strong>{fmtTime(r.timeUsedSec)}</strong></div>
      </section>

      {topics.length > 0 && (
        <section style={{ marginTop: "1.25rem" }}>
          <h2>Topics</h2>
          {weak.length > 0 && <p><strong>Revise:</strong> {weak.map((w) => `${w.t} (${w.pct}%)`).join(", ")}</p>}
          {strong.length > 0 && <p><strong>Strong:</strong> {strong.map((w) => `${w.t} (${w.pct}%)`).join(", ")}</p>}
          {weak.length === 0 && strong.length === 0 && <p className="muted">Keep practicing to see clearer strengths and weak spots.</p>}
        </section>
      )}

      <section style={{ marginTop: "1.25rem" }}>
        <h2>Answers</h2>
        {!revealed && <p className="notice">Correct answers and explanations are hidden for this quiz. They may appear after the exam closes.</p>}
        {review?.map((it, i) => (
          <article key={it.questionId} className="post">
            <p className="pre"><strong>{i + 1}.</strong> {it.stem}</p>
            {it.options.map((o, j) => (
              <div key={o.id} className={`option review ${o.id === it.correct ? "right" : o.id === it.chosen ? "wrong" : ""}`}>
                <span className="letter">{"ABCD"[j]}</span><span>{o.text}</span>
                {o.id === it.correct && <span className="badge verified">Correct</span>}
                {o.id === it.chosen && o.id !== it.correct && <span className="badge rejected">Your answer</span>}
              </div>
            ))}
            {it.chosen === null && <p className="muted small">You skipped this question.</p>}
            {it.explanation && <p className="small"><strong>Why:</strong> {it.explanation}</p>}
          </article>
        ))}
      </section>
    </>
  );
}
