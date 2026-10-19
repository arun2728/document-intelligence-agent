import "server-only";

// Spend protection for the public demo. Every Interfaze-backed call takes one slot
// from a per-IP hourly budget and one from a global daily budget (fixed windows).
//
// With Upstash Redis configured (Vercel Marketplace → Upstash, free tier is plenty)
// the counters are shared by every function instance. Without it they live in
// instance memory, which isn't shared and resets on cold start: best-effort only.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type LimitScope = "ip" | "daily";
export type LimitResult = { ok: true } | { ok: false; scope: LimitScope; retryAfterSeconds: number };

function envLimit(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export async function consume(ip: string, now = Date.now()): Promise<LimitResult> {
  const hour = Math.floor(now / HOUR_MS);
  const day = Math.floor(now / DAY_MS);
  const windows = [
    // One document run is 4 calls (guard, OCR, classify, extract), so 40/hour ≈ 10 documents.
    { scope: "ip", key: `rl:ip:${ip}:${hour}`, max: envLimit("RATE_LIMIT_PER_IP_HOURLY", 40), resetAt: (hour + 1) * HOUR_MS },
    { scope: "daily", key: `rl:daily:${day}`, max: envLimit("RATE_LIMIT_DAILY", 400), resetAt: (day + 1) * DAY_MS },
  ] as const;

  // Per-IP first, so one client hitting its limit doesn't also eat the global budget.
  for (const w of windows) {
    if ((await increment(w.key, w.resetAt, now)) > w.max) {
      return { ok: false, scope: w.scope, retryAfterSeconds: Math.ceil((w.resetAt - now) / 1000) };
    }
  }
  return { ok: true };
}

/** On Vercel these headers are set by the platform and can't be spoofed by the client. */
export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function increment(key: string, resetAt: number, now: number): Promise<number> {
  const redis = redisConfig();
  if (redis) {
    try {
      return await incrementInRedis(redis, key, resetAt);
    } catch (err) {
      console.error("Rate limiter: Redis unavailable, falling back to memory", err);
    }
  }
  return incrementInMemory(key, resetAt, now);
}

// The Vercel Marketplace integration sets the KV_* names; a direct Upstash setup uses UPSTASH_*.
function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

async function incrementInRedis({ url, token }: { url: string; token: string }, key: string, resetAt: number): Promise<number> {
  // Keys embed their window, so the expiry is only cleanup; PEXPIREAT is idempotent.
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify([
      ["INCR", key],
      ["PEXPIREAT", key, resetAt + 60_000],
    ]),
    cache: "no-store",
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
  const [incr] = (await res.json()) as { result?: unknown; error?: string }[];
  if (typeof incr?.result !== "number") throw new Error(incr?.error ?? "Unexpected Upstash response");
  return incr.result;
}

const memory = new Map<string, { count: number; expiresAt: number }>();

function incrementInMemory(key: string, resetAt: number, now: number): number {
  if (memory.size > 10_000) {
    for (const [k, v] of memory) if (v.expiresAt <= now) memory.delete(k);
  }
  const entry = memory.get(key);
  if (!entry) {
    memory.set(key, { count: 1, expiresAt: resetAt });
    return 1;
  }
  return ++entry.count;
}
