import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  ["", "Overview"], ["analytics", "Analytics"], ["students", "Students"], ["verification", "Verification"], ["materials", "Materials"], ["questions", "Questions"], ["quizzes", "Quizzes"], ["ai-generate", "AI generator"], ["ai", "AI settings"], ["notify", "Notify"], ["payments", "Payments"], ["reports", "Reports"], ["chat", "Chat groups"],
  ["subjects", "Subjects"], ["roster", "Roster"], ["settings", "Settings"], ["audit", "Audit log"],
] as const;

export default function AdminLayout() {
  return (
    <>
      <header className="page-head"><h1>Admin</h1></header>
      <nav className="admin-tabs" aria-label="Admin sections">
        {TABS.map(([to, label]) => <NavLink key={to} end={to === ""} to={`/admin/${to}`} className="tab">{label}</NavLink>)}
      </nav>
      <Outlet />
    </>
  );
}
