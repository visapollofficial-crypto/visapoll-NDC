import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Composer } from "../components/Composer";
import { PostCard } from "../components/PostCard";
import { fetchPinned, fetchPosts, type Cursor, type Post } from "../services/feed";

export default function Feed() {
  const { user, profile, role } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [pinned, setPinned] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const loadMore = useCallback(async (from: Cursor) => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError("");
    try {
      const r = await fetchPosts(from);
      setPosts((p) => (from ? [...p, ...r.posts] : r.posts));
      setCursor(r.cursor); setDone(r.done);
    } catch { setError("Couldn't load the feed. Check your connection and try again."); }
    finally { busy.current = false; setLoading(false); }
  }, []);

  const refresh = useCallback(() => {
    setDone(false); setCursor(null);
    fetchPinned().then(setPinned).catch(() => undefined);
    return loadMore(null);
  }, [loadMore]);

  useEffect(() => { refresh(); }, [refresh]);

  // Infinite scroll
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done || error) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && !busy.current && cursor) loadMore(cursor); }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, done, error, loadMore]);

  if (!user || !profile) return null;
  const isStaff = role === "moderator" || role === "admin" || role === "superadmin";
  const remove = (id: string) => { setPosts((p) => p.filter((x) => x.id !== id)); setPinned((p) => p.filter((x) => x.id !== id)); };
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const card = (p: Post) => <PostCard key={p.id} post={p} uid={user.uid} myName={profile.fullName} isStaff={isStaff} onDeleted={remove} />;

  return (
    <>
      <header className="page-head"><h1>Feed</h1></header>
      <Composer uid={user.uid} isStaff={isStaff} onPosted={refresh} />
      {pinned.map(card)}
      {posts.filter((p) => !pinnedIds.has(p.id)).map(card)}

      {loading && <><div className="post skeleton-card" /><div className="post skeleton-card" /></>}
      {!loading && !error && posts.length === 0 && (
        <p className="muted">Nothing here yet. Be the first to share a note or a question.</p>
      )}
      {error && (
        <div className="center-screen" style={{ minHeight: 0 }}>
          <p className="error" role="alert">{error}</p>
          <button className="btn" onClick={() => loadMore(cursor)}>Try again</button>
        </div>
      )}
      {!done && !loading && !error && <div ref={sentinel} style={{ height: 1 }} />}
      {done && posts.length > 0 && <p className="muted small" style={{ textAlign: "center" }}>You're all caught up.</p>}
    </>
  );
}
