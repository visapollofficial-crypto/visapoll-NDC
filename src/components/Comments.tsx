import { useEffect, useState, type FormEvent } from "react";
import { addComment, deleteComment, fetchComments, type Comment } from "../services/feed";
import { timeAgo } from "../utils/time";

export function Comments({ postId, uid, name, isStaff, onCount }: {
  postId: string; uid: string; name: string; isStaff: boolean; onCount: (delta: number) => void;
}) {
  const [items, setItems] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => fetchComments(postId).then(setItems).catch(() => setError("Couldn't load comments."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [postId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setBusy(true); setError("");
    try {
      await addComment(postId, uid, name, t);
      setText(""); onCount(1); await load();
    } catch { setError("Couldn't post your comment. Try again."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    try { await deleteComment(postId, id); onCount(-1); setItems((p) => p?.filter((c) => c.id !== id) ?? p); }
    catch { setError("Couldn't delete that comment."); }
  }

  return (
    <div className="comments">
      {items === null && !error && <div className="skeleton-bar" />}
      {items?.length === 0 && <p className="muted small">No comments yet. Start the discussion.</p>}
      {items?.map((c) => (
        <div key={c.id} className="comment">
          <p><strong>{c.authorName}</strong> <span className="muted small">{c.createdAt ? timeAgo(c.createdAt.toMillis()) : ""}</span></p>
          <p className="pre">{c.text}</p>
          {(c.authorId === uid || isStaff) && <button className="linkbtn" onClick={() => remove(c.id)}>Delete</button>}
        </div>
      ))}
      <form onSubmit={submit} className="comment-form">
        <label className="sr-only" htmlFor={`c-${postId}`}>Write a comment</label>
        <input id={`c-${postId}`} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Write a comment" />
        <button className="btn" disabled={busy || !text.trim()}>Post</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
