import { useEffect, useState } from "react";
import { collection, getCountFromServer, query, where, type QueryConstraint } from "firebase/firestore";
import { db } from "../firebase/config";

const count = async (col: string, ...c: QueryConstraint[]) => (await getCountFromServer(query(collection(db, col), ...c))).data().count;

export default function Overview() {
  const [s, setS] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      count("users"),
      count("users", where("verificationStatus", "==", "pending")),
      count("subscriptions", where("status", "==", "trial")),
      count("subscriptions", where("status", "==", "active")),
      count("subscriptions", where("status", "==", "expired")),
      count("classMaterials", where("status", "==", "published")),
      count("reports", where("status", "==", "open")),
      count("studentRoster"),
    ]).then(([students, pending, trial, paid, expired, materials, reports, roster]) =>
      setS({ students, pending, trial, paid, expired, materials, reports, roster })).catch(() => setError(true));
  }, []);

  if (error) return <p className="error" role="alert">Couldn't load statistics.</p>;
  const cards: [string, string][] = [["students", "Students"], ["pending", "Pending verification"], ["trial", "On free trial"], ["paid", "Paid"], ["expired", "Expired"], ["materials", "Published materials"], ["reports", "Open reports"], ["roster", "Roster size"]];
  return (
    <div className="grid">
      {cards.map(([k, label]) => (
        <div key={k} className="tile"><span>{label}</span><strong className="stat">{s ? s[k] : "…"}</strong></div>
      ))}
    </div>
  );
}
