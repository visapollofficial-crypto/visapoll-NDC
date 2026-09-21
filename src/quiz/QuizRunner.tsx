import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveAnswer, submitAttempt, fmtTime, type AttemptPayload } from "../services/quiz";
import { friendlyError } from "../services/api";

export function QuizRunner({ payload, onFinished }: { payload: AttemptPayload; onFinished: (attemptId: string) => void }) {
  const qs = payload.questions;
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | null>>(payload.answers);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [unsaved, setUnsaved] = useState(false);

  // The server's clock decides the deadline; correct for any difference with the device clock.
  const offset = useMemo(() => payload.serverNow - Date.now(), [payload.serverNow]);
  const remainingMs = () => payload.deadline - (Date.now() + offset);
  const [remaining, setRemaining] = useState(remainingMs());
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const done = useRef(false);

  const submit = useCallback(async () => {
    if (done.current) return;
    setSubmitting(true); setError("");
    try {
      await submitAttempt(payload.attemptId, answersRef.current);
      done.current = true;
      onFinished(payload.attemptId);
    } catch (err) { setError(friendlyError(err)); setSubmitting(false); }
  }, [payload.attemptId, onFinished]);

  useEffect(() => {
    const t = setInterval(() => {
      const r = payload.deadline - (Date.now() + offset);
      setRemaining(r);
      if (r <= 0) { clearInterval(t); submit(); } // time's up: submit automatically
    }, 1000);
    return () => clearInterval(t);
  }, [payload.deadline, offset, submit]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (!done.current) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const q = qs[idx];
  const answered = qs.filter((x) => answers[x.id]).length;
  const low = remaining < 60_000;

  function choose(optionId: string) {
    setAnswers((a) => ({ ...a, [q.id]: optionId }));
    saveAnswer(payload.attemptId, q.id, optionId).then(() => setUnsaved(false)).catch(() => setUnsaved(true));
  }
  function clear() {
    setAnswers((a) => ({ ...a, [q.id]: null }));
    saveAnswer(payload.attemptId, q.id, null).catch(() => setUnsaved(true));
  }
  const toggleFlag = () => setFlagged((f) => { const n = new Set(f); n.has(q.id) ? n.delete(q.id) : n.add(q.id); return n; });

  return (
    <div className="runner">
      <div className="runner-top">
        <strong>{payload.quizTitle}</strong>
        <span className={`timer ${low ? "low" : ""}`} role="timer" aria-label="Time remaining">{fmtTime(Math.max(0, remaining) / 1000)}</span>
      </div>
      <div className="progress-wrap" aria-hidden="true"><div className="progress-fill" style={{ width: `${(answered / qs.length) * 100}%` }} /></div>
      <p className="muted small">Question {idx + 1} of {qs.length} · {answered} answered</p>
      {unsaved && <p className="notice small" role="status">Your last answer couldn't be saved yet. Don't worry, all answers are sent when you submit.</p>}

      <fieldset className="question">
        <legend className="pre">{q.stem}</legend>
        {q.options.map((o, i) => (
          <label key={o.id} className={`option ${answers[q.id] === o.id ? "chosen" : ""}`}>
            <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === o.id} onChange={() => choose(o.id)} />
            <span className="letter" aria-hidden="true">{"ABCD"[i]}</span><span>{o.text}</span>
          </label>
        ))}
      </fieldset>

      <div className="composer-bar">
        <button className="btn ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Previous</button>
        <button className="btn ghost" onClick={toggleFlag} aria-pressed={flagged.has(q.id)}>{flagged.has(q.id) ? "Unmark review" : "Mark for review"}</button>
        {answers[q.id] && <button className="linkbtn" onClick={clear}>Clear answer</button>}
        {idx < qs.length - 1
          ? <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setIdx(idx + 1)}>Next</button>
          : <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setConfirm(true)}>Submit</button>}
      </div>

      <nav className="palette" aria-label="Question navigator">
        {qs.map((x, i) => (
          <button key={x.id} onClick={() => setIdx(i)} aria-label={`Question ${i + 1}${answers[x.id] ? ", answered" : ""}${flagged.has(x.id) ? ", marked for review" : ""}`}
            className={`pal ${i === idx ? "current" : ""} ${answers[x.id] ? "answered" : ""} ${flagged.has(x.id) ? "flag" : ""}`}>{i + 1}</button>
        ))}
      </nav>
      <button className="btn ghost" onClick={() => setConfirm(true)}>Finish quiz</button>

      {confirm && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="submit-title">
          <div className="modal">
            <h2 id="submit-title">Submit your answers?</h2>
            <p>{answered} of {qs.length} answered{qs.length - answered > 0 && `, ${qs.length - answered} unanswered`}{flagged.size > 0 && `, ${flagged.size} marked for review`}.</p>
            <p className="muted small">You can't change answers after submitting.</p>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="composer-bar">
              <button className="btn ghost" onClick={() => setConfirm(false)} disabled={submitting}>Keep working</button>
              <button className="btn" onClick={submit} disabled={submitting} autoFocus>{submitting ? "Submitting…" : "Submit now"}</button>
            </div>
          </div>
        </div>
      )}
      {submitting && !confirm && <p role="status">Time's up. Submitting your answers…</p>}
    </div>
  );
}
