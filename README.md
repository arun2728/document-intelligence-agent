# Document Intelligence Agent

A KYC / document-processing pipeline built on [Interfaze](https://interfaze.ai). Upload an ID, passport, invoice, or receipt. The app gates it through guardrails, OCRs it, classifies it with [Lev](https://github.com/InterfazeAI/lev), extracts typed fields with a per-type Zod schema, traces every value back to its OCR bounding box, and returns an approve / review / reject verdict.

Next.js 16 · React 19 · TypeScript · `interfaze` SDK · Zod 4 · Tailwind 4

```
           ┌─ /api/guard ─ guard: S1/S12/S15_IMAGE ─┐
 image ────┤      (runs in parallel; gates below)    ├─► /api/classify ──► /api/extract ──► grounding + checks
           └─ /api/ocr ── task: "ocr" → precontext ──┘    Lev systemone     Zod schema for     (client, pure TS)
                                                          on OCR text       that doc type,
                                                                            on OCR text
```

## What each step uses

| Step | Interfaze feature | Notes |
|---|---|---|
| Guardrails | `guard: ["S1_IMAGE","S12_IMAGE","S15_IMAGE"]` | Reads the verdict from the `unsafe <code>` content **and** the raw `nsfw/nudity/gore` scores in the `image_guardrail_classifier` precontext. Fails closed. |
| OCR | `task: "ocr"` | Text, per-line and per-word quads, and confidences from `precontext`. Rendered as an SVG overlay coloured by confidence. |
| Classify | Lev `/v1/systemone` | One forward pass answers a `choice` (document type → picks the schema) and a `noul` (is this an identity document?). Calibrated probabilities, zero output tokens. Falls back to Interfaze structured output if `LEV_BASE_URL` isn't set or Lev is unreachable, and the UI labels that result *uncalibrated*. |
| Extract | `response_format: responseFormat(z.toJSONSchema(schema))` | Six schemas in [lib/schemas.ts](lib/schemas.ts). Every field is `nullable` (never optional), so "not on the document" is an explicit `null`. The response is re-validated with `safeParse`. |

## Design decisions worth calling out

- **OCR once, reuse the text.** Classification and extraction both run on the OCR text rather than re-sending the image. Text-only calls don't need tools, so they skip the router (`bypassMoA: true`). On the sample license this cut extraction from 9.5s to 4.6s with identical output.
- **The guard runs on `interfaze-1.1-lite`.** The verdict comes from the guardrail classifiers, not the model's reply, so the lite model is enough. Measured 7.2s vs 13.5s on `interfaze-1`, with the same classifiers firing. It runs in parallel with OCR, and OCR output isn't rendered until the guard passes.
- **Grounding.** [lib/grounding.ts](lib/grounding.ts) maps each extracted value back to the OCR words it came from. It handles reformatted dates (`1987-09-12` ↔ `09/12/1987`), diacritics (`MUNOZ` ↔ `MUÑOZ`), labels fused to values (`DOB09/12/1987`), and addresses split across lines. Hovering a field highlights its source on the document, and its confidence is the real OCR confidence of those words. Values that can't be traced are flagged *not in OCR*, which means the model normalized or inferred them.
- **The model extracts; code decides.** [lib/checks.ts](lib/checks.ts) does the deterministic checks:
  - IDs: expiry, age, document number present.
  - Invoices and receipts: line items sum to the subtotal, and subtotal + tax (+ tip) equals the total.
  - OCR quality.
  - PII: lists PII fields, and catches visible SSNs and card numbers with a Luhn check. It's tuned to ignore receipt UPCs and transaction codes.

  On the bundled Walmart receipt, the arithmetic check catches that the extracted line items don't add up to the printed subtotal.

## Run it

```bash
cp .env.example .env.local     # add INTERFAZE_API_KEY
npm install
npm run dev                    # http://localhost:3000
```

Click **Driver's license** or **Receipt** to run a bundled sample, or drop, browse for, or paste your own PNG, JPEG, or WebP. The browser applies EXIF rotation and downscales the image to ≤2000px before upload, which keeps requests well under serverless body limits.

### Spend limits

The demo is public, so every API route that calls Interfaze checks three things before it does any work (`enforceLimits` in [lib/http.ts](lib/http.ts)):

- **Same origin only.** A request whose `Origin` is another site gets `403`. This stops other pages from spending the budget through their visitors' browsers.
- **Per-IP budget:** 40 calls an hour by default (about 10 documents, since a run makes 4 calls). Past that the route returns `429` with `Retry-After`.
- **Global daily cap:** 400 calls a day by default across all clients. This puts a hard ceiling on the daily Interfaze bill.

The counters are fixed-window and live in [lib/rate-limit.ts](lib/rate-limit.ts). When Upstash Redis is configured, every serverless instance shares the counters. Without it they're kept in instance memory, which is fine locally but only best-effort on Vercel. If Redis is unreachable, the limiter falls back to memory rather than failing requests. The Interfaze key is used only in server code (`server-only`), so it never reaches the browser.

### Deploying to Vercel

```bash
vercel link
vercel env add INTERFAZE_API_KEY production --sensitive
# Recommended: Vercel dashboard → Storage → Upstash for Redis (free tier) → connect to this project.
# This sets KV_REST_API_URL / KV_REST_API_TOKEN, which the rate limiter picks up.
vercel deploy --prod
```

A day at the default cap uses about 1,600 Redis commands, well inside Upstash's free 500K a month.

### Enabling Lev

Lev is a 4B open-weight model (Qwen3.5-4B + LoRA, Apache-2.0). It needs a GPU to run at useful speed:

```bash
pip install "lev[serve] @ git+https://github.com/InterfazeAI/lev#subdirectory=packages/lev"
lev serve --checkpoint interfaze-ai/lev --host 0.0.0.0 --port 8000
# then in .env.local
LEV_BASE_URL=http://localhost:8000
```

Without it, everything still works through the Interfaze fallback.

### Running Lev on a free ZeroGPU Space

No GPU? [deploy/lev-zerogpu](deploy/lev-zerogpu) runs Lev on a free Hugging Face [ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu) Space. It's a Gradio app that wraps `model.system_one` as a single `/systemone` API, so it returns the same `answers` shape as `lev serve`.

| File | |
|---|---|
| [app.py](deploy/lev-zerogpu/app.py) | Loads `interfaze-ai/lev` at startup and runs each call inside `@spaces.GPU(duration=30)`. It patches PEFT to read the LoRA adapter on the CPU, because ZeroGPU's startup CUDA emulation can't load it straight onto the GPU. |
| [requirements.txt](deploy/lev-zerogpu/requirements.txt) | Pins `torch==2.13.0`, the newest version ZeroGPU supports, with `transformers==5.17.0` and `lev` from GitHub. |
| [README.md](deploy/lev-zerogpu/README.md) | The Space's config header (`sdk: gradio`, Python 3.12), plus the deploy steps and a curl smoke test. |

To deploy it:

1. Create a **Gradio** Space and pick **ZeroGPU** hardware. Free accounts need a verified email and an account older than 30 days, and can host two ZeroGPU Spaces. The Space can be private.
2. Push the three files to the Space repo, for example:

   ```bash
   hf upload <user>/<space> deploy/lev-zerogpu . --repo-type space --exclude "__pycache__/*"
   ```

   The first build installs torch, and the first start downloads about 9.5 GB of weights, so allow several minutes.
3. Create a Hugging Face **read** token. ZeroGPU charges GPU time to the caller's daily quota (5 min a day on a free account, 2 min unauthenticated), so always send the token.
4. Point the app at the Space in `.env.local` and on Vercel:

   ```bash
   LEV_BASE_URL=https://<user>-<space>.hf.space
   LEV_TRANSPORT=gradio
   LEV_API_KEY=hf_...          # the read token, sent as a bearer token
   LEV_TIMEOUT_MS=40000        # leaves room for queueing and GPU attach
   ```

With `LEV_TRANSPORT=gradio`, [lib/lev.ts](lib/lev.ts) queues a call on `POST /gradio_api/call/systemone`, then reads the result from the server-sent event stream. If the Space is asleep, out of quota, or slower than `LEV_TIMEOUT_MS`, classify falls back to Interfaze and the UI shows why. The server log records which engine answered each request (`[classify] engine=lev transport=gradio ...`). To test the Space on its own, use the curl smoke test in [deploy/lev-zerogpu/README.md](deploy/lev-zerogpu/README.md#smoke-test).

### Environment

| Variable | Default | |
|---|---|---|
| `INTERFAZE_API_KEY` | (none) | Required |
| `INTERFAZE_MODEL` | `interfaze-1` | OCR / classify / extract |
| `INTERFAZE_GUARD_MODEL` | `interfaze-1.1-lite` | Guardrail call |
| `LEV_BASE_URL` / `LEV_API_KEY` | (none) | Optional Lev server or Space. The key is sent as a bearer token; for the Space it's a Hugging Face read token |
| `LEV_TRANSPORT` | `http` | `gradio` when `LEV_BASE_URL` is the ZeroGPU Space |
| `LEV_TIMEOUT_MS` | `20000` | How long classify waits for Lev before falling back (about `40000` for ZeroGPU) |
| `RATE_LIMIT_PER_IP_HOURLY` | `40` | Interfaze calls per client IP per hour |
| `RATE_LIMIT_DAILY` | `400` | Interfaze calls per UTC day, all clients |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | (none) | Shared limit counters (`KV_REST_API_*` also accepted) |

## Project layout

```
app/
  page.tsx                    pipeline orchestration + layout (client)
  api/{guard,ocr,classify,extract}/route.ts
  components/                 BoundingBoxOverlay, ExtractionResults, ClassificationCard,
                              GuardCard, ChecksPanel, PipelineTimeline, ConfidenceBar, DocumentUpload
lib/
  interfaze.ts                SDK clients (full + router-bypass)
  lev.ts                      /v1/systemone client
  schemas.ts                  Zod schemas per document type + PII field map
  ocr.ts                      precontext → normalized lines/words/quads
  grounding.ts                value → OCR word matching
  checks.ts                   KYC + arithmetic + PII checks
  guard.ts                    guard verdict + classifier scores
  http.ts                     request validation, origin check + limits, error mapping
  rate-limit.ts               per-IP / daily counters (Upstash Redis or in-memory)
tests/                        vitest, against a real OCR response fixture
deploy/
  lev-zerogpu/                Gradio app that serves Lev on a Hugging Face ZeroGPU Space
```

```bash
npm test          # unit tests (grounding, checks, OCR/guard parsing, rate limits, route-level limits)
npm run typecheck
npm run lint
```

## Measured latency (bundled samples, `interfaze-1`)

| | Guard | OCR | Classify (fallback) | Extract | End-to-end |
|---|---|---|---|---|---|
| Driver's license | 2.8s | 3.9s | 4.3s | 4.3s | ~13s |
| Receipt (61 lines, 28 items) | 3.1s | 7.8s | 5.6s | 11.9s | ~26s |

The receipt's extraction time is dominated by output tokens (~2.4k). With Lev, classification is a single forward pass on your own GPU.

## Limitations / next steps

- Images only. PDFs would need page rasterization (e.g. pdf.js) to draw the overlay.
- Lev's wire format follows its model card. The classification path was tested against a stub that returns the documented response shape, not against a live Lev server.
- Single-character values (`sex: "M"`) aren't grounded, because they'd match noise.
- Streaming extraction (`chat.completions.stream`) would let fields appear progressively on long receipts.
