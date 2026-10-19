import { ms } from "@/lib/format";
import { Icon } from "./ui";

export type StepId = "guard" | "ocr" | "classify" | "extract";

export interface StepState {
  status: "pending" | "running" | "done" | "error" | "blocked" | "skipped";
  ms?: number;
  detail?: string;
}

const STEPS: { id: StepId; title: string; tech: string }[] = [
  { id: "guard", title: "Guardrails", tech: "guard: S1/S12/S15_IMAGE" },
  { id: "ocr", title: "OCR", tech: 'task: "ocr" · precontext' },
  { id: "classify", title: "Classify", tech: "Lev /v1/systemone" },
  { id: "extract", title: "Extract", tech: "Zod → response_format" },
];

const STATUS_STYLE: Record<StepState["status"], { icon: Parameters<typeof Icon>[0]["name"]; className: string }> = {
  pending: { icon: "dot", className: "text-muted/50" },
  running: { icon: "spinner", className: "text-accent" },
  done: { icon: "check", className: "text-good" },
  error: { icon: "x", className: "text-bad" },
  blocked: { icon: "alert", className: "text-bad" },
  skipped: { icon: "skip", className: "text-muted" },
};

export function PipelineTimeline({ steps }: { steps: Record<StepId, StepState> }) {
  return (
    <ol className="grid grid-cols-2 gap-2 2xl:grid-cols-4">
      {STEPS.map((step, i) => {
        const state = steps[step.id];
        const style = STATUS_STYLE[state.status];
        return (
          <li
            key={step.id}
            className={`rounded-lg border px-3 py-2 ${state.status === "running" ? "border-accent/50 bg-accent-soft" : "border-border bg-surface"}`}
          >
            <div className="flex items-center gap-1.5">
              <span className={style.className}>
                <Icon name={style.icon} />
              </span>
              <span className="text-sm font-medium whitespace-nowrap">
                <span className="text-muted">{i + 1}.</span> {step.title}
              </span>
              {state.ms !== undefined && <span className="ml-auto font-mono text-xs tabular-nums text-muted">{ms(state.ms)}</span>}
            </div>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted" title={state.detail ?? step.tech}>
              {state.detail ?? step.tech}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
