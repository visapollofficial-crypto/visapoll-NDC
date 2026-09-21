import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NotificationBell } from "../components/NotificationBell";
import { onForegroundMessage } from "../firebase/messaging";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/config";

// Desktop sidebar lists everything; the mobile bottom bar keeps the five most used.
const SIDE_EXTRA = [{ to: "/feed", label: "Feed" }, { to: "/homework", label: "Homework help" }, { to: "/chat", label: "Chat" }, { to: "/results", label: "Results" }, { to: "/insights", label: "Insights" }, { to: "/subscription", label: "Subscription" }];
const NAV = [
  { to: "/dashboard", label: "Home" },
  { to: "/learn", label: "Learn" },
  { to: "/quiz", label: "Quiz" },
  { to: "/ai", label: "AI" },
  { to: "/profile", label: "Profile" },
];

export function StudentLayout() {
  const { role, signOut, profile } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  // Once a day, tell the server this student was active (counts only, no page tracking).
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem("pingDay") === today) return;
    httpsCallable(functions, "pingActive")().then(() => localStorage.setItem("pingDay", today)).catch(() => undefined);
  }, []);

  const [toast, setToast] = useState<{ title: string; body: string; link: string } | null>(null);
  useEffect(() => {
    let off = () => undefined as void;
    onForegroundMessage((title, body, link) => { setToast({ title, body, link }); setTimeout(() => setToast(null), 6000); }).then((f) => { off = f; });
    return () => off();
  }, []);

  const isStaff = role === "admin" || role === "superadmin";

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">NDC Learn</div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className="navlink">
              {n.label}
            </NavLink>
          ))}
          {SIDE_EXTRA.map((n) => <NavLink key={n.to} to={n.to} className="navlink">{n.label}</NavLink>)}
          <NotificationBell className="navlink" />
          {isStaff && (
            <NavLink to="/admin" className="navlink">
              Admin
            </NavLink>
          )}
        </nav>
        <div className="sidebar-foot">
          <span className="muted small">{profile?.fullName}</span>
          <button className="btn ghost" onClick={() => setDark((d) => !d)} aria-pressed={dark}>
            {dark ? "Light mode" : "Dark mode"}
          </button>
          <button className="btn ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="topbar"><span className="brand">NDC Learn</span><NotificationBell className="bell" /></div>
      <main className="content" id="main">
        {toast && (
          <div className="toast" role="status">
            <strong>{toast.title}</strong> <span>{toast.body}</span>
            {toast.link && <NavLink to={toast.link} onClick={() => setToast(null)}> Open</NavLink>}
          </div>
        )}
        <Outlet />
      </main>
      <nav className="bottomnav" aria-label="Main navigation">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className="bottomlink">
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
