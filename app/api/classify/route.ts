import { responseFormat } from "interfaze";
import { z } from "zod";
import type { ClassifyResponse } from "@/lib/api";
import { DOCUMENT_TYPE_INFO, DOCUMENT_TYPES, type DocumentType, isDocumentType } from "@/lib/document-types";
import { errorResponse, enforceLimits, readJson } from "@/lib/http";
import { interfazeDirect, MODEL } from "@/lib/interfaze";
import { lev } from "@/lib/lev";

export const maxDuration = 60;

// Lev and the fallback both read the OCR text, not the image; the head of the
// document carries nearly all the type signal.
const MAX_STATE_CHARS = 4000;

const body = z.object({ text: z.string().min(1, "No text to classify") });

export async function POST(req: Request) {
  try {
    await enforceLimits(req);
    const { text } = await readJson(req, body);
    const state = text.slice(0, MAX_STATE_CHARS);
    const started = performance.now();

    if (lev.isConfigured()) {
      try {
        return Response.json({ ...(await classifyWithLev(state)), latencyMs: elapsed(started) } satisfies ClassifyResponse);
      } catch (err) {
        const note = `Lev unavailable (${err instanceof Error ? err.message : "unknown error"}); fell back to Interfaze.`;
        return Response.json({ ...(await classifyWithInterfaze(state)), note, latencyMs: elapsed(started) } satisfies ClassifyResponse);
      }
    }

    return Response.json({
      ...(await classifyWithInterfaze(state)),
      note: "LEV_BASE_URL not set; using Interfaze structured output.",
      latencyMs: elapsed(started),
    } satisfies ClassifyResponse);
  } catch (err) {
    return errorResponse(err);
  }
}

type Classification = Omit<ClassifyResponse, "latencyMs" | "note">;

async function classifyWithLev(state: string): Promise<Classification> {
  // One forward pass answers both questions: the choice picks the extraction
  // schema, the yes/no decides whether the KYC checks apply.
  const result = await lev.systemOne(state, {
    document_type: {
      type: "choice",
      instructions: "What type of document is this OCR text from?",
      criteria: Object.fromEntries(DOCUMENT_TYPES.map((t) => [t, DOCUMENT_TYPE_INFO[t].description])),
    },
    is_identity_document: {
      type: "noul",
      instructions: "Is this a government-issued identity document belonging to a person?",
    },
  });

  const answer = result.answers.document_type;
  const probabilities = normalize(answer?.probabilities ?? (answer?.choice ? { [answer.choice]: 1 } : {}));
  const identity = result.answers.is_identity_document?.noul;

  return {
    engine: "lev",
    documentType: isDocumentType(answer?.choice) ? answer.choice : argmax(probabilities),
    probabilities,
    calibrated: true,
    signals: identity === undefined ? {} : { is_identity_document: identity },
    outputTokens: result.usage?.output_tokens ?? 0,
  };
}

const fallbackSchema = z.object({
  document_type: z.enum(DOCUMENT_TYPES),
  probabilities: z
    .object(Object.fromEntries(DOCUMENT_TYPES.map((t) => [t, z.number()])) as Record<DocumentType, z.ZodNumber>)
    .describe("Probability for each type, summing to 1"),
});

async function classifyWithInterfaze(state: string): Promise<Classification> {
  const criteria = DOCUMENT_TYPES.map((t) => `- ${t}: ${DOCUMENT_TYPE_INFO[t].description}`).join("\n");
  const res = await interfazeDirect.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `Classify the document the OCR text came from.\n${criteria}\nReturn a probability for every type.`,
      },
      { role: "user", content: state },
    ],
    response_format: responseFormat(z.toJSONSchema(fallbackSchema), "document_classification"),
  });

  const parsed = fallbackSchema.parse(JSON.parse(res.choices[0]?.message.content ?? "{}"));
  return {
    engine: "interfaze",
    documentType: parsed.document_type,
    probabilities: normalize(parsed.probabilities),
    calibrated: false,
    signals: {},
    outputTokens: res.usage?.completion_tokens ?? null,
  };
}

function normalize(p: Record<string, number>): Record<DocumentType, number> {
  const values = DOCUMENT_TYPES.map((t) => Math.max(0, p[t] ?? 0));
  const sum = values.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(DOCUMENT_TYPES.map((t, i) => [t, values[i] / sum])) as Record<DocumentType, number>;
}

function argmax(p: Record<DocumentType, number>): DocumentType {
  return DOCUMENT_TYPES.reduce((best, t) => (p[t] > p[best] ? t : best), "other" as DocumentType);
}

const elapsed = (started: number) => Math.round(performance.now() - started);
