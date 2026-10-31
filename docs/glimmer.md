# Inbox triage on Muse Glimmer (this computer)

New inbox mail is triaged locally when Muse Glimmer is running on this computer: the server sends only each email's subject + snippet to Glimmer to decide customer-or-not, at zero API cost. When Glimmer isn't reachable, triage falls back to Muse Spark automatically — nothing breaks, and Settings → Thinking says which backend is sorting the inbox.

## Run Glimmer locally with LM Studio

1. Download and install [LM Studio](https://lmstudio.ai), then open it.
2. In LM Studio, search for and download the Muse Glimmer model, and load it (open the model in a chat or via the Models tab so it stays resident).
3. Start the local server: open the Developer tab (server icon) and press **Start Server**. It listens on port **1234** by default, serving an OpenAI-compatible API at `http://127.0.0.1:1234/v1`.
4. Point this repo's server at it with two env vars (same shell that runs `pnpm dev`, or a `.env` file — see below):

   ```sh
   export GLIMMER_BASE_URL=http://127.0.0.1:1234/v1
   export GLIMMER_MODEL=<the loaded model id, as shown in LM Studio>
   ```

   `GLIMMER_MODEL` must match the model id exactly — the health check GETs `<GLIMMER_BASE_URL>/models` and looks for that id in the list.
5. Restart the server (`pnpm dev`). The log shows either `[models] triage → Muse Glimmer (<model>)` or `[models] triage → Muse Spark (Glimmer isn't running on this computer)`.
6. Open Settings → Thinking: healthy Glimmer shows "Inbox sorting runs on this computer (Muse Glimmer) ✓".

## How the fallback works

- Both vars must be set; if either is missing, or the `/models` check fails (3 s timeout), triage runs on Muse Spark.
- The server re-checks every 60 s, so starting LM Studio later revives Glimmer with no restart — and if Glimmer goes away, the next re-check (or the next failed triage call) drops back to Spark.
- A triage call that fails on Glimmer retries that same call on Spark immediately and marks Glimmer down until a re-check passes.
- Glimmer calls report `costUsd: 0`. LM Studio may not support the `json_schema` response format, so Glimmer calls use `json_object` with the schema inlined in the system prompt; the reply is still validated with zod, and an invalid reply falls back to Spark like any other failure.
- Only the `triage` role ever runs on Glimmer. Builders, planners, and vision stay on Meta models (see Settings → Thinking for the full list).
