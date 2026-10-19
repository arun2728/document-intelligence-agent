import "server-only";
import { z } from "zod";

/**
 * Minimal client for Lev's `/v1/systemone` protocol (https://github.com/InterfazeAI/lev).
 * Lev reads every answer from logits in one forward pass, so there are no output
 * tokens and choice probabilities are calibrated rather than self-reported.
 */

export type SystemOneQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "noul"; instructions: string };

const answerSchema = z.object({
  choice: z.string().optional(),
  probabilities: z.record(z.string(), z.number()).nullish(),
  noul: z.number().optional(),
  score: z.number().optional(),
  confidence: z.number().nullish(),
});

const responseSchema = z.object({
  answers: z.record(z.string(), answerSchema),
  usage: z.object({ output_tokens: z.number() }).partial().optional(),
});

export type SystemOneResponse = z.infer<typeof responseSchema>;

function baseUrl() {
  return process.env.LEV_BASE_URL?.replace(/\/+$/, "");
}

export const lev = {
  isConfigured: () => Boolean(baseUrl()),

  async systemOne(
    state: string,
    questions: Record<string, SystemOneQuestion>,
    { timeoutMs = 20_000 } = {},
  ): Promise<SystemOneResponse> {
    const url = baseUrl();
    if (!url) throw new Error("LEV_BASE_URL is not set");

    const res = await fetch(`${url}/v1/systemone`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.LEV_API_KEY && { authorization: `Bearer ${process.env.LEV_API_KEY}` }),
      },
      body: JSON.stringify({ state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Lev responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return responseSchema.parse(await res.json());
  },
};
