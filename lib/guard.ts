import { GUARD_LABELS, type GuardCode, type Precontext } from "interfaze";

/** Image categories relevant to an upload pipeline: gore, nudity, NSFW. */
export const IMAGE_GUARD_CODES = ["S1_IMAGE", "S12_IMAGE", "S15_IMAGE"] as const satisfies GuardCode[];

export interface GuardScores {
  nsfw: number;
  nudity: number;
  gore: number;
}

export interface GuardVerdict {
  safe: boolean;
  flagged: { code: string; label: string }[];
  /** Raw image-classifier scores, when Interfaze returns them in precontext. */
  scores: GuardScores | null;
}

/** A blocked request still returns 200; the content is `unsafe <CODE>[, <CODE>…]`. */
export function parseGuardVerdict(content: string | null | undefined, precontext?: Precontext[]): GuardVerdict {
  const match = /^\s*unsafe\b([\s\S]*)$/i.exec(content ?? "");
  const codes = match ? (match[1].match(/S\d+(?:_IMAGE)?/gi) ?? []).map((c) => c.toUpperCase()) : [];

  return {
    safe: !match,
    flagged: codes.map((code) => ({ code, label: GUARD_LABELS[code] ?? code })),
    scores: readImageScores(precontext),
  };
}

function readImageScores(precontext?: Precontext[]): GuardScores | null {
  const entry = precontext?.find((p) => p.name === "image_guardrail_classifier");
  const r = entry?.result as Record<string, unknown> | undefined;
  if (!r || typeof r.nsfw_score !== "number") return null;
  return {
    nsfw: r.nsfw_score,
    nudity: typeof r.nudity_score === "number" ? r.nudity_score : 0,
    gore: typeof r.gore_score === "number" ? r.gore_score : 0,
  };
}
