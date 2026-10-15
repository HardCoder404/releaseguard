"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePoll, type Approval, type Status } from "@/lib/api";
import { Shield } from "./Icons";

const links = [["/", "Live"], ["/approvals/", "Approvals"], ["/history/", "History"], ["/policy/", "Policy"]] as const;

export function Nav() {
  const path = usePathname();
  const { data: pending } = usePoll<Approval[]>("/api/approvals", 2000);
  const { data: st } = usePoll<Status>("/api/status", 5000);
  const n = pending?.length ?? 0;
  return (
    <header className="sticky top-0 z-20 backdrop-blur-md bg-bg/70 border-b border-line/80">
      <div className="mx-auto max-w-6xl px-5 h-[60px] flex items-center gap-7">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="grid place-items-center w-8 h-8 rounded-xl bg-gradient-to-br from-blue to-violet text-white shadow-[0_8px_20px_-8px_rgba(91,140,255,.9)]"><Shield className="w-4.5 h-4.5" /></span>
          <span className="font-semibold tracking-tight text-[15px]">ReleaseGuard</span>
        </Link>
        <nav className="flex items-center gap-0.5 text-sm">
          {links.map(([href, name]) => {
            const active = href === "/" ? path === "/" : path.startsWith(href.replace(/\/$/, ""));
            return (
              <Link key={href} href={href} className={`relative px-3.5 py-2 rounded-lg transition-colors ${active ? "text-fg" : "text-mut hover:text-fg"}`}>
                {name}
                {name === "Approvals" && n > 0 && <span className="ml-1.5 pill pill-warn py-0.5 px-1.5">{n}</span>}
                {active && <span className="absolute left-3 right-3 -bottom-[13px] h-[2px] rounded-full bg-gradient-to-r from-blue to-violet" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          {st?.running ? (
            <div className="pill pill-mut mono text-[11px] py-1.5 pr-3">
              <span className={`dot ${st.healthy ? "text-ok dot-live" : "text-bad"}`} />
              <span className="text-mut">{st.target}</span>
              <span className="text-fg">{st.running}</span>
              {st.pods && <span className="text-dim">· {st.pods.ready}/{st.pods.desired} pods</span>}
              <span className="text-dim">· {((st.errorRate ?? 0) * 100).toFixed(1)}% err · p95 {st.p95ms ?? "–"}ms</span>
            </div>
          ) : <div className="pill pill-mut mono text-[11px]"><span className="dot text-dim" />target offline</div>}
        </div>
      </div>
    </header>
  );
}
