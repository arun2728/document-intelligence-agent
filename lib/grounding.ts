import type { OcrResult, OcrWord } from "./ocr";

/**
 * Grounding links each extracted field back to the OCR words it came from, so the
 * UI can highlight its source and score it with real OCR confidence. A field that
 * can't be grounded was normalized or inferred by the model — worth a human look.
 */

export interface Grounding {
  wordIds: string[];
  /** Mean OCR confidence of the source words. */
  confidence: number;
}

export interface FlatField {
  /** Dotted path into the extraction, e.g. `line_items.0.amount`. */
  path: string;
  value: string | number | boolean;
}

export function flattenFields(data: unknown, prefix = ""): FlatField[] {
  if (data === null || data === undefined) return [];
  if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
    return [{ path: prefix, value: data }];
  }
  if (Array.isArray(data)) return data.flatMap((v, i) => flattenFields(v, join(prefix, String(i))));
  if (typeof data === "object") {
    return Object.entries(data).flatMap(([k, v]) => flattenFields(v, join(prefix, k)));
  }
  return [];
}

const join = (a: string, b: string) => (a ? `${a}.${b}` : b);

/** Uppercase, strip diacritics and everything that isn't a letter or digit. */
export const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** The ways a normalized value might appear verbatim on the document. */
export function candidates(value: string | number | boolean): string[] {
  if (typeof value === "boolean") return [];
  if (typeof value === "number") return unique([value.toFixed(2), String(value)].map(norm));

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const [, y, m, d] = iso;
    const yy = y.slice(2);
    const mon = MONTHS[Number(m) - 1] ?? "";
    return unique([
      `${m}${d}${y}`, `${d}${m}${y}`, `${y}${m}${d}`,
      `${m}${d}${yy}`, `${d}${m}${yy}`,
      `${d}${mon}${y}`, `${d}${mon}${yy}`, `${mon}${d}${y}`,
    ]);
  }
  return unique([norm(value)]).filter(Boolean);
}

const unique = <T,>(xs: T[]) => [...new Set(xs)];

/** Single characters ("M", class "C", quantity 1 → "1") match noise; don't try to ground them. */
export const isGroundable = (value: string | number | boolean) => {
  const cands = candidates(value);
  return cands.length > 0 && cands.every((c) => c.length >= 2);
};

export function groundValue(value: string | number | boolean, ocr: OcrResult): Grounding | null {
  const words = ocr.lines.flatMap((l) => l.words);
  const cands = candidates(value).filter((c) => c.length >= 2);

  // 1. The whole value is exactly one word.
  for (const c of cands) {
    const hits = words.filter((w) => norm(w.text) === c);
    if (hits.length) return toGrounding(hits);
  }

  // 2. ...or one word fused with a label or suffix ("DOB09/12/1987", "12:59:46" for 12:59).
  for (const c of cands) {
    if (c.length < 4) continue;
    const hits = words.filter((w) => {
      const n = norm(w.text);
      return n.startsWith(c) || (c.length >= 5 && n.includes(c));
    });
    if (hits.length) return toGrounding(hits);
  }

  // 3. The whole value is one OCR line.
  for (const c of cands) {
    const line = ocr.lines.find((l) => norm(l.text) === c);
    if (line) return toGrounding(line.words);
  }

  // 4. Multi-word values (names, addresses) spread across words and lines:
  //    greedily take the lines that cover the most still-unmatched tokens.
  if (typeof value !== "string") return null;
  const tokens = unique(value.split(/[\s,]+/).map(norm).filter((t) => t.length >= 2));
  if (tokens.length < 2) return null;

  const covered = new Set<string>();
  const picked: OcrWord[] = [];
  const perLine = ocr.lines.map((line) =>
    line.words.map((w) => ({ w, token: tokens.find((t) => norm(w.text) === t) })).filter((x) => x.token),
  );

  for (;;) {
    let best = -1;
    let bestGain = 0;
    perLine.forEach((matches, i) => {
      const gain = new Set(matches.map((m) => m.token).filter((t) => !covered.has(t!))).size;
      if (gain > bestGain) [best, bestGain] = [i, gain];
    });
    if (best < 0) break;
    for (const m of perLine[best]) {
      if (!covered.has(m.token!)) picked.push(m.w);
      covered.add(m.token!);
    }
    perLine[best] = [];
  }

  const coverage = [...covered].join("").length / tokens.join("").length;
  return coverage >= 0.6 ? toGrounding(words.filter((w) => picked.includes(w))) : null;
}

function toGrounding(words: OcrWord[]): Grounding {
  return {
    wordIds: words.map((w) => w.id),
    confidence: words.reduce((a, w) => a + w.confidence, 0) / words.length,
  };
}

/** Paths absent from the result were too short to ground; `null` means "not found". */
export function groundFields(data: Record<string, unknown>, ocr: OcrResult): Record<string, Grounding | null> {
  return Object.fromEntries(
    flattenFields(data)
      .filter((f) => isGroundable(f.value))
      .map((f) => [f.path, groundValue(f.value, ocr)]),
  );
}
