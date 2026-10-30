import type { ServerType } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import type { Workflow } from '@dad/shared';
import { catalog } from '@dad/shared';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { EventEmitter } from 'node:events';
import { z } from 'zod';
import { AGENT_BUSY_MESSAGE, type BuilderAgent } from './agent/loop.js';
import type { Bridge, WSContext as BridgeSocket } from './bridge/bridge.js';
import { type Pairing } from './bridge/pairing.js';
import type { Repo } from './db/repo.js';
import type { createEngine } from './engine/engine.js';
import type { EngineEvent } from './engine/events.js';
import { buildRunStory } from './engine/story.js';
import { FileNotFoundError, FileRejectedError, type FileStore } from './files/store.js';
import type { TestRunResult } from './engine/testRun.js';
import type { ImageModels } from './models/image.js';
import { DEFAULT_MOOD_BUSINESS_WHAT, generateMoodSet } from './mood/generate.js';
import type { SettingsStore } from './settings/store.js';
import type { TableStore } from './tables/store.js';
import type { ViewStore } from './views/store.js';
import { createVoiceHandlers, type VoiceProxyOptions } from './voice/proxy.js';
import { createWorkflowOps, type OpResult, type WorkflowOps } from './workflows/ops.js';
import { checkWorkflow } from './workflows/validate.js';

// Grows in later tasks (gateway, store, engine, bridge...). Kept as an
// interface so call sites can add fields without changing createApp's shape.
export interface AppDeps {
  [key: string]: unknown;
}

type FullBridge = Bridge & { attach(ws: BridgeSocket): void };

// NOTE: installed @hono/node-ws@1.x requires createNodeWebSocket({ app }) —
// the binding is per app instance, not a module-scope singleton. Each
// createApp() call registers its own injector here; index.ts and tests pass
// their app back to injectAppWebSocket(). Per-app binding is also what keeps
// tests isolated (every test builds its own app + bridge + server).
const injectors = new WeakMap<object, (server: ServerType) => void>();

/** Enable /ext WebSocket upgrades on a server for a createApp() app. */
export function injectAppWebSocket(app: Hono, server: ServerType): void {
  const inject = injectors.get(app);
  if (!inject) throw new Error('WebSocket not configured for this app');
  inject(server);
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  // Deps arrive via the Task 1 index-signature shape; cast on read.
  const pairing = deps.pairing as Pairing | undefined;
  const bridge = deps.bridge as FullBridge | undefined;
  const repo = deps.repo as Repo | undefined;
  const engine = deps.engine as ReturnType<typeof createEngine> | undefined;
  const tables = deps.tables as TableStore | undefined;
  const onWorkflowChange = deps.onWorkflowChange as
    | ((wf: Workflow, note: string, by: 'dad' | 'agent') => void)
    | undefined;
  const agent = deps.agent as BuilderAgent | undefined;
  const agentEvents = deps.agentEvents as EventEmitter | undefined;
  const testRun = deps.testRun as ((workflowId: string) => Promise<TestRunResult>) | undefined;
  const appSettings = deps.appSettings as SettingsStore | undefined;
  const setTimezone = deps.setTimezone as ((tz: string) => void) | undefined;
  const files = deps.files as FileStore | undefined;
  const views = deps.views as ViewStore | undefined;
  const voice = deps.voice as VoiceProxyOptions | undefined;
  const image = deps.image as ImageModels | undefined;

  // The canvas and the builder agent change workflows ONLY through these ops.
  // The composition root shares ONE ops (so its onChange sees Dad's edits);
  // direct createApp callers without one get a local instance as before.
  const ops =
    (deps.ops as WorkflowOps | undefined) ??
    (repo && tables
      ? createWorkflowOps({ repo, tables, catalog, onChange: onWorkflowChange })
      : undefined);

  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  injectors.set(app, injectWebSocket);

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/api/pairing/start', (c) => {
    if (!pairing) return c.json({ error: 'Bridge not configured' }, 500);
    return c.json(pairing.start());
  });

  // Task 11 contract: { paired, connected }.
  app.get('/api/pairing/status', (c) => {
    if (!pairing || !bridge) return c.json({ error: 'Bridge not configured' }, 500);
    return c.json({ paired: pairing.paired(), connected: bridge.connected() });
  });

  app.post('/api/pairing/revoke', (c) => {
    if (!pairing || !bridge) return c.json({ error: 'Bridge not configured' }, 500);
    pairing.revoke();
    bridge.dropActive();
    return c.json({ revoked: true });
  });

  // The full settings document (M5). The web app GETs on first load and PUTs
  // the browser zone when none is stored; AI steps read the zone via StepContext.
  app.get('/api/settings', (c) => {
    if (!appSettings) return c.json({ error: 'Server not configured' }, 500);
    return c.json(appSettings.get());
  });

  // PUT takes a PARTIAL patch ({ theme: 'evening' }); every key is optional
  // but validated when present. An empty object is a valid no-op.
  const settingsPatchBody = z
    .object({
      businessName: z.string().optional(),
      businessWhat: z.string().optional(),
      timezone: z.string().optional(),
      theme: z.enum(['morning', 'evening', 'workshop']).optional(),
      textSize: z.enum(['normal', 'large', 'xlarge']).optional(),
      sound: z.object({ on: z.boolean(), volume: z.number().min(0).max(1) }).strict().optional(),
      onboarded: z.boolean().optional(),
      moodFileIds: z.array(z.string()).optional(),
    })
    .strict();

  app.put('/api/settings', async (c) => {
    if (!appSettings || !setTimezone) return c.json({ error: 'Server not configured' }, 500);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid settings body' }, 400);
    }
    const parsed = settingsPatchBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid settings body' }, 400);
    const { timezone, ...rest } = parsed.data;
    // The zone feeds Intl.DateTimeFormat in every AI step: a bad value throws
    // on each run until overwritten, so reject (empty, whitespace-only,
    // non-IANA) with 400 and never persist invalid.
    if (timezone !== undefined) {
      if (timezone.trim() === '') return c.json({ error: 'Invalid settings body' }, 400);
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: timezone });
      } catch {
        return c.json({ error: 'Invalid settings body' }, 400);
      }
    }
    // Nothing is written until every field validates, so a bad patch leaves
    // the stored settings untouched.
    if (Object.keys(rest).length > 0) appSettings.update(rest);
    // Timezone goes through setTimezone so live AI steps see it immediately.
    if (timezone !== undefined) setTimezone(timezone);
    return c.json(appSettings.get());
  });

  // Mood backgrounds (M5 Task 4). POST draws Dad's business in the
  // background (202 immediately) and emits { type: 'mood', fileIds } on
  // /api/events when done; GET reports the stored set plus whether a run is
  // in flight. A POST while a run is in flight is a no-op 202 (no duplicate
  // spend). The business description comes from the saved settings (Task 5's
  // Next saves first), falling back to the default-business scenes.
  let moodGenerating = false;
  app.get('/api/mood', (c) => {
    if (!appSettings) return c.json({ error: 'Server not configured' }, 500);
    return c.json({ fileIds: appSettings.get().moodFileIds, generating: moodGenerating });
  });

  app.post('/api/mood/generate', (c) => {
    if (!appSettings || !image || !files) {
      return c.json({ error: 'Server not configured' }, 500);
    }
    if (moodGenerating) return c.json({}, 202);
    moodGenerating = true;
    const stored = appSettings.get().businessWhat?.trim();
    const businessWhat = stored ? stored : DEFAULT_MOOD_BUSINESS_WHAT;
    generateMoodSet({ image, files, settings: appSettings }, { businessWhat })
      .then((fileIds) => {
        engine?.events.emit('event', { type: 'mood', fileIds });
      })
      .catch((err) => {
        console.error('[mood] generation failed:', err);
      })
      .finally(() => {
        moodGenerating = false;
      });
    return c.json({}, 202);
  });

  // Task 11 contract. Missing repo/engine deps are a distinct 500 from the
  // bridge's 'Bridge not configured': these routes never touch the bridge.
  app.get('/api/workflows', (c) => {
    if (!repo) return c.json({ error: 'Server not configured' }, 500);
    return c.json(repo.listWorkflows());
  });

  // Photo uploads: multipart field `file` → FileRef. Rejections (not a
  // photo, unreadable HEIC) are 400s with the store's readable message.
  app.post('/api/files', async (c) => {
    if (!files) return c.json({ error: 'Server not configured' }, 500);
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) return c.json({ error: 'Choose a photo to upload.' }, 400);
    try {
      const ref = await files.saveUpload(
        Buffer.from(await file.arrayBuffer()),
        file.type || 'application/octet-stream',
      );
      return c.json(ref);
    } catch (err) {
      if (err instanceof FileRejectedError) return c.json({ error: err.message }, 400);
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.get('/api/files/:id', async (c) => {
    if (!files) return c.json({ error: 'Server not configured' }, 500);
    try {
      const { buf, mime } = await files.read(c.req.param('id'));
      return new Response(buf, { headers: { 'Content-Type': mime } });
    } catch (err) {
      if (err instanceof FileNotFoundError) return c.json({ error: err.message }, 404);
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // Lists + saved views (M4 Task 8). Counts and paging slice the full
  // query: Dad-scale lists fit in memory, so no SQL-level paging.
  app.get('/api/lists', (c) => {
    if (!tables) return c.json({ error: 'Server not configured' }, 500);
    return c.json(
      tables.listTables().map((t) => ({ ...t, count: tables.query(t.name).length })),
    );
  });

  app.get('/api/lists/:table/rows', (c) => {
    if (!tables) return c.json({ error: 'Server not configured' }, 500);
    const table = c.req.param('table');
    if (!tables.getTable(table)) return c.json({ error: `Unknown table: ${table}` }, 404);
    const limitRaw = c.req.query('limit') ?? '50';
    const offsetRaw = c.req.query('offset') ?? '0';
    const limit = Number(limitRaw);
    const offset = Number(offsetRaw);
    if (!Number.isInteger(limit) || limit < 0) {
      return c.json({ error: `Invalid limit: ${limitRaw}` }, 400);
    }
    if (!Number.isInteger(offset) || offset < 0) {
      return c.json({ error: `Invalid offset: ${offsetRaw}` }, 400);
    }
    const all = tables.query(table);
    return c.json({ rows: all.slice(offset, offset + limit), total: all.length });
  });

  app.get('/api/views', (c) => {
    if (!views) return c.json({ error: 'Server not configured' }, 500);
    return c.json(views.list());
  });

  const viewBody = z
    .object({
      table: z.string(),
      kind: z.enum(['grid', 'cards', 'stat']),
      title: z.string(),
      pinned: z.boolean(),
      config: z
        .object({
          columns: z.array(z.string()).optional(),
          stat: z
            .object({
              op: z.enum(['count', 'sum']),
              column: z.string().optional(),
              where: z.record(z.string(), z.unknown()).optional(),
              sinceDays: z.number().optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict();

  app.post('/api/views', async (c) => {
    if (!views) return c.json({ error: 'Server not configured' }, 500);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid view body' }, 400);
    }
    const parsed = viewBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid view body' }, 400);
    try {
      return c.json(views.save({ ...parsed.data, config: parsed.data.config ?? {} }));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.delete('/api/views/:id', (c) => {
    if (!views) return c.json({ error: 'Server not configured' }, 500);
    try {
      views.remove(c.req.param('id'));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
    }
    return c.json({ removed: true });
  });

  app.get('/api/views/:id/data', (c) => {
    if (!views) return c.json({ error: 'Server not configured' }, 500);
    const id = c.req.param('id');
    const view = views.list().find((v) => v.id === id);
    if (!view) return c.json({ error: `Unknown view: ${id}` }, 404);
    try {
      return c.json(views.compute(view));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  const createWorkflowBody = z.object({ name: z.string(), description: z.string() }).strict();

  app.post('/api/workflows', async (c) => {
    if (!repo || !ops) return c.json({ error: 'Server not configured' }, 500);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid workflow body' }, 400);
    }
    const parsed = createWorkflowBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid workflow body' }, 400);
    return c.json(ops.create(parsed.data));
  });

  app.get('/api/workflows/:id', (c) => {
    if (!repo || !tables) return c.json({ error: 'Server not configured' }, 500);
    const id = c.req.param('id');
    const wf = repo.getWorkflow(id);
    if (!wf) return c.json({ error: `Unknown workflow: ${id}` }, 404);
    return c.json({ ...wf, problems: checkWorkflow(wf, tables) });
  });

  // The ops route takes positional args (the workflow id comes from the URL):
  //   { op: 'move', args: ['save-k3j2a1', { x: 10, y: 20 }] }
  // These schemas check shapes only; the ops do the semantic validation.
  // A refused op is still a 200: the OpResult body carries the readable error.
  // Keyed by DispatchOp (every WorkflowOps method except create) so a schema
  // key with no matching method — or a method with no schema — fails the
  // build instead of throwing a TypeError at runtime on user input.
  type DispatchOp = Exclude<keyof WorkflowOps, 'create'>;
  const OP_ARGS: Record<DispatchOp, z.ZodTypeAny> = {
    setTrigger: z.tuple([
      z
        .object({
          type: z.string(),
          config: z.record(z.string(), z.unknown()),
          title: z.string().optional(),
          summary: z.string().optional(),
        })
        .strict(),
    ]),
    addStep: z.tuple([
      z
        .object({
          type: z.string(),
          title: z.string(),
          summary: z.string(),
          config: z.record(z.string(), z.unknown()),
          inputs: z.record(z.string(), z.string()),
          after: z.string().optional(),
        })
        .strict(),
    ]),
    updateStep: z.tuple([
      z.string(),
      z
        .object({
          title: z.string().optional(),
          summary: z.string().optional(),
          config: z.record(z.string(), z.unknown()).optional(),
          inputs: z.record(z.string(), z.string()).optional(),
        })
        .strict(),
    ]),
    removeStep: z.tuple([z.string()]),
    connect: z.tuple([
      z.object({ from: z.string(), to: z.string(), when: z.string().optional() }).strict(),
    ]),
    disconnect: z.tuple([z.object({ from: z.string(), to: z.string() }).strict()]),
    move: z.tuple([z.string(), z.object({ x: z.number(), y: z.number() }).strict()]),
    setStatus: z.tuple([z.enum(['on', 'off'])]),
    rename: z.tuple([
      z.object({ name: z.string(), description: z.string().optional() }).strict(),
    ]),
  };
  const OP_NAMES: ReadonlySet<string> = new Set(Object.keys(OP_ARGS));
  const isDispatchOp = (op: string): op is DispatchOp => OP_NAMES.has(op);
  const opsBody = z.object({ op: z.string(), args: z.array(z.unknown()) }).strict();

  app.post('/api/workflows/:id/ops', async (c) => {
    if (!repo || !ops) return c.json({ error: 'Server not configured' }, 500);
    const id = c.req.param('id');
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid op body' }, 400);
    }
    const parsed = opsBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid op body' }, 400);
    const { op, args } = parsed.data;
    if (op === 'create') {
      return c.json({ error: 'Use POST /api/workflows to create a workflow' }, 400);
    }
    if (!isDispatchOp(op)) return c.json({ error: `Unknown op: ${op}` }, 400);
    const argsParsed = OP_ARGS[op].safeParse(args);
    if (!argsParsed.success) {
      return c.json({ error: 'Invalid op body' }, 400);
    }
    // Indexed by DispatchOp, so the method must exist; the single `as` only
    // unifies the per-op signatures into one variadic call shape.
    const fn = ops[op] as (...a: unknown[]) => OpResult;
    // Forward the validated args, not the raw body, so unknown keys can
    // never ride through to the op even if a schema stops being strict.
    const validatedArgs = argsParsed.data as unknown[];
    return c.json(fn(id, ...validatedArgs, { by: 'dad' }));
  });

  const agentBody = z.object({ text: z.string().min(1) }).strict();

  // One turn at a time per workflow: the 202 returns immediately and the turn
  // runs in the background; a second send while busy is a 409.
  app.post('/api/workflows/:id/agent', async (c) => {
    if (!repo || !agent) return c.json({ error: 'Server not configured' }, 500);
    const id = c.req.param('id');
    if (!repo.getWorkflow(id)) return c.json({ error: `Unknown workflow: ${id}` }, 404);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid agent body' }, 400);
    }
    const parsed = agentBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid agent body' }, 400);
    // No await between the check and the send, so no second request can slip
    // in: send sets the busy flag synchronously at call time.
    if (agent.isBusy(id)) return c.json({ error: AGENT_BUSY_MESSAGE }, 409);
    agent.send(id, parsed.data.text).catch((err) => {
      console.error('[agent] turn failed:', err);
    });
    return c.json({}, 202);
  });

  app.get('/api/workflows/:id/agent', (c) => {
    if (!repo || !agent) return c.json({ error: 'Server not configured' }, 500);
    const id = c.req.param('id');
    if (!repo.getWorkflow(id)) return c.json({ error: `Unknown workflow: ${id}` }, 404);
    return c.json(agent.getTranscript(id));
  });

  app.get('/api/runs', (c) => {
    if (!repo) return c.json({ error: 'Server not configured' }, 500);
    const workflowId = c.req.query('workflowId');
    return c.json(repo.listRuns(workflowId ? { workflowId } : {}));
  });

  // The canvas "Try it" button: runs the SHARED test runner (bound in main.ts,
  // the same instance the builder agent uses — never a second construction)
  // and returns the run, its steps, the sample flag, and the story lines, so
  // the design screen needs no follow-up fetch for its story strip. The story
  // is cheap (pure function over the run's own pinned version, same idiom as
  // GET /api/runs/:id below). Runner failures (e.g. a trigger with no sample)
  // are 500s with the message, matching the server's error idiom.
  app.post('/api/workflows/:id/test', async (c) => {
    if (!repo || !testRun) return c.json({ error: 'Server not configured' }, 500);
    const id = c.req.param('id');
    if (!repo.getWorkflow(id)) return c.json({ error: `Unknown workflow: ${id}` }, 404);
    try {
      const { run, steps, usedSample } = await testRun(id);
      const workflow = repo.getWorkflow(run.workflowId, run.workflowVersion);
      if (!workflow) return c.json({ error: `Unknown workflow: ${run.workflowId}` }, 500);
      return c.json({
        run,
        steps,
        usedSample,
        story: buildRunStory(workflow, steps, { usedSample }),
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // The photo drop zone: multipart `file` (+ optional `note`) → saves the
  // photo and starts a run with { file, note? }. An explicit user start, so
  // it runs whatever the workflow status is (like "Try it", no status gate).
  app.post('/api/workflows/:id/upload', async (c) => {
    if (!repo || !engine || !files) return c.json({ error: 'Server not configured' }, 500);
    const id = c.req.param('id');
    const wf = repo.getWorkflow(id);
    if (!wf) return c.json({ error: `Unknown workflow: ${id}` }, 404);
    if (wf.trigger.type !== 'trigger.upload') {
      return c.json({ error: "This chore reducer doesn't start from a photo upload." }, 400);
    }
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) return c.json({ error: 'Choose a photo to upload.' }, 400);
    const rawNote = body['note'];
    const note = typeof rawNote === 'string' && rawNote !== '' ? rawNote : undefined;
    try {
      const saved = await files.saveUpload(
        Buffer.from(await file.arrayBuffer()),
        file.type || 'application/octet-stream',
      );
      const run = await engine.start(id, note === undefined ? { file: saved } : { file: saved, note });
      return c.json({ run, file: saved });
    } catch (err) {
      if (err instanceof FileRejectedError) return c.json({ error: err.message }, 400);
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.get('/api/runs/:id', (c) => {
    if (!repo) return c.json({ error: 'Server not configured' }, 500);
    const id = c.req.param('id');
    const got = repo.getRun(id);
    if (!got) return c.json({ error: `Unknown run: ${id}` }, 404);
    // The run's OWN pinned version, not latest: the canvas must render the
    // definition the run actually executed.
    const workflow = repo.getWorkflow(got.run.workflowId, got.run.workflowVersion);
    if (!workflow) return c.json({ error: `Unknown workflow: ${got.run.workflowId}` }, 500);
    // usedSample is read from the persisted run (M3 Task 6), so a refetch
    // keeps the "sample email" prefix exactly as the test response had it.
    const story = buildRunStory(workflow, got.steps, { usedSample: got.run.usedSample });
    return c.json({ run: got.run, steps: got.steps, story, workflow });
  });

  // Strict: approve/skip take no text, edit requires it. A surplus field is a
  // client bug, so it 400s rather than being silently stripped.
  const approvalBody = z.discriminatedUnion('action', [
    z.object({ action: z.literal('approve') }).strict(),
    z.object({ action: z.literal('edit'), text: z.string() }).strict(),
    z.object({ action: z.literal('skip') }).strict(),
  ]);

  // 404/409 taxonomy without engine changes: the engine throws the SAME
  // message for unknown ids and wrong-state steps, so the routes check ids
  // themselves (404) and map any engine throw to 409. No TOCTOU: the repo is
  // synchronous, so nothing interleaves between the check and the engine's
  // own re-check at the head of resolveApproval/retryStep.
  app.post('/api/runs/:id/steps/:stepId/approval', async (c) => {
    if (!repo || !engine) return c.json({ error: 'Server not configured' }, 500);
    const id = c.req.param('id');
    const stepId = c.req.param('stepId');
    const got = repo.getRun(id);
    if (!got) return c.json({ error: `Unknown run: ${id}` }, 404);
    if (!got.steps.some((s) => s.stepId === stepId)) {
      return c.json({ error: `Unknown step: ${stepId}` }, 404);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid approval body' }, 400);
    }
    const parsed = approvalBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid approval body' }, 400);
    // An empty edit would approve blank text: 422, matching the Task 6 card's
    // "The reply is empty" wording. Whitespace-only counts as empty — it
    // renders as nothing in the draft.
    if (parsed.data.action === 'edit' && parsed.data.text.trim().length === 0) {
      return c.json({ error: 'The reply is empty' }, 422);
    }
    try {
      await engine.resolveApproval(id, stepId, parsed.data);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 409);
    }
    const full = repo.getRun(id)!;
    const workflow = repo.getWorkflow(full.run.workflowId, full.run.workflowVersion);
    if (!workflow) return c.json({ error: `Unknown workflow: ${full.run.workflowId}` }, 500);
    return c.json({
      run: full.run,
      steps: full.steps,
      story: buildRunStory(workflow, full.steps, { usedSample: full.run.usedSample }),
    });
  });

  app.post('/api/runs/:id/steps/:stepId/retry', async (c) => {
    if (!repo || !engine) return c.json({ error: 'Server not configured' }, 500);
    const id = c.req.param('id');
    const stepId = c.req.param('stepId');
    const got = repo.getRun(id);
    if (!got) return c.json({ error: `Unknown run: ${id}` }, 404);
    if (!got.steps.some((s) => s.stepId === stepId)) {
      return c.json({ error: `Unknown step: ${stepId}` }, 404);
    }
    try {
      await engine.retryStep(id, stepId);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 409);
    }
    const full = repo.getRun(id)!;
    const workflow = repo.getWorkflow(full.run.workflowId, full.run.workflowVersion);
    if (!workflow) return c.json({ error: `Unknown workflow: ${full.run.workflowId}` }, 500);
    return c.json({
      run: full.run,
      steps: full.steps,
      story: buildRunStory(workflow, full.steps, { usedSample: full.run.usedSample }),
    });
  });

  app.get('/api/events', (c) => {
    if (!engine) return c.json({ error: 'Server not configured' }, 500);
    // Verified against the installed hono: streamSSE lives in 'hono/streaming'
    // and writeSSE takes { data }. The stream ends when the client aborts.
    return streamSSE(c, async (stream) => {
      const onEvent = (e: EngineEvent): void => {
        // A write after disconnect rejects; swallow it (the abort below ends
        // the stream) instead of surfacing an unhandled rejection.
        void stream.writeSSE({ data: JSON.stringify(e) }).catch(() => {});
      };
      const onAgent = (e: { type: 'agent'; workflowId: string; event: unknown }): void => {
        void stream.writeSSE({ data: JSON.stringify(e) }).catch(() => {});
      };
      engine.events.on('event', onEvent);
      agentEvents?.on('event', onAgent);
      try {
        await new Promise<void>((resolve) => {
          if (c.req.raw.signal.aborted) return resolve();
          c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      } finally {
        // Always unsubscribe: one leaked listener per SSE connection would
        // accumulate on the singleton engine's emitter.
        engine.events.off('event', onEvent);
        agentEvents?.off('event', onAgent);
      }
    });
  });

  // Push-to-talk (M5 Task 3): the browser streams PCM here and the proxy
  // bridges it to Muse Voice Transcribe realtime, holding MODEL_API_KEY on
  // the server side. Without a key the socket errors and closes.
  app.get(
    '/api/voice',
    upgradeWebSocket(() =>
      createVoiceHandlers({
        apiKey: voice?.apiKey,
        upstreamUrl: voice?.upstreamUrl,
        connectTimeoutMs: voice?.connectTimeoutMs,
        finalWaitTimeoutMs: voice?.finalWaitTimeoutMs,
      }),
    ),
  );

  app.get(
    '/ext',
    upgradeWebSocket(() => {
      if (!bridge) {
        return {
          onOpen(_e: Event, ws: { close(code?: number, reason?: string): void }) {
            ws.close(1011, 'Bridge not configured');
          },
        };
      }
      // One adapter per connection: the bridge drives it via onmessage/onclose.
      let socket: BridgeSocket | null = null;
      return {
        onOpen(
          _e: Event,
          ws: { send(data: string): void; close(code?: number, reason?: string): void },
        ) {
          const s: BridgeSocket = {
            send: (d) => ws.send(d),
            close: (code, reason) => ws.close(code, reason),
          };
          socket = s;
          bridge.attach(s);
        },
        onMessage(e: MessageEvent) {
          socket?.onmessage?.(String(e.data));
        },
        onClose() {
          socket?.onclose?.();
          socket = null;
        },
      };
    }),
  );

  return app;
}
