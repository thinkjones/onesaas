# M1: Foundation and Thin Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a "✨ Save as lead & reply" button injected into Gmail runs a hand-written flow 1 workflow (extract → save customer → write reply → draft reply in Gmail), with every step's input, output and why visible in a bare run log page.

**Architecture:** pnpm monorepo. `packages/shared` holds zod schemas for workflows, runs, the step catalog and the extension protocol. `apps/server` (Node, Hono, SQLite) holds the model gateway, table store, engine, step executors and the WebSocket bridge to the extension. `apps/extension` (WXT, MV3) holds the Gmail adapter. `apps/web` (Vite + React) shows pairing and the run log. Everything runs on localhost.

**Tech Stack:** Node 22, pnpm 9, TypeScript 5, Vitest, Hono + @hono/node-server + @hono/node-ws, better-sqlite3 + drizzle-orm, zod 3 + zod-to-json-schema, jexl, openai (npm), WXT, React 19 + Vite, jsdom (tests).

**Spec:** `AgenticHarness/docs/meta-ai-hackathon-my-dads-ai-agent/plans/2026-10-28-dads-ai-agent-design.md` (sections 3, 5, 7, 8 are the ones this plan implements).

**Milestone context:** This is plan 1 of 5, all in this folder:
- M1 (Wed–Thu Oct 28–29): this plan.
- M2 (Fri Oct 30): `2026-10-28-m2-runtime-mode-and-approvals.md`
- M3 (Sat Oct 31): `2026-10-28-m3-builder-agent-and-design-mode.md`
- M4 (Sun Nov 1): `2026-10-28-m4-flows-2-and-4-connectors-media-views.md`
- M5 (Mon–Tue Nov 2–3): `2026-10-28-m5-experience-voice-mood-and-polish.md`

If time runs short, cut in the spec's order: Glimmer triage (M5 Task 7), themes 2 and 3 (M5 Task 1), flow 2's free/busy check (M4 Task 2), `code.transform` (M4 Task 9), card and stat views (M4 Task 8).

## Global Constraints

- Meta Model API base URL `https://api.meta.ai/v1`, key from env `MODEL_API_KEY`, passed explicitly to the OpenAI client (the SDK does not read it).
- Model IDs: `muse-spark-1.3`, `muse-wonder-1.0`, `muse-image-1.0`, `sam-3.1`, `muse-voice-transcribe-1.0`. Gateway roles: `{ builder: 'muse-spark-1.3', planner: 'muse-wonder-1.0', triage: 'muse-spark-1.3', vision: 'muse-spark-1.3' }` (triage switches to Glimmer in M5).
- Pricing for cost tracking (USD per million tokens, input/output): spark-1.3 1.25/4.25, wonder-1.0 4.00/20.00.
- Server binds `127.0.0.1:8787` only. Web dev server `localhost:5173`. Extension WebSocket `ws://127.0.0.1:8787/ext`.
- The server never calls Google or Meta directly; all `gmail.*` steps go through the extension.
- Nothing sends automatically: `gmail.draftReply` leaves a draft, never clicks Send.
- Every AI step returns `{ output, why }` from one structured call; `why` is one plain-English sentence.
- SQLite file at `data/app.db` (gitignored). Tests use `:memory:`.
- Repo is public and MIT licensed; README states all code was written during the hackathon (Oct 27 – Nov 4, 2026) with Muse Code.
- Extension heartbeat every 20 s; extension command default timeout 30 s.

## Review Focus

- Customer emails twice: `table.upsert` keyed on email updates the existing row instead of adding a duplicate (test in Task 4).
- Extension not connected or Gmail tab closed when a step needs it: the step fails within the timeout with the message "I need Gmail open in Chrome to do this." instead of hanging (test in Task 8).
- Model returns JSON that doesn't match the step's output schema: one automatic retry, then the step fails with a readable error and the run stops cleanly (test in Task 6).
- Gmail button double-clicked: a second click while that email's run is still `running` does not start a second run (test in Task 9).
- Agent- or user-supplied table and column names with spaces, quotes or SQL (`"Customers; DROP"`) are sanitised to safe identifiers, never interpolated raw (test in Task 4).

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `LICENSE` (MIT, Gene Conroy-Jones 2026), `README.md`
- Create: `packages/shared/{package.json,tsconfig.json,src/index.ts}`
- Create: `apps/server/{package.json,tsconfig.json,src/index.ts,src/app.ts}`, `apps/server/test/health.test.ts`
- Create: `apps/web/` via `pnpm create vite apps/web --template react-ts`, then add workspace dep on `@dad/shared`
- Create: `apps/extension/` via `pnpm dlx wxt@latest init apps/extension --template react`
- Modify: `.gitignore` (add `node_modules`, `dist`, `.output`, `.wxt`, `data/`, `.env*`)

**Interfaces:**
- Produces: package names `@dad/shared`, `@dad/server`, `@dad/web`, `@dad/extension`. `createApp(deps: AppDeps): Hono` exported from `apps/server/src/app.ts` (AppDeps grows in later tasks; start with `{}`). Root scripts: `pnpm dev` (server, web and extension in parallel via `pnpm -r --parallel dev`), `pnpm test` (`vitest run`), `pnpm typecheck`.

- [ ] **Step 1: Write the failing test** `apps/server/test/health.test.ts`

```ts
import { createApp } from '../src/app';
test('GET /health returns ok', async () => {
  const res = await createApp({}).request('/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run `pnpm test` and confirm it fails** (module not found).
- [ ] **Step 3: Create the workspace files and `createApp` with a `/health` route.** `src/index.ts` serves it with `@hono/node-server` on `127.0.0.1:8787`. README: one-paragraph pitch, "Built during the Meta AI Developer Hackathon, Oct 27 – Nov 4 2026, with Muse Code", setup (`pnpm i`, `export MODEL_API_KEY=…`, `pnpm dev`).
- [ ] **Step 4: Run `pnpm test` (PASS) and `pnpm dev`; confirm `curl 127.0.0.1:8787/health` returns `{"ok":true}`, the web app loads on 5173, and WXT opens a Chrome with the extension loaded.**
- [ ] **Step 5: Commit** `chore: scaffold monorepo (server, web, extension, shared)`

### Task 2: Model gateway and Meta model smoke test

**Files:**
- Create: `apps/server/src/models/gateway.ts`, `apps/server/src/models/pricing.ts`, `apps/server/test/gateway.test.ts`
- Create: `scripts/smoke-models.ts`, `scripts/fixtures/hello.wav` (make with `say -o /tmp/h.aiff "hello dad" && ffmpeg -i /tmp/h.aiff -ac 1 -ar 24000 -c:a pcm_s16le scripts/fixtures/hello.wav`), `scripts/fixtures/mug.jpg` (any photo you took yourself)

**Interfaces:**
- Produces:
  ```ts
  type ModelRole = 'builder' | 'planner' | 'triage' | 'vision';
  interface ChatJsonResult<T> { data: T; model: string; tokens: { input: number; output: number }; costUsd: number }
  interface Gateway { chatJson<T>(o: { role: ModelRole; system: string; user: string; schema: z.ZodType<T>; schemaName: string }): Promise<ChatJsonResult<T>> }
  function createGateway(o: { client: Pick<OpenAI, 'chat'>; roles?: Partial<Record<ModelRole, string>> }): Gateway
  function costUsd(model: string, input: number, output: number): number
  ```

- [ ] **Step 1: Write failing tests** in `gateway.test.ts` with a fake `client.chat.completions.create`:
  - `chatJson` sends `model: 'muse-spark-1.3'` for role `builder` and `response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }`.
  - It parses `choices[0].message.content` with the zod schema and returns `data`.
  - It returns `costUsd` = `costUsd('muse-spark-1.3', 1000, 2000)` = `0.00975` for usage `{prompt_tokens:1000, completion_tokens:2000}`.
  - When content fails the schema, it throws an error whose message starts with `Model output did not match schema`.
- [ ] **Step 2: Run `pnpm vitest run apps/server/test/gateway.test.ts`; expect FAIL.**
- [ ] **Step 3: Implement `createGateway` and `costUsd`.** Convert zod with `zod-to-json-schema` (`target: 'openAi'`). No retry here; retries live in the executor (Task 6).
- [ ] **Step 4: Run the tests; expect PASS.**
- [ ] **Step 5: Write `scripts/smoke-models.ts`** (run with `pnpm tsx scripts/smoke-models.ts`), printing one ✓/✗ line per model:
  - Spark: chat completion "Reply with the single word: ready".
  - Wonder: same prompt with `muse-wonder-1.0`.
  - Image: `client.images.generate({ model: 'muse-image-1.0', prompt: 'soft watercolor of a small shop counter at dawn' })`; write the result to `data/smoke-image.png`.
  - SAM: `POST /v1/responses` with `model: 'sam-3.1'`, the mug photo and prompt "mug". Request shape per https://dev.meta.ai/docs/media-segmentation. Print the number of masks.
  - Transcribe: multipart `POST /v1/asr/transcribe` with `request={"model":"muse-voice-transcribe-1.0","audioEncoding":"WAV","mode":"PUSH_TO_TALK"}` and `hello.wav`; print `transcript`.
  - Glimmer: if `GLIMMER_BASE_URL` is set, a chat completion against it; otherwise print "skipped".
- [ ] **Step 6: Run the smoke script with a real key.** Expected: ✓ on Spark, Wonder, Image, SAM, Transcribe; the transcript contains "hello". Record any shape differences from the docs in a comment at the top of the script.
- [ ] **Step 7: Commit** `feat(server): Meta model gateway with structured output and cost; smoke script`

### Task 3: Shared workflow, run and protocol schemas, plus bindings

**Files:**
- Create: `packages/shared/src/workflow.ts`, `packages/shared/src/run.ts`, `packages/shared/src/protocol.ts`, `packages/shared/src/bindings.ts`
- Test: `packages/shared/test/bindings.test.ts`, `packages/shared/test/workflow.test.ts`

**Interfaces:**
- Produces (all zod schemas plus inferred types, exported from `@dad/shared`):
  - `StepInstance { id; type; title; summary; config: Record<string, unknown>; inputs: Record<string, string>; position: { x; y } }`
  - `Edge { from; to; when?: string }`
  - `Workflow { id; name; description; version: number; status: 'draft'|'on'|'off'; trigger: StepInstance; steps: StepInstance[]; edges: Edge[] }`
  - `RunStatus = 'running'|'waiting'|'done'|'failed'`, `StepRunStatus = 'pending'|'running'|'waiting'|'done'|'failed'|'skipped'`
  - `Run { id; workflowId; workflowVersion; triggerPayload: unknown; status; startedAt; endedAt? }`
  - `StepRun { id; runId; stepId; status; input?; output?; error?; model?; tokens?; costUsd?; durationMs?; why?; startedAt }`
  - Protocol (extension ⇄ server), discriminated on `type`:
    - `pair { code }` → `paired { token }`
    - `hello { token }` → `ready { buttons: { workflowId; label }[] }`
    - `cmd { id; site: 'gmail'|'calendar'|'meta'; action; input }` → `result { id; ok: true; output } | { id; ok: false; error }`
    - `trigger { workflowId; triggerType: 'gmailButton'; payload }`
    - `runStatus { workflowId; threadId; runId; status: RunStatus }`
    - `ping` → `pong`
  - Union types `ExtensionToServer` and `ServerToExtension` (with `buttons { items: { workflowId; label }[] }` added to the server side), and `TriggerMsg` for the `trigger` variant.
  - `resolveBindings(inputs: Record<string,string>, ctx: Record<string, unknown>): Promise<Record<string, unknown>>`
  - `evalCondition(expr: string, ctx: Record<string, unknown>): Promise<boolean>`
  - `topoOrder(wf: Workflow): string[]`: throws `Workflow has a cycle` on cycles.

- [ ] **Step 1: Write failing tests.**
  - `resolveBindings({ body: '{{trigger.email.body}}' }, { trigger: { email: { body: 'hi' } } })` → `{ body: 'hi' }`.
  - A value that is exactly one `{{expr}}` keeps the raw type (an object stays an object).
  - Mixed text interpolates as a string: `'Hi {{extract.name}}!'` → `'Hi Sarah!'`.
  - A missing path resolves to `undefined` (not a throw).
  - `evalCondition("classify.isBooking == true", …)` returns true or false.
  - `topoOrder` on trigger→a→b plus trigger→c puts trigger first and a before b.
  - `topoOrder` throws on a→b→a.
  - `Workflow.parse` rejects an edge whose `from` is not a step or trigger id (use `superRefine`).
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** Use one shared `new jexl.Jexl()`, a `/\{\{(.+?)\}\}/g` template scan, and Kahn's algorithm for `topoOrder`.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(shared): workflow, run and extension protocol schemas; jexl bindings`

### Task 4: Table store

**Files:**
- Create: `apps/server/src/db/connection.ts`, `apps/server/src/tables/store.ts`
- Test: `apps/server/test/tables.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ColumnType = 'text' | 'number' | 'boolean' | 'date' | 'email';
  interface TableDef { name: string; label: string; columns: { name: string; label: string; type: ColumnType }[]; displayField: string; keyField?: string }
  function openDb(file: string): Database   // better-sqlite3, WAL, foreign keys on
  function createTableStore(db: Database): {
    createTable(def: TableDef): TableDef;               // returns the def with sanitised names
    getTable(name: string): TableDef | undefined;
    listTables(): TableDef[];
    insert(table: string, row: Record<string, unknown>): { id: number };
    upsert(table: string, row: Record<string, unknown>, keyField: string): { id: number; created: boolean };
    query(table: string, o?: { where?: Record<string, unknown>; limit?: number }): Record<string, unknown>[];
  }
  ```
  Tables live as `t_<name>` with `id INTEGER PRIMARY KEY`, `created_at` and `updated_at`. They are registered in `_tables(name PRIMARY KEY, def JSON)`.

- [ ] **Step 1: Write failing tests.**
  - `createTable` with name `"Customers; DROP"` stores the name `customers_drop` and the table exists.
  - Column `"First Name"` becomes `first_name` and keeps `label: 'First Name'`.
  - `upsert('customers', { email: 'sarah@x.com', name: 'Sarah' }, 'email')` returns `created: true`. Running it again with `name: 'Sarah Lee'` returns `created: false` and the same id, and `query` returns 1 row named `Sarah Lee`.
  - `insert` into an unknown table throws `Unknown table: nope`.
  - Unknown columns in a row are ignored, not written.
  - `email` columns reject values without `@` with `Invalid email for column email`.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** Sanitise with lowercase, non-`[a-z0-9]` runs → `_`, and trim underscores. Prefix `c_` if the name starts with a digit. Use parameterised values only; identifiers come only from the sanitised registry.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(server): SQLite table store with sanitised dynamic tables and upsert`

### Task 5: Workflow and run persistence

**Files:**
- Create: `apps/server/src/db/schema.ts` (drizzle), `apps/server/src/db/repo.ts`
- Test: `apps/server/test/repo.test.ts`

**Interfaces:**
- Consumes: `Workflow`, `Run`, `StepRun` (Task 3); `openDb` (Task 4).
- Produces:
  ```ts
  function createRepo(db: Database): {
    saveWorkflow(wf: Workflow): Workflow;      // bumps version if the definition changed; keeps old versions
    getWorkflow(id: string, version?: number): Workflow | undefined;   // latest when no version
    listWorkflows(): Workflow[];               // latest version of each
    createRun(r: Omit<Run, 'id'|'startedAt'>): Run;
    updateRun(id: string, patch: Partial<Run>): void;
    upsertStepRun(sr: StepRun): void;
    getRun(id: string): { run: Run; steps: StepRun[] } | undefined;
    listRuns(o?: { workflowId?: string; limit?: number }): Run[];   // newest first
  }
  ```
  Tables: `workflows(id, version, def JSON, status, created_at, PK(id,version))`, `runs`, `step_runs` (JSON columns for input, output and tokens). Ids are `crypto.randomUUID()`.

- [ ] **Step 1: Write failing tests.**
  - Saving the same workflow twice unchanged keeps version 1. Changing a step title makes version 2, and `getWorkflow(id, 1)` still returns the old title.
  - `upsertStepRun` twice with the same id updates in place.
  - `listRuns` is newest first.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement with drizzle-orm/better-sqlite3.** Create tables with `CREATE TABLE IF NOT EXISTS` on startup; no migration tool in M1.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(server): workflow versions and run log persistence`

### Task 6: Step catalog and executors (ai.extract, ai.write, table.upsert, triggers)

**Files:**
- Create: `packages/shared/src/catalog.ts` (definitions: type, kind, title, config/input/output schemas)
- Create: `apps/server/src/steps/registry.ts`, `apps/server/src/steps/ai.ts`, `apps/server/src/steps/table.ts`, `apps/server/src/steps/trigger.ts`
- Test: `apps/server/test/steps.test.ts`

**Interfaces:**
- Consumes: `Gateway` (Task 2), table store (Task 4).
- Produces:
  ```ts
  // shared
  interface StepDef { type: string; kind: 'trigger'|'fetch'|'enrich'|'store'|'act'; title: string;
    configSchema: z.ZodTypeAny; inputSchema: z.ZodTypeAny; outputSchema: z.ZodTypeAny }
  const catalog: Record<string, StepDef>
  // server
  interface StepContext { gateway: Gateway; tables: TableStore; bridge: Bridge; signal: AbortSignal }
  interface StepResult { output: unknown; why: string; model?: string; tokens?: { input: number; output: number }; costUsd?: number }
  type Executor = (config: any, input: any, ctx: StepContext) => Promise<StepResult>
  const executors: Record<string, Executor>
  ```
  M1 catalog entries:
  - `trigger.gmailButton`: config `{ label }`; output `{ email: { from, fromName, subject, body, threadId } }`.
  - `trigger.manual`: output `{ payload }`.
  - `ai.extract`: config `{ instructions, fields: { name, type: ColumnType, description }[] }`; input `{ text }`; output an object with those fields.
  - `ai.write`: config `{ instructions, tone: 'friendly'|'formal'|'brief' }`; input `{ context }`; output `{ text }`.
  - `table.upsert`: config `{ table, keyField }`; input `{ row }`; output `{ id, created }`.
  - `gmail.read`: input `{ threadId }`; output matches the trigger's email.
  - `gmail.draftReply`: input `{ threadId, body }`; output `{ drafted: true }`.

  `Bridge` is defined in Task 8; Task 6 uses only its type `{ call(site, action, input, timeoutMs?): Promise<unknown> }`.

- [ ] **Step 1: Write failing tests** with a fake gateway and an in-memory table store.
  - `ai.extract` builds a zod object from `fields` and calls `chatJson` with role `builder` and a schema of `{ output: <fields object>, why: string }`. It returns the parsed output and the why.
  - When the fake gateway throws a schema error once and then succeeds, `ai.extract` succeeds; the fake was called twice.
  - When it throws twice, `ai.extract` rejects with a message starting `I couldn't read that properly:`.
  - `table.upsert` returns `why: 'Saved Sarah Lee to customers because the email address was new.'` when created, and `'Updated Sarah Lee in customers because we already knew this email address.'` when updated. The name comes from the table's `displayField`.
  - `gmail.draftReply` calls `bridge.call('gmail', 'draftReply', { threadId, body })`; `gmail.read` calls `bridge.call('gmail', 'readOpenEmail', { threadId })` and its why names the sender and subject.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** The system prompt for AI steps: "You help a small business owner. Reply only with the JSON schema given. `why` is one plain-English sentence explaining what you did and why, with no jargon." Retry once on schema errors only, with backoff of 500 ms.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat: step catalog and executors for flow 1`

### Task 7: Engine

**Files:**
- Create: `apps/server/src/engine/engine.ts`, `apps/server/src/engine/events.ts`
- Test: `apps/server/test/engine.test.ts`

**Interfaces:**
- Consumes: `topoOrder`, `resolveBindings`, `evalCondition` (Task 3); repo (Task 5); `executors`, `catalog`, `StepContext` (Task 6).
- Produces:
  ```ts
  type EngineEvent = { type: 'run'; run: Run } | { type: 'step'; stepRun: StepRun };
  function createEngine(d: { repo: Repo; executors: Record<string, Executor>; ctx: Omit<StepContext,'signal'> }): {
    start(workflowId: string, triggerPayload: unknown): Promise<Run>;   // resolves when the run finishes
    events: EventEmitter;   // emits 'event' with EngineEvent
  }
  ```
  Binding context for a step is `{ trigger: <trigger output>, <stepId>: <output>, … }` for each step that has finished.

- [ ] **Step 1: Write failing tests** with fake executors and an in-memory repo.
  - Linear trigger→a→b runs in order. Each step's StepRun is saved as `running` and then `done` with input, output, why and durationMs, and the run ends `done`.
  - Independent branches trigger→a and trigger→b start concurrently (both fakes awaited on a shared latch, and the test resolves).
  - An edge `when: "a.ok == false"` that evaluates false marks the target and everything only reachable through it `skipped`, with `why: 'Skipped because the condition "a.ok == false" was not met.'`
  - Step a throws `Boom`: a is `failed` with `error: 'Boom'`, b (which depends on a) stays `pending`, the run is `failed`, and other branches still finish.
  - The output is validated against the step's `outputSchema`; a mismatch fails the step.
  - `events` emits a `step` event for every StepRun change.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** Use a ready-set loop: a step becomes ready when all of its incoming edges come from `done` or `skipped` steps. If every incoming edge is from a skipped step or has a false condition, it becomes skipped. Run ready steps with `Promise.all` per wave. Validate input against `inputSchema` before running, and output after.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(server): DAG engine with step run log, branches and skip propagation`

### Task 8: Extension bridge (server side) and pairing

**Files:**
- Create: `apps/server/src/bridge/bridge.ts`, `apps/server/src/bridge/pairing.ts`
- Modify: `apps/server/src/app.ts` (add `/ext` WebSocket via `@hono/node-ws`, `POST /api/pairing/start`, `GET /api/pairing/status`)
- Test: `apps/server/test/bridge.test.ts`

**Interfaces:**
- Consumes: protocol schemas (Task 3).
- Produces:
  ```ts
  interface Bridge {
    call(site: 'gmail'|'calendar'|'meta', action: string, input: unknown, timeoutMs?: number): Promise<unknown>;
    connected(): boolean;
    send(msg: ServerToExtension): void;            // e.g. runStatus, buttons
    onTrigger(fn: (t: TriggerMsg) => void): void;
    onReady(fn: () => void): void;                // after a successful hello
  }
  function createBridge(o: { pairing: Pairing; defaultTimeoutMs?: number }): Bridge & { attach(ws: WSContext): void }
  function createPairing(store: { get(k: string): string | undefined; set(k: string, v: string): void }): {
    start(): { code: string };        // 6 digits, valid 10 minutes
    redeem(code: string): string | null;   // returns token
    isValid(token: string): boolean;
  }
  ```
  The token is persisted in a `settings` key-value table.

- [ ] **Step 1: Write failing tests** with a real server on a random port and a `ws` client.
  - `call` with no extension connected rejects immediately with `I need Gmail open in Chrome to do this.` (site name capitalised per site: Gmail, Google Calendar, Meta Business Suite).
  - `call` with a connected client that never answers rejects after `timeoutMs: 100` with the same message.
  - The client answers `result {ok:false,error:'No reply button'}` → `call` rejects with `No reply button`.
  - A socket sending `hello` with a bad token is closed with code 4401.
  - `pair` with the right code returns `paired { token }`, and a later `hello` with that token gets `ready`.
  - `ping` gets `pong`.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** Keep pending calls in a `Map<id, {resolve, reject, timer}>`. One active socket; a new valid `hello` replaces the old socket.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(server): extension bridge over WebSocket with pairing and timeouts`

### Task 9: Gmail button trigger wiring and the flow 1 seed

**Files:**
- Create: `apps/server/src/triggers/gmailButton.ts`, `apps/server/src/seed/flow1.json`, `apps/server/src/main.ts` (composition root: db, tables, repo, gateway, bridge, engine, triggers)
- Modify: `apps/server/src/index.ts` (use `main.ts`), `apps/server/src/app.ts` (routes below)
- Test: `apps/server/test/gmailButton.test.ts`

**Interfaces:**
- Consumes: bridge (Task 8), engine (Task 7), repo (Task 5).
- Produces:
  - `registerGmailButtonTrigger(d: { bridge; engine; repo }): void`:
    - **On `ready`:** sends a `buttons` message listing every workflow with `status: 'on'` whose trigger is `trigger.gmailButton`.
    - **On `trigger`:** starts a run. While one is `running`/`waiting` for the same `workflowId + threadId`, it ignores further clicks.
    - **Status updates:** forwards each run status change as `runStatus`.
  - Routes:
    - `GET /api/workflows`
    - `GET /api/runs?workflowId=`
    - `GET /api/runs/:id` (returns `{ run, steps }`)
    - `GET /api/events` (SSE stream of `EngineEvent`)
  - `flow1.json` is seeded on startup if no workflows exist: id `flow-1`, status `on`, trigger `trigger.gmailButton` with label "✨ Save as lead & reply", then these steps:
    1. `extract` (`ai.extract`): fields `name: text`, `email: email`, `need: text`, `urgency: text`; input `text: "From {{trigger.email.fromName}} <{{trigger.email.from}}>\nSubject: {{trigger.email.subject}}\n\n{{trigger.email.body}}"`
    2. `save` (`table.upsert`): table `customers`, keyField `email`, input `row: "{{extract}}"`
    3. `write` (`ai.write`): tone `friendly`, instructions "Write a short, warm reply that thanks them and says we'll get back to them about their need within one business day. Sign off as the owner.", input `context: "{{extract}}"`
    4. `draft` (`gmail.draftReply`): input `threadId: "{{trigger.email.threadId}}"`, `body: "{{write.text}}"`

    Seeding also creates the `customers` table (columns name, email, need, urgency; displayField `name`; keyField `email`) if missing.

- [ ] **Step 1: Write failing tests** with a fake bridge and engine.
  - Two `trigger` messages for the same thread while the first run is pending → `engine.start` is called once.
  - After the first run finishes, a new click starts a new run.
  - On `ready`, the bridge receives `buttons` with `[{ workflowId: 'flow-1', label: '✨ Save as lead & reply' }]`.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement the trigger, the routes and `main.ts`.** The SSE route uses Hono's `streamSSE` and subscribes to `engine.events`.
- [ ] **Step 4: Run them; expect PASS. Then `pnpm --filter @dad/server dev`; `curl 127.0.0.1:8787/api/workflows` shows flow-1.**
- [ ] **Step 5: Commit** `feat(server): Gmail button trigger, flow 1 seed, run and SSE routes`

### Task 10: Chrome extension: connection, pairing and the Gmail adapter

**Files:**
- Create: `apps/extension/entrypoints/background.ts`, `apps/extension/entrypoints/popup/{App.tsx,main.tsx,index.html}`, `apps/extension/entrypoints/gmail.content.ts`
- Create: `apps/extension/lib/gmail/{selectors.ts,read.ts,draftReply.ts,button.ts}`
- Create: `apps/extension/test/fixtures/gmail-thread.html` (save a real open thread from the test Gmail account with DevTools "Copy outerHTML" of `div[role=main]`; remove anything private)
- Test: `apps/extension/test/gmail.test.ts` (Vitest + jsdom)

**Interfaces:**
- Consumes: protocol schemas (Task 3).
- Produces:
  ```ts
  function readOpenEmail(doc: Document): { from: string; fromName: string; subject: string; body: string; threadId: string }
  function draftReply(doc: Document, body: string): Promise<{ drafted: true }>
  function injectButtons(doc: Document, buttons: { workflowId: string; label: string }[], onClick: (workflowId: string) => void): void
  function setButtonStatus(doc: Document, workflowId: string, status: RunStatus): void
  ```
  - Manifest: `host_permissions: ['https://mail.google.com/*', 'http://127.0.0.1:8787/*']`, `permissions: ['storage', 'tabs']`.
  - The background script holds the WebSocket. It reconnects with backoff (1, 2, 5, 10 s), pings every 20 s, routes `cmd` to the Gmail tab via `chrome.tabs.sendMessage`, and relays `trigger` from content scripts.
  - The token is stored in `chrome.storage.local`.

- [ ] **Step 1: Write failing tests** against the fixture.
  - `readOpenEmail` returns the subject, sender email/name, body text (trimmed, without quoted history), and `threadId` from the fixture's `data-legacy-thread-id`.
  - `injectButtons` adds exactly one button with text `✨ Save as lead & reply` to the message toolbar. Calling it twice still leaves one.
  - `setButtonStatus(..., 'running')` shows a pill with text `Working…`; `'done'` shows `✓ Done`; `'failed'` shows `Needs a look`.
  - `draftReply` clicks the Reply control and fills the `contenteditable` message body (`div[aria-label="Message Body"]`) with the text. Assert on the DOM after clicking: the fixture includes the reply box markup.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** Keep all selectors in `selectors.ts`. Starting points (verify against the fixture):
  - subject `h2.hP`
  - sender `span.gD` (`email` attribute and text)
  - body: last `div.a3s` in the thread
  - thread id: `h2.hP[data-legacy-thread-id]`
  - reply control `[role=button][data-tooltip^="Reply"]` or `span.ams.bkH`
  - toolbar: the message header actions container next to the reply arrow

  A `MutationObserver` re-injects buttons when Gmail navigates between threads. Popup: when unpaired, a 6-digit input sends `pair`; when paired, it shows "Connected ✓" or "Not connected", plus "Open the app" linking `http://localhost:5173`.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(extension): background socket, pairing popup, Gmail read/draft/button adapter`

### Task 11: Bare run log page and the end-to-end check

**Files:**
- Create: `apps/web/src/api.ts`, `apps/web/src/RunLog.tsx`, `apps/web/src/Pairing.tsx`
- Create: `scripts/run-flow1.ts` (boots the server composition root from `apps/server/src/main.ts` and calls `engine.start('flow-1', <canned email payload>)`)
- Modify: `apps/web/src/App.tsx`, `apps/web/vite.config.ts` (proxy `/api` → `http://127.0.0.1:8787`)
- Test: `apps/web/src/RunLog.test.tsx` (Vitest + @testing-library/react)

**Interfaces:**
- Consumes: `GET /api/runs`, `GET /api/runs/:id`, `GET /api/events`, `POST /api/pairing/start`, `GET /api/pairing/status` (Tasks 8–9).
- Produces: a single page with two parts. No styling work; that's M2/M5.
  - **Pairing card:** "Connect Chrome" button → shows the 6-digit code → shows "Connected ✓" once paired.
  - **Run log:** newest run first. Each run expands to its steps in topological order, showing the step title, status, `why`, model, cost, and collapsible input/output JSON. It refreshes live from SSE.

- [ ] **Step 1: Write a failing test.** Render `RunLog` with a mocked fetch for one run with steps `extract` (done, why "Found Sarah's name and email.") and `draft` (failed, error "I need Gmail open in Chrome to do this."). Assert both texts are visible and the failed step has `data-status="failed"`.
- [ ] **Step 2: Run it; expect FAIL.**
- [ ] **Step 3: Implement `api.ts` (fetch helpers plus an `EventSource` hook), `RunLog`, `Pairing` and `App`.**
- [ ] **Step 4: Run it; expect PASS.**
- [ ] **Step 5: End-to-end manual check** with the test Gmail account:
  1. `pnpm dev`, open `localhost:5173`, click Connect Chrome, enter the code in the extension popup → "Connected ✓".
  2. Send the test account an email from another address: "Hi, I'm Sarah Lee, I'd like a quote for a new fence. Can you call me this week?"
  3. Open it in Gmail → the "✨ Save as lead & reply" button is visible. Click it → pill shows `Working…` then `✓ Done`.
  4. Gmail shows a reply draft addressed to Sarah, written warmly.
  5. The run log shows 5 steps done, each with a why and the AI steps with cost.
  6. `sqlite3 data/app.db "select name,email,need from t_customers"` shows Sarah.
  7. Click the button again on the same email → still one row for Sarah (upsert), a second run in the log.
  8. Disable the extension, then run `pnpm tsx scripts/run-flow1.ts` (starts flow-1 through `engine.start` with a canned email payload) → `extract`, `save` and `write` are done, `draft` fails with "I need Gmail open in Chrome to do this.", and the log shows it.
- [ ] **Step 6: Commit** `feat(web): pairing and live run log; flow 1 works end to end`
