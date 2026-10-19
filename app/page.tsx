"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ClassifyResponse, ExtractResponse, GuardResponse, OcrResponse } from "@/lib/api";
import { runChecks } from "@/lib/checks";
import { DOCUMENT_TYPE_INFO, type DocumentType } from "@/lib/document-types";
import { pct } from "@/lib/format";
import { groundFields } from "@/lib/grounding";
import { prepareImage, type PreparedImage } from "@/lib/image";
import type { OcrResult } from "@/lib/ocr";
import { BoundingBoxOverlay, type HoveredText, type OverlayMode } from "./components/BoundingBoxOverlay";
import { ChecksPanel } from "./components/ChecksPanel";
import { ClassificationCard } from "./components/ClassificationCard";
import { DocumentUpload } from "./components/DocumentUpload";
import { ExtractionResults } from "./components/ExtractionResults";
import { GuardCard } from "./components/GuardCard";
import { PipelineTimeline, type StepId, type StepState } from "./components/PipelineTimeline";

type Steps = Record<StepId, StepState>;

interface RunState {
  image: PreparedImage;
  steps: Steps;
  guard?: GuardResponse;
  ocr?: OcrResult;
  classification?: ClassifyResponse;
  documentType?: DocumentType;
  extraction?: ExtractResponse;
  error?: string;
}

const INITIAL_STEPS: Steps = {
  guard: { status: "pending" },
  ocr: { status: "pending" },
  classify: { status: "pending" },
  extract: { status: "pending" },
};

async function post<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

type Timed<T> = { ok: true; value: T; ms: number } | { ok: false; error: string; ms: number };

async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const started = performance.now();
  try {
    return { ok: true, value: await fn(), ms: performance.now() - started };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), ms: performance.now() - started };
  }
}

export default function Home() {
  const [run, setRun] = useState<RunState | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [mode, setMode] = useState<OverlayMode>("lines");
  const [hoverPaths, setHoverPaths] = useState<string[] | null>(null);
  const [hoverBox, setHoverBox] = useState<HoveredText | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const update = useCallback((patch: (r: RunState) => Partial<RunState>) => {
    setRun((r) => (r ? { ...r, ...patch(r) } : r));
  }, []);
  const setSteps = useCallback(
    (steps: Partial<Steps>) => update((r) => ({ steps: { ...r.steps, ...steps } })),
    [update],
  );

  const extract = useCallback(
    async (text: string, documentType: DocumentType, signal: AbortSignal) => {
      update(() => ({ documentType, extraction: undefined }));
      setSteps({ extract: { status: "running" } });
      const res = await timed(() => post<ExtractResponse>("/api/extract", { text, documentType }, signal));
      if (signal.aborted) return;
      if (!res.ok) return setSteps({ extract: { status: "error", ms: res.ms, detail: res.error } });
      update(() => ({ extraction: res.value }));
      const fields = Object.keys(res.value.data).length;
      setSteps({ extract: { status: "done", ms: res.ms, detail: `${fields} fields · ${DOCUMENT_TYPE_INFO[documentType].label}` } });
    },
    [update, setSteps],
  );

  const processFile = useCallback(
    async (file: Blob, name: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;
      setPrepError(null);
      setHoverPaths(null);

      let image: PreparedImage;
      try {
        image = await prepareImage(file, name);
      } catch (err) {
        setPrepError(err instanceof Error ? err.message : String(err));
        return;
      }
      if (signal.aborted) return;

      setRun({ image, steps: { ...INITIAL_STEPS, guard: { status: "running" }, ocr: { status: "running" } } });

      // 1 + 2. Guardrails and OCR in parallel. OCR output is held back until the
      // guard passes, so flagged content never renders.
      const [guard, ocr] = await Promise.all([
        timed(() => post<GuardResponse>("/api/guard", { image: image.dataUrl }, signal)).then((r) => {
          if (!signal.aborted && r.ok) {
            setSteps({ guard: { status: r.value.safe ? "done" : "blocked", ms: r.ms, detail: r.value.safe ? "passed" : r.value.flagged.map((f) => f.code).join(", ") } });
          }
          return r;
        }),
        timed(() => post<OcrResponse>("/api/ocr", { image: image.dataUrl }, signal)).then((r) => {
          if (!signal.aborted && r.ok) {
            setSteps({ ocr: { status: "done", ms: r.ms, detail: `${r.value.ocr.lines.length} lines` } });
          }
          return r;
        }),
      ]);
      if (signal.aborted) return;

      const skip = (...ids: StepId[]) => Object.fromEntries(ids.map((id) => [id, { status: "skipped" }])) as Partial<Steps>;

      if (!guard.ok) {
        // Fail closed: no safety verdict, no processing.
        update(() => ({ error: `Guardrail check failed, so processing stopped. ${guard.error}` }));
        return setSteps({ guard: { status: "error", ms: guard.ms, detail: guard.error }, ...skip("ocr", "classify", "extract") });
      }
      update(() => ({ guard: guard.value }));
      if (!guard.value.safe) return setSteps(skip("ocr", "classify", "extract"));

      if (!ocr.ok) {
        update(() => ({ error: ocr.error }));
        return setSteps({ ocr: { status: "error", ms: ocr.ms, detail: ocr.error }, ...skip("classify", "extract") });
      }
      const text = ocr.value.ocr.text.trim();
      update(() => ({ ocr: ocr.value.ocr }));
      if (!text) {
        update(() => ({ error: "No text found in this image." }));
        return setSteps({ ocr: { status: "error", ms: ocr.ms, detail: "no text found" }, ...skip("classify", "extract") });
      }

      // 3. Classify the OCR text to pick a schema.
      setSteps({ classify: { status: "running" } });
      const cls = await timed(() => post<ClassifyResponse>("/api/classify", { text }, signal));
      if (signal.aborted) return;
      if (!cls.ok) {
        update(() => ({ error: cls.error }));
        return setSteps({ classify: { status: "error", ms: cls.ms, detail: cls.error }, ...skip("extract") });
      }
      const c = cls.value;
      update(() => ({ classification: c }));
      setSteps({
        classify: {
          status: "done",
          ms: cls.ms,
          detail: `${c.engine} · ${DOCUMENT_TYPE_INFO[c.documentType].label} ${pct(c.probabilities[c.documentType])}`,
        },
      });

      // 4. Structured extraction with the schema for that type.
      await extract(text, c.documentType, signal);
    },
    [update, setSteps, extract],
  );

  const reextract = (documentType: DocumentType) => {
    if (!run?.ocr) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void extract(run.ocr.text, documentType, controller.signal);
  };

  const reset = () => {
    abortRef.current?.abort();
    setRun(null);
    setHoverPaths(null);
    setHoverBox(null);
  };

  const groundings = useMemo(
    () => (run?.extraction && run.ocr ? groundFields(run.extraction.data, run.ocr) : {}),
    [run?.extraction, run?.ocr],
  );

  const checks = useMemo(
    () =>
      run?.extraction && run.ocr
        ? runChecks({ documentType: run.extraction.documentType, data: run.extraction.data, ocr: run.ocr, groundings })
        : null,
    [run?.extraction, run?.ocr, groundings],
  );

  const highlight = useMemo(
    () => new Set((hoverPaths ?? []).flatMap((p) => groundings[p]?.wordIds ?? [])),
    [hoverPaths, groundings],
  );

  const busy = run ? Object.values(run.steps).some((s) => s.status === "running") : false;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Document Intelligence Agent</h1>
          <p className="text-sm text-muted">KYC and document processing on Interfaze: guardrails → OCR → Lev → structured output</p>
        </div>
        <nav className="flex gap-4 text-sm text-muted">
          <a className="hover:text-foreground" href="https://interfaze.ai/docs" target="_blank" rel="noreferrer">
            Interfaze docs
          </a>
          <a className="hover:text-foreground" href="https://github.com/InterfazeAI/lev" target="_blank" rel="noreferrer">
            Lev
          </a>
        </nav>
      </header>

      {!run ? (
        <div className="mx-auto mt-6 max-w-2xl">
          <DocumentUpload onFile={processFile} />
          {prepError && <p className="mt-3 text-center text-sm text-bad">{prepError}</p>}
          <HowItWorks />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="truncate text-sm font-medium" title={run.image.name}>
                {run.image.name}{" "}
                <span className="font-normal text-muted">
                  {run.image.width}×{run.image.height}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <div role="radiogroup" aria-label="Bounding boxes" className="flex rounded-lg border border-border bg-surface p-0.5 text-xs">
                  {(["lines", "words", "off"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={mode === m}
                      onClick={() => setMode(m)}
                      className={`rounded-md px-2.5 py-1 capitalize ${mode === m ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
                >
                  New document
                </button>
              </div>
            </div>

            <BoundingBoxOverlay
              src={run.image.dataUrl}
              alt={`Uploaded document ${run.image.name}`}
              ocr={run.ocr ?? null}
              mode={mode}
              highlight={highlight}
              onHover={setHoverBox}
            />

            <p className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-live="polite">
              {hoverBox ? (
                <>
                  <span className="font-mono text-foreground">{hoverBox.text}</span>
                  <span>OCR confidence {pct(hoverBox.confidence, 1)}</span>
                </>
              ) : run.ocr ? (
                <>
                  <Legend className="bg-good" label="≥ 90%" />
                  <Legend className="bg-warn" label="75–90%" />
                  <Legend className="bg-bad" label="< 75%" />
                  <span>Hover a box to read it, or a field to find its source.</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <PipelineTimeline steps={run.steps} />

            {run.error && (
              <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
                {run.error}
              </p>
            )}

            {checks && <ChecksPanel checks={checks} />}

            {run.extraction ? (
              <ExtractionResults extraction={run.extraction} groundings={groundings} onHover={setHoverPaths} />
            ) : (
              run.steps.extract.status === "running" && <Skeleton label="Extracting structured fields…" />
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              {run.classification && run.documentType && (
                <ClassificationCard
                  classification={run.classification}
                  selected={run.documentType}
                  onSelect={reextract}
                  disabled={busy}
                />
              )}
              {run.guard && <GuardCard guard={run.guard} />}
            </div>

            {run.ocr && (
              <details className="rounded-xl border border-border bg-surface text-sm">
                <summary className="cursor-pointer px-4 py-2.5 font-medium">Raw responses</summary>
                <pre className="max-h-96 overflow-auto border-t border-border p-4 font-mono text-xs leading-relaxed">
                  {JSON.stringify(
                    {
                      extraction: run.extraction?.data,
                      classification: run.classification,
                      guard: run.guard,
                      ocr: { text: run.ocr.text, width: run.ocr.width, height: run.ocr.height, lines: run.ocr.lines.length },
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`size-2 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="mb-3 text-sm text-muted">{label}</p>
      <div className="grid gap-2">
        {[80, 65, 72, 50].map((w) => (
          <div key={w} className="h-3 animate-pulse rounded bg-surface-muted" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

const HOW = [
  ["Guardrails", "Image safety classifiers (NSFW, nudity, gore) gate everything downstream."],
  ["OCR", "Interfaze's OCR task returns text with per-word quads and confidence scores."],
  ["Classify", "Lev reads the OCR text and returns calibrated probabilities in one forward pass, with zero output tokens."],
  ["Extract", "A Zod schema picked for that document type becomes the structured-output contract; each value is traced back to its OCR box."],
] as const;

function HowItWorks() {
  return (
    <ol className="mt-10 grid gap-3 sm:grid-cols-2">
      {HOW.map(([title, body], i) => (
        <li key={title} className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-medium">
            <span className="text-accent">{i + 1}.</span> {title}
          </p>
          <p className="mt-1 text-sm text-muted">{body}</p>
        </li>
      ))}
    </ol>
  );
}
