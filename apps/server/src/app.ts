import type { ServerType } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import type { Workflow } from '@dad/shared';
import { catalog } from '@dad/shared';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Bridge, WSContext as BridgeSocket } from './bridge/bridge.js';
import type { Pairing } from './bridge/pairing.js';
import type { Repo } from './db/repo.js';
import type { createEngine } from './engine/engine.js';
import type { EngineEvent } from './engine/events.js';
import { buildRunStory } from './engine/story.js';
import type { TableStore } from './tables/store.js';
import { createWorkflowOps, type OpResult } from './workflows/ops.js';
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

  // The canvas and the builder agent change workflows ONLY through these ops.
  const ops =
    repo && tables
      ? createWorkflowOps({ repo, tables, catalog, onChange: onWorkflowChange })
      : undefined;

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

  // Task 11 contract. Missing repo/engine deps are a distinct 500 from the
  // bridge's 'Bridge not configured': these routes never touch the bridge.
  app.get('/api/workflows', (c) => {
    if (!repo) return c.json({ error: 'Server not configured' }, 500);
    return c.json(repo.listWorkflows());
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
  const OP_ARGS: Record<string, z.ZodTypeAny> = {
    setTrigger: z.tuple([
      z.object({
        type: z.string(),
        config: z.record(z.string(), z.unknown()),
        title: z.string().optional(),
        summary: z.string().optional(),
      }),
    ]),
    addStep: z.tuple([
      z.object({
        type: z.string(),
        title: z.string(),
        summary: z.string(),
        config: z.record(z.string(), z.unknown()),
        inputs: z.record(z.string(), z.string()),
        after: z.string().optional(),
      }),
    ]),
    updateStep: z.tuple([
      z.string(),
      z.object({
        title: z.string().optional(),
        summary: z.string().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        inputs: z.record(z.string(), z.string()).optional(),
      }),
    ]),
    removeStep: z.tuple([z.string()]),
    connect: z.tuple([
      z.object({ from: z.string(), to: z.string(), when: z.string().optional() }),
    ]),
    disconnect: z.tuple([z.object({ from: z.string(), to: z.string() })]),
    move: z.tuple([z.string(), z.object({ x: z.number(), y: z.number() })]),
    setStatus: z.tuple([z.enum(['on', 'off'])]),
    rename: z.tuple([
      z.object({ name: z.string(), description: z.string().optional() }),
    ]),
  };
  const OP_NAMES = new Set(Object.keys(OP_ARGS));
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
    if (!OP_NAMES.has(op)) return c.json({ error: `Unknown op: ${op}` }, 400);
    if (!OP_ARGS[op]!.safeParse(args).success) {
      return c.json({ error: 'Invalid op body' }, 400);
    }
    const fn = (ops as unknown as Record<string, (...a: unknown[]) => OpResult>)[op]!;
    return c.json(fn(id, ...args, { by: 'dad' }));
  });

  app.get('/api/runs', (c) => {
    if (!repo) return c.json({ error: 'Server not configured' }, 500);
    const workflowId = c.req.query('workflowId');
    return c.json(repo.listRuns(workflowId ? { workflowId } : {}));
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
    return c.json({ run: got.run, steps: got.steps, story: buildRunStory(workflow, got.steps), workflow });
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
    return c.json({ run: full.run, steps: full.steps, story: buildRunStory(workflow, full.steps) });
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
    return c.json({ run: full.run, steps: full.steps, story: buildRunStory(workflow, full.steps) });
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
      engine.events.on('event', onEvent);
      try {
        await new Promise<void>((resolve) => {
          if (c.req.raw.signal.aborted) return resolve();
          c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      } finally {
        // Always unsubscribe: one leaked listener per SSE connection would
        // accumulate on the singleton engine's emitter.
        engine.events.off('event', onEvent);
      }
    });
  });

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
