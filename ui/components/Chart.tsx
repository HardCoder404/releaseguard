"use client";
// Dependency-free line chart. Two series max (canary vs stable), one threshold line.
export interface Series { name: string; color: string; points: (number | null)[] }

export function LineChart({ series, threshold, unit, height = 140, max }: { series: Series[]; threshold?: number; unit: string; height?: number; max?: number }) {
  const n = Math.max(2, ...series.map((s) => s.points.length));
  const all = series.flatMap((s) => s.points).filter((v): v is number => v !== null);
  const top = Math.max(max ?? 0, threshold ?? 0, ...all, 1e-9) * 1.15;
  const W = 600, H = height, padL = 44, padR = 10, padT = 10, padB = 22;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / top) * (H - padT - padB);
  const path = (pts: (number | null)[]) => pts.map((v, i) => v === null ? "" : `${i === 0 || pts[i - 1] === null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const fmt = (v: number) => unit === "%" ? `${(v * 100).toFixed(v * 100 < 10 ? 1 : 0)}%` : `${Math.round(v)}${unit}`;
  const ticks = [0, top / 2, top];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#232834" strokeWidth={1} />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#8b93a7">{fmt(t)}</text>
        </g>
      ))}
      {threshold !== undefined && (
        <g>
          <line x1={padL} x2={W - padR} y1={y(threshold)} y2={y(threshold)} stroke="#ff5a5f" strokeDasharray="4 4" strokeWidth={1} />
          <text x={W - padR} y={y(threshold) - 4} textAnchor="end" fontSize={10} fill="#ff5a5f">limit {fmt(threshold)}</text>
        </g>
      )}
      {series.map((s) => (
        <g key={s.name}>
          <path d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
          {s.points.map((v, i) => v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color} />)}
        </g>
      ))}
      <g>
        {series.map((s, i) => (
          <g key={s.name} transform={`translate(${padL + i * 110}, ${H - 6})`}>
            <rect width={10} height={3} y={-6} fill={s.color} rx={1} />
            <text x={14} fontSize={10} fill="#8b93a7">{s.name}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
