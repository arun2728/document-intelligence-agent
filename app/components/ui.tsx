import type { ReactNode } from "react";

export function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold whitespace-nowrap">{title}</h2>
        {aside && <div className="flex items-center gap-2 text-xs text-muted">{aside}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

const BADGE_TONE = {
  neutral: "border-border text-muted",
  accent: "border-accent/30 bg-accent-soft text-accent",
  good: "border-good/30 text-good",
  warn: "border-warn/30 text-warn",
  bad: "border-bad/30 text-bad",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE_TONE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${BADGE_TONE[tone]}`}>
      {children}
    </span>
  );
}

type IconName = "check" | "x" | "alert" | "info" | "spinner" | "dot" | "skip";

const PATHS: Record<Exclude<IconName, "spinner">, ReactNode> = {
  check: <path d="M4 10.5l3.5 3.5L16 6" />,
  x: <path d="M5 5l10 10M15 5L5 15" />,
  alert: <path d="M10 6v5M10 14h.01M8.6 2.9L1.8 15a1.6 1.6 0 001.4 2.4h13.6a1.6 1.6 0 001.4-2.4L11.4 2.9a1.6 1.6 0 00-2.8 0z" />,
  info: <path d="M10 9v5M10 6h.01M10 18a8 8 0 100-16 8 8 0 000 16z" />,
  dot: <circle cx="10" cy="10" r="3" />,
  skip: <path d="M5 10h10" />,
};

export function Icon({ name, className = "size-4" }: { name: IconName; className?: string }) {
  if (name === "spinner") {
    return (
      <svg viewBox="0 0 20 20" className={`${className} animate-spin`} fill="none" aria-hidden>
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
        <path d="M17 10a7 7 0 00-7-7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
