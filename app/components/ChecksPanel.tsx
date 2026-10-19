import type { Check, CheckLevel } from "@/lib/checks";
import { Badge, Card, Icon } from "./ui";

const LEVEL: Record<CheckLevel, { icon: Parameters<typeof Icon>[0]["name"]; className: string }> = {
  pass: { icon: "check", className: "text-good" },
  warn: { icon: "alert", className: "text-warn" },
  fail: { icon: "x", className: "text-bad" },
  info: { icon: "info", className: "text-info" },
};

const ORDER: CheckLevel[] = ["fail", "warn", "info", "pass"];

export function ChecksPanel({ checks }: { checks: Check[] }) {
  const sorted = [...checks].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
  const fails = checks.filter((c) => c.level === "fail").length;
  const warns = checks.filter((c) => c.level === "warn").length;

  return (
    <Card
      title="Verification"
      aside={
        fails ? (
          <Badge tone="bad">Reject · {fails} failed</Badge>
        ) : warns ? (
          <Badge tone="warn">Review · {warns} warnings</Badge>
        ) : (
          <Badge tone="good">Auto-approve</Badge>
        )
      }
    >
      <ul className="grid gap-2">
        {sorted.map((c) => (
          <li key={c.id} className="flex gap-2 text-sm">
            <span className={`mt-0.5 shrink-0 ${LEVEL[c.level].className}`}>
              <Icon name={LEVEL[c.level].icon} />
            </span>
            <div className="min-w-0">
              <p>{c.title}</p>
              {c.detail && <p className="text-xs wrap-break-word text-muted">{c.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
