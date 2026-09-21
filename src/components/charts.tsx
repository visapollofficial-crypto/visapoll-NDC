/** Small dependency-free SVG charts: light for slow phones, follow the light/dark theme, and include a text table for screen readers. */
interface Pt { label: string; value: number | null }

function DataTable({ data, unit }: { data: Pt[]; unit: string }) {
  return (
    <details className="chart-data">
      <summary>View as a table</summary>
      <table><tbody>{data.map((d, i) => <tr key={i}><th scope="row">{d.label}</th><td>{d.value === null ? "no data" : `${d.value}${unit}`}</td></tr>)}</tbody></table>
    </details>
  );
}

const W = 600, H = 200, PAD = { l: 34, r: 10, t: 12, b: 26 };

export function LineChart({ data, max, unit = "", label }: { data: Pt[]; max?: number; unit?: string; label: string }) {
  const vals = data.map((d) => d.value).filter((v): v is number => v !== null);
  if (vals.length === 0) return <p className="muted small">Not enough data yet.</p>;
  const top = max ?? Math.max(5, Math.ceil(Math.max(...vals) * 1.15));
  const x = (i: number) => PAD.l + (data.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (data.length - 1));
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const pts = data.map((d, i) => (d.value === null ? null : ([x(i), y(d.value)] as const)));
  let path = "", pen = false; // start a new segment after any gap
  pts.forEach((p) => { if (!p) { pen = false; return; } path += `${pen ? "L" : "M"}${p[0]},${p[1]}`; pen = true; });
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {[0, 0.5, 1].map((g) => <g key={g}><line x1={PAD.l} x2={W - PAD.r} y1={y(top * g)} y2={y(top * g)} className="grid" /><text x={PAD.l - 6} y={y(top * g) + 4} textAnchor="end" className="axis">{Math.round(top * g)}</text></g>)}
        <path d={path} className="line" />
        {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={3.5} className="pt" />)}
        <text x={PAD.l} y={H - 6} className="axis">{data[0].label}</text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="axis">{data[data.length - 1].label}</text>
      </svg>
      <DataTable data={data} unit={unit} />
    </figure>
  );
}

export function BarChart({ data, unit = "", label }: { data: Pt[]; unit?: string; label: string }) {
  const vals = data.map((d) => d.value ?? 0);
  if (Math.max(0, ...vals) === 0) return <p className="muted small">Nothing to show yet.</p>;
  const top = Math.ceil(Math.max(...vals) * 1.15);
  const bw = (W - PAD.l - PAD.r) / data.length;
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {[0, 0.5, 1].map((g) => <g key={g}><line x1={PAD.l} x2={W - PAD.r} y1={y(top * g)} y2={y(top * g)} className="grid" /><text x={PAD.l - 6} y={y(top * g) + 4} textAnchor="end" className="axis">{Math.round(top * g)}</text></g>)}
        {data.map((d, i) => <rect key={i} x={PAD.l + i * bw + bw * 0.15} width={bw * 0.7} y={y(d.value ?? 0)} height={H - PAD.b - y(d.value ?? 0)} rx={2} className="bar" />)}
        <text x={PAD.l} y={H - 6} className="axis">{data[0].label}</text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="axis">{data[data.length - 1].label}</text>
      </svg>
      <DataTable data={data} unit={unit} />
    </figure>
  );
}

/** Horizontal percentage bars, e.g. accuracy per subject or topic. */
export function HBars({ rows, warnBelow = 60, goodFrom = 80 }: { rows: { name: string; pct: number; note?: string }[]; warnBelow?: number; goodFrom?: number }) {
  if (rows.length === 0) return <p className="muted small">Not enough answers yet.</p>;
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.name}>
          <div className="hb-top"><span>{r.name}</span><strong>{r.pct}%{r.note && <span className="muted small"> · {r.note}</span>}</strong></div>
          <div className="hb-track" role="img" aria-label={`${r.name}: ${r.pct} percent`}><div className={`hb-fill ${r.pct < warnBelow ? "low" : r.pct >= goodFrom ? "high" : ""}`} style={{ width: `${Math.max(2, r.pct)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
