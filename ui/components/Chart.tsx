"use client";
// Dependency-free area/line chart: smooth curves, gradient fill, threshold line, glowing last point.
export interface Series { name: string; color: string; points: (number | null)[] }

function smooth(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

export function LineChart({ series, threshold, unit, height = 150, max, id }: { series: Series[]; threshold?: number; unit: string; height?: number; max?: number; id: string }) {
  const n = Math.max(2, ...series.map((s) => s.points.length));
  const all = series.flatMap((s) => s.points).filter((v): v is number => v !== null);
  const top = Math.max(max ?? 0, (threshold ?? 0) * 1.25, ...all.map((v) => v * 1.2), 1e-9);
  const W = 600, H = height, padL = 46, padR = 12, padT = 12, padB = 26;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - Math.min(v, top) / top) * (H - padT - padB);
  const fmt = (v: number) => unit === "%" ? `${(v * 100).toFixed(v * 100 < 10 ? 1 : 0)}%` : `${Math.round(v)}${unit}`;
  const nice = (t: number) => unit === "%" ? t : t;
  const ticks = [0, top / 2, top].map(nice);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      <defs>
        {series.map((s) => (
          <linearGradient key={s.name} id={`${id}-${s.name}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity=".28" /><stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
        <filter id={`${id}-glow`}><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#1f2430" strokeWidth={1} />
          <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="#5c6478" fontFamily="var(--font-mono)">{fmt(t)}</text>
        </g>
      ))}
      {threshold !== undefined && threshold <= top && (
        <g>
          <line x1={padL} x2={W - padR} y1={y(threshold)} y2={y(threshold)} stroke="#fb5c5c" strokeDasharray="5 5" strokeWidth={1.2} opacity=".9" />
          <rect x={W - padR - 74} y={y(threshold) - 16} width={74} height={14} rx={7} fill="#fb5c5c" opacity=".12" />
          <text x={W - padR - 37} y={y(threshold) - 5.5} textAnchor="middle" fontSize={9.5} fill="#fb5c5c" fontFamily="var(--font-mono)">limit {fmt(threshold)}</text>
        </g>
      )}
      {series.map((s) => {
        const pts = s.points.map((v, i) => v === null ? null : { x: x(i), y: y(v) }).filter((p): p is { x: number; y: number } => !!p);
        if (!pts.length) return null;
        const line = smooth(pts);
        const area = `${line} L${pts[pts.length - 1].x},${y(0)} L${pts[0].x},${y(0)} Z`;
        const last = pts[pts.length - 1];
        return (
          <g key={s.name}>
            <path d={area} fill={`url(#${id}-${s.name})`} />
            <path d={line} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.2} fill="#0b0d12" stroke={s.color} strokeWidth={1.5} />)}
            <circle cx={last.x} cy={last.y} r={4} fill={s.color} filter={`url(#${id}-glow)`} />
          </g>
        );
      })}
      {series.map((s, i) => (
        <g key={s.name} transform={`translate(${padL + i * 100}, ${H - 7})`}>
          <rect width={12} height={3} y={-7} fill={s.color} rx={1.5} />
          <text x={17} fontSize={10} fill="#8a92a6" fontFamily="var(--font-mono)">{s.name}</text>
        </g>
      ))}
    </svg>
  );
}
