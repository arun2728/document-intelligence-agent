---
title: Lev System One
sdk: gradio
sdk_version: 6.30.0
python_version: "3.12"
app_file: app.py
pinned: false
license: apache-2.0
---

# Lev on ZeroGPU

Serves [Lev](https://github.com/InterfazeAI/lev) on a free Hugging Face ZeroGPU Space for the
document intelligence app's classify step.

## Deploy

1. Create a **Gradio** Space with **ZeroGPU** hardware. Free accounts need a verified email and
   an account older than 30 days, and can host two ZeroGPU Spaces. Make it private if you like.
2. Push this folder's three files to the Space repo. The first build installs torch and the
   first start downloads ~9.5 GB of weights, so give it several minutes.
3. Create a read token at <https://huggingface.co/settings/tokens>. GPU time is charged to the
   caller's daily quota (5 min/day on a free account, 2 min/day unauthenticated), so always send it.
4. Set these in the app (`.env.local` and Vercel):

   ```bash
   LEV_BASE_URL=https://<user>-<space>.hf.space
   LEV_TRANSPORT=gradio
   LEV_API_KEY=hf_...
   LEV_TIMEOUT_MS=40000
   ```

## Smoke test

```bash
URL=https://<user>-<space>.hf.space
curl -s -X POST $URL/gradio_api/call/systemone -H "Authorization: Bearer $HF_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"data":["INVOICE #1042. Total due $1,280.00","{\"t\":{\"type\":\"choice\",\"instructions\":\"Document type?\",\"criteria\":{\"invoice\":null,\"passport\":null}}}"]}'
# → {"event_id": "..."}
curl -sN $URL/gradio_api/call/systemone/<event_id> -H "Authorization: Bearer $HF_TOKEN"
```
