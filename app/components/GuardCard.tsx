import type { GuardResponse } from "@/lib/api";
import { ConfidenceBar } from "./ConfidenceBar";
import { Badge, Card } from "./ui";

export function GuardCard({ guard }: { guard: GuardResponse }) {
  return (
    <Card title="Content safety" aside={guard.safe ? <Badge tone="good">Passed</Badge> : <Badge tone="bad">Blocked</Badge>}>
      {!guard.safe && (
        <p className="mb-3 text-sm text-bad">
          Flagged: {guard.flagged.map((f) => `${f.label} (${f.code})`).join(", ") || "unsafe content"}. Processing stopped and
          no OCR output was shown.
        </p>
      )}
      {guard.scores ? (
        <dl className="grid gap-1.5 text-sm">
          {(
            [
              ["NSFW", guard.scores.nsfw],
              ["Nudity", guard.scores.nudity],
              ["Gore", guard.scores.gore],
            ] as const
          ).map(([label, score]) => (
            <div key={label} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
              <dt className="text-muted">{label}</dt>
              <dd>
                <ConfidenceBar value={score} tone={score >= 0.5 ? "bad" : "muted"} label={`${label} score`} digits={1} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        guard.safe && <p className="text-sm text-muted">No image categories matched.</p>
      )}
    </Card>
  );
}
