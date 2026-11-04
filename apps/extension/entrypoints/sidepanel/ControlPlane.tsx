import ArrowUpRight from 'lucide-react/icons/arrow-up-right';
import Check from 'lucide-react/icons/check';
import Pause from 'lucide-react/icons/pause';
import Pencil from 'lucide-react/icons/pencil';
import Play from 'lucide-react/icons/play';
import Plus from 'lucide-react/icons/plus';
import Settings from 'lucide-react/icons/settings';
import { useEffect, useRef, useState } from 'react';
import { flowOrder, groupAutomations, type Automation, type AutomationStep } from '../../lib/automations.js';
import { readActivePage } from '../../lib/pageText.js';
import type { PanelSite } from '../../lib/sites.js';

// Same origin the background socket uses; covered by host_permissions.
const API = 'http://127.0.0.1:8787';

// New automations made in the app show up without touching the panel.
const REFRESH_MS = 5000;

/** How long each step stays on "Working…", so a fast run can still be followed. */
function randomStepPace(): number {
  return 1000 + Math.random() * 1000;
}

const FINISHED_STEP = new Set(['done', 'skipped', 'waiting', 'failed']);

type RunState = 'starting' | 'running' | 'waiting' | 'done' | 'failed' | 'refused';

interface StepState {
  stepId: string;
  status: string;
  why?: string;
  error?: string;
  output?: unknown;
}

interface ActiveRun {
  automation: Automation;
  id: string | null;
  state: RunState;
  steps: Record<string, StepState>;
  error: string | null;
}

const RUN_LABEL: Record<RunState, string> = {
  starting: 'Running',
  running: 'Running',
  waiting: 'Waiting for you',
  done: 'Finished',
  failed: 'Needs a look',
  refused: "Couldn't run",
};

const RUN_DETAIL: Record<RunState, string> = {
  starting: 'This is a real run on your real data.',
  running: 'This is a real run on your real data.',
  waiting: 'Check this before the run carries on.',
  done: 'This was a real run. See what it did below.',
  failed: 'A step stopped. Details below.',
  refused: 'Nothing happened.',
};

function StepDot({ status }: { status: string }) {
  return (
    <span className="run-step-icon" aria-hidden="true">
      {status === 'done' && <Check size={12} strokeWidth={3.5} />}
      {status === 'waiting' && <Pause size={11} fill="currentColor" />}
      {status === 'failed' && '!'}
    </span>
  );
}

function stepMap(steps: StepState[] | undefined): Record<string, StepState> {
  return Object.fromEntries((steps ?? []).map((s) => [s.stepId, s]));
}

function runStateOf(status: unknown): RunState {
  return status === 'waiting' || status === 'done' || status === 'failed' ? status : 'running';
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === 'string' && body.error !== '' ? body.error : fallback;
}

function postJson(path: string, body?: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

export interface ControlPlaneProps {
  site: PanelSite | null;
  connected: boolean;
  openApp(path: string): Promise<void>;
  onOpenSettings(): void;
  /** Test seam: milliseconds to hold each step on "Working…". */
  stepPace?: () => number;
}

/**
 * The side panel's main view: run an automation and see what it did. Building
 * and changing automations happens in the app.
 */
export default function ControlPlane({
  site,
  connected,
  openApp,
  onOpenSettings,
  stepPace = randomStepPace,
}: ControlPlaneProps) {
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [pageUnread, setPageUnread] = useState(false);
  // Steps before this index show what really happened. The run itself is never
  // slowed down: this only paces how the results appear.
  const [revealed, setRevealed] = useState(0);
  const [approvalText, setApprovalText] = useState<string | null>(null);
  // The one event stream outlives renders, so it reads the current run through a ref.
  const runRef = useRef<ActiveRun | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const photoFor = useRef<Automation | null>(null);

  const lastList = useRef<string | null>(null);
  const activeStep = useRef<HTMLLIElement | null>(null);

  const updateRun = (next: ActiveRun | null) => {
    runRef.current = next;
    setRun(next);
  };

  const loadAutomations = async () => {
    try {
      const res = await fetch(`${API}/api/workflows`);
      if (!res.ok) throw new Error(String(res.status));
      const list = (await res.json()) as Automation[];
      // Most refreshes find nothing new, so they shouldn't re-render.
      const text = JSON.stringify(list);
      if (text !== lastList.current) {
        lastList.current = text;
        setAutomations(list);
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  };

  useEffect(() => {
    void loadAutomations();
    if (typeof EventSource === 'undefined') return;
    const events = new EventSource(`${API}/api/events`);
    events.onmessage = (e: MessageEvent<string>) => {
      try {
        handleEvent(JSON.parse(e.data) as Record<string, unknown>);
      } catch {
        // One bad frame must not stop the stream.
      }
    };
    return () => events.close();
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadAutomations();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      clearInterval(timer);
    };
  }, []);

  const order = run === null ? [] : flowOrder(run.automation);
  const lastShown = revealed > 0 ? run?.steps[order[revealed - 1]?.id ?? '']?.status : undefined;
  const pausedOnStep = lastShown === 'waiting' || lastShown === 'failed';
  const pacing = run !== null && run.state !== 'refused' && revealed < order.length && !pausedOnStep;
  const currentId = pacing ? order[revealed]!.id : null;
  const currentStatus = currentId === null ? undefined : run?.steps[currentId]?.status;
  const stepFinished = currentStatus !== undefined && FINISHED_STEP.has(currentStatus);
  // A settled run with no record for a step means it never ran: don't hold on it.
  const neverRan =
    currentId !== null &&
    !stepFinished &&
    (run?.state === 'done' || run?.state === 'failed' || run?.state === 'waiting');

  useEffect(() => {
    if (!stepFinished && !neverRan) return;
    const timer = setTimeout(() => setRevealed((n) => n + 1), neverRan ? 0 : stepPace());
    return () => clearTimeout(timer);
  }, [currentId, stepFinished, neverRan, stepPace]);

  useEffect(() => {
    activeStep.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [revealed]);

  function handleEvent(data: Record<string, unknown>) {
    const current = runRef.current;
    if (!current) return;
    if (data['type'] === 'run') {
      const e = data['run'] as { id: string; workflowId: string; status: string; kind?: string };
      if (e.kind === 'test') return;
      // The first live run of this automation after the click is ours.
      const claims = current.id === null && e.workflowId === current.automation.id;
      if (claims || e.id === current.id) {
        updateRun({ ...current, id: e.id, state: runStateOf(e.status) });
      }
    } else if (data['type'] === 'step') {
      const e = data['stepRun'] as StepState & { runId: string };
      if (e.runId === current.id) {
        updateRun({ ...current, steps: { ...current.steps, [e.stepId]: e } });
      }
    }
  }

  function finishRun(a: Automation, id: string, status: unknown, steps: StepState[] | undefined) {
    updateRun({
      automation: a,
      id,
      state: runStateOf(status),
      steps: { ...runRef.current?.steps, ...stepMap(steps) },
      error: null,
    });
  }

  /** Runs `start`, whose response carries the run; the stream fills in progress. */
  async function trackRun(a: Automation, start: () => Promise<Response>) {
    updateRun({ automation: a, id: null, state: 'starting', steps: {}, error: null });
    setPageUnread(false);
    setRevealed(0);
    setApprovalText(null);
    const refuse = (error: string) =>
      updateRun({ automation: a, id: null, state: 'refused', steps: {}, error });
    try {
      const res = await start();
      if (!res.ok) return refuse(await errorOf(res, "Couldn't start this automation."));
      const body = (await res.json()) as { run: { id: string; status: string }; steps?: StepState[] };
      let steps = body.steps;
      // The upload route returns only the run; read its steps for the checklist.
      if (steps === undefined) {
        const detail = await fetch(`${API}/api/runs/${encodeURIComponent(body.run.id)}`);
        if (detail.ok) steps = ((await detail.json()) as { steps?: StepState[] }).steps;
      }
      finishRun(a, body.run.id, body.run.status, steps);
    } catch {
      refuse("Couldn't reach the app. Is it running?");
    }
  }

  const activate = (a: Automation) => {
    if (a.status !== 'on') return void openApp(`/automations/${encodeURIComponent(a.id)}?mode=design`);
    if (a.trigger.type === 'trigger.upload') {
      photoFor.current = a;
      photoInput.current?.click();
      return;
    }
    void trackRun(a, async () => {
      const path = `/api/workflows/${encodeURIComponent(a.id)}/run`;
      if (a.trigger.type !== 'trigger.manual') return postJson(path);
      const page = await readActivePage();
      setPageUnread(page === null);
      return postJson(path, page === null ? undefined : { page });
    });
  };

  const onPhoto = (file: File | undefined) => {
    const a = photoFor.current;
    photoFor.current = null;
    if (photoInput.current) photoInput.current.value = '';
    if (!a || !file) return;
    const form = new FormData();
    form.append('file', file);
    void trackRun(a, () =>
      fetch(`${API}/api/workflows/${encodeURIComponent(a.id)}/upload`, { method: 'POST', body: form }),
    );
  };

  async function decide(step: AutomationStep, proposed: string, skip: boolean) {
    const current = runRef.current;
    if (!current?.id) return;
    const text = approvalText ?? proposed;
    const decision = skip
      ? { action: 'skip' }
      : text === proposed
        ? { action: 'approve' }
        : { action: 'edit', text };
    updateRun({ ...current, state: 'running', error: null });
    setApprovalText(null);
    try {
      const res = await postJson(
        `/api/runs/${encodeURIComponent(current.id)}/steps/${encodeURIComponent(step.id)}/approval`,
        decision,
      );
      if (!res.ok) {
        const error = await errorOf(res, "Couldn't save that.");
        return updateRun({ ...runRef.current!, state: 'waiting', error });
      }
      const body = (await res.json()) as { run: { status: string }; steps?: StepState[] };
      finishRun(current.automation, current.id, body.run.status, body.steps);
    } catch {
      updateRun({ ...runRef.current!, state: 'waiting', error: "Couldn't reach the app. Is it running?" });
    }
  }

  // What the panel says follows the paced steps, not the run underneath.
  const shownState: RunState | null = run === null ? null : pacing ? 'running' : run.state;
  const running = shownState === 'starting' || shownState === 'running';
  const groups = groupAutomations(automations ?? [], site);

  const row = (a: Automation) => {
    const live = a.status === 'on';
    return (
      <button
        key={a.id}
        type="button"
        className={`cta ${live ? 'cta-run' : 'cta-draft'}`}
        disabled={live && (running || shownState === 'waiting')}
        onClick={() => activate(a)}
        title={live ? `Run ${a.name} now` : `${a.name} isn't on yet. Finish it in the app.`}
      >
        <span className="cta-icon" aria-hidden="true">
          {live ? <Play size={13} fill="currentColor" /> : <Pencil size={14} />}
        </span>
        <span className="cta-name">{a.name}</span>
        <span className="cta-tag">{live ? 'Run' : 'Draft'}</span>
      </button>
    );
  };

  const shownStatus = (step: AutomationStep, i: number): string => {
    if (i < revealed) return run?.steps[step.id]?.status ?? 'pending';
    return i === revealed && pacing ? 'running' : 'pending';
  };
  const stepsShownDone = order.filter((step, i) => shownStatus(step, i) === 'done').length;

  const banner = run !== null && (
    <div className="mode-banner" data-testid="run-banner" role="status">
      <div className="mode-title">
        <strong>
          {RUN_LABEL[shownState!]}: {run.automation.name}
        </strong>
        {!running && shownState !== 'waiting' && (
          <button type="button" className="mode-close" onClick={() => updateRun(null)}>
            Close
          </button>
        )}
      </div>
      <span className="dim">{RUN_DETAIL[shownState!]}</span>
      {run.state !== 'refused' && (
        <div
          className="run-strip"
          role="img"
          aria-label={`${stepsShownDone} of ${order.length} steps done`}
        >
          {order.map((step, i) => (
            <span key={step.id} data-status={shownStatus(step, i)} />
          ))}
        </div>
      )}
    </div>
  );

  const runView = run !== null && (
    <div className="run-view" data-testid="run-view">
      {run.error !== null && <p className="error">{run.error}</p>}
      {pageUnread && <p className="dim">I couldn't read this page, so this run has nothing from it.</p>}
      {run.state !== 'refused' && (
        <ol className="run-steps">
          {order.map((step, i) => {
            const status = shownStatus(step, i);
            // Nothing about a step shows until it's that step's turn.
            const state = i < revealed ? run.steps[step.id] : undefined;
            const proposed = (state?.output as { proposed?: { text?: unknown } } | undefined)?.proposed?.text;
            const waiting = status === 'waiting' && shownState === 'waiting';
            return (
              <li
                key={step.id}
                ref={i === revealed || waiting ? activeStep : undefined}
                data-step={step.id}
                data-status={status}
                className="run-step"
              >
                <div className="run-step-line">
                  <StepDot status={status} />
                  <div className="run-step-body">
                    <span className="run-step-title">
                      {status === 'pending' ? 'Then: ' : ''}
                      {step.title}
                    </span>
                    {status === 'running' && <span className="run-step-why">Working…</span>}
                    {state?.error !== undefined && <span className="error">{state.error}</span>}
                    {state?.error === undefined && state?.why !== undefined && !waiting && (
                      <span className="run-step-why">{state.why}</span>
                    )}
                  </div>
                </div>
                {waiting && (
                  <section aria-label="Approval" className="approval">
                    <span className="approval-pill">Waiting for you</span>
                    <h2>{typeof step.config['question'] === 'string' ? step.config['question'] : 'Is this OK to use?'}</h2>
                    <label htmlFor={`approval-${step.id}`} className="dim">
                      Change anything before it goes.
                    </label>
                    <textarea
                      id={`approval-${step.id}`}
                      aria-label="Proposed text"
                      rows={8}
                      value={approvalText ?? (typeof proposed === 'string' ? proposed : '')}
                      onChange={(e) => setApprovalText(e.target.value)}
                    />
                    <div className="approval-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void decide(step, typeof proposed === 'string' ? proposed : '', false)}
                      >
                        Looks good
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide(step, typeof proposed === 'string' ? proposed : '', true)}
                      >
                        Skip
                      </button>
                    </div>
                    <span className="dim">Nothing goes out until you say so.</span>
                  </section>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {run.id !== null && !running && (
        <button
          type="button"
          className="see-in-app"
          onClick={() => void openApp(`/automations/${encodeURIComponent(run.automation.id)}?mode=runs&run=${encodeURIComponent(run.id!)}`)}
        >
          See this run in the app
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );

  return (
    <div className="control" data-mode={run !== null ? 'run' : undefined}>
      <header className="brand-bar">
        <h1>OneSaaS</h1>
        <span
          className={`dot ${connected ? 'dot-on' : 'dot-off'}`}
          role="img"
          aria-label={connected ? 'Connected' : 'Not connected'}
          title={connected ? 'Connected' : 'Not connected. Is the app running?'}
        />
        <button type="button" className="icon-button" onClick={() => void openApp('/automate')} title="Open the app" aria-label="Open the app">
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
          <Settings size={16} aria-hidden="true" />
        </button>
      </header>

      {banner}

      <main className="activity">
        {run !== null ? (
          runView
        ) : (
          <div className="cta-groups">
            {loadError && <p className="error">Can't reach the app. Is it running?</p>}
            <section aria-label="Automations for this page">
              <h2>On this page</h2>
              {groups.onThisPage.length > 0 ? (
                groups.onThisPage.map(row)
              ) : (
                <p className="dim">Nothing for this page yet.</p>
              )}
            </section>
            <section aria-label="Your other automations">
              <h2>Your other automations</h2>
              {groups.others.length > 0 ? groups.others.map(row) : <p className="dim">None yet.</p>}
            </section>
            <button type="button" className="cta cta-new" onClick={() => void openApp('/automate')}>
              <span className="cta-icon" aria-hidden="true">
                <Plus size={15} />
              </span>
              <span className="cta-name">Set up a new automation</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </main>

      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => onPhoto(e.target.files?.[0])}
      />
    </div>
  );
}
