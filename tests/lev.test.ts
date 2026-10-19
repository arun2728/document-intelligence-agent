import { afterEach, describe, expect, it, vi } from "vitest";
import { lev } from "@/lib/lev";

const answers = { answers: { t: { choice: "invoice", probabilities: { invoice: 0.9, passport: 0.1 } } }, usage: { output_tokens: 0 } };
const question = { t: { type: "choice" as const, instructions: "Document type?", criteria: { invoice: null, passport: null } } };

/** Gradio streams in arbitrary chunk sizes; split the events mid-line to exercise buffering. */
function sse(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
      c.close();
    },
  });
}

function stubSpace(events: string) {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith("/gradio_api/call/systemone")
      ? Response.json({ event_id: "ev1" })
      : new Response(sse(events), { headers: { "content-type": "text/event-stream" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("lev over the Gradio transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("queues the call, then reads the result from the event stream", async () => {
    vi.stubEnv("LEV_BASE_URL", "https://user-lev.hf.space/");
    vi.stubEnv("LEV_TRANSPORT", "gradio");
    vi.stubEnv("LEV_API_KEY", "hf_test");
    const fetchMock = stubSpace(`event: heartbeat\ndata: null\n\nevent: complete\ndata: ${JSON.stringify([answers])}\n\n`);

    const result = await lev.systemOne("INVOICE #1042", question);

    expect(result.answers.t.choice).toBe("invoice");
    const [queueUrl, queueInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(queueUrl).toBe("https://user-lev.hf.space/gradio_api/call/systemone");
    expect(JSON.parse(queueInit.body as string)).toEqual({ data: ["INVOICE #1042", JSON.stringify(question)] });
    expect(fetchMock.mock.calls[1][0]).toBe("https://user-lev.hf.space/gradio_api/call/systemone/ev1");
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.headers).toMatchObject({ authorization: "Bearer hf_test" });
    }
  });

  it("surfaces a Space error so classify can fall back", async () => {
    vi.stubEnv("LEV_BASE_URL", "https://user-lev.hf.space");
    vi.stubEnv("LEV_TRANSPORT", "gradio");
    stubSpace(`event: error\ndata: {"error": "ZeroGPU quota exceeded"}\n\n`);

    await expect(lev.systemOne("x", question)).rejects.toThrow(/quota exceeded/);
  });
});
