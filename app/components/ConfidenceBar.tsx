import { confidenceTone, pct, type Tone } from "@/lib/format";

const FILL: Record<Tone | "accent" | "muted", string> = {
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad",
  accent: "bg-accent",
  muted: "bg-muted",
};

interface Props {
  value: number;
  /** Defaults to a tone derived from the value (green ≥ 90%, amber ≥ 75%, red below). */
  tone?: keyof typeof FILL;
  label?: string;
  showValue?: boolean;
  digits?: number;
}

export function ConfidenceBar({ value, tone, label, showValue = true, digits = 0 }: Props) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-label={label ?? "Confidence"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${FILL[tone ?? confidenceTone(clamped)]}`}
          style={{ width: `${Math.max(clamped * 100, clamped > 0 ? 1 : 0)}%` }}
        />
      </div>
      {showValue && <span className="w-12 text-right font-mono text-xs tabular-nums text-muted">{pct(clamped, digits)}</span>}
    </div>
  );
}
