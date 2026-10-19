import "server-only";
import { APIError } from "interfaze";
import { z } from "zod";
import type { ApiErrorBody, Usage } from "./api";
import { clientIp, consume } from "./rate-limit";

// ~6 MB of base64. The client downscales before upload, so real requests are far smaller.
const MAX_DATA_URL_LENGTH = 8_000_000;

export const imageDataUrl = z
  .string()
  .max(MAX_DATA_URL_LENGTH, "Image is too large; keep uploads under ~6 MB")
  .regex(/^data:image\/(png|jpeg|webp);base64,/, "Expected a PNG, JPEG, or WebP data URL");

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers?: HeadersInit,
  ) {
    super(message);
  }
}

/**
 * Every paid route calls this first. The origin check stops other sites from
 * spending the budget through visitors' browsers (a text/plain POST skips CORS
 * preflight); the rate limits bound what a script can spend.
 */
export async function enforceLimits(req: Request): Promise<void> {
  const origin = req.headers.get("origin");
  if (origin && !sameHost(origin, req.url)) throw new HttpError(403, "Cross-origin requests are not allowed");

  const result = await consume(clientIp(req));
  if (result.ok) return;
  const message =
    result.scope === "ip"
      ? `Demo limit reached for your connection; try again in ${Math.ceil(result.retryAfterSeconds / 60)} min.`
      : "The demo's daily usage cap has been reached; it resets at 00:00 UTC.";
  throw new HttpError(429, message, { "retry-after": String(result.retryAfterSeconds) });
}

function sameHost(origin: string, url: string): boolean {
  try {
    return new URL(origin).host === new URL(url).host;
  } catch {
    return false; // e.g. the literal "null" origin from sandboxed iframes
  }
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const body = await req.json().catch(() => {
    throw new HttpError(400, "Request body must be JSON");
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

export function errorResponse(err: unknown): Response {
  let status = 500;
  let message = "Unexpected error";
  let headers: HeadersInit | undefined;

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
    headers = err.headers;
  } else if (err instanceof APIError) {
    // Surface upstream auth / rate-limit errors as-is; anything else is a bad gateway.
    status = err.status && [400, 401, 403, 413, 429].includes(err.status) ? err.status : 502;
    message = `Interfaze: ${err.message}`;
  } else if (err instanceof Error) {
    message = err.message;
  }

  if (status >= 500) console.error(err);
  return Response.json({ error: message } satisfies ApiErrorBody, { status, headers });
}

export function toUsage(usage: { prompt_tokens: number; completion_tokens: number } | undefined): Usage | null {
  return usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } : null;
}
