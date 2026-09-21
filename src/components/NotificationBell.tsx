import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

export function useUnread(): number {
  const { user } = useAuth();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collection(db, "notifications"), where("uid", "==", user.uid), orderBy("createdAt", "desc"), limit(30)),
      (s) => setN(s.docs.filter((d) => d.get("read") === false).length),
      () => setN(0)
    );
  }, [user]);
  return n;
}

export function NotificationBell({ className }: { className?: string }) {
  const n = useUnread();
  return (
    <NavLink to="/notifications" className={className} aria-label={n ? `Notifications, ${n} unread` : "Notifications"}>
      Notifications{n > 0 && <span className="count" aria-hidden="true">{n > 9 ? "9+" : n}</span>}
    </NavLink>
  );
}
