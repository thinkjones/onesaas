# M2: Runtime Mode and Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dad watches flow 1 run live on a canvas: each box lights up, an approval card lets him Approve / Edit / Skip the reply before it's drafted, any box opens an inspector showing what came in, what happened and why, failures offer Retry on just that step, and runs survive a server restart.

**Architecture:** The M1 engine gains a `waiting` state (approval), single-step retry and resume-on-boot. The server adds approve/retry routes and a run story to `GET /api/runs/:id`. The web app gets its real shell (Tailwind v4, shadcn/ui, react-router), a React Flow canvas that later serves design mode too, and the runtime screen (runs list, canvas, inspector).

**Tech Stack:** M1 stack plus Tailwind CSS v4, shadcn/ui, react-router 7, @tanstack/react-query 5, @xyflow/react 12, @dagrejs/dagre, motion 12, lucide-react.

**Spec:** `AgenticHarness/docs/meta-ai-hackathon-my-dads-ai-agent/plans/2026-10-28-dads-ai-agent-design.md` (sections 4 runtime mode, 7, 9 workflow screen).

**Depends on:** M1 (`2026-10-28-m1-foundation-and-thin-slice.md`). Uses its `Workflow`, `Run`, `StepRun`, `createEngine`, `createRepo`, `catalog`, `executors`, `Bridge`, routes and `setButtonStatus`.

## Global Constraints

- All M1 global constraints still apply.
- User-facing words: "chore reducer" (workflow), "list" (table), "step" (node). Never show JSON by default; input/output JSON sits behind a "Show details" toggle.
- Status colours and labels, used everywhere: pending "Not started" (muted), running "Working…" (blue, pulsing), waiting "Waiting for you" (amber), done "Done" (green), failed "Needs a look" (red), skipped "Skipped" (grey, dashed border).
- Side-effecting steps (`kind: 'act'`) never re-run automatically, including on resume.
- Body text 16px minimum; click targets 40px minimum; motion 200–300 ms ease-in-out; respect `prefers-reduced-motion`.
- Only the Morning theme in this milestone (warm cream). Colours are defined as CSS variables so M5 can add themes without touching components.

## Review Focus

- Server restarts while a run is waiting for approval: after restart the approval card is still there and approving it continues the run (test in Task 1).
- Server restarts while an `act` step was mid-flight: the step shows "Needs a look" with "I was interrupted while doing this. Press Retry if it didn't happen." rather than silently repeating it (test in Task 1).
- Dad edits the draft in the approval card to an empty string: Approve is disabled with "The reply is empty" (test in Task 6).
- Retry on a failed step whose upstream outputs were from an older workflow version: retry uses the run's own `workflowVersion`, not the latest (test in Task 2).
- SSE connection drops (laptop sleeps): the page reconnects and refetches the open run so the canvas isn't stale (test in Task 4).

---

### Task 1: Approval step, waiting state and resume on boot

**Files:**
- Modify: `packages/shared/src/catalog.ts` (add `approval.ask`), `apps/server/src/engine/engine.ts`, `apps/server/src/steps/registry.ts`
- Create: `apps/server/src/steps/approval.ts`
- Test: `apps/server/test/engine-approval.test.ts`

**Interfaces:**
- Consumes: `createEngine`, `Executor`, `StepResult`, repo (M1 Tasks 5–7).
- Produces:
  - Catalog `approval.ask`: kind `act`; config `{ question: string }` (default "Is this OK to use?"); input `{ text: string }`; output `{ text: string; decision: 'approved' | 'edited' }`.
  - `StepResult` gains an optional `wait?: { kind: 'approval'; question: string; proposed: unknown }`. When present the engine saves the StepRun as `waiting` with `output: { proposed }` and sets the run to `waiting`.
  - Engine additions:
    ```ts
    resolveApproval(runId: string, stepId: string, d: { action: 'approve' } | { action: 'edit'; text: string } | { action: 'skip' }): Promise<Run>
    resumeAll(): Promise<void>   // call once at boot
    ```
  - Approve → step `done`, output `{ text: proposed.text, decision: 'approved' }`, why `You approved this at <h:mm a>.` (in the stored timezone, default the server's).
  - Edit → output `{ text, decision: 'edited' }`, why `You changed the wording and approved it at <h:mm a>.`
  - Skip → step `skipped`, why `You chose to skip this.`; skip propagates under M1's rule.

- [ ] **Step 1: Write failing tests.**
  - A trigger→write→approve→draft run stops with approve `waiting`, run `waiting`, and `draft` still `pending`.
  - `resolveApproval(..., {action:'edit', text:'Hi Sarah!'})` continues; `draft` receives `body: 'Hi Sarah!'`.
  - `resolveApproval` on a step that isn't waiting rejects with `That step isn't waiting for you.`
  - Create a fresh engine on the same repo (simulates a restart) and call `resumeAll()`. A `waiting` run stays waiting and can be resolved. A `running` run whose `enrich` step was `running` re-runs that step. A `running` run whose `act` step was `running` marks it `failed` with error `I was interrupted while doing this. Press Retry if it didn't happen.` and the run `failed`.
- [ ] **Step 2: Run `pnpm vitest run apps/server/test/engine-approval.test.ts`; expect FAIL.**
- [ ] **Step 3: Implement.** Refactor the M1 run loop into `continueRun(runId)`, which rebuilds the binding context from saved `done` StepRuns, so `start`, `resolveApproval`, `retryStep` (Task 2) and `resumeAll` share it.
- [ ] **Step 4: Run them; expect PASS. Run the full suite (`pnpm test`); M1 engine tests still pass.**
- [ ] **Step 5: Commit** `feat(server): approval step, waiting runs and resume on boot`

### Task 2: Single-step retry, run story and API routes

**Files:**
- Modify: `apps/server/src/engine/engine.ts`, `apps/server/src/app.ts`
- Create: `apps/server/src/engine/story.ts`
- Test: `apps/server/test/engine-retry.test.ts`, `apps/server/test/story.test.ts`, `apps/server/test/routes-runs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  retryStep(runId: string, stepId: string): Promise<Run>   // engine; failed steps only; re-resolves inputs from saved outputs of the run's own workflowVersion
  function buildRunStory(wf: Workflow, steps: StepRun[]): string[]   // 1–4 lines
  ```
  Routes:
  - `GET /api/runs/:id` now returns `{ run, steps, story, workflow }`, where `workflow` is the run's own version.
  - `POST /api/runs/:id/steps/:stepId/approval` with body `{ action, text? }`.
  - `POST /api/runs/:id/steps/:stepId/retry`.

  Both POSTs return the updated `{ run, steps, story }`, `409` with `{ error }` when the step is in the wrong state, and `404` for unknown ids.
- Story rules:
  - Take the `why` of done steps in topological order, skipping triggers.
  - Prefix the first line with the trigger's summary.
  - Join with " → " into lines of at most 3 steps.
  - A failed step adds `Stopped at "<title>": <error>`. A waiting run ends with `Waiting for you to check "<title>".`

- [ ] **Step 1: Write failing tests.**
  - Retry: a failed `draft` re-runs with the same input. On success the run becomes `done`, and steps after it run.
  - `retryStep` on a `done` step rejects with `Only a step that needs a look can be retried.`
  - After `saveWorkflow` bumps to v2 (title change on `write`), retrying a v1 run's failed step uses v1's definition.
  - Story: for a done flow-1 run, the result has ≤4 lines, and the first starts with the trigger summary.
  - Story: for a failed run, the last line is `Stopped at "Draft the reply in Gmail": I need Gmail open in Chrome to do this.`
  - Routes: approval on an unknown run → 404; a second approval on the same step → 409.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement `retryStep`, `buildRunStory` and the routes.**
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(server): retry a single step, run story, approval and retry routes`

### Task 3: Web shell and visual foundation

**Files:**
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`
- Create: `apps/web/src/styles/tokens.css` (Morning theme variables), `apps/web/src/styles/app.css`, `apps/web/components.json` (shadcn)
- Create: `apps/web/src/shell/{AppShell.tsx,NavRail.tsx}`, `apps/web/src/routes.tsx`
- Create pages (placeholders until later milestones): `apps/web/src/pages/{HomePage,ChoreReducersPage,ListsPage,SettingsPage,WorkflowPage}.tsx`
- Move: the M1 `Pairing` card into `SettingsPage`; the M1 `RunLog` is retired once Task 5 lands
- Test: `apps/web/src/shell/NavRail.test.tsx`

**Interfaces:**
- Produces:
  - Routes:
    - `/` → Home
    - `/reducers` → Chore reducers
    - `/reducers/:workflowId?mode=design|runtime&run=:runId&step=:stepId` → WorkflowPage
    - `/lists` → Lists
    - `/settings` → Settings
  - The Chore reducers page lists `GET /api/workflows` as cards: name, on/off, last run time, count of waiting runs.
  - `apps/web/src/api.ts` moves to TanStack Query hooks: `useWorkflows()`, `useWorkflow(id)`, `useRuns(workflowId)`, `useRun(runId)`, `useApprove()`, `useRetry()`.
  - `useLiveEvents()` subscribes to `/api/events` once at app level and invalidates `['run', runId]` and `['runs', workflowId]` on each event.
  - shadcn components added now: button, card, badge, sheet, tooltip, textarea, scroll-area, separator, switch, toast (sonner).
- Morning tokens (HSL, under `:root[data-theme="morning"]`):
  - `--background 40 33% 97%`
  - `--foreground 25 20% 15%`
  - `--card 40 30% 99%`
  - `--primary 22 80% 52%`
  - `--primary-foreground 0 0% 100%`
  - `--muted 35 20% 92%`
  - `--accent 160 35% 40%`
  - `--destructive 4 70% 50%`
  - `--warning 38 92% 50%`
  - `--success 145 50% 38%`
  - `--radius 0.875rem`
  - Base font size 17px.

- [ ] **Step 1: Write a failing test.** NavRail renders the links "Home", "Chore reducers", "Lists", "Settings". The active route has `aria-current="page"`. Each link is at least 40px tall (assert the `min-h-10` class).
- [ ] **Step 2: Run it; expect FAIL.**
- [ ] **Step 3: Install Tailwind v4 (`@tailwindcss/vite`), init shadcn, then add tokens, shell, routes and query hooks.** Fonts arrive in M5; use the system font stack for now.
- [ ] **Step 4: Run it; expect PASS. `pnpm dev`: each route renders and the Settings pairing card still pairs.**
- [ ] **Step 5: Commit** `feat(web): app shell, routes, tokens and query hooks`

### Task 3b: Craft-inspired design system

**Design reference:** Craft (https://www.craft.do/): paper-like card surfaces, warm neutrals, a quiet sidebar, strong type hierarchy, generous whitespace, soft small shadows, one corner radius, minimal chrome, and friendly empty states. This task turns that language plus the M2 Global Constraints into shared tokens and primitives so Tasks 4–6 (and every later screen) look like one app, not six.

**Files:**
- Create: `apps/web/src/design/{tokens.css,AppCard.tsx,AppButton.tsx,StatusBadge.tsx,EmptyState.tsx}`, `apps/web/src/pages/DesignPreviewPage.tsx`
- Modify: `apps/web/src/styles/app.css` (import design tokens), `apps/web/src/routes.tsx` (add `/design` preview route)
- Test: `apps/web/src/design/primitives.test.tsx`

**Interfaces:**
- Consumes: Morning tokens and shadcn set (Task 3); status labels/colours (Global Constraints).
- Produces:
  - `tokens.css` extends the Task 3 tokens with `--info 210 80% 50%` (running blue), `--shadow-sm` and `--shadow-md` (soft, low-opacity), keeping `--radius` as the single corner radius.
  - `StatusBadge({status})` renders the exact Global Constraints label for each of the six statuses (`pending`, `running`, `waiting`, `done`, `failed`, `skipped`) with a `data-status` attribute; `running` pulses (disabled under `prefers-reduced-motion`); `skipped` uses a dashed border.
  - `AppCard` (paper surface: `--card` background, `--radius` corners, `--shadow-sm`), `AppButton` (wraps the shadcn button; at least 40px tall, 16px+ text), `EmptyState({icon, title, hint, action?})` (centred icon, title, one-line hint, optional action button).
  - `/design` preview page renders every primitive in every state plus all six status badges, so regressions are visible in one place.
  - Rule from here on: no screen introduces one-off colours, fonts, radii, or shadows. Tasks 4–6 consume these primitives, and later milestones extend them instead of inventing new ones.

- [ ] **Step 1: Write failing tests.** StatusBadge renders "Not started", "Working…", "Waiting for you", "Done", "Needs a look" and "Skipped" for the six statuses with matching `data-status`. AppButton carries `min-h-10` and `text-base`. EmptyState renders its title, hint and action label.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement the tokens, primitives and preview page.**
- [ ] **Step 4: Run them; expect PASS. `pnpm dev`: open `/design` and confirm one card language, one radius, readable hierarchy, and no clipped text at 1280×800.**
- [ ] **Step 5: Commit** `feat(web): Craft-inspired design primitives and status language`

### Task 4: Workflow canvas (shared by both modes)

**Files:**
- Create: `apps/web/src/canvas/{WorkflowCanvas.tsx,StepNode.tsx,FlowEdge.tsx,layout.ts,stepVisuals.ts}`
- Test: `apps/web/src/canvas/layout.test.ts`, `apps/web/src/canvas/StepNode.test.tsx`, `apps/web/src/api.events.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type CanvasMode = 'design' | 'runtime';
  interface WorkflowCanvasProps {
    workflow: Workflow; mode: CanvasMode;
    stepRuns?: Record<string, StepRun>;      // runtime overlay keyed by stepId
    ghosts?: { id: string; type: string; title: string; summary: string }[];   // design-mode plan preview (M3)
    selectedStepId?: string;
    onSelectStep(stepId: string): void;
    onChange?(op: CanvasOp): void;           // design mode only (M3)
    renderNodeExtra?(stepId: string): React.ReactNode;   // approval / failure cards
  }
  type CanvasOp = { op: 'move'; stepId: string; position: { x: number; y: number } }
    | { op: 'connect'; from: string; to: string } | { op: 'remove'; stepId: string } | { op: 'disconnect'; from: string; to: string };
  function layoutWorkflow(wf: Workflow): Workflow   // fills missing/overlapping positions, left-to-right
  const stepVisuals: Record<StepDef['kind'], { icon: LucideIcon; tint: string }>
  ```
  - StepNode: 280px wide. It shows the kind icon, title, plain-English summary, and a status badge (Global Constraints labels) when `stepRuns` has the step.
  - It has `data-status` and `data-step-id` attributes.
  - In runtime mode the node is not draggable or connectable. React Flow's `nodesDraggable`, `nodesConnectable` and `elementsSelectable` follow the mode.
  - FlowEdge animates (moving dash) while its target is `running`, and shows a `when` condition as a small pill label.
  - `useLiveEvents` (Task 3) reconnects on `EventSource` error with backoff 1/2/5 s and on reconnect invalidates every `['run', *]` query.

- [ ] **Step 1: Write failing tests.**
  - `layoutWorkflow` on flow 1 with all positions `{0,0}` gives distinct positions, trigger x < extract x < save x, and keeps existing non-zero positions.
  - StepNode with status `waiting` shows "Waiting for you" and `data-status="waiting"`.
  - An `EventSource` mock fires `error` then `open`; the query client's `invalidateQueries` is called with `['run']`.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** `layoutWorkflow` uses dagre with `rankdir: 'LR'`, `nodesep: 60`, `ranksep: 120`. Node enter/state changes animate with Motion (opacity and scale 0.96→1, 250 ms).
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(web): React Flow workflow canvas with status overlay and auto layout`

### Task 5: Runtime screen (runs list, inspector, run story)

**Files:**
- Create: `apps/web/src/runtime/{RuntimeView.tsx,RunsList.tsx,Inspector.tsx,RunStory.tsx}`, `apps/web/src/shell/ModeSwitch.tsx`
- Modify: `apps/web/src/pages/WorkflowPage.tsx`
- Delete: `apps/web/src/RunLog.tsx` and its test (replaced)
- Test: `apps/web/src/runtime/Inspector.test.tsx`, `apps/web/src/runtime/RunsList.test.tsx`

**Interfaces:**
- Consumes: `useRuns`, `useRun` (Task 3); `WorkflowCanvas` (Task 4); `GET /api/runs/:id` `{ run, steps, story, workflow }` (Task 2).
- Produces:
  - WorkflowPage shows the ModeSwitch (big two-part control "Design | Watch it run") at the top. Design is disabled with the tooltip "Coming soon" until M3.
  - **Runtime layout:**
    - **RunsList on the left (300px):** each row is "Today 10:42 · Sarah Lee", built from the trigger payload's `fromName`, or `subject`, or "Manual run". Each row shows a status badge and the story's last line, truncated. The newest run is selected by default.
    - **Canvas in the centre:** shows the selected run's `workflow` with the `stepRuns` overlay.
    - **RunStory header:** sits above the canvas and shows the story lines.
  - **Inspector:** a shadcn Sheet from the right, opened by clicking a node. It shows:
    - the title and status;
    - **Why**, in large text;
    - **What came in** / **What came out**, as readable key-value lists (strings as text, images as thumbnails from M4, objects as nested lists), with a "Show details" toggle for raw JSON;
    - model, cost (`$0.0012`), duration (`1.2 s`) and start time.
  - URL state `run` and `step` keeps selections linkable (M3's "Fix this step" and M5's explain links use it).

- [ ] **Step 1: Write failing tests.**
  - Inspector with a done `extract` StepRun shows the why text, a "What came out" row "name: Sarah Lee", and "$0.0012". Raw JSON is hidden until "Show details" is clicked.
  - RunsList renders "Sarah Lee" for a run whose trigger payload has `email.fromName: 'Sarah Lee'`, and marks the selected row `aria-selected="true"`.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement the views.** Format times with `Intl.DateTimeFormat` in the browser's timezone.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(web): runtime view with runs list, inspector and run story`

### Task 6: Approval and failure cards on the canvas; flow 1 gets an approval step

**Files:**
- Create: `apps/web/src/runtime/{ApprovalCard.tsx,FailureCard.tsx}`
- Modify: `apps/web/src/runtime/RuntimeView.tsx` (pass `renderNodeExtra`), `apps/server/src/seed/flow1.json`, `apps/extension/lib/gmail/button.ts`
- Create: `apps/server/src/seed/migrate.ts` (if `flow-1` exists without an `approve` step, save the new definition as the next version)
- Test: `apps/web/src/runtime/ApprovalCard.test.tsx`, `apps/web/src/runtime/FailureCard.test.tsx`, `apps/extension/test/gmail.test.ts` (extend)

**Interfaces:**
- Consumes: `useApprove`, `useRetry` (Task 3); approval and retry routes (Task 2).
- Produces:
  - **ApprovalCard** is attached under a `waiting` node. It shows the question, an editable textarea pre-filled with `proposed.text`, and three buttons: "Looks good" (approve), "Use my changes" (edit; enabled only when the text changed), and "Skip".
  - **FailureCard** is attached under a `failed` node. It shows the error in plain words, "Try again" (retry), and "Fix this step". "Fix this step" links to `?mode=design&step=<id>` and is disabled with the "Coming soon" tooltip until M3.
  - **Flow 1 v2 steps:** `extract` → `save` → `write` → `approve` (`approval.ask`, question "Is this reply OK to put in Gmail?", input `text: "{{write.text}}"`) → `draft` (body `{{approve.text}}`).
  - **Gmail pill:** `setButtonStatus(doc, id, 'waiting')` shows `Waiting for you`. Clicking the pill opens `http://localhost:5173/reducers/<workflowId>?mode=runtime&run=<runId>`; the `runStatus` message already carries `runId`.

- [ ] **Step 1: Write failing tests.**
  - ApprovalCard: clearing the textarea disables every approve button and shows "The reply is empty".
  - ApprovalCard: editing the text enables "Use my changes", which calls the mutation with `{action:'edit', text}`.
  - FailureCard shows the error and calls retry on "Try again".
  - Extension: a `waiting` status renders `Waiting for you`, and the pill's link has the run URL.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement the cards, the seed change and migration, and the pill update.**
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: End-to-end check:**
  1. Click the Gmail button on Sarah's email. The pill shows `Waiting for you`; click it.
  2. The runtime view opens on that run with `approve` amber and the card showing the draft.
  3. Change one word, then "Use my changes". `draft` turns green, and Gmail has the edited draft.
  4. The story reads trigger → saved → wrote → "You changed the wording and approved it at …" → drafted.
  5. Close Gmail and run `pnpm tsx scripts/run-flow1.ts`, then approve. `draft` is red with "I need Gmail open in Chrome to do this."
  6. Open Gmail and press "Try again". It turns green.
  7. Kill the server while a run waits, restart, and approve. It completes.
- [ ] **Step 6: Commit** `feat: approval and failure cards on the canvas; flow 1 asks before drafting`
