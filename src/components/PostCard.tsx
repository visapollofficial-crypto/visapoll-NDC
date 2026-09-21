import { useEffect, useState } from "react";
import { deletePost, hasLiked, reportPost, setLiked, type Post } from "../services/feed";
import { timeAgo } from "../utils/time";
import { Avatar } from "./Avatar";
import { Comments } from "./Comments";

const REASONS = [
  ["spam", "Spam"], ["abuse", "Abusive or bullying"], ["inappropriate", "Inappropriate"],
  ["cheating", "Cheating or leaked answers"], ["other", "Something else"],
] as const;

export function PostCard({ post, uid, myName, isStaff, onDeleted }: {
  post: Post; uid: string; myName: string; isStaff: boolean; onDeleted: (id: string) => void;
}) {
  const [liked, setLikedState] = useState(false);
  const [likes, setLikes] = useState(post.likeCount);
  const [comments, setComments] = useState(post.commentCount);
  const [showComments, setShowComments] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => { hasLiked(post.id, uid).then(setLikedState).catch(() => undefined); }, [post.id, uid]);

  async function toggleLike() {
    const next = !liked;
    setLikedState(next); setLikes((n) => n + (next ? 1 : -1)); // optimistic
    try { await setLiked(post.id, uid, next); }
    catch { setLikedState(!next); setLikes((n) => n + (next ? -1 : 1)); }
  }

  async function remove() {
    if (!confirm("Delete this post? This can't be undone.")) return;
    try { await deletePost(post.id); onDeleted(post.id); } catch { setNote("Couldn't delete the post."); }
  }

  async function report(reason: string) {
    setReporting(false);
    try { await reportPost(post.id, reason); setNote("Thanks. Staff will review this post."); }
    catch { setNote("Couldn't send your report. Try again."); }
  }

  const canDelete = post.authorId === uid || isStaff;

  return (
    <article className={`post ${post.kind === "announcement" ? "announcement" : ""}`}>
      <header className="post-head">
        <Avatar name={post.authorName} url={post.authorPhoto} />
        <div>
          <strong>{post.authorName}</strong>{" "}
          {post.authorRole === "staff" && <span className="badge verified">Staff</span>}
          <div className="muted small">
            {post.kind === "announcement" && "Announcement · "}{post.createdAt ? timeAgo(post.createdAt.toMillis()) : ""}
            {post.pinned && " · Pinned"}
          </div>
        </div>
      </header>

      {post.text && <p className="pre">{post.text}</p>}
      {post.link && <p><a href={post.link} target="_blank" rel="noopener noreferrer nofollow">{post.link}</a></p>}

      {post.media.length > 0 && (
        <div className={`media m${Math.min(post.media.length, 4)}`}>
          {post.media.map((m) =>
            m.type === "image"
              ? <img key={m.path} src={m.url} alt="Attached by the author" loading="lazy" />
              : <video key={m.path} src={m.url} controls preload="metadata" />
          )}
        </div>
      )}

      <div className="actions">
        <button className={`linkbtn ${liked ? "on" : ""}`} onClick={toggleLike} aria-pressed={liked}>
          {liked ? "Liked" : "Like"} · {Math.max(0, likes)}
        </button>
        <button className="linkbtn" onClick={() => setShowComments((s) => !s)} aria-expanded={showComments}>
          Comments · {Math.max(0, comments)}
        </button>
        {canDelete && <button className="linkbtn" onClick={remove}>Delete</button>}
        {post.authorId !== uid && <button className="linkbtn" onClick={() => setReporting((r) => !r)}>Report</button>}
      </div>

      {reporting && (
        <div className="report-menu" role="group" aria-label="Report reason">
          {REASONS.map(([k, label]) => <button key={k} className="btn ghost" onClick={() => report(k)}>{label}</button>)}
        </div>
      )}
      {note && <p className="muted small" role="status">{note}</p>}
      {showComments && <Comments postId={post.id} uid={uid} name={myName} isStaff={isStaff} onCount={(d) => setComments((c) => c + d)} />}
    </article>
  );
}
