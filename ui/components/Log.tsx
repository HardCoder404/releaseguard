"use client";
import { useEffect, useRef } from "react";

function cls(l: string) {
  if (/^▶/.test(l)) return "log-head";
  if (/^\s*(✅|✓)/.test(l) || /is live|promoted|approved/.test(l)) return "log-ok";
  if (/^\s*(🔴|✗)/.test(l) || /failed|regression|rolled back|discarded|removed|rejected/.test(l)) return "log-bad";
  if (/^\d\/4/.test(l)) return "log-step";
  if (/needs human approval|risk \d+\/10/.test(l)) return "log-warn";
  return "";
}

export function Log({ lines, running }: { lines: string[]; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (el && running) el.scrollTop = el.scrollHeight; }, [lines.length, running]);
  return (
    <div ref={ref} className="mono text-[12.5px] leading-[1.7] text-mut max-h-[360px] overflow-auto rounded-xl bg-[#0a0c11] border border-line p-4">
      {lines.length ? lines.map((l, i) => <span key={i} className={`log-line ${cls(l)}`}>{l || " "}</span>) : <span className="text-dim">waiting for the first line…</span>}
      {running && <span className="log-line text-blue">▍</span>}
    </div>
  );
}
