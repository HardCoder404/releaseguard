export function RiskRing({ score, threshold, size = 64 }: { score: number; threshold: number; size?: number }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(1, score / 10));
  const color = score >= threshold ? "#fb5c5c" : score >= 4 ? "#fbbf24" : "#34d399";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1f2430" strokeWidth={5} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center leading-none"><div className="text-[15px] font-semibold mono" style={{ color }}>{score}</div><div className="text-[8.5px] text-dim mt-0.5">/ 10</div></div>
      </div>
    </div>
  );
}
