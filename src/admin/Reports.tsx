import { useCallback, useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where, type Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase/config";
import { friendlyError } from "../services/api";

interface Rep { id: string; type: "post" | "message"; targetId: string; reason: string; note?: string | null; snapshot?: string; senderName?: string; createdAt: Timestamp }
type Action = "dismiss" | "remove" | "remove_and_restrict" | "remove_and_suspend";

function Item({ r, onDone }: { r: Rep; onDone: () => void }) {
  const [post, setPost] = useState<{ text: string; authorName: string; status: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (r.type === "post") getDoc(doc(db, "posts", r.targetId)).then((s) => setPost(s.exists() ? (s.data() as { text: string; authorName: string; status: string }) : null)); }, [r]);

  async function act(action: Action) {
    const warn = action === "remove_and_suspend" ? "Remove this and SUSPEND the sender's account?" : action === "dismiss" ? "Dismiss this report?" : "Remove this content?";
    if (!confirm(warn)) return;
    setBusy(true); setError("");
    try { await httpsCallable(functions, "adminResolveReport")({ reportId: r.id, action }); onDone(); } catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  const content = r.type === "message" ? r.snapshot : post === undefined ? "Loading…" : post === null ? "(This post no longer exists.)" : post.text || "(Photo or link post)";
  const who = r.type === "message" ? r.senderName : post?.authorName;
  return (
    <div className="post">
      <div className="small muted">{r.type === "message" ? "Chat message" : "Feed post"} · reason: <strong>{r.reason}</strong> · {new Date(r.createdAt.toMillis()).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{post?.status === "hidden" && " · auto-hidden"}</div>
      {who && <div><strong>{who}</strong></div>}
      <p className="pre quote">{content}</p>
      {r.note && <p className="small">Reporter's note: {r.note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="composer-bar">
        <button className="btn ghost" disabled={busy} onClick={() => act("dismiss")}>Dismiss{r.type === "post" && post?.status === "hidden" ? " and restore" : ""}</button>
        <button className="btn" disabled={busy} onClick={() => act("remove")}>Remove</button>
        {r.type === "message" && <button className="btn ghost" disabled={busy} onClick={() => act("remove_and_restrict")}>Remove + restrict chat</button>}
        <button className="btn ghost" disabled={busy} onClick={() => act("remove_and_suspend")}>Remove + suspend</button>
      </div>
    </div>
  );
}

export default function Reports() {
  const [items, setItems] = useState<Rep[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    getDocs(query(collection(db, "reports"), where("status", "==", "open"), orderBy("createdAt", "desc"), limit(50)))
      .then((s) => setItems(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Rep, "id">) })))).catch(() => setError("Couldn't load reports."));
  }, []);
  useEffect(load, [load]);
  return (
    <>
      <p className="muted small">Reports on feed posts and chat messages. Chat messages are saved with the report, so you can act even if the sender deleted them. Private one-to-one chats are only visible to admins through reports.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {items === null && !error && <div className="post skeleton-card" />}
      {items?.length === 0 && <p className="muted">No open reports. 🎉</p>}
      {items?.map((r) => <Item key={r.id} r={r} onDone={load} />)}
    </>
  );
}
