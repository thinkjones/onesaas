# My Dad's AI Agent: Design Spec

Date: 2026-10-28. Status: draft for review. Inputs: [[AgenticHarness/docs/meta-ai-hackathon-my-dads-ai-agent/plans/brief]], [[hackathon-application]], [[hackathon-participant-guide]].

## 1. Intent

We are building **the tool that builds small-business apps**, not the apps themselves. A non-technical small business owner (my dad) says what he wants to achieve, and the app builds a **chore reducer** (a workflow) that he can watch being built, test, switch on and then see running, with a plain-English reason for everything that happens.

**Success for the hackathon:** by Wed Nov 4, 9 PM ET, a public repo and a 3-minute video in which the builder produces three different workflows from plain speech, one of which runs end to end on a real Gmail inbox, with every Meta model used for a real job.

**Hackathon frame:** Indie Developer track, problem statement "Build for Your World". Bonus targets: Best Agentic Use-Case, Best Build on Meta Open Weight Models (Glimmer), Best Creative Build (Muse Image), Most Viral. Rubric weights: Impact 30%, Meta tooling 25%, Demo 25%, Technical depth 20%.

## 2. Decisions

| Decision | Choice |
|---|---|
| What we build | The builder: Tables, Views and Workflows as building blocks. Workflows are the focus. |
| Workflow shape | trigger → fetch → enrich → store → act |
| Step model | Fixed catalog of typed steps (JSON-schema I/O) plus one sandboxed `code.transform` escape step |
| Auth | None. Single-user local demo. |
| Connections to Google and Meta | A companion Chrome extension acting in the user's logged-in tabs. No OAuth apps. |
| Runtime | Local Node server + React web app on localhost + Chrome extension over WebSocket |
| Engine | Our own small workflow engine with a per-step run record (no n8n/Temporal) |
| Workflow modes | Design mode (build and edit) and Runtime mode (watch runs step by step) |
| Desktop | Web app, desktop-only (1280px+). Electron wrapper is optional later. |
| Demo flows | 1: email → customer record → reply. 2: booking request → calendar. 4: chained email flow plus photo → social post. All built live by the builder, none hard-coded. |

**Out of scope for the MVP:** user accounts and auth, multi-user, OAuth apps, dynamic MCP/skill loading, auto-sending or auto-posting, mobile layouts, hosted deployment.

## 3. Architecture

```
┌──────────────── Web app (React, localhost:5173) ────────────────┐
│  Agent panel (chat + push-to-talk)  │  Canvas (React Flow)       │
│                                     │  [Design] ⇄ [Runtime]      │
│  Home · Chore reducers · Lists nav  │  Step inspector drawer     │
└───────────────▲──────────────────────────────▲───────────────────┘
                │ REST + SSE                    │
┌───────────────┴──────── Server (Node/Hono, localhost:8787) ──────┐
│ Builder agent (Spark tool loop) ─edits→ Workflow defs (versioned)│
│ Engine: triggers → run queue → step executor → run log           │
│ Step catalog (typed, JSON-schema I/O)   Table store (SQLite)     │
│ Model gateway: Spark · Wonder · Image · SAM · Transcribe · Glimmer│
└───────────────▲──────────────────────────────────────────────────┘
                │ WebSocket (commands ↓ / events + data ↑)
┌───────────────┴──── Chrome extension (MV3) ──────────────────────┐
│ Adapters: Gmail · Calendar · Meta Business Suite (+ screenshot)  │
└──────────────────────────────────────────────────────────────────┘
```

**Repo layout (monorepo, pnpm workspaces):** `apps/web`, `apps/server`, `apps/extension`, `packages/shared` (step catalog schemas, workflow and run types, extension protocol).

**Stack:**
- Web: Vite, React 19, TypeScript, Tailwind v4, shadcn/ui (Radix), React Flow (xyflow), Motion.
- Server: Node, Hono, SQLite via Drizzle, zod, jexl, `openai` SDK pointed at Meta Model API, SSE for live updates.
- Extension: Manifest V3, TypeScript, content scripts per site, background service worker holding the WebSocket.

**Model use:**

| Model | Job |
|---|---|
| Muse Spark 1.3 | Builder agent (tool calling), `ai.extract` / `ai.classify` / `ai.write`, explanations, screenshot vision fallback |
| Muse Wonder 1.0 | `propose_plan` for complex requests (more than about 6 steps or any branching) |
| Muse Voice Transcribe | Push-to-talk input, streaming with end-of-speech detection |
| Muse Image | Onboarding and design-mode backgrounds, `image.generate` / `image.edit` steps |
| SAM 3.1 | `image.cutout` step (product cut out of a phone photo) |
| Muse Glimmer (local, OpenAI-compatible endpoint via LM Studio or llama.cpp) | Inbox triage before `trigger.email` fires a run. Falls back to Spark if not running. |
| Muse Code | The coding agent used to build the project |

Gateway config: `{ builder: spark-1.3, planner: wonder-1.0, triage: glimmer | spark-1.3, vision: spark-1.3 }`. There is no Meta text-to-speech model, so the app listens but replies in text.

## 4. Workflow modes

**Design mode** is where workflows are built and edited:
- The canvas is editable by Dad (drag, connect, configure) or by the agent. Every change creates a new workflow version, so there is always undo, and runs record the version they ran.
- Each step box shows its type, a plain-English summary and the sample data that flows in and out.
- **Test-run** executes once on a real sample (for example the email currently open in Gmail). Results appear on each box. Side-effecting steps only draft or preview.
- **Turn on** activates the trigger and switches to runtime mode.
- Mood: a faded, slowly drifting Muse Image background, soft ambient sound, a chime as each step snaps in.

**Runtime mode** is where Dad watches workflows run:
- The same graph and positions, read-only, with live run state per box: running, done, waiting for approval, failed, skipped. Edges animate as data moves.
- A runs list on the left ("Today 10:42 · email from Sarah → saved lead → reply drafted ✓").
- Clicking a box on any run opens the inspector: input, output, model, cost, duration, and the stored one-line **why**.
- Approval steps pause the run and show Approve / Edit / Skip on the box.
- Failures show a red box, a plain reason, **Fix this step** (jumps to design mode on that step with the agent ready) and **Retry** (re-runs only that step from its stored input).
- Mood: the background fades to a plain surface, sound off, tighter contrast.

## 5. Workflow definition and step catalog

```ts
Workflow { id, name, description, version, status: 'draft'|'on'|'off',
  trigger: StepInstance, steps: StepInstance[], edges: {from, to, when?}[] }
StepInstance { id, type, title, summary,
  config: object,                    // validated by the step type's configSchema
  inputs: Record<string, Binding>,   // e.g. "{{trigger.email.body}}"
  position: {x, y} }
```

- Bindings use `{{stepId.field}}` templates evaluated with jexl (sandboxed expressions). Conditional edges use `when` expressions, for example `classify.isBooking == true`. Graphs have no cycles.
- Each step type declares `configSchema`, `inputSchema` and `outputSchema` in zod in `packages/shared`. The same schemas generate the builder's tool definitions and the canvas config forms.

**MVP catalog:**

| Group | Step types |
|---|---|
| Trigger | `trigger.gmailButton` (button injected into Gmail), `trigger.email` (new Gmail message, needs Gmail open), `trigger.schedule` (cron in Dad's timezone), `trigger.upload` (photo or file dropped in the app), `trigger.manual` |
| Fetch | `gmail.read`, `calendar.freeBusy`, `table.query` |
| Enrich | `ai.extract`, `ai.classify`, `ai.write`, `image.cutout`, `image.generate`, `image.edit`, `code.transform` |
| Store | `table.upsert`, `table.insert` |
| Act | `gmail.draftReply`, `calendar.createEvent`, `meta.draftPost`, `approval.ask`, `notify` |

All `gmail.*`, `calendar.*`, `meta.*` steps and the Gmail triggers run through the Chrome extension. The server never calls Google or Meta directly.

**Demo flows the builder must be able to produce:**
- **Flow 1 (email → customer record → reply):** `trigger.gmailButton` → `ai.extract` → `table.upsert(Customers)` → `ai.write` → `approval.ask` → `gmail.draftReply`
- **Flow 2 (booking request → calendar):** `trigger.email` → `ai.classify(is booking?)` → `ai.extract(date, time, tz)` → `calendar.freeBusy` → `table.insert(Bookings)` → `calendar.createEvent` + `gmail.draftReply`
- **Flow 4 (chained):** flow 1 with a "new customer" branch, plus `trigger.upload` → `image.cutout` → `image.generate` → `table.insert(Posts)` → `meta.draftPost`

**Tables** are created by the builder's `create_table` tool (name, typed columns, display field), stored as real SQLite tables and registered in a `_tables` registry so steps and views get type checks.

**Views (MVP):** an automatic grid view per table, plus card-list and stat (count or sum) views that the agent can pin to the home screen.

**`code.transform`:** the agent writes `(input) => output` in JS. It runs in `node:vm` with a timeout and no network or filesystem access, is validated against its output schema, and is shown in the inspector as code plus a plain-English explanation.

## 6. Builder agent

One conversation per workflow, in the agent panel beside the canvas. Voice input streams through Muse Voice Transcribe with end-of-speech detection.

**Loop (Muse Spark 1.3 with tool calling):**
1. **Understand.** Repeat the problem back in Dad's words, acknowledge that running a business is hard, and ask at most 2–3 questions, each with clickable answers.
2. **Plan.** `propose_plan` shows a row of ghost boxes on the canvas. Dad accepts or asks for changes. Complex requests route this call to Muse Wonder.
3. **Build.** `create_table`, `add_step`, `connect`, `set_config`, `set_trigger`. Each call is validated against the catalog. Validation errors go back to the agent to fix, not to Dad. Each box animates in with a chime.
4. **Test.** `test_run` on a real sample. The agent explains each step's result in one sentence.
5. **Turn on.** `activate` on Dad's yes, then switch to runtime mode.

**Other tools:** `explain` (any step, run, table or UI element), `query_table`, `query_runs`, `edit_step`.

**Clicking and talking are the same actions.** Every agent tool maps to a UI action, and both call the same server functions. Manual edits are reported to the agent so the conversation stays in sync.

**Rules:** plain words only and no JSON unless asked; anything that sends or posts defaults to draft plus approval; always use the stored timezone; ask before guessing anything that touches a real customer. The prompt includes the three demo flows as worked examples.

## 7. Engine, runs and explanations

```ts
Run     { id, workflowId, workflowVersion, triggerPayload, status: 'running'|'waiting'|'done'|'failed', startedAt, endedAt }
StepRun { id, runId, stepId, status: 'pending'|'running'|'waiting'|'done'|'failed'|'skipped',
          input, output, error?, model?, tokens?, costUsd?, durationMs, why, startedAt }
```

- One in-process worker walks the graph in dependency order and runs independent branches in parallel.
- Per step: resolve bindings, validate input, execute, validate output, save the StepRun before moving on. Runs resume after a restart from the last saved step.
- Conditional edges that evaluate false mark the steps below them `skipped`, with the reason stored.
- `approval.ask` sets the run to `waiting`. Approve / Edit / Skip resumes it. An edit becomes the step's output.
- Extension steps send `{ id, site, action, input }` with a timeout. If Chrome or the site is not open, the step fails with a friendly reason ("I need Gmail open in Chrome to do this").
- Model calls retry twice with backoff. Extension and side-effecting steps never retry automatically.
- Every AI step returns `{ output, why }` from one structured call. Non-AI steps get a templated why.
- **Run story:** the run header shows 3–4 plain-English lines assembled from the why fields.
- **Questions about runs:** "Why didn't Bob get a reply yesterday?" uses `query_runs` and `explain`, and the canvas highlights the step that answers it.
- Live updates go to the web app over SSE.

**Data safety:** one local SQLite file; the server binds to localhost only; the extension only connects to localhost and must present a pairing token; model calls send only the fields each step needs; Glimmer triage keeps routine inbox filtering on the machine.

## 8. Chrome extension

- Manifest V3. The background service worker holds `ws://localhost:8787/ext` and sends a heartbeat every 20s to stay alive. Content scripts for Gmail, Google Calendar and Meta Business Suite. A popup with connection status and pairing.
- **Adapter interface:**
  ```ts
  Adapter { site: 'gmail'|'calendar'|'meta',
    actions: { [name]: { input: zod, output: zod, run(input, ctx) } },
    triggers?: { [name]: (emit) => unsubscribe } }
  ```
  The worker routes each command to an open tab of that site (opening one if needed) and returns `{ id, ok, output | error }`.
- **Reliability ladder**, most reliable first:
  1. URL-based actions: Calendar `render?action=TEMPLATE&text=…&dates=…&ctz=…`, Gmail compose `?view=cm&to=&su=&body=`.
  2. Page-structure actions with a small tested set of Gmail selectors: read the open email, reply in thread, inject the trigger button, watch for new inbox rows.
  3. Screenshot plus Muse Spark vision for reading when selectors fail or for unmapped pages (Calendar free/busy).
  4. Hand off to Dad where automation is unreliable (Meta image attach): fill the text, copy the image to the clipboard, highlight where to paste, finish as "prepared for you".
- **The Gmail button:** when a workflow with `trigger.gmailButton` is on, the extension injects a labelled button ("✨ Save as lead & reply") into the message toolbar. Clicking it sends sender, subject, body and thread id to the server. A status pill shows running, waiting for you, or done, and links to the run.
- **Nothing sends or posts automatically in the MVP.** Dad clicks the final send or post.
- **Pairing:** the app shows a 6-digit code, Dad enters it in the popup, and the server rejects sockets without the resulting token.

## 9. UX, onboarding and visual design

**Onboarding (4 screens, Muse Image backgrounds, ambient sound with a visible mute):**
1. Welcome: "Technology has made running a business harder, not easier. That's not your fault." Button: "Let's fix that."
2. About your business: name, what you do, timezone (pre-filled). Typed or spoken. Muse Image generates a personal background set from the answer.
3. Compliment and reframe: "You've kept a business running through all of it. That's the hard part." Introduces chore reducers with 3 illustrated example cards.
4. Connect Chrome: install the extension, enter the pairing code. Can be skipped.

**Home:** "What do you want to achieve today?" centred, with push-to-talk, a text box and 3–4 suggestion cards. Below: "Your chore reducers" (cards with on/off, last run, items waiting) and "Your business at a glance" (pinned views). Left rail: Home · Chore reducers · Lists · Settings. User-facing words: chore reducer (workflow), list (table), step (node).

**Workflow screen:** canvas fills the space, agent panel on the right (about 380px, collapsible), a large Design / Runtime switch at the top.

**Explain anything:** a small `?` on every box, table, column, run and button, and Alt-click anywhere, opens a short agent explanation with "tell me more".

**Visual system:** shadcn/ui on Tailwind v4 with CSS-variable tokens and three themes: Morning (warm cream, default), Evening (soft dark) and Workshop (high contrast, larger text). Inter for the interface, Nunito for headings and the prompt. Click targets of 40px or more, body text 16px minimum, motion 200–300ms ease-in-out, reduced-motion respected. Below 1280px wide, show a friendly "best on a bigger screen" message.

**Assets:** backgrounds generated with Muse Image (stock-image packs from a royalty-free library as fallback). 2–3 CC0 ambient loops and a few UI chimes stored locally. All sources and licences recorded in `ASSETS.md`.

## 10. Testing

- `packages/shared`: unit tests for schemas, binding evaluation and conditional edges.
- Engine: tests with fake step executors for ordering, parallel branches, skip propagation, approval pause and resume, failure and single-step retry, resume after restart.
- Builder: validation tests that the tool layer rejects invalid steps and connections; a scripted eval that the three demo prompts produce valid workflows of the expected shape.
- Extension: adapter tests against saved HTML snapshots of Gmail, Calendar and Meta Business Suite; a daily manual smoke checklist against the real sites.
- Model gateway: a smoke script that calls each Meta model once.

## 11. Build order

| Day | Goal | Done when |
|---|---|---|
| Wed Oct 28 | Scaffold monorepo; Meta API smoke test (Spark, Image, SAM, Transcribe); claim Meta and Baseten credits; start Glimmer locally | Every model answers one scripted call |
| Thu Oct 29 | Thin end-to-end version: hand-written flow 1 JSON, engine and StepRun log, extension pairing, Gmail button trigger, `gmail.read`, `gmail.draftReply`, `ai.extract`, `ai.write`, `table.upsert` | Clicking the Gmail button drafts a reply and saves a customer, visible in a bare run log |
| Fri Oct 30 | Canvas in runtime mode with SSE, inspector, `approval.ask` | Flow 1 lights up step by step and the draft can be approved |
| Sat Oct 31 | Builder agent tools, ghost-plan and build animation, `test_run`, design-mode editing | Saying flow 1 in plain English builds it live |
| Sun Nov 1 | Flow 2 (Calendar URL template, vision fallback for free/busy, conditional edges); flow 4 (`trigger.upload`, SAM, Muse Image, Meta prepare-to-post); `create_table` and automatic views | The builder produces all three demo flows from speech |
| Mon Nov 2 | Onboarding, home, themes, design-mode mood, voice push-to-talk, explain anything, Glimmer triage | It looks and feels like the brief |
| Tue Nov 3 | Polish, dry runs on a test Gmail account, fix the 5 worst rough edges; README with new-work statement and model map, ASSETS.md, architecture diagram; record the video | 3-minute video recorded |
| Wed Nov 4 | Buffer, re-record if needed, submit by about 5 PM ET, post on X | Submitted |

**Cut line, in order:** Glimmer triage (Spark does it), themes 2 and 3, flow 2's free/busy check, `code.transform`, card and stat views. **Never cut:** the Gmail button, the live builder animation, runtime mode with why, onboarding.

## 12. Demo script (3 minutes)

1. 0:00–0:25: Dad's problem in his own words if he will record a clip.
2. 0:25–0:50: Onboarding, his business illustrated by Muse Image, then "What do you want to achieve today?"
3. 0:50–1:40: He says "When a customer emails me, save them and draft a reply." Ghost plan, boxes build in, test run on a real email, Turn on.
4. 1:40–2:15: In Gmail, click the ✨ button. Runtime mode lights up, approve the draft, the reply appears in Gmail. "Why did Sarah get this reply?" shows the run story.
5. 2:15–2:45: Montage: booking flow lands on Calendar; photo → SAM cutout → Muse Image post → prepared in Meta Business Suite.
6. 2:45–3:00: Model map and "built with Muse Code during the hackathon".

## 13. Risks

| Risk | Mitigation |
|---|---|
| Gmail or Meta page changes break the extension | Reliability ladder, saved-page tests, vision fallback, demo on a test account recorded ahead of time |
| Builder produces invalid workflows | Schema validation with self-correction, demo flows as worked examples in the prompt |
| Time | Thin end-to-end version on day 2, cut line, video by Tue |
| Muse Code requirement and new-work rule | Build with Muse Code and say so in the README; public repo from day 1; all commits dated during the event |
| Model cost | Spark by default, Wonder only for big plans, spend limit set in Meta billing |
| MV3 service worker sleeps and drops the socket | 20s heartbeat; auto-reconnect; the app shows extension status |
