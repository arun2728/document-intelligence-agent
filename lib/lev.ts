import "server-only";
import { z } from "zod";

/**
 * Minimal client for Lev's `/v1/systemone` protocol (https://github.com/InterfazeAI/lev).
 * Lev reads every answer from logits in one forward pass, so there are no output
 * tokens and choice probabilities are calibrated rather than self-reported.
 *
 * `LEV_BASE_URL` points at either a `lev serve` instance or, with
 * `LEV_TRANSPORT=gradio`, the Gradio Space in deploy/lev-zerogpu.
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

function authHeader(): Record<string, string> {
  return process.env.LEV_API_KEY ? { authorization: `Bearer ${process.env.LEV_API_KEY}` } : {};
}

export const lev = {
  isConfigured: () => Boolean(baseUrl()),

  async systemOne(
    state: string,
    questions: Record<string, SystemOneQuestion>,
    { timeoutMs = Number(process.env.LEV_TIMEOUT_MS) || 20_000 } = {},
  ): Promise<SystemOneResponse> {
    const url = baseUrl();
    if (!url) throw new Error("LEV_BASE_URL is not set");

    const signal = AbortSignal.timeout(timeoutMs);
    const call = process.env.LEV_TRANSPORT === "gradio" ? callGradio : callServer;
    return responseSchema.parse(await call(url, state, questions, signal));
  },
};

async function callServer(url: string, state: string, questions: object, signal: AbortSignal) {
  const res = await fetch(`${url}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeader() },
    body: JSON.stringify({ state, questions }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Lev responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/** Gradio queues the call, then streams its result as server-sent events. */
async function callGradio(url: string, state: string, questions: object, signal: AbortSignal) {
  const endpoint = `${url}/gradio_api/call/systemone`;
  const queued = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeader() },
    body: JSON.stringify({ data: [state, JSON.stringify(questions)] }),
    signal,
  });
  if (!queued.ok) {
    throw new Error(`Lev Space responded ${queued.status}: ${(await queued.text()).slice(0, 200)}`);
  }
  const { event_id } = z.object({ event_id: z.string() }).parse(await queued.json());

  const res = await fetch(`${endpoint}/${event_id}`, { headers: authHeader(), signal });
  if (!res.ok || !res.body) {
    throw new Error(`Lev Space responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  for await (const { event, data } of readEvents(res.body)) {
    if (event === "complete") return (JSON.parse(data) as unknown[])[0];
    if (event === "error") throw new Error(`Lev Space failed: ${data.slice(0, 200)}`);
  }
  throw new Error("Lev Space closed the stream without a result");
}

async function* readEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        if (event) yield { event, data: /^data: (.*)$/m.exec(block)?.[1] ?? "null" };
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
