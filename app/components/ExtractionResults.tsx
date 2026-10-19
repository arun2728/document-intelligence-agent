"use client";

import { useState } from "react";
import type { ExtractResponse } from "@/lib/api";
import { DOCUMENT_TYPE_INFO } from "@/lib/document-types";
import { fieldLabel, mask } from "@/lib/format";
import type { Grounding } from "@/lib/grounding";
import { PII_FIELDS } from "@/lib/schemas";
import { ConfidenceBar } from "./ConfidenceBar";
import { Badge, Card } from "./ui";

interface Props {
  extraction: ExtractResponse;
  groundings: Record<string, Grounding | null>;
  /** Hovering a field (or a whole table row) reports the paths whose source boxes to highlight. */
  onHover: (paths: string[] | null) => void;
}

type Scalar = string | number | boolean | null;
type Row = Record<string, Scalar>;

const isRowArray = (v: unknown): v is Row[] =>
  Array.isArray(v) && v.every((x) => x !== null && typeof x === "object" && !Array.isArray(x));

export function ExtractionResults({ extraction, groundings, onHover }: Props) {
  const [masked, setMasked] = useState(false);
  const pii = new Set(PII_FIELDS[extraction.documentType]);
  const entries = Object.entries(extraction.data);
  const scalars = entries.filter(([, v]) => !isRowArray(v));
  const tables = entries.filter((e): e is [string, Row[]] => isRowArray(e[1]));

  const display = (path: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return <span className="text-muted">—</span>;
    const text = Array.isArray(v) ? v.join(", ") : String(v);
    return masked && pii.has(path) ? <span className="font-mono">{mask(text)}</span> : <span className="whitespace-pre-wrap">{text}</span>;
  };

  return (
    <Card
      title={`Extracted · ${DOCUMENT_TYPE_INFO[extraction.documentType].label}`}
      aside={
        <>
          {extraction.issues.length ? (
            <Badge tone="warn">{extraction.issues.length} schema issues</Badge>
          ) : (
            <Badge tone="good">Schema valid</Badge>
          )}
          {pii.size > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={masked} onChange={(e) => setMasked(e.target.checked)} className="accent-accent" />
              Mask PII
            </label>
          )}
        </>
      }
    >
      <table className="w-full text-sm" onMouseLeave={() => onHover(null)}>
        <thead className="sr-only">
          <tr>
            <th>Field</th>
            <th>Value</th>
            <th>OCR confidence</th>
          </tr>
        </thead>
        <tbody>
          {scalars.map(([key, value]) => {
            const g = groundings[key];
            return (
              <tr
                key={key}
                onMouseEnter={() => onHover([key])}
                className="border-b border-border/60 last:border-0 hover:bg-accent-soft/60"
              >
                <th scope="row" className="w-36 py-1.5 pr-3 text-left align-top font-normal text-muted">
                  {fieldLabel(key)}
                  {pii.has(key) && <span className="ml-1 text-[10px] uppercase tracking-wide text-warn">pii</span>}
                </th>
                <td className="py-1.5 pr-3 align-top font-medium wrap-break-word">{display(key, value)}</td>
                <td className="w-36 py-1.5 align-top">
                  <GroundingCell value={value} grounding={g} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {tables.map(([key, rows]) => {
        const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        return (
          <div key={key} className="mt-4">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              {fieldLabel(key)} ({rows.length})
            </h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm" onMouseLeave={() => onHover(null)}>
                <thead className="bg-surface-muted text-left text-xs text-muted">
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className="px-2.5 py-1.5 font-medium">
                        {fieldLabel(c)}
                      </th>
                    ))}
                    <th className="w-8">
                      <span className="sr-only">Found in OCR</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const paths = columns.map((c) => `${key}.${i}.${c}`);
                    const groundable = paths.filter((p) => p in groundings);
                    const grounded = groundable.filter((p) => groundings[p]).length;
                    const filled = groundable.length;
                    return (
                      <tr key={i} onMouseEnter={() => onHover(paths)} className="border-t border-border/60 hover:bg-accent-soft/60">
                        {columns.map((c) => (
                          <td key={c} className={`px-2.5 py-1.5 ${typeof row[c] === "number" ? "text-right font-mono tabular-nums" : ""}`}>
                            {display(`${key}.${i}.${c}`, row[c])}
                          </td>
                        ))}
                        <td className="w-8 pr-2 text-right" title={`${grounded}/${filled} values found in OCR text`}>
                          <span className={grounded === filled ? "text-good" : "text-warn"}>●</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {extraction.issues.length > 0 && (
        <ul className="mt-3 list-inside list-disc text-xs text-warn">
          {extraction.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function GroundingCell({ value, grounding }: { value: unknown; grounding: Grounding | null | undefined }) {
  // `undefined`: too short to ground meaningfully (e.g. "M"); nothing to show.
  if (value === null || value === undefined || value === "" || grounding === undefined) return null;
  if (!grounding) {
    return (
      <span title="Value not found verbatim in the OCR text: it was normalized or inferred by the model.">
        <Badge tone="warn">not in OCR</Badge>
      </span>
    );
  }
  return <ConfidenceBar value={grounding.confidence} label="OCR confidence of source words" />;
}
