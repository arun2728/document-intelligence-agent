import { beforeAll, describe, expect, it } from "vitest";

// Route handlers enforce the origin check and spend limits themselves.
// No request here reaches Interfaze: each one fails validation after the limits pass.
beforeAll(() => {
  process.env.INTERFAZE_API_KEY = "sk_test_not_used";
  process.env.RATE_LIMIT_PER_IP_HOURLY = "3";
  process.env.RATE_LIMIT_DAILY = "1000";
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) delete process.env[k];
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const routes = {
  guard: () => import("@/app/api/guard/route"),
  ocr: () => import("@/app/api/ocr/route"),
  classify: () => import("@/app/api/classify/route"),
  extract: () => import("@/app/api/extract/route"),
};

describe("paid routes enforce limits themselves", () => {
  for (const [name, load] of Object.entries(routes)) {
    it(`/api/${name} rejects cross-origin requests`, async () => {
      const { POST } = await load();
      const res = await POST(post({}, { origin: "https://evil.example", "x-real-ip": `origin-${name}` }));
      expect(res.status).toBe(403);
      expect((await POST(post({}, { origin: "null", "x-real-ip": `origin-${name}` }))).status).toBe(403);
    });
  }

  it("lets same-origin and origin-less requests through to validation", async () => {
    const { POST } = await routes.extract();
    expect((await POST(post({ text: "" }, { origin: "http://localhost", "x-real-ip": "same-origin" }))).status).toBe(400);
    expect((await POST(post({ text: "" }, { "x-real-ip": "same-origin" }))).status).toBe(400);
  });

  it("returns 429 with Retry-After once an IP spends its hourly budget, across routes", async () => {
    const ip = { "x-real-ip": "203.0.113.7" };
    const { POST: classify } = await routes.classify();
    const { POST: extract } = await routes.extract();
    for (let i = 0; i < 3; i++) expect((await (i % 2 ? classify : extract)(post({ text: "" }, ip))).status).toBe(400);

    const limited = await extract(post({ text: "" }, ip));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await limited.json()).error).toMatch(/Demo limit reached/);

    // Other clients are unaffected.
    expect((await extract(post({ text: "" }, { "x-real-ip": "203.0.113.8" }))).status).toBe(400);
  });
});
