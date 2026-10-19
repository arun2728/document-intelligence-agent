import { responseFormat } from "interfaze";
import { z } from "zod";
import type { ExtractResponse } from "@/lib/api";
import { DOCUMENT_TYPE_INFO, DOCUMENT_TYPES } from "@/lib/document-types";
import { errorResponse, enforceLimits, HttpError, readJson, toUsage } from "@/lib/http";
import { interfazeDirect, MODEL } from "@/lib/interfaze";
import { EXTRACTION_SCHEMAS } from "@/lib/schemas";

export const maxDuration = 60;

const body = z.object({
  text: z.string().min(1, "No text to extract from").max(200_000),
  documentType: z.enum(DOCUMENT_TYPES),
});

export async function POST(req: Request) {
  try {
    await enforceLimits(req);
    const { text, documentType } = await readJson(req, body);
    const schema = EXTRACTION_SCHEMAS[documentType];
    const started = performance.now();

    // Extraction runs on the OCR text we already have rather than re-sending the
    // image: OCR happens once, and the text-only call can skip the tool router.
    const res = await interfazeDirect.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: [
            `You extract fields from the OCR text of a ${DOCUMENT_TYPE_INFO[documentType].label.toLowerCase()}.`,
            "OCR lines are in reading order; field labels (e.g. DOB, EXP, LN) may be fused to their values.",
            "Copy names and identifiers exactly as printed. Normalize dates to YYYY-MM-DD.",
            "Use null for anything not present. Never invent values.",
          ].join("\n"),
        },
        { role: "user", content: text },
      ],
      response_format: responseFormat(z.toJSONSchema(schema), documentType),
    });

    let json: unknown;
    try {
      json = JSON.parse(res.choices[0]?.message.content ?? "");
    } catch {
      throw new HttpError(502, "Interfaze returned non-JSON content for a structured request");
    }

    // Validate rather than trust: return the data either way, but surface mismatches.
    const parsed = schema.safeParse(json);
    return Response.json({
      documentType,
      data: (parsed.success ? parsed.data : json) as Record<string, unknown>,
      issues: parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      latencyMs: Math.round(performance.now() - started),
      usage: toUsage(res.usage),
    } satisfies ExtractResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
