import type { ClassifyResponse } from "@/lib/api";
import { DOCUMENT_TYPE_INFO, DOCUMENT_TYPES, type DocumentType } from "@/lib/document-types";
import { pct } from "@/lib/format";
import { ConfidenceBar } from "./ConfidenceBar";
import { Badge, Card } from "./ui";

interface Props {
  classification: ClassifyResponse;
  /** The type extraction actually used (may be a manual override). */
  selected: DocumentType;
  onSelect: (type: DocumentType) => void;
  disabled?: boolean;
}

export function ClassificationCard({ classification: c, selected, onSelect, disabled }: Props) {
  const ranked = [...DOCUMENT_TYPES].sort((a, b) => c.probabilities[b] - c.probabilities[a]);
  const identity = c.signals.is_identity_document;

  return (
    <Card
      title="Document type"
      aside={
        c.engine === "lev" ? (
          <>
            <Badge tone="accent">Lev · calibrated</Badge>
            <Badge>{c.outputTokens ?? 0} output tokens</Badge>
          </>
        ) : (
          <Badge tone="warn">Fallback · uncalibrated</Badge>
        )
      }
    >
      <ul className="grid gap-1.5">
        {ranked.map((type) => (
          <li key={type} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-sm">
            <span className={type === c.documentType ? "font-medium" : "text-muted"}>{DOCUMENT_TYPE_INFO[type].label}</span>
            <ConfidenceBar value={c.probabilities[type]} tone={type === c.documentType ? "accent" : "muted"} label={`${type} probability`} digits={1} />
          </li>
        ))}
      </ul>

      {identity !== undefined && (
        <p className="mt-3 text-sm">
          <span className="text-muted">Identity document (same forward pass):</span>{" "}
          <span className="font-mono tabular-nums">{pct(identity, 1)}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
        <label htmlFor="doc-type" className="text-muted">
          Extract as
        </label>
        <select
          id="doc-type"
          value={selected}
          disabled={disabled}
          onChange={(e) => onSelect(e.target.value as DocumentType)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm disabled:opacity-50"
        >
          {DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {DOCUMENT_TYPE_INFO[t].label}
              {t === c.documentType ? " (predicted)" : ""}
            </option>
          ))}
        </select>
        {c.note && <span className="text-xs text-muted">{c.note}</span>}
      </div>
    </Card>
  );
}
