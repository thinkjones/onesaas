# M3: Builder Agent and Design Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a blank chore reducer, Dad types "When a customer emails me, save them and draft a reply" and watches the agent ask one or two questions, show a ghost plan, build the boxes one by one, test-run on the email open in Gmail, and turn it on. He can also drag, connect, configure and delete steps himself, and the agent stays in sync.

**Architecture:** A single set of **workflow operations** on the server (validated, versioned) is the only way workflows change. REST exposes them to the canvas, and the builder agent's tools call the same functions. The agent is a Muse Spark tool-calling loop with a persisted conversation per workflow. Complex plans are refined by Muse Wonder. Test runs use the M1/M2 engine with a `testMode` flag that turns every outside-world action into a preview.

**Tech Stack:** M2 stack. No new runtime dependencies beyond `nanoid` (step ids).

**Spec:** `AgenticHarness/docs/meta-ai-hackathon-my-dads-ai-agent/plans/2026-10-28-dads-ai-agent-design.md` (sections 4 design mode, 5, 6).

**Depends on:** M1, M2. Uses `Gateway`, `catalog`, `executors`, `createEngine` (with `continueRun`), `createRepo`, `createTableStore`, `WorkflowCanvas`/`CanvasOp`, `layoutWorkflow`, `ModeSwitch`, `FailureCard`, query hooks.

## Global Constraints

- All M1 and M2 global constraints still apply.
- Every change to a workflow goes through `workflowOps`. Nothing else writes workflow definitions.
- Position-only changes (`move`) update the latest version in place and do not create a version. Every other op creates a new version.
- The agent speaks plain English, never shows JSON or step type ids to Dad, and defaults every send/post/create action to draft plus `approval.ask`.
- The agent asks at most 3 questions per request, each with 2–4 clickable answers.
- Builder role `muse-spark-1.3`. Planner role `muse-wonder-1.0` is used only when a proposed plan has more than 6 steps or any conditional edge.
- At most 20 tool calls per user turn; on hitting the cap the agent says "I've got a bit tangled. Can you tell me which part to focus on?" and stops.
- Test runs never touch Gmail, Calendar or Meta and never write to lists. They return previews, and the run is marked `kind: 'test'`.

## Review Focus

- The agent references a step that doesn't exist yet in a binding (`{{extrct.name}}`): the op is refused with a readable message and the agent fixes it without Dad seeing an error (test in Task 1).
- Dad deletes a step that later steps depend on: the deletion succeeds, the dependent steps' broken bindings are listed on those boxes as "Needs an input from a removed step", and Turn on is blocked until fixed (test in Task 1).
- Test run with no email open in Gmail: the test uses the catalog's sample email and says so in the run story ("Tested with a sample email because none was open in Gmail.") (test in Task 3).
- Dad edits the canvas while the agent is mid-turn: the agent's next op works against the latest version and is told about Dad's change (test in Task 5).
- The model calls an unknown tool or sends malformed tool arguments: the loop returns the error to the model as the tool result and continues, and never crashes the turn (test in Task 5).

---

### Task 1: Workflow operations (shared by canvas and agent)

**Files:**
- Create: `apps/server/src/workflows/ops.ts`, `apps/server/src/workflows/validate.ts`
- Modify: `apps/server/src/db/repo.ts` (add `createWorkflow`, `updateLatestInPlace`), `apps/server/src/app.ts`, `packages/shared/src/catalog.ts` (add `description` and `sample` to `StepDef`)
- Test: `apps/server/test/ops.test.ts`, `apps/server/test/validate.test.ts`

**Interfaces:**
- Consumes: repo, table store, catalog, `topoOrder`, `Workflow.parse`.
- Produces:
  ```ts
  type OpResult = { ok: true; workflow: Workflow; note: string } | { ok: false; error: string };
  interface WorkflowOps {
    create(o: { name: string; description: string }): Workflow;                // status 'draft', trigger 'trigger.manual'
    setTrigger(id: string, o: { type: string; config: object; title?: string; summary?: string }): OpResult;
    addStep(id: string, o: { type: string; title: string; summary: string; config: object; inputs: Record<string,string>; after?: string }): OpResult;  // `after` also adds edge after→new
    updateStep(id: string, stepId: string, patch: Partial<Pick<StepInstance,'title'|'summary'|'config'|'inputs'>>): OpResult;
    removeStep(id: string, stepId: string): OpResult;                          // also removes its edges
    connect(id: string, o: { from: string; to: string; when?: string }): OpResult;
    disconnect(id: string, o: { from: string; to: string }): OpResult;
    move(id: string, stepId: string, position: { x: number; y: number }): OpResult;
    setStatus(id: string, status: 'on' | 'off'): OpResult;                     // 'on' requires checkWorkflow(wf).length === 0
    rename(id: string, o: { name: string; description?: string }): OpResult;   // bumps version
  }
  function createWorkflowOps(d: { repo; tables; catalog; onChange?(wf: Workflow, note: string, by: 'dad' | 'agent'): void }): WorkflowOps
  function checkWorkflow(wf: Workflow, tables: TableStore): { stepId: string; problem: string }[]
  ```
  - `StepDef` gains `description: string` (one plain sentence) and `sample?: unknown`. The sample is an example trigger output, e.g. a sample email for `trigger.gmailButton`.
  - `note` is a plain-English summary of the change, e.g. `Added step "Save to Customers" after "Read the email".`
  - Routes: `POST /api/workflows` with `{ name, description }` → `Workflow`, and `POST /api/workflows/:id/ops` with `{ op: keyof WorkflowOps, args }` → `OpResult`, where op calls from the web pass `by: 'dad'`. `GET /api/workflows/:id` now also returns `problems: checkWorkflow(...)`.
- `checkWorkflow` problems (exact strings):
  - unknown type → `I don't know how to do "<type>" yet.`
  - config failing `configSchema` → `This step isn't set up yet: <first zod issue path> is missing.`
  - a binding to a step that isn't upstream → `Needs an input from a step that isn't before it ("<ref>").`
  - a binding to a removed step → `Needs an input from a removed step.`
  - `table.*` referencing a missing list → `The list "<table>" doesn't exist yet.`
  - an unreachable step → `Nothing leads to this step yet.`
  - a cycle → `These steps go round in a circle.`

- [ ] **Step 1: Write failing tests.**
  - `addStep` with an unknown type → `{ ok:false, error: 'I don't know how to do "ai.dance" yet.' }`.
  - `addStep` with a binding `{{extrct.name}}` → `ok:false` and the "isn't before it" message.
  - `connect` that would make a cycle → `ok:false`, `These steps go round in a circle.`
  - `removeStep('extract')` on flow 1 → `ok:true`; `checkWorkflow` then reports `Needs an input from a removed step.` for `save` and `write`, and `setStatus('on')` → `ok:false`.
  - `move` keeps the version number; `updateStep` and `rename` bump it.
  - `onChange` is called with `by` and the note.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** Extract binding references with the same `/\{\{(.+?)\}\}/g` scan as `resolveBindings`, taking the first path segment as the step id. Upstream means reachable backwards via edges. Step ids are `nanoid(6)` prefixed by a slug of the title (`save-k3j2a1`).
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(server): validated, versioned workflow operations shared by canvas and agent`

### Task 2: Gateway tool calling

**Files:**
- Modify: `apps/server/src/models/gateway.ts`
- Test: `apps/server/test/gateway-tools.test.ts`

**Interfaces:**
- Produces (added to `Gateway`):
  ```ts
  type AgentMessage = OpenAI.ChatCompletionMessageParam;
  interface ToolSpec { name: string; description: string; parameters: object /* JSON schema */ }
  chatTools(o: { role: ModelRole; messages: AgentMessage[]; tools: ToolSpec[] }): Promise<{
    message: OpenAI.ChatCompletionMessage; toolCalls: { id: string; name: string; args: unknown; argsError?: string }[];
    model: string; tokens: { input: number; output: number }; costUsd: number }>
  ```
  `args` is the parsed JSON. When the arguments string isn't valid JSON, `args` is `undefined` and `argsError` is `Arguments weren't valid JSON: <message>`.

- [ ] **Step 1: Write failing tests** with a fake client.
  - Tools are sent as `{ type: 'function', function: { name, description, parameters } }` with `tool_choice: 'auto'`.
  - A response with two `tool_calls` yields two parsed calls.
  - Bad JSON arguments give `argsError` instead of a throw.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(server): gateway tool calling`

### Task 3: Test runs with previews

**Files:**
- Modify: `packages/shared/src/run.ts` (add `kind: 'live' | 'test'` to `Run`, default `'live'`), `apps/server/src/db/repo.ts`, `apps/server/src/engine/engine.ts`, `apps/server/src/steps/*.ts`
- Create: `apps/server/src/engine/testRun.ts`
- Test: `apps/server/test/testRun.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // StepContext gains:
  testMode: boolean
  // engine:
  testRun(workflowId: string): Promise<{ run: Run; steps: StepRun[]; usedSample: boolean }>
  ```
  - **Choosing the sample:** for `trigger.gmailButton` and `trigger.email`, try `bridge.call('gmail', 'readOpenEmail', {})` with a 5 s timeout; on any failure use `catalog[trigger.type].sample`. Other triggers always use `sample`.
  - **In `testMode`:**
    - `act` and `store` executors don't call the bridge or the table store. They return `{ output: <preview>, why: 'In a real run I would <action>.' }`. `table.upsert` in test mode still *reads* the store to say whether it would create or update.
    - `approval.ask` auto-approves with why `In a real run I'd ask you to check this first.`
    - The run is saved with `kind: 'test'`.
  - `listRuns` excludes test runs unless called with `{ includeTests: true }`.
  - A test-run story that used the sample starts with `Tested with a sample email because none was open in Gmail.`

- [ ] **Step 1: Write failing tests.**
  - A test run of flow 1 with a disconnected bridge has `usedSample: true`, every step `done`, the bridge never called for `draftReply`, `t_customers` still empty, and the `draft` why `In a real run I would put this reply into Gmail as a draft.`
  - With a fake bridge returning an email, `usedSample: false` and `extract` gets that email.
  - `listRuns()` doesn't include it.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** Give each act/store executor a `preview(config, input)` alongside `run`, and have the engine pick one based on `testMode`.
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(server): test runs that preview outside-world actions`

### Task 4: Builder tools and prompt

**Files:**
- Create: `apps/server/src/agent/tools.ts`, `apps/server/src/agent/prompt.ts`, `apps/server/src/agent/examples.ts`
- Test: `apps/server/test/agent-tools.test.ts`

**Interfaces:**
- Consumes: `WorkflowOps` (Task 1), `testRun` (Task 3), table store, repo.
- Produces:
  ```ts
  interface ToolContext { workflowId: string; ops: WorkflowOps; tables: TableStore; repo: Repo; engine: Engine; gateway: Gateway; emit(e: AgentEvent): void }
  interface AgentTool extends ToolSpec { run(args: any, ctx: ToolContext): Promise<{ result: string; endTurn?: boolean }> }
  const builderTools: AgentTool[]
  function buildSystemPrompt(o: { business: { name?: string; what?: string; timezone: string }; workflow: Workflow; problems: ReturnType<typeof checkWorkflow>; tables: TableDef[] }): string
  type AgentEvent =
    | { type: 'say'; text: string }
    | { type: 'ask'; question: string; options: string[] }
    | { type: 'plan'; ghosts: { id: string; type: string; title: string; summary: string }[]; edges: Edge[] }
    | { type: 'activity'; text: string }            // plain-English line per tool call, e.g. "Adding a step: Save to Customers"
    | { type: 'built'; stepId: string }             // canvas animates this box in
    | { type: 'test'; runId: string }
    | { type: 'done' };
  ```
  Tools (name: args → behaviour):
  - `ask_user`: `{ question, options: string[] (2–4) }` → emits `ask`, `endTurn: true`.
  - `propose_plan`: `{ steps: { key, type, title, summary }[], edges: { from, to, when? }[] }` → emits `plan`. If there are more than 6 steps or any `when`, it calls `gateway.chatJson({ role: 'planner', schemaName: 'plan', … })` with the conversation summary and catalog, and emits the refined plan instead. Result: "Plan shown to Dad; wait for his reply." `endTurn: true`.
  - `create_table`: `TableDef` → `tables.createTable`; result `Created list "<label>" with columns …`.
  - `set_trigger`, `add_step`, `update_step`, `remove_step`, `connect`, `rename_workflow`: map 1:1 to `WorkflowOps` with `by: 'agent'`. An `ok:false` result becomes a tool result `Problem: <error>` (no `endTurn`). `add_step` also emits `built`.
  - `test_run` → `engine.testRun`, emits `test`, and returns each step's title, status and why, one line each.
  - `activate` → `ops.setStatus(id, 'on')`, then `done`.
  - `explain`: `{ about: 'step'|'run'|'table'|'workflow', id }` → returns the stored why, story or definition summary for the agent to paraphrase.
  - `query_table`: `{ table, where?, limit? }` → rows as compact lines.
  - `query_runs`: `{ contains?: string, limit? }` → runs whose story contains the text, as id + story.
- The prompt contains:
  1. Role and voice. The text is fixed: "You help a small business owner turn a chore into a chore reducer. Running a business is hard; be warm, brief and encouraging. Use plain words. Never mention JSON, ids or step types."
  2. Rules from Global Constraints.
  3. The catalog. For each `StepDef`: `type`, `description`, config/input/output JSON schema (via `zod-to-json-schema`), and how to bind (`{{stepId.field}}`).
  4. Current workflow and problems.
  5. Existing lists.
  6. `examples.ts`: flow 1 as a worked example, a user sentence and the tool-call sequence that builds it (M4 adds flows 2 and 4).
  7. Business profile and timezone.

- [ ] **Step 1: Write failing tests.**
  - `add_step` with a bad binding returns a `Problem: …` result string and doesn't throw.
  - `propose_plan` with 7 steps calls the planner role once; with 4 steps it doesn't.
  - Every tool's `parameters` is valid JSON Schema with `type: 'object'`.
  - The system prompt contains every catalog type's description and the flow 1 example.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(server): builder agent tools, catalog-aware prompt and flow 1 example`

### Task 5: Agent loop, conversations and sync with manual edits

**Files:**
- Create: `apps/server/src/agent/loop.ts`, `apps/server/src/agent/conversations.ts`
- Modify: `apps/server/src/db/schema.ts` (table `conversations(workflow_id PK, messages JSON, updated_at)`), `apps/server/src/app.ts`, `apps/server/src/main.ts` (wire `onChange` from ops into conversations)
- Create: `scripts/eval-builder.ts`
- Test: `apps/server/test/agent-loop.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function createBuilderAgent(d: { gateway; ops; tables; repo; engine; events: EventEmitter }): {
    send(workflowId: string, text: string): Promise<void>;     // runs one user turn; emits AgentEvents
    noteManualChange(workflowId: string, note: string): void;  // appends a system message: "Dad changed the canvas: <note>"
  }
  ```
  Routes:
  - `POST /api/workflows/:id/agent` with `{ text }` → `202`; the turn runs in the background, one turn at a time per workflow, and a second send while busy returns `409 { error: 'Still thinking about your last message.' }`.
  - `GET /api/workflows/:id/agent` → the visible transcript `{ role: 'dad'|'agent', text, ask?, at }[]`.

  `/api/events` also carries `{ type: 'agent', workflowId, event: AgentEvent }`.
- **Loop:**
  1. Load the conversation and rebuild the system prompt from the *latest* workflow on every iteration.
  2. Call `chatTools({ role: 'builder' })`.
  3. Emit assistant text as `say`.
  4. Run tool calls sequentially:
     - an unknown tool → `Problem: there is no tool called <name>.`
     - an `argsError` → `Problem: <argsError>`
  5. Append the results and repeat until the model replies with no tool calls, a tool returns `endTurn`, or 20 calls are reached.
  6. Persist the messages and emit `done`.
- `scripts/eval-builder.ts` sends "When a customer emails me, save them in my customer list and draft a friendly reply for me to check." to a fresh workflow. It auto-answers any `ask` with its first option and auto-accepts a plan with "Yes, build it". It then asserts:
  - the trigger is `trigger.gmailButton` or `trigger.email`;
  - the steps include `ai.extract`, `table.upsert`, `ai.write`, `approval.ask` and `gmail.draftReply`;
  - `checkWorkflow` is empty.

  It prints PASS/FAIL, tool calls and cost.

- [ ] **Step 1: Write failing tests** with a scripted fake gateway.
  - A scripted sequence (`propose_plan`) ends the turn with a `plan` event.
  - Next turn ("yes"): `add_step`×4, `connect`, then text → four `built` events and one `say`.
  - An unknown tool call gets a `Problem:` tool result, and the loop continues.
  - The 21st call is not executed and the tangled message is said.
  - `noteManualChange` inserts the system message seen by the next `chatTools` call.
  - A concurrent second `send` → 409.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them; expect PASS. Then run `pnpm tsx scripts/eval-builder.ts` with a real key; expect PASS. If it fails, adjust the prompt or examples (not the eval) and re-run until it passes 3 times in a row.**
- [ ] **Step 5: Commit** `feat(server): builder agent loop with persisted conversation and manual-edit sync`

### Task 6: Design mode on the canvas

**Files:**
- Create: `apps/web/src/design/{DesignView.tsx,StepPalette.tsx,ConfigForm.tsx,GhostNode.tsx,ProblemsBadge.tsx,TestResults.tsx}`
- Modify: `apps/web/src/canvas/WorkflowCanvas.tsx` (design interactions, ghosts, build animation), `apps/web/src/shell/ModeSwitch.tsx` (enable Design), `apps/web/src/runtime/FailureCard.tsx` (enable "Fix this step"), `apps/web/src/api.ts` (`useWorkflowOp()`, `useTestRun()`)
- Test: `apps/web/src/design/ConfigForm.test.tsx`, `apps/web/src/design/DesignView.test.tsx`

**Interfaces:**
- Consumes: ops route (Task 1), `POST /api/workflows/:id/test` (add the route → `engine.testRun`), agent events (Task 5).
- Produces:
  - **Editing the canvas:** in design mode the canvas can be dragged (sends `move`), connected (`connect`) and deleted with Backspace (`remove` after a confirm toast with Undo, which re-adds the step from the previous version via `updateStep`/`addStep`).
  - **Step palette:** a left drawer listing catalog steps grouped by kind with plain names ("When…", "Get…", "Work out…", "Save…", "Do…") and each step's `description`. Click to add after the selected step.
  - **ConfigForm:** renders a step's `configSchema` (as JSON Schema) for string, multiline string (field names `instructions`, `body`, `question`), enum, number, boolean, and array-of-objects (add/remove rows). It also renders an "Inputs" section listing each `inputs` binding as a picker of upstream step outputs (from their `outputSchema` fields) or free text. Saving calls `updateStep`.
  - **Problems:** each box with problems shows an amber badge with the problem text, and the top bar shows "2 things to fix before turning on".
  - **Ghosts:** a `plan` event shows dashed, 50% opacity ghost boxes laid out with `layoutWorkflow`. On `built`, the matching ghost (by title) is replaced by a real box animating in (scale 0.9→1, 300 ms) with a `onBuilt` hook for the M5 chime.
  - **Test run:** a "Try it" button runs a test. Results show on each box (why text under the title) and as a story strip, using `TestResults`.
  - **Turn on:** shown when there are no problems. It calls `setStatus('on')` and switches to runtime mode.
  - **Fix this step:** opens design mode with the step selected and its ConfigForm open, and pre-fills the agent input with `"<title>" stopped with: <error>. Can you help me fix it?`

- [ ] **Step 1: Write failing tests.**
  - ConfigForm for `ai.extract` renders an "instructions" textarea and a fields table where "Add a field" adds a row; saving calls the op with the new config.
  - DesignView receiving a `plan` event with 3 ghosts renders 3 elements with `data-ghost="true"`; a `built` event for the 2nd title leaves 2 ghosts and 1 real node.
  - With problems present, "Turn on" is replaced by "2 things to fix before turning on".
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them; expect PASS.**
- [ ] **Step 5: Commit** `feat(web): design mode with palette, config forms, ghosts, problems, test run and turn on`

### Task 7: Agent panel and starting a new chore reducer

**Files:**
- Create: `apps/web/src/agent/{AgentPanel.tsx,Message.tsx,AskChips.tsx,ActivityLine.tsx,useAgent.ts}`
- Modify: `apps/web/src/pages/WorkflowPage.tsx` (panel on the right, 380px, collapsible, in both modes), `apps/web/src/pages/ChoreReducersPage.tsx` ("New chore reducer" button), `apps/web/src/pages/HomePage.tsx` (temporary text box "What do you want to achieve today?" that creates a workflow and sends the text; M5 replaces the page)
- Test: `apps/web/src/agent/AgentPanel.test.tsx`

**Interfaces:**
- Consumes: agent routes and events (Task 5), `POST /api/workflows`.
- Produces:
  - `useAgent(workflowId)` → `{ transcript, busy, send(text) }`. `busy` is true from send until `done`.
  - **AgentPanel layout:**
    - **Transcript:** Dad's messages on the right and the agent's on the left. `activity` events appear as small grey lines with a spinner while busy. `ask` events show AskChips (clicking one sends it as Dad's message).
    - **Bottom:** a textarea (Enter sends, Shift+Enter adds a newline) and a placeholder mic button, which is wired in M5.
  - **Starting from a sentence:** a new workflow is named from the first 6 words of Dad's sentence; the agent gives it a proper name with `rename_workflow` once the plan is agreed.
  - **Keeping the agent in sync:** canvas ops by Dad call `noteManualChange` server-side (via `onChange` with `by: 'dad'`), and nothing extra is needed in the web app.

- [ ] **Step 1: Write a failing test.** With mocked events, AgentPanel shows `say` text, renders 3 chips for an `ask` with 3 options, sends the clicked chip text, and disables the input while `busy`.
- [ ] **Step 2: Run it; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it; expect PASS.**
- [ ] **Step 5: End-to-end check:**
  1. Stop the server, delete `data/app.db`, start again (the flow 1 seed reappears; leave it).
  2. Home → type "When a customer emails me, save them and draft a reply for me to check".
  3. Within a minute the agent asks at most 3 questions and shows a ghost plan; answer "Yes, build it".
  4. Boxes animate in one by one. "Try it" with Sarah's email open in Gmail → every box shows a why, and no draft appears in Gmail.
  5. Drag a box (no new version). Change the reply tone in ConfigForm (new version), then ask the agent "what did I just change?" It knows.
  6. Turn on → runtime. Click the new workflow's Gmail button on a fresh email → approval card → draft appears.
- [ ] **Step 6: Commit** `feat(web): agent panel; build a chore reducer from one sentence`
