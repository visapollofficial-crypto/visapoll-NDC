import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, limit, orderBy, query, where, type Timestamp } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

export interface QuizDoc {
  id: string; title: string; type: "weekly" | "topic"; subjectName: string; durationMin: number;
  questionIds: string[]; questionCount: number; startAt: Timestamp | null; endAt: Timestamp | null;
  examAttempts: number; practiceAttempts: number; negativeMarking: number; marksPerQuestion: number;
}

export default function QuizList() {
  const { profile } = useAuth();
  const [items, setItems] = useState<QuizDoc[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!profile) return;
    getDocs(query(collection(db, "quizzes"), where("status", "==", "published"), where("departments", "array-contains", profile.department), orderBy("createdAt", "desc"), limit(30)))
      .then((s) => setItems(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<QuizDoc, "id">) })))).catch(() => setError(true));
  }, [profile]);

  const now = Date.now();
  const state = (q: QuizDoc) => {
    if (q.type !== "weekly" || !q.startAt || !q.endAt) return "Practice quiz";
    if (now < q.startAt.toMillis()) return `Exam opens ${new Date(q.startAt.toMillis()).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
    if (now <= q.endAt.toMillis()) return "Exam is open now";
    return "Exam closed. Practice available";
  };

  return (
    <>
      <header className="page-head">
        <h1>Quizzes</h1>
        <Link className="btn ghost" to="/results">My results</Link>
      </header>
      {error && <p className="error" role="alert">Couldn't load quizzes. Check your connection.</p>}
      {items === null && !error && <div className="post skeleton-card" />}
      {items?.length === 0 && <p className="muted">No quizzes are available yet. You'll be told when one is published.</p>}
      {items?.map((q) => (
        <Link key={q.id} to={`/quiz/${q.id}`} className="tile material" style={{ marginBottom: ".8rem" }}>
          <span className="small">{q.type === "weekly" ? "Weekly model quiz" : "Topic quiz"}{q.subjectName && ` · ${q.subjectName}`}</span>
          <strong>{q.title}</strong>
          <span>{q.questionCount || q.questionIds.length} questions · {q.durationMin} min{q.negativeMarking > 0 && ` · negative marking ${q.negativeMarking * 100}%`}</span>
          <span className={`badge ${now >= (q.startAt?.toMillis() ?? Infinity) && now <= (q.endAt?.toMillis() ?? 0) ? "verified" : ""}`} style={{ justifySelf: "start" }}>{state(q)}</span>
        </Link>
      ))}
    </>
  );
}
