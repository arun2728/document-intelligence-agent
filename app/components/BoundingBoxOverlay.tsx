"use client";

import { confidenceTone } from "@/lib/format";
import type { OcrResult, Quad } from "@/lib/ocr";

export type OverlayMode = "lines" | "words" | "off";

export interface HoveredText {
  text: string;
  confidence: number;
}

interface Props {
  src: string;
  alt: string;
  ocr: OcrResult | null;
  mode: OverlayMode;
  /** Word ids to emphasize (the source of the hovered extracted field). */
  highlight: ReadonlySet<string>;
  onHover: (hovered: HoveredText | null) => void;
}

const STROKE = { good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)" };

const points = (q: Quad) => q.map((p) => `${p.x},${p.y}`).join(" ");

/**
 * Draws OCR quads over the document. The SVG's viewBox is the OCR pixel space and
 * it is stretched over the rendered image, so boxes stay aligned at any display size;
 * quads (not rectangles) keep skewed or rotated scans accurate.
 */
export function BoundingBoxOverlay({ src, alt, ocr, mode, highlight, onHover }: Props) {
  const focused = highlight.size > 0;
  const shapes =
    !ocr || mode === "off"
      ? []
      : mode === "lines"
        ? ocr.lines.map((l) => ({ id: l.id, text: l.text, confidence: l.confidence, quad: l.quad, hit: l.words.some((w) => highlight.has(w.id)) }))
        : ocr.lines.flatMap((l) => l.words.map((w) => ({ ...w, hit: highlight.has(w.id) })));

  const highlighted = ocr && focused ? ocr.lines.flatMap((l) => l.words).filter((w) => highlight.has(w.id)) : [];

  return (
    <div className="relative overflow-hidden rounded-lg bg-surface-muted">
      {/* eslint-disable-next-line @next/next/no-img-element -- local data URL, nothing to optimize */}
      <img src={src} alt={alt} className="block h-auto w-full select-none" draggable={false} />
      {ocr && (
        <svg
          viewBox={`0 0 ${ocr.width} ${ocr.height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
          onMouseLeave={() => onHover(null)}
          aria-hidden
        >
          {shapes.map((s) => (
            <polygon
              key={s.id}
              points={points(s.quad)}
              fill={STROKE[confidenceTone(s.confidence)]}
              fillOpacity={0}
              stroke={STROKE[confidenceTone(s.confidence)]}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              opacity={focused && !s.hit ? 0.2 : 0.9}
              className="ocr-box"
              onMouseEnter={() => onHover({ text: s.text, confidence: s.confidence })}
            />
          ))}
          {highlighted.map((w) => (
            <polygon
              key={`hl-${w.id}`}
              points={points(w.quad)}
              fill="var(--accent)"
              fillOpacity={0.28}
              stroke="var(--accent)"
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
        </svg>
      )}
    </div>
  );
}
