import { beforeAll, describe, expect, it } from "vitest";
import { clientIp, consume } from "@/lib/rate-limit";

const HOUR = 3_600_000;
const DAY = 86_400_000;

beforeAll(() => {
  process.env.RATE_LIMIT_PER_IP_HOURLY = "2";
  process.env.RATE_LIMIT_DAILY = "3";
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) delete process.env[k];
});

// Each test uses its own day so the in-memory counters don't interact.
describe("rate limiter (in-memory)", () => {
  it("limits each IP per hour and resets in the next hour", async () => {
    const t = 10 * DAY;
    expect(await consume("a", t)).toEqual({ ok: true });
    expect(await consume("a", t + 1000)).toEqual({ ok: true });
    expect(await consume("a", t + 2000)).toEqual({ ok: false, scope: "ip", retryAfterSeconds: 3598 });
    expect(await consume("a", t + HOUR)).toEqual({ ok: true });
  });

  it("caps total calls per day across IPs", async () => {
    const t = 20 * DAY;
    for (const ip of ["a", "b", "c"]) expect((await consume(ip, t)).ok).toBe(true);
    expect(await consume("d", t)).toEqual({ ok: false, scope: "daily", retryAfterSeconds: DAY / 1000 });
    expect((await consume("d", t + DAY)).ok).toBe(true);
  });

  it("doesn't charge the daily budget for requests an IP limit already rejected", async () => {
    const t = 30 * DAY;
    for (let i = 0; i < 5; i++) await consume("greedy", t);
    expect((await consume("fresh", t)).ok).toBe(true); // daily count is 2 (greedy's allowed calls) + 1
  });
});

describe("clientIp", () => {
  it("prefers x-real-ip, then the first x-forwarded-for hop", () => {
    const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
    expect(clientIp(req({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(req({ "x-forwarded-for": "2.2.2.2, 10.0.0.1" }))).toBe("2.2.2.2");
    expect(clientIp(req({}))).toBe("unknown");
  });
});
