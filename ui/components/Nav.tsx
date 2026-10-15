"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePoll, type Approval, type Status } from "@/lib/api";

const links = [["/", "Live"], ["/approvals/", "Approvals"], ["/history/", "History"], ["/policy/", "Policy"]] as const;

export function Nav() {
  const path = usePathname();
  const { data: pending } = usePoll<Approval[]>("/api/approvals", 2000);
  const { data: st } = usePoll<Status>("/api/status", 5000);
  const n = pending?.length ?? 0;
  return (
    <header className="sticky top-0 z-10 bg-bg/80 backdrop-blur border-b border-line">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-6">
        <Link href="/" className="font-semibold tracking-tight">ReleaseGuard</Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map(([href, name]) => {
            const active = href === "/" ? path === "/" : path.startsWith(href.replace(/\/$/, ""));
            return (
              <Link key={href} href={href} className={`px-3 py-1.5 rounded-lg transition-colors ${active ? "bg-panel2 text-fg" : "text-mut hover:text-fg"}`}>
                {name}{name === "Approvals" && n > 0 && <span className="ml-1.5 pill bg-warn/20 text-warn">{n}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto text-xs text-mut mono flex items-center gap-3">
          {st?.running ? (
            <>
              <span className={`inline-block w-2 h-2 rounded-full ${st.healthy ? "bg-ok" : "bg-bad"}`} />
              <span>{st.target} · <span className="text-fg">{st.running}</span></span>
              {st.pods && <span>pods {st.pods.ready}/{st.pods.desired}</span>}
              <span>err {((st.errorRate ?? 0) * 100).toFixed(1)}% · p95 {st.p95ms ?? "–"}ms</span>
            </>
          ) : <span>no target reachable</span>}
        </div>
      </div>
    </header>
  );
}
