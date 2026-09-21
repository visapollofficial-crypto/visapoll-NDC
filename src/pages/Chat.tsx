import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, type Timestamp } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { Avatar } from "../components/Avatar";
import { deleteMessage, isUnread, listMyChats, markSeen, reportMessage, searchStudents, sendMessage, startDirectChat, type ChatSummary, type Found } from "../services/chat";
import { friendlyError } from "../services/api";
import { timeAgo } from "../utils/time";

interface Msg { id: string; senderId: string; senderName: string; text: string; deleted?: boolean; createdAt: Timestamp | null }

function Thread({ chat, me, onChanged }: { chat: ChatSummary; me: string; onChanged: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMsgs(null); setError("");
    return onSnapshot(query(collection(db, "chats", chat.id, "messages"), orderBy("createdAt", "desc"), limit(60)),
      (s) => { setMsgs(s.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: "estimate" }) as Omit<Msg, "id">) })).reverse()); markSeen(chat.id); },
      () => setError("Couldn't load messages."));
  }, [chat.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setError("");
    try { await sendMessage({ chatId: chat.id, text: t }); setText(""); onChanged(); }
    catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
  }
  async function toggleBlock() {
    if (!chat.otherUid) return;
    try {
      if (chat.blocked) await deleteDoc(doc(db, "blocks", me, "list", chat.otherUid));
      else if (confirm(`Block ${chat.name}? You won't receive messages from each other.`)) await setDoc(doc(db, "blocks", me, "list", chat.otherUid), { name: chat.name, createdAt: serverTimestamp() });
      onChanged();
    } catch { setError("Couldn't update the block."); }
  }
  async function report(m: Msg) {
    const reason = prompt("Why are you reporting this? Type one: spam, abuse, inappropriate, cheating, other", "abuse")?.trim().toLowerCase();
    if (!reason) return;
    try { await reportMessage({ chatId: chat.id, messageId: m.id, reason: ["spam", "abuse", "inappropriate", "cheating", "other"].includes(reason) ? reason : "other" }); setNote("Thanks. Staff will review it."); }
    catch (err) { setError(friendlyError(err)); }
  }
  async function remove(m: Msg) { try { await deleteMessage({ chatId: chat.id, messageId: m.id }); } catch { setError("Couldn't delete that message."); } }

  return (
    <section className="chat-thread" aria-label={`Chat with ${chat.name}`}>
      <header className="chat-head">
        <Link to="/chat" className="back" aria-label="Back to chats">←</Link>
        <Avatar name={chat.name} url={chat.photoURL} size={36} />
        <strong>{chat.name}</strong>
        {chat.type === "dm" && <button className="linkbtn" style={{ marginLeft: "auto" }} onClick={toggleBlock}>{chat.blocked ? "Unblock" : "Block"}</button>}
      </header>
      <div className="msgs" aria-live="polite">
        {msgs === null && !error && <div className="skeleton-bar" />}
        {msgs?.length === 0 && <p className="muted" style={{ textAlign: "center" }}>No messages yet. Say hello.</p>}
        {msgs?.map((m) => {
          const mine = m.senderId === me;
          return (
            <div key={m.id} className={`msg ${mine ? "mine" : ""}`}>
              {chat.type === "group" && !mine && <span className="small muted">{m.senderName}</span>}
              <div className="msg-body">{m.deleted ? <em className="muted">Message removed</em> : m.text}</div>
              <span className="small muted">
                {m.createdAt ? timeAgo(m.createdAt.toMillis()) : "sending…"}
                {!m.deleted && (mine ? <> · <button className="linkbtn tiny" onClick={() => remove(m)}>Delete</button></> : <> · <button className="linkbtn tiny" onClick={() => report(m)}>Report</button></>)}
              </span>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {note && <p className="small" role="status">{note}</p>}
      {error && <p className="error small" role="alert">{error}</p>}
      {chat.blocked ? <p className="notice small">You blocked this person. Unblock to send messages.</p> : (
        <form className="composer-row" onSubmit={send}>
          <label className="sr-only" htmlFor="msg">Message</label>
          <input id="msg" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Write a message" autoComplete="off" />
          <button className="btn" disabled={busy || !text.trim()}>Send</button>
        </form>
      )}
    </section>
  );
}

export default function Chat() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);

  const load = useCallback(() => listMyChats().then((r) => { setChats(r.chats); setRestricted(r.restricted); setError(""); }).catch((e) => setError(friendlyError(e))), []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  useEffect(() => { // arriving from someone's profile with "Message"
    const start = (loc.state as { start?: string } | null)?.start;
    if (start) { nav(loc.pathname, { replace: true, state: null }); open(start); }
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setFound(null); return; }
    const t = setTimeout(() => searchStudents({ q }).then(setFound).catch(() => setFound([])), 400);
    return () => clearTimeout(t);
  }, [q]);

  async function open(uid: string) {
    try { const r = await startDirectChat({ uid }); setQ(""); setFound(null); await load(); nav(`/chat/${r.chatId}`); }
    catch (e) { setError(friendlyError(e)); }
  }
  if (!user) return null;
  const current = chats?.find((c) => c.id === id);
  const groups = chats?.filter((c) => c.type === "group") ?? [], dms = chats?.filter((c) => c.type === "dm") ?? [];

  const row = (c: ChatSummary) => (
    <Link key={c.id} to={`/chat/${c.id}`} className={`chat-row ${c.id === id ? "active" : ""}`}>
      <Avatar name={c.name} url={c.photoURL} size={40} />
      <span className="grow"><strong>{c.name}</strong><span className="small muted line">{c.lastMessage || "No messages yet"}</span></span>
      {isUnread(c, user.uid) && c.id !== id && <span className="dot" aria-label="Unread messages" />}
    </Link>
  );

  return (
    <div className={`chat-shell ${id ? "open" : ""}`}>
      <aside className="chat-list">
        <header className="page-head" style={{ marginBottom: ".6rem" }}><h1>Chat</h1></header>
        <label className="sr-only" htmlFor="find">Find a student</label>
        <input id="find" type="search" placeholder="Find a student by name" value={q} onChange={(e) => setQ(e.target.value)} />
        {found && (
          <div className="found">
            {found.length === 0 && <p className="muted small">No students found.</p>}
            {found.map((f) => <button key={f.uid} className="chat-row" onClick={() => open(f.uid)}><Avatar name={f.name} url={f.photoURL} size={36} /><span className="grow"><strong>{f.name}</strong><span className="small muted line">{f.department} · {f.session}</span></span><Link to={`/students/${f.uid}`} className="small" onClick={(e) => e.stopPropagation()}>Profile</Link></button>)}
          </div>
        )}
        {restricted && <p className="notice small">An admin has restricted your messaging. You can still read chats.</p>}
        {error && <p className="error small" role="alert">{error} <button className="linkbtn" onClick={load}>Retry</button></p>}
        {chats === null && !error && <div className="post skeleton-card" />}
        {groups.length > 0 && <><h2 className="small muted">Class chats</h2>{groups.map(row)}</>}
        <h2 className="small muted">Messages</h2>
        {chats && dms.length === 0 && <p className="muted small">No conversations yet. Search for a classmate above to start one.</p>}
        {dms.map(row)}
        <p className="muted small">Be kind. Messages can be reported, and admins can restrict accounts that abuse chat.</p>
      </aside>
      <div className="chat-pane">
        {current ? <Thread chat={current} me={user.uid} onChanged={load} />
          : id && chats ? <p className="muted">This chat isn't available. <Link to="/chat">Back to chats</Link></p>
          : <p className="muted chat-empty">Choose a chat to start talking.</p>}
      </div>
    </div>
  );
}
