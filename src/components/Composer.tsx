import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPost } from "../services/feed";
import { uploadFeedMedia, validateMedia, type UploadedMedia } from "../services/upload";
import { friendlyError } from "../services/api";

export function Composer({ uid, isStaff, onPosted }: { uid: string; isStaff: boolean; onPosted: () => void }) {
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [announce, setAnnounce] = useState(false);
  const [pin, setPin] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const previews = useMemo(() => files.map((f) => ({ f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  function pick(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, 4);
    const bad = next.map(validateMedia).find(Boolean);
    if (bad) return setError(bad);
    setError(""); setFiles(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!text.trim() && files.length === 0 && !link.trim()) return setError("Write something or add a photo.");
    if (link && !/^https:\/\//i.test(link.trim())) return setError("Links must start with https://");
    setBusy(true);
    try {
      const uploaded: UploadedMedia[] = [];
      for (let i = 0; i < files.length; i++) {
        uploaded.push(await uploadFeedMedia(uid, files[i], (p) => setProgress((i + p) / files.length)));
      }
      await createPost({
        text: text.trim(), link: link.trim() || undefined, media: uploaded,
        kind: announce ? "announcement" : "post", pinned: pin,
      });
      setText(""); setLink(""); setFiles([]); setAnnounce(false); setPin(false); setProgress(0);
      onPosted();
    } catch (err) {
      setError(err instanceof Error && !("code" in err) ? err.message : friendlyError(err));
    } finally { setBusy(false); }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="post-text">Share something with your class</label>
      <textarea id="post-text" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Share a note, a question or a resource with your class" />
      <input type="url" aria-label="Link (optional)" placeholder="Link (optional, https://…)" value={link} onChange={(e) => setLink(e.target.value)} />
      {previews.length > 0 && (
        <div className="previews">
          {previews.map(({ f, url }, i) => (
            <div key={url} className="preview">
              {f.type.startsWith("video") ? <video src={url} muted /> : <img src={url} alt="" />}
              <button type="button" className="linkbtn" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
        </div>
      )}
      {busy && files.length > 0 && <progress value={progress} max={1} aria-label="Upload progress" />}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="composer-bar">
        <label className="btn ghost filebtn">
          Add photo or video
          <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
        </label>
        {isStaff && (
          <>
            <label className="check inline"><input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Announcement</label>
            <label className="check inline"><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> Pin</label>
          </>
        )}
        <button className="btn" disabled={busy}>{busy ? "Posting…" : "Post"}</button>
      </div>
    </form>
  );
}
