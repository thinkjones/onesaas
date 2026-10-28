# M4: Flows 2 and 4, Connectors, Media and Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The builder can produce all three demo flows from plain speech: flow 1 (already working), flow 2 (booking request email → classify → extract date/time → check Calendar → save booking → create Calendar event + draft confirmation) and flow 4 (flow 1 plus a new-customer branch, and photo → SAM cutout → Muse Image post → Meta Business Suite prepared). Lists can be browsed as grid, cards or stats, and pinned.

**Architecture:** The extension gains a Calendar adapter (URL template first), a Meta Business Suite adapter (fill and hand off), an inbox watcher for `trigger.email`, a hidden worker tab for background reads, and a screenshot action. The server gains a Spark vision fallback for reads, `ai.classify`, Calendar and Meta steps, file storage, the image steps (SAM 3.1, Muse Image) and saved views. Email triage runs on the `triage` model role so M5 can switch it to Glimmer.

**Tech Stack:** M3 stack plus `sharp` (mask compositing), `@tanstack/react-table` 8, `react-dropzone`.

**Spec:** `AgenticHarness/docs/meta-ai-hackathon-my-dads-ai-agent/plans/2026-10-28-dads-ai-agent-design.md` (sections 5 catalog, demo flows, tables, views; 8 reliability ladder).

**Depends on:** M1–M3. Uses `Bridge`, protocol schemas, `Executor`/`preview`, `testMode`, `WorkflowOps`, `checkWorkflow`, `builderTools`, `examples.ts`, `scripts/eval-builder.ts`, `Gateway`, `createTableStore`, `Inspector`.

## Global Constraints

- All earlier global constraints still apply.
- Reliability ladder for every extension action, in order: URL-based, then page selectors, then screenshot + Spark vision (reads only), then hand off to Dad. Actions never click Send, Publish or Post.
- Dates are stored as ISO 8601 with offset in the business timezone (`settings.timezone`, IANA name). AI steps get the current date, weekday and timezone in their system prompt.
- Files live in `data/files/<id>.<ext>` and are served only on `127.0.0.1` at `/api/files/:id`.
- SAM model `sam-3.1` via `POST /v1/responses`; Muse Image `muse-image-1.0` via `/v1/images/generations` and `/v1/images/edits`. Request shapes follow the M1 smoke script, which recorded what the API actually accepts.
- Vision fallback uses role `vision` (`muse-spark-1.3`) with an `image_url` data-URL content part.
- `trigger.email` only fires while a Gmail tab is open. The UI says so on that trigger's box: "Works while Gmail is open in Chrome."

## Review Focus

- The same new email is seen twice (Gmail re-renders the inbox, or the extension reconnects): only one run starts for a thread id (test in Task 3).
- A booking request with a relative time ("next Tuesday at 3") is extracted relative to the business timezone and today's date, not UTC (test in Task 4).
- A photo where SAM finds nothing for the prompt: `image.cutout` fails with "I couldn't find the <thing> in this photo. Try a clearer photo or a different word." instead of returning an empty image (test in Task 6).
- The Calendar day view's markup changes and the selector finds no events container: `calendar.freeBusy` falls back to a screenshot read and its why says "I read your calendar from a screenshot because the page looked different." (test in Task 2).
- Dad drops a HEIC or 20 MB photo: it's converted to JPEG and resized to at most 2048 px before any model call; non-images are rejected with "That doesn't look like a photo." (test in Task 6).

---

### Task 1: Protocol error codes, worker tab and screenshot action

**Files:**
- Modify: `packages/shared/src/protocol.ts`, `apps/server/src/bridge/bridge.ts`, `apps/extension/entrypoints/background.ts`
- Create: `apps/extension/lib/tabs.ts`
- Test: `apps/server/test/bridge-errors.test.ts`, `apps/extension/test/tabs.test.ts`

**Interfaces:**
- Produces:
  - `result` failures become `{ id; ok: false; error: string; code?: 'SELECTOR_MISSING' | 'NOT_OPEN' | 'TIMEOUT' | 'HANDOFF' }`.
  - `bridge.call` rejects with `BridgeError extends Error { code?: string }`. Existing string messages are unchanged.
  - New `cmd` options: `{ tab?: 'worker' | 'active' }` (default `active`).
    - `worker` uses one pinned, inactive tab per site, created on demand and reused, so background reads don't move Dad's view.
    - `active` focuses or opens a visible tab.
  - Background action `screenshot` with input `{ site, url? }` (`site: 'browser'`): navigates the site's worker tab to `url` if given, briefly activates it, then calls `chrome.tabs.captureVisibleTab` and returns `{ dataUrl }` (PNG). The tab is restored afterwards.
  - Server helper:
    ```ts
    function withVisionFallback<T>(o: { bridge; gateway; site; action; input; screenshotUrl?: string; prompt: string; schema: z.ZodType<T> }): Promise<{ data: T; viaScreenshot: boolean; model?: string; costUsd?: number }>
    ```
    Calls the action; on `code === 'SELECTOR_MISSING'` it takes a screenshot and calls `gateway.visionJson`.
  - Gateway addition: `visionJson<T>(o: { role: 'vision'; prompt: string; imageDataUrl: string; schema; schemaName }): Promise<ChatJsonResult<T>>`.
  - Manifest adds `permissions: ['activeTab', 'scripting']`, `host_permissions` `https://calendar.google.com/*` and `https://business.facebook.com/*`.

- [ ] **Step 1: Write failing tests.**
  - The bridge maps `{ok:false, code:'SELECTOR_MISSING'}` to a `BridgeError` with that code.
  - `withVisionFallback` with a fake bridge that fails with `SELECTOR_MISSING` and a fake gateway returns `viaScreenshot: true` and the gateway data. With a successful bridge it never calls the gateway.
  - `getWorkerTab('calendar')` called twice creates one tab (mock `chrome.tabs`).
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat: extension error codes, worker tabs, screenshot and vision fallback`

### Task 2: Calendar adapter and steps

**Files:**
- Create: `apps/extension/lib/calendar/{selectors.ts,freeBusy.ts,createEvent.ts}`, `apps/extension/entrypoints/calendar.content.ts`, `apps/extension/test/fixtures/calendar-day.html` (save a real day view from the test account)
- Create: `apps/server/src/steps/calendar.ts`
- Modify: `packages/shared/src/catalog.ts`, `apps/server/src/steps/registry.ts`
- Test: `apps/extension/test/calendar.test.ts`, `apps/server/test/steps-calendar.test.ts`

**Interfaces:**
- Produces:
  - Extension: `readDayEvents(doc): { title: string; start: string; end: string }[]` (from each event element's `aria-label`/`data-eventid`); throws `SELECTOR_MISSING` when the grid container isn't found.
  - Extension: `createEventUrl(o: { title; start; end; details?; timezone }): string`, which returns `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=<YYYYMMDDTHHmmss>/<…>&ctz=<tz>&details=…`.
  - Extension: `saveTemplateEvent(doc): Promise<void>`, which clicks the Save button (`[aria-label="Save"]` or a button with text "Save").
  - Catalog `calendar.freeBusy` (kind `fetch`): config `{}`; input `{ start: string; end: string }` (ISO); output `{ free: boolean; clashes: { title; start; end }[] }`.
    - It runs in the worker tab on the day view URL `https://calendar.google.com/calendar/r/day/YYYY/M/D`.
    - Vision fallback prompt: "List every event visible on this calendar day with start and end times."
    - why: `You're free then.` or `That clashes with "<title>" at <h:mm a>.`, plus the screenshot sentence when `viaScreenshot` is true.
  - Catalog `calendar.createEvent` (kind `act`): config `{ titleTemplate?: string }`; input `{ title, start, end, details? }`; output `{ created: boolean }`.
    - It opens the template URL in the **active** tab and clicks Save; if Save isn't found it returns `{ created: false }` with code `HANDOFF` and why `I've filled in the event; press Save in Google Calendar.`
    - Preview: `In a real run I would add "<title>" to your calendar on <date> at <time>.`

- [ ] **Step 1: Write failing tests.**
  - `readDayEvents` on the fixture returns the fixture's events.
  - On a doc without the grid it throws an error with `code: 'SELECTOR_MISSING'`.
  - `createEventUrl({ title: 'Fence quote – Sarah', start: '2026-11-03T15:00:00-08:00', end: '2026-11-03T16:00:00-08:00', timezone: 'America/Los_Angeles' })` contains `dates=20261103T150000/20261103T160000` and `ctz=America%2FLos_Angeles`.
  - The `calendar.freeBusy` executor with a fake bridge returning one overlapping event gives `free: false` and the clash why.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them; expect PASS. Manually: run the `calendar.createEvent` executor via a scratch script; a real event appears in the test calendar.**
- [ ] **Step 5: Commit** `feat: Google Calendar free/busy and create-event steps via extension`

### Task 3: Email trigger, triage and classify

**Files:**
- Create: `apps/extension/lib/gmail/inboxWatcher.ts`, `apps/server/src/triggers/email.ts`, `apps/server/src/steps/classify.ts`
- Modify: `apps/extension/entrypoints/gmail.content.ts`, `packages/shared/src/protocol.ts` (`trigger.triggerType` adds `'email'`), `packages/shared/src/catalog.ts`, `apps/server/src/db/schema.ts` (table `seen_emails(thread_id PK, seen_at)`), `apps/server/src/main.ts`
- Test: `apps/extension/test/inboxWatcher.test.ts`, `apps/server/test/trigger-email.test.ts`, `apps/server/test/steps-classify.test.ts`

**Interfaces:**
- Produces:
  - **Extension:** `watchInbox(doc, emit: (e: { threadId; from; fromName; subject; snippet }) => void): () => void`.
    - It observes unread inbox rows (`tr.zA.zE`) and emits each new thread id once per page session.
    - The content script sends `trigger { triggerType: 'email', workflowId: '*', payload }`, and the server fans it out.
  - **Catalog `trigger.email`:** config `{ onlyCustomerEmails: boolean (default true), matching?: string }`; output `{ email: { threadId, from, fromName, subject, snippet } }`; `sample` is a booking-request email.
  - **Server:** `registerEmailTrigger(d: { bridge; engine; repo; gateway; db })`. For each incoming email:
    1. Insert into `seen_emails`; skip if it's already there.
    2. For each workflow that is `on` with a `trigger.email`:
       - If `matching` is set, the subject or snippet must contain it (case-insensitive).
       - If `onlyCustomerEmails` is set, call `gateway.chatJson({ role: 'triage', schema: { isCustomer: boolean, why: string } })` with the subject and snippet only.
       - Start the run if it passes.
  - **Catalog `ai.classify` (kind `enrich`):** config `{ question: string; options: string[] (default ['yes','no']) }`; input `{ text }`; output `{ choice: string }`, with `choice` constrained to `options` via a zod enum built at run time. Conditions use `{{classify.choice}}`, e.g. `when: "classify.choice == 'yes'"`.
  - `ai.extract` and `ai.write` system prompts gain `Today is <weekday, d MMMM yyyy>, the time is <h:mm a>, timezone <tz>. Resolve relative dates against this.`
  - `ColumnType` gains `'datetime'`, stored as ISO with offset; the table store validates it with `Date.parse`.

- [ ] **Step 1: Write failing tests.**
  - `watchInbox` on a fixture with two unread rows emits 2 events. Re-rendering the same rows (replace the tbody) emits nothing new.
  - The server trigger handling the same threadId twice starts one run.
  - Triage returning `isCustomer:false` starts no run.
  - `ai.classify` rejects a model choice outside `options` (schema error → one retry → readable failure).
  - `ai.extract` with a fixed clock (`2026-10-30T10:00` America/Los_Angeles, Friday) passes a system prompt containing `Friday, 30 October 2026` (assert on the fake gateway's prompt).
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** Inject the clock into `StepContext` as `now(): Date` and `timezone: string` (from `settings`; default `Intl.DateTimeFormat().resolvedOptions().timeZone`) so tests can fix it. The web app posts the browser's timezone to `PUT /api/settings` (`{ timezone }`) on first load if none is stored.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat: new-email trigger with dedupe and triage; classify step; timezone-aware AI steps`

### Task 4: table.insert, table.query and flow 2 in the builder

**Files:**
- Modify: `packages/shared/src/catalog.ts`, `apps/server/src/steps/table.ts`, `apps/server/src/agent/examples.ts`, `scripts/eval-builder.ts`
- Modify: `apps/web/src/canvas/FlowEdge.tsx` and `apps/web/src/design/ConfigForm.tsx` (edit an edge's condition: click the edge in design mode → popover "Only continue when…" with a picker of the upstream classify step's options)
- Test: `apps/server/test/steps-table.test.ts` (extend), `apps/web/src/canvas/FlowEdge.test.tsx`

**Interfaces:**
- Produces:
  - Catalog `table.insert` (kind `store`): config `{ table }`; input `{ row }`; output `{ id }`; why `Added <display> to <table label>.`
  - Catalog `table.query` (kind `fetch`): config `{ table, limit (default 20) }`; input `{ where?: object }`; output `{ rows: object[]; count: number }`; why `Found <count> in <table label>.`
  - **Flow 2 worked example** in `examples.ts`. The user sentence is "When someone emails asking to book a time, check my calendar, save the booking and put it in my calendar, then draft a confirmation for me to check." The tool sequence:
    1. `create_table` Bookings: name text, email email, service text, start datetime, end datetime, status text; display `name`.
    2. `set_trigger trigger.email`.
    3. `gmail.read` (full body via the worker tab).
    4. `ai.classify` "Is this asking to book an appointment?"
    5. A conditional edge `classify.choice == 'yes'` to `ai.extract` (name, email, service, start, end).
    6. `calendar.freeBusy`.
    7. `table.insert` Bookings.
    8. `calendar.createEvent`.
    9. `ai.write` (confirm, or offer another time when `freeBusy.free` is false).
    10. `approval.ask`.
    11. `gmail.draftReply`.
  - The eval script gains a flow 2 case that asserts the step types above, the conditional edge and an empty `checkWorkflow`.

- [ ] **Step 1: Write failing tests.**
  - `table.insert` adds a row and returns the why.
  - `table.query` with `where: { status: 'confirmed' }` returns the matching count.
  - FlowEdge shows the condition pill "Only if: yes", and editing it calls `connect` with `when: "classify.choice == 'yes'"` (re-connect replaces the edge).
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** `gmail.read` gains `tab: 'worker'` support: navigate the worker tab to `https://mail.google.com/mail/u/0/#all/<threadId>` and read it there.
- [ ] **Step 4: Run them; expect PASS. Run `pnpm tsx scripts/eval-builder.ts`; flows 1 and 2 PASS 3 times in a row (tune the prompt or examples, not the eval).**
- [ ] **Step 5: End-to-end check:**
  1. Build flow 2 from the sentence in the agent panel and turn it on.
  2. Send the test inbox "Hi, could I book a fence quote next Tuesday at 3pm? – Bob".
  3. With Gmail open, a run starts by itself. Classify "yes", free/busy shows free, the booking is saved with next Tuesday's date at 15:00 local time, and the approval card shows the confirmation.
  4. Approve → the event is in Google Calendar and the draft is in Gmail.
  5. Send "Thanks for the invoice" → no run starts (triage), or the run skips after classify.
- [ ] **Step 6: Commit** `feat: insert/query list steps, editable conditions, flow 2 buildable from speech`

### Task 5: File storage and the upload trigger

**Files:**
- Create: `apps/server/src/files/store.ts`, `apps/server/src/triggers/upload.ts`
- Modify: `apps/server/src/db/schema.ts` (table `files(id PK, path, mime, width, height, source, created_at)`), `apps/server/src/app.ts`, `packages/shared/src/catalog.ts`
- Create: `apps/web/src/design/UploadDrop.tsx`; modify `apps/web/src/pages/WorkflowPage.tsx` (drop zone shown in runtime mode for workflows whose trigger is `trigger.upload`) and `apps/web/src/runtime/Inspector.tsx` (render `{ fileId }` values as thumbnails)
- Test: `apps/server/test/files.test.ts`, `apps/web/src/design/UploadDrop.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  interface FileRef { fileId: string; mime: string; width?: number; height?: number }
  function createFileStore(d: { db; dir: string }): {
    saveUpload(buf: Buffer, mime: string): Promise<FileRef>;   // images → JPEG/PNG ≤2048px; others rejected
    saveGenerated(buf: Buffer, mime: string, source: string): Promise<FileRef>;
    read(fileId: string): Promise<{ buf: Buffer; mime: string }>;
    dataUrl(fileId: string): Promise<string>;
  }
  ```
  - Routes: `POST /api/files` (multipart, field `file`) → `FileRef`; `GET /api/files/:id`; `POST /api/workflows/:id/upload` (multipart) → saves the file and starts a run with `{ file: FileRef, note?: string }`.
  - Catalog `trigger.upload`: config `{ prompt: string (default 'Drop a photo here') }`; output `{ file: FileRef; note?: string }`; `sample` is a bundled sample photo, `apps/server/assets/sample-mug.jpg` (your own photo).
  - Inspector renders any object with a `fileId` as an `<img src="/api/files/<id>">` thumbnail (max 240 px) that opens full size on click.

- [ ] **Step 1: Write failing tests.**
  - `saveUpload` of a 4000×3000 JPEG returns width 2048.
  - A HEIC fixture is converted to `image/jpeg` (sharp with HEIF support; if the local sharp build lacks HEIF, assert the readable error `I can't open that photo type yet. Try a JPEG or PNG.`).
  - A PDF is rejected with `That doesn't look like a photo.`
  - UploadDrop accepts a dropped image and calls the upload mutation.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** Use `sharp(buf).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })`.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat: local file store, upload trigger and image thumbnails in the inspector`

### Task 6: Image steps: SAM 3.1 cutout and Muse Image

**Files:**
- Create: `apps/server/src/models/image.ts`, `apps/server/src/steps/image.ts`
- Modify: `packages/shared/src/catalog.ts`, `apps/server/src/steps/registry.ts`
- Test: `apps/server/test/steps-image.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function createImageModels(d: { client: OpenAI; fetch: typeof fetch; apiKey: string }): {
    segment(o: { imageDataUrl: string; prompt: string }): Promise<{ masks: { box: [number,number,number,number]; maskPng: Buffer; score: number }[] }>;  // sam-3.1 via /v1/responses
    generate(o: { prompt: string; references?: string[] /* data URLs */ }): Promise<Buffer>;   // muse-image-1.0
    edit(o: { imageDataUrl: string; instruction: string }): Promise<Buffer>;
  }
  ```
  - Catalog `image.cutout` (kind `enrich`): config `{ thing: string }` (e.g. "mug"); input `{ file: FileRef }`; output `{ file: FileRef }` (transparent PNG cropped to the best mask's box); why `Cut the <thing> out of your photo.` With no masks it fails with `I couldn't find the <thing> in this photo. Try a clearer photo or a different word.`
  - Catalog `image.generate` (kind `enrich`): config `{ style: string }` (e.g. "bright, friendly Instagram post for a family hardware store"); input `{ text?: string; reference?: FileRef }`; output `{ file: FileRef }`; why `Made a new picture: <style>.`
  - Catalog `image.edit` (kind `enrich`): config `{ instruction }`; input `{ file }`; output `{ file }`.
  - Cost: Muse Image $0.01 per image; SAM $0.0025 per image. Both are recorded in StepRun `costUsd`; add them to `pricing.ts` as per-call prices.

- [ ] **Step 1: Write failing tests** with a fake `image` models object and sharp on a generated 100×100 image.
  - `image.cutout` applies the mask: the output PNG has alpha 0 outside the mask and is cropped to the box size.
  - No masks → the exact failure message.
  - `image.generate` passes the cutout as a reference data URL and stores the result via `saveGenerated` with source `muse-image`.
  - Costs are recorded as 0.0025 and 0.01.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement `createImageModels` from the shapes recorded in `scripts/smoke-models.ts`, and the executors.** Compositing: `sharp(original).ensureAlpha().joinChannel(maskAsSingleChannel)`, then `.extract(box)`.
- [ ] **Step 4: Run them; expect PASS. Manually: a scratch script runs cutout → generate on `sample-mug.jpg` and saves both files; view them.**
- [ ] **Step 5: Commit** `feat: SAM 3.1 cutout and Muse Image generate/edit steps`

### Task 7: Meta Business Suite prepare-to-post and flow 4

**Files:**
- Create: `apps/extension/lib/meta/{selectors.ts,draftPost.ts}`, `apps/extension/entrypoints/meta.content.ts`, `apps/extension/test/fixtures/meta-composer.html`
- Create: `apps/server/src/steps/meta.ts`
- Modify: `packages/shared/src/catalog.ts`, `apps/server/src/agent/examples.ts`, `scripts/eval-builder.ts`
- Test: `apps/extension/test/meta.test.ts`, `apps/server/test/steps-meta.test.ts`

**Interfaces:**
- Produces:
  - Extension `prepareDraftPost(doc, o: { text: string; imageDataUrl?: string }): Promise<{ textFilled: boolean; imageCopied: boolean }>`. It fills the composer's contenteditable, writes the image to the clipboard with `ClipboardItem({'image/png': blob})`, and shows an overlay pointing at the media area: "Your photo is copied. Click here and press ⌘V, then Publish when you're happy."
  - Catalog `meta.draftPost` (kind `act`): input `{ text: string; image?: FileRef }`; output `{ prepared: true }`.
    - It opens `https://business.facebook.com/latest/composer` in the **active** tab.
    - why: `Prepared the post in Meta Business Suite; paste the photo and press Publish.`
    - Preview: `In a real run I would open a new post in Meta Business Suite with this text and photo.`
  - **Flow 4 worked example** in `examples.ts`. The sentence is "When a new customer emails, do what you did before, and also let me drop in a product photo to turn into a post for Facebook and Instagram." It produces:
    - **The email branch:** flow 1 plus `ai.classify` "Is this person new?" using `table.query` on customers by email, with a `when` edge to a `notify` step ("New customer: <name>").
    - **The photo branch:** a separate workflow with `trigger.upload` → `image.cutout` → `image.generate` → `ai.write` (caption) → `table.insert` Posts (caption text, image file id, created datetime) → `approval.ask` → `meta.draftPost`.
    - The agent creates the two workflows in sequence; add a `create_workflow` tool (`{ name, description }` → `WorkflowOps.create`, switching the conversation's target workflow, and the web app navigates on an `agent` event `{ type: 'switched', workflowId }`).
  - Catalog `notify` (kind `act`): input `{ text }`; emits an in-app toast via `/api/events` (`{ type: 'notify', text }`) and leaves the run `done`.
  - The eval script gains a flow 4 case: two workflows, with step types as above.

- [ ] **Step 1: Write failing tests.**
  - `prepareDraftPost` on the fixture fills the composer text and adds the overlay (clipboard mocked).
  - The server executor calls the bridge with `tab: 'active'`, returns the why, and in test mode returns the preview without calling the bridge.
  - `create_workflow` emits `switched`.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them; expect PASS. `pnpm tsx scripts/eval-builder.ts`: flows 1, 2 and 4 PASS 3 times in a row.**
- [ ] **Step 5: End-to-end check:** build flow 4 from speech-like text, turn both on, and drop the mug photo. You see the cutout, then the generated post image and caption in the inspector, then approve. Meta Business Suite opens with the caption filled and the paste hint, and ⌘V pastes the image.
- [ ] **Step 6: Commit** `feat: Meta Business Suite prepare-to-post, notify step, flow 4 buildable from speech`

### Task 8: Lists screen and views

**Files:**
- Create: `apps/server/src/views/store.ts`; modify `apps/server/src/db/schema.ts` (table `views(id PK, table_name, kind, config JSON, pinned, title)`), `apps/server/src/app.ts`, `apps/server/src/agent/tools.ts` (`pin_view`)
- Create: `apps/web/src/lists/{ListsPage.tsx,GridView.tsx,CardsView.tsx,StatView.tsx,ViewRenderer.tsx}`; modify `apps/web/src/pages/ListsPage.tsx`
- Test: `apps/server/test/views.test.ts`, `apps/web/src/lists/StatView.test.tsx`, `apps/web/src/lists/GridView.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  type ViewKind = 'grid' | 'cards' | 'stat';
  interface ViewDef { id: string; table: string; kind: ViewKind; title: string; pinned: boolean;
    config: { columns?: string[]; stat?: { op: 'count' | 'sum'; column?: string; where?: Record<string, unknown>; sinceDays?: number } } }
  function createViewStore(d: { db; tables }): { list(): ViewDef[]; save(v: Omit<ViewDef,'id'> & { id?: string }): ViewDef; remove(id: string): void; compute(v: ViewDef): { rows?: object[]; value?: number } }
  ```
  - Routes: `GET /api/lists` (tables with row counts), `GET /api/lists/:table/rows?limit&offset`, `GET /api/views`, `POST /api/views`, `DELETE /api/views/:id`, `GET /api/views/:id/data`.
  - Agent tool `pin_view` with args `ViewDef` minus id → `save({ …, pinned: true })`; result `Pinned "<title>" to your home screen.`
  - **Lists page:** left, a list of lists with counts; right, the selected list as a GridView (TanStack Table, sortable, column labels from `TableDef`, datetimes formatted in the business timezone, file ids as thumbnails), with a toggle for Cards (displayField as the title plus 3 more fields) and a "Pin a number" button that builds a stat view (count, or sum of a number column, optional "in the last N days").
  - Every list gets a grid view automatically; there's no need to save one.

- [ ] **Step 1: Write failing tests.**
  - `compute` for `{ op: 'count', sinceDays: 7 }` counts only rows with `created_at` in the last 7 days (fixed clock).
  - `{ op: 'sum', column: 'amount' }` sums.
  - StatView renders the value large with the title.
  - GridView renders column labels (not sanitised names), e.g. "First Name".
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them; expect PASS. Manually: ask the agent "How many new customers this week? Pin that for me." → a `query_table` answer and a pinned stat view in `GET /api/views`.**
- [ ] **Step 5: Commit** `feat: lists screen with grid, cards and stat views; agent can pin views`

### Task 9: `code.transform` escape step

**Files:**
- Create: `apps/server/src/steps/code.ts`
- Modify: `packages/shared/src/catalog.ts`, `apps/server/src/agent/prompt.ts` (when to use it: only when no catalog step fits, e.g. "add 20% to the quote", "split the full name"), `apps/web/src/runtime/Inspector.tsx` and `apps/web/src/design/ConfigForm.tsx` (show the code read-only in a monospace block under its explanation)
- Test: `apps/server/test/steps-code.test.ts`

**Interfaces:**
- Produces: catalog `code.transform` (kind `enrich`): config `{ explanation: string; code: string /* body of (input) => output */; outputFields: { name; type: ColumnType }[] }`; input `{ value: unknown }`; output an object built from `outputFields` (zod built at run time). The why is the config's `explanation`.
- Sandbox: `node:vm` `runInNewContext` with a context containing only `input` (deep-cloned via `structuredClone`) and `Math`, `Date`, `JSON`, `String`, `Number`, `Array`, `Object`; `timeout: 250` ms; `codeGeneration: { strings: false, wasm: false }`. No `require`, `process`, `fetch` or `globalThis` leak.

- [ ] **Step 1: Write failing tests.**
  - `code: 'return { total: input.value.amount * 1.2 }'` with `outputFields [{ name: 'total', type: 'number' }]` returns `{ total: 120 }` for amount 100.
  - `while(true){}` fails with `This calculation took too long.`
  - `return process.env` fails with `This calculation tried to use something it isn't allowed to.`
  - Output missing `total` fails the output schema.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** Wrap as `(function(input){ <code> })(input)`. Map `ReferenceError` and `EvalError` to the "isn't allowed" message, and the vm timeout error to the "took too long" message.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(server): sandboxed code.transform escape step`
