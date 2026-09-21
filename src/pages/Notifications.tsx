import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where, writeBatch, type Timestamp } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { timeAgo } from "../utils/time";

interface N { id: string; type: string; title: string; body: string; link: string | null; read: boolean; createdAt: Timestamp }

export default function Notifications() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState<N[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, "notifications"), where("uid", "==", user.uid), orderBy("createdAt", "desc"), limit(30)),
      (s) => setItems(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<N, "id">) }))), () => setError(true));
  }, [user]);

  async function open(n: N) {
    if (!n.read) await updateDoc(doc(db, "notifications", n.id), { read: true }).catch(() => undefined);
    if (n.link) nav(n.link);
  }
  async function markAll() {
    const batch = writeBatch(db);
    items?.filter((n) => !n.read).forEach((n) => batch.update(doc(db, "notifications", n.id), { read: true }));
    await batch.commit().catch(() => undefined);
  }
  const unread = items?.filter((n) => !n.read).length ?? 0;

  return (
    <>
      <header className="page-head">
        <h1>Notifications</h1>
        {unread > 0 && <button className="btn ghost" onClick={markAll}>Mark all as read</button>}
      </header>
      {error && <p className="error" role="alert">Couldn't load notifications.</p>}
      {items === null && !error && <div className="post skeleton-card" />}
      {items?.length === 0 && <p className="muted">You're all caught up. New quizzes, class notes and announcements will show up here.</p>}
      {items?.map((n) => (
        <button key={n.id} className={`notif ${n.read ? "" : "unread"}`} onClick={() => open(n)}>
          <strong>{n.title}</strong>
          <span>{n.body}</span>
          <span className="muted small">{n.createdAt ? timeAgo(n.createdAt.toMillis()) : ""}{!n.read && " · New"}</span>
        </button>
      ))}
    </>
  );
}
