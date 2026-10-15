// Renders the model's incident note: a few lines of light Markdown (bold, code, bullets). No library.
export function Note({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.split("\n").map((l) => l.replace(/^\s*[-•]\s+/, "").trim()).filter(Boolean);
  return (
    <ul className={`space-y-1 text-sm leading-relaxed ${className}`}>
      {lines.map((l, i) => <li key={i} className="pl-4 relative before:content-['·'] before:absolute before:left-0 before:text-mut">{inline(l)}</li>)}
    </ul>
  );
}
function inline(s: string) {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) =>
    p.startsWith("**") ? <b key={i} className="text-fg font-semibold">{p.slice(2, -2)}</b>
    : p.startsWith("`") ? <code key={i} className="mono text-[12px] bg-panel2 px-1 py-0.5 rounded text-fg">{p.slice(1, -1)}</code>
    : <span key={i}>{p}</span>);
}
