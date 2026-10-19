import { z } from "zod";

// Raw shape of the `ocr` precontext entry Interfaze returns alongside a completion.
// Parsed leniently: anything we don't draw is optional.
const rawPoint = z.object({ x: z.number(), y: z.number() });
const rawBounds = z.object({
  top_left: rawPoint,
  top_right: rawPoint,
  bottom_right: rawPoint,
  bottom_left: rawPoint,
});
const rawWord = z.object({
  text: z.string(),
  confidence: z.number().optional(),
  bounds: rawBounds,
});
const rawLine = z.object({
  text: z.string(),
  average_confidence: z.number().optional(),
  bounds: rawBounds,
  words: z.array(rawWord).default([]),
});
const rawOcrResult = z.object({
  extracted_text: z.string().default(""),
  width: z.number().optional(),
  height: z.number().optional(),
  sections: z.array(z.object({ lines: z.array(rawLine).default([]) })).default([]),
});

export interface Point {
  x: number;
  y: number;
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left. Not necessarily axis-aligned. */
export type Quad = [Point, Point, Point, Point];

export interface OcrWord {
  id: string;
  text: string;
  confidence: number;
  quad: Quad;
}

export interface OcrLine {
  id: string;
  text: string;
  confidence: number;
  quad: Quad;
  words: OcrWord[];
}

export interface OcrResult {
  text: string;
  /** Pixel space the coordinates live in. */
  width: number;
  height: number;
  lines: OcrLine[];
}

const toQuad = (b: z.infer<typeof rawBounds>): Quad => [
  b.top_left,
  b.top_right,
  b.bottom_right,
  b.bottom_left,
];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function parseOcrResult(raw: unknown): OcrResult {
  const parsed = rawOcrResult.parse(raw);
  const lines: OcrLine[] = parsed.sections.flatMap((section, s) =>
    section.lines.map((line, l) => {
      const words = line.words.map((w, i) => ({
        id: `s${s}l${l}w${i}`,
        text: w.text,
        confidence: w.confidence ?? line.average_confidence ?? 0,
        quad: toQuad(w.bounds),
      }));
      return {
        id: `s${s}l${l}`,
        text: line.text,
        // Bounds carry their own width/height, but they don't always agree with
        // the corners; corners are the source of truth everywhere downstream.
        confidence: line.average_confidence ?? mean(words.map((w) => w.confidence)),
        quad: toQuad(line.bounds),
        words,
      };
    }),
  );

  const corners = lines.flatMap((l) => l.quad);
  return {
    text: parsed.extracted_text || lines.map((l) => l.text).join("\n"),
    width: parsed.width ?? Math.max(1, ...corners.map((p) => p.x)),
    height: parsed.height ?? Math.max(1, ...corners.map((p) => p.y)),
    lines,
  };
}

export function averageConfidence(ocr: OcrResult): number {
  return mean(ocr.lines.map((l) => l.confidence));
}
