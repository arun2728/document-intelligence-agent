import { inputs } from "interfaze";
import { z } from "zod";
import type { OcrResponse } from "@/lib/api";
import { errorResponse, enforceLimits, HttpError, imageDataUrl, readJson, toUsage } from "@/lib/http";
import { interfaze, MODEL } from "@/lib/interfaze";
import { parseOcrResult } from "@/lib/ocr";

export const maxDuration = 60;

const body = z.object({ image: imageDataUrl });

export async function POST(req: Request) {
  try {
    await enforceLimits(req);
    const { image } = await readJson(req, body);
    const started = performance.now();

    // `task: "ocr"` runs only the OCR layer — faster and cheaper than a full
    // completion, and the raw result (text + quads + confidences) comes back as precontext.
    const res = await interfaze.chat.completions.create({
      model: MODEL,
      task: "ocr",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Extract all text." }, inputs.image(image)],
        },
      ],
    });

    const raw = res.precontext?.find((p) => p.name === "ocr")?.result ?? contentResult(res.choices[0]?.message.content);
    if (!raw) throw new HttpError(502, "Interfaze returned no OCR result");

    return Response.json({
      ocr: parseOcrResult(raw),
      latencyMs: Math.round(performance.now() - started),
      usage: toUsage(res.usage),
    } satisfies OcrResponse);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Task runs also echo `{ name, result }` as the message content. */
function contentResult(content: string | null | undefined): unknown {
  try {
    return content ? JSON.parse(content).result : undefined;
  } catch {
    return undefined;
  }
}
