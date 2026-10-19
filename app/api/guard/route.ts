import { inputs } from "interfaze";
import { z } from "zod";
import type { GuardResponse } from "@/lib/api";
import { IMAGE_GUARD_CODES, parseGuardVerdict } from "@/lib/guard";
import { errorResponse, enforceLimits, imageDataUrl, readJson } from "@/lib/http";
import { GUARD_MODEL, interfaze } from "@/lib/interfaze";

export const maxDuration = 60;

const body = z.object({ image: imageDataUrl });

export async function POST(req: Request) {
  try {
    await enforceLimits(req);
    const { image } = await readJson(req, body);
    const started = performance.now();

    const res = await interfaze.chat.completions.create({
      model: GUARD_MODEL,
      max_tokens: 5,
      guard: [...IMAGE_GUARD_CODES],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Reply with the single word OK." }, inputs.image(image)],
        },
      ],
    });

    const verdict = parseGuardVerdict(res.choices[0]?.message.content, res.precontext);
    return Response.json({
      ...verdict,
      latencyMs: Math.round(performance.now() - started),
    } satisfies GuardResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
