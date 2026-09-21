import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { Loader } from "../components/Loader";
import { QuizRunner } from "../quiz/QuizRunner";
import { startAttempt, type AttemptPayload } from "../services/quiz";
import { friendlyError } from "../services/api";
import type { QuizDoc } from "./QuizList";

export default function QuizDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [quiz, setQuiz] = useState<QuizDoc | null | undefined>(undefined);
  const [used, setUsed] = useState({ practice: 0, exam: 0 });
  const [payload, setPayload] = useState<AttemptPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!id || !user) return;
    try {
      const s = await getDoc(doc(db, "quizzes", id));
      setQuiz(s.exists() ? ({ id: s.id, ...(s.data() as Omit<QuizDoc, "id">) }) : null);
      const [p, e] = await Promise.all(["practice", "exam"].map((m) => getDoc(doc(db, "attemptCounters", `${user.uid}_${id}_${m}`))));
      setUsed({ practice: p.exists() ? p.data()!.count : 0, exam: e.exists() ? e.data()!.count : 0 });
    } catch { setQuiz(null); }
  }, [id, user]);
  useEffect(() => { load(); }, [load]);

  async function start(mode: "practice" | "exam") {
    if (!id) return;
    setBusy(true); setError("");
    try { setPayload(await startAttempt(id, mode)); }
    catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
  }

  if (payload) return <QuizRunner payload={payload} onFinished={(aid) => nav(`/results/${aid}`, { replace: true })} />;
  if (quiz === undefined) return <Loader />;
  if (quiz === null) return <><Link to="/quiz">← Quizzes</Link><p className="muted">This quiz isn't available.</p></>;

  const now = Date.now();
  const live = quiz.type === "weekly" && quiz.startAt && quiz.endAt;
  const examOpen = !!live && now >= quiz.startAt!.toMillis() && now <= quiz.endAt!.toMillis();
  const fmt = (t: { toMillis(): number }) => new Date(t.toMillis()).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <Link to="/quiz">← Quizzes</Link>
      <header className="page-head" style={{ marginTop: ".8rem" }}><h1>{quiz.title}</h1></header>
      <section className="plan-card" style={{ display: "block" }}>
        <p>{quiz.questionCount || quiz.questionIds.length} questions · {quiz.durationMin} minutes · {quiz.marksPerQuestion} mark each</p>
        <p>{quiz.negativeMarking > 0 ? `Each wrong answer costs ${quiz.negativeMarking * 100}% of a mark.` : "No negative marking."}</p>
        {live && <p>Live exam: {fmt(quiz.startAt!)} to {fmt(quiz.endAt!)}</p>}
        <p className="muted small">The timer runs on our server. If time runs out, your answers are submitted automatically.</p>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="composer-bar">
        {live && (
          <button className="btn" disabled={busy || !examOpen || used.exam >= quiz.examAttempts} onClick={() => start("exam")}>
            {used.exam >= quiz.examAttempts ? "Exam attempt used" : examOpen ? "Start exam" : now < quiz.startAt!.toMillis() ? "Exam not open yet" : "Exam closed"}
          </button>
        )}
        <button className={live ? "btn ghost" : "btn"} disabled={busy || used.practice >= quiz.practiceAttempts} onClick={() => start("practice")}>
          {used.practice >= quiz.practiceAttempts ? "No practice attempts left" : `Practice (${quiz.practiceAttempts - used.practice} left)`}
        </button>
      </div>
    </>
  );
}
