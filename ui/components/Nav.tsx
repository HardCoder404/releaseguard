"use client";
import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePoll, fmtTime, resultMeta, type Approval, type Status, type Deployment, type Config } from "@/lib/api";
import { Shield, Activity, Inbox, History, Sliders, Cube } from "./Icons";

const tabs = [
  { href: "/", name: "Live", Icon: Activity, key: "1" },
  { href: "/approvals/", name: "Approvals", Icon: Inbox, key: "2" },
  { href: "/history/", name: "History", Icon: History, key: "3" },
  { href: "/policy/", name: "Policy", Icon: Sliders, key: "4" },
] as const;

function ago(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return fmtTime(iso);
}

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const { data: pending } = usePoll<Approval[]>("/api/approvals", 2000);
  const { data: st } = usePoll<Status>("/api/status", 5000);
  const { data: latest } = usePoll<Deployment | null>("/api/deployments/latest", 3000);
  const { data: cfg } = usePoll<Config>("/api/config", 30000);
  const n = pending?.length ?? 0;
  const running = !!latest && !latest.result;
  const activeIdx = tabs.findIndex((t) => (t.href === "/" ? path === "/" : path.startsWith(t.href.replace(/\/$/, ""))));

  // keyboard: 1-4 switch tabs
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.tagName === "INPUT") return;
      const t = tabs.find((x) => x.key === e.key); if (t) router.push(t.href);
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [router]);

  return (
    <header className="sticky top-0 z-20">
      {/* progress hairline: animates while a deploy is running */}
      <div className={`h-[2px] w-full ${running ? "bg-gradient-to-r from-blue via-violet to-ok shimmer-bar" : "bg-gradient-to-r from-blue/40 via-violet/30 to-transparent"}`} />
      <div className="backdrop-blur-xl bg-bg/75 border-b border-line/80">
        <div className="mx-auto max-w-6xl px-5 h-[64px] flex items-center gap-5">
          {/* brand */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <span className="relative grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-blue to-violet text-white shadow-[0_10px_24px_-8px_rgba(91,140,255,.9)]">
              <Shield className="w-[18px] h-[18px]" />
              {running && <span className="absolute -right-0.5 -top-0.5 w-2.5 h-2.5 rounded-full bg-ok border-2 border-bg dot-live" />}
            </span>
            <span className="leading-tight">
              <span className="block font-semibold tracking-tight text-[15px]">ReleaseGuard</span>
              <span className="block text-[10.5px] text-dim mono -mt-0.5">deploy guardrail</span>
            </span>
          </Link>

          {/* segmented tabs */}
          <nav className="relative ml-2 flex items-center p-1 rounded-2xl bg-panel/80 border border-line">
            <span className="absolute top-1 bottom-1 rounded-xl bg-panel2 border border-line2 shadow-[inset_0_1px_0_rgba(255,255,255,.05)] transition-all duration-300 ease-[cubic-bezier(.2,.7,.2,1)]"
              style={{ width: `calc((100% - 8px) / 4)`, left: `calc(4px + ${Math.max(0, activeIdx)} * ((100% - 8px) / 4))` }} />
            {tabs.map(({ href, name, Icon, key }, i) => (
              <Link key={href} href={href} className={`relative z-[1] flex items-center justify-center gap-2 w-[118px] h-9 rounded-xl text-[13px] transition-colors ${i === activeIdx ? "text-fg" : "text-mut hover:text-fg"}`}>
                <Icon className={`w-[15px] h-[15px] ${i === activeIdx ? "text-blue" : ""}`} />
                {name}
                {name === "Approvals" && n > 0 && <span className="pill pill-warn py-0.5 px-1.5 ml-0.5 dot-live">{n}</span>}
                <kbd className="hidden lg:inline text-[9.5px] text-dim mono border border-line rounded px-1 ml-0.5">{key}</kbd>
              </Link>
            ))}
          </nav>

          {/* status cluster */}
          <div className="ml-auto flex items-center gap-2">
            {st?.running ? (
              <>
                <div className="hidden md:flex items-center gap-2 rounded-xl bg-panel/80 border border-line px-3 h-10">
                  <span className={`relative flex w-2 h-2`}><span className={`absolute inset-0 rounded-full ${st.healthy ? "bg-ok" : "bg-bad"} opacity-60 animate-ping`} /><span className={`relative rounded-full w-2 h-2 ${st.healthy ? "bg-ok" : "bg-bad"}`} /></span>
                  <span className="text-[11px] text-dim mono uppercase tracking-wider">{st.target}</span>
                  <span className="text-[13px] mono text-fg font-semibold">{st.running}</span>
                  {st.pods && <span className="text-[11px] text-dim mono">· {st.pods.ready}/{st.pods.desired} pods</span>}
                </div>
                <Stat label="err" value={`${((st.errorRate ?? 0) * 100).toFixed(1)}%`} tone={(st.errorRate ?? 0) > (cfg?.watch.rollback_if.error_rate_above ?? 0.05) ? "bad" : "ok"} />
                <Stat label="p95" value={`${st.p95ms ?? "–"}ms`} tone={(st.p95ms ?? 0) > (cfg?.watch.rollback_if.p95_latency_above_ms ?? 800) ? "bad" : "ok"} />
              </>
            ) : <div className="pill pill-mut mono"><span className="dot text-dim" />target offline</div>}
          </div>
        </div>

        {/* context strip */}
        <div className="border-t border-line/60 bg-panel/40">
          <div className="mx-auto max-w-6xl px-5 h-8 flex items-center gap-4 text-[11.5px] mono text-dim whitespace-nowrap overflow-hidden [&>*]:shrink-0">
            <span className="flex items-center gap-1.5"><Cube className="w-3.5 h-3.5" />cluster <span className="text-mut">minikube</span></span>
            <span className="text-line2">|</span>
            <span>namespace <span className="text-mut">default</span></span>
            <span className="text-line2">|</span>
            <span>deployment <span className="text-mut">{cfg?.k8s.deployment ?? "shop-api"}</span></span>
            <span className="text-line2">|</span>
            <span>strategy <span className="text-mut">{cfg?.k8s.canary ? "canary → promote" : "rolling update"}</span></span>
            {latest && (
              <Link href="/" className="ml-auto flex items-center gap-2 hover:text-fg transition-colors">
                <span className="text-dim">last deploy</span>
                <span className="text-mut">#{latest.id} {latest.previous ?? "–"} → {latest.version}</span>
                <span className={`pill ${resultMeta[latest.result ?? "running"].pill} py-0.5`}><span className={`dot ${running ? "dot-live" : ""}`} />{resultMeta[latest.result ?? "running"].label}</span>
                <span className="text-dim">{ago(latest.started_at)}</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "ok" | "bad" }) {
  return (
    <div className="hidden sm:flex flex-col items-end justify-center rounded-xl bg-panel/80 border border-line px-3 h-10 min-w-[64px]">
      <span className="text-[9.5px] uppercase tracking-wider text-dim leading-none">{label}</span>
      <span className={`text-[13px] mono font-semibold leading-tight ${tone === "bad" ? "text-bad" : "text-fg"}`}>{value}</span>
    </div>
  );
}
