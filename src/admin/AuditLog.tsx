import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, type Timestamp } from "firebase/firestore";
import { db } from "../firebase/config";

interface L { id: string; at: Timestamp; adminId?: string; action?: string; target?: string; type?: string; uid?: string; result?: string; previousAccountId?: string }

function useLogs(col: string) {
  const [rows, setRows] = useState<L[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    getDocs(query(collection(db, col), orderBy("at", "desc"), limit(50)))
      .then((s) => setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<L, "id">) })))).catch(() => setError(true));
  }, [col]);
  return { rows, error };
}

export default function AuditLog() {
  const audit = useLogs("auditLogs");
  const sec = useLogs("securityLogs");
  const when = (t: Timestamp) => new Date(t.toMillis()).toLocaleString();
  return (
    <>
      <h2>Suspicious registration activity</h2>
      {sec.error && <p className="error">Couldn't load security events.</p>}
      {sec.rows?.length === 0 && <p className="muted">No security events.</p>}
      <div className="table-wrap"><table><tbody>
        {sec.rows?.map((r) => <tr key={r.id}><td>{when(r.at)}</td><td>{r.type?.replace(/_/g, " ")}</td><td className="small">{r.uid}{r.previousAccountId && ` (previous account ${r.previousAccountId})`}</td></tr>)}
      </tbody></table></div>

      <h2 style={{ marginTop: "1.5rem" }}>Admin actions</h2>
      {audit.error && <p className="error">Couldn't load the audit log.</p>}
      {audit.rows?.length === 0 && <p className="muted">No admin actions yet.</p>}
      <div className="table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Target</th><th>Admin</th></tr></thead><tbody>
        {audit.rows?.map((r) => <tr key={r.id}><td>{when(r.at)}</td><td>{r.action?.replace(/_/g, " ")}</td><td className="small">{r.target}</td><td className="small">{r.adminId}</td></tr>)}
      </tbody></table></div>
    </>
  );
}
