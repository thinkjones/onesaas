import { useEffect, useRef, useState } from 'react';
import { groupAutomations, type Automation, type AutomationStep } from '../../lib/automations.js';
import type { PanelSite } from '../../lib/sites.js';

// Same origin the background socket uses; covered by host_permissions.
const API = 'http://127.0.0.1:8787';

// `done` doesn't always mean the turn is over: `activate` emits one mid-turn.
// Only this long a silence after a `done` settles the chat (same as the app).
const AGENT_SETTLING_MS = 1500;

type ChatItem =
  | { kind: 'dad' | 'agent' | 'activity'; text: string }
  | { kind: 'ask'; text: string; options: string[] };

interface TranscriptEntry {
  role: 'dad' | 'agent';
  text: string;
  ask?: { options: string[] };
}

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

const STEP_ICON: Record<string, string> = {
  pending: '○',
  running: '◐',
  waiting: '⏸',
  done: '✓',
  skipped: '–',
  failed: '✕',
};

/** Names a new automation from the first sentence; the agent renames it later. */
function nameFromSentence(sentence: string): string {
  return sentence.split(/\s+/).slice(0, 6).join(' ');
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
}

/**
 * The side panel's main view: automations to run above, a chat to design them
 * below. Exactly one mode shows at a time, in a banner: a click on an automation
 * RUNS it for real, and anything sent from the chat DESIGNS (changes the selected
 * automation, or creates a new one when none is selected).
 */
export default function ControlPlane({ site, connected, openApp, onOpenSettings }: ControlPlaneProps) {
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [approvalText, setApprovalText] = useState<string | null>(null);

  // The one event stream outlives renders, so it reads the current run and
  // chat target through refs.
  const targetRef = useRef<string | null>(null);
  const runRef = useRef<ActiveRun | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const photoFor = useRef<Automation | null>(null);
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const chatInput = useRef<HTMLTextAreaElement | null>(null);

  const updateRun = (next: ActiveRun | null) => {
    runRef.current = next;
    setRun(next);
  };

  const loadAutomations = async () => {
    try {
      const res = await fetch(`${API}/api/workflows`);
      if (!res.ok) throw new Error(String(res.status));
      setAutomations((await res.json()) as Automation[]);
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
    return () => {
      events.close();
      clearTimeout(settleTimer.current);
    };
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [transcript, run]);

  function handleEvent(data: Record<string, unknown>) {
    if (data['type'] === 'agent') {
      if (data['workflowId'] === targetRef.current) handleAgentEvent(data['event'] as Record<string, unknown>);
      return;
    }
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

  function handleAgentEvent(e: Record<string, unknown>) {
    clearTimeout(settleTimer.current);
    const add = (item: ChatItem) => setTranscript((t) => [...t, item]);
    if (e['type'] === 'say') add({ kind: 'agent', text: e['text'] as string });
    if (e['type'] === 'activity') add({ kind: 'activity', text: e['text'] as string });
    if (e['type'] === 'ask') {
      add({ kind: 'ask', text: e['question'] as string, options: e['options'] as string[] });
    }
    // create_workflow makes another automation mid-turn: show it in the lists.
    if (e['type'] === 'switched') void loadAutomations();
    if (e['type'] === 'done') {
      settleTimer.current = setTimeout(() => {
        setAgentBusy(false);
        void loadAutomations();
      }, AGENT_SETTLING_MS);
    }
  }

  /** Points the chat at an automation (null = a new one) and loads its history. */
  async function selectTarget(id: string | null) {
    clearTimeout(settleTimer.current);
    targetRef.current = id;
    setTarget(id);
    setTranscript([]);
    setSendError(null);
    setAgentBusy(false);
    if (id === null) return;
    try {
      const res = await fetch(`${API}/api/workflows/${encodeURIComponent(id)}/agent`);
      if (!res.ok) return;
      const rows = (await res.json()) as TranscriptEntry[];
      if (targetRef.current !== id) return; // Moved on while this loaded.
      setTranscript(
        rows.map((r): ChatItem =>
          r.ask ? { kind: 'ask', text: r.text, options: r.ask.options } : { kind: r.role, text: r.text },
        ),
      );
    } catch {
      // History is a bonus: the chat still works without it.
    }
  }

  const startDesigning = (id: string | null) => {
    updateRun(null);
    void selectTarget(id);
    chatInput.current?.focus?.();
  };

  async function send(text: string) {
    const message = text.trim();
    if (message === '' || agentBusy) return;
    // Leaving the run view: from here on the chat is what's happening.
    updateRun(null);
    setSendError(null);
    setAgentBusy(true);
    setInput('');
    const entry: ChatItem = { kind: 'dad', text: message };
    setTranscript((t) => [...t, entry]);
    const fail = (error: string, keepBusy = false) => {
      setTranscript((t) => t.filter((item) => item !== entry));
      setSendError(error);
      setInput(message);
      if (!keepBusy) setAgentBusy(false);
    };
    try {
      let id = targetRef.current;
      if (id === null) {
        const res = await postJson('/api/workflows', {
          name: nameFromSentence(message),
          description: message,
        });
        if (!res.ok) return fail(await errorOf(res, "Couldn't start a new automation."));
        id = ((await res.json()) as { id: string }).id;
        // Set before the agent call so the stream's first reply is matched.
        targetRef.current = id;
        setTarget(id);
        void loadAutomations();
      }
      const res = await postJson(`/api/workflows/${encodeURIComponent(id)}/agent`, { text: message });
      if (!res.ok) return fail(await errorOf(res, "Couldn't reach the app."), res.status === 409);
    } catch {
      fail("Couldn't reach the app. Is it running?");
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
    setApprovalText(null);
    void selectTarget(a.id);
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
    if (a.status !== 'on') return startDesigning(a.id);
    if (a.trigger.type === 'trigger.upload') {
      photoFor.current = a;
      photoInput.current?.click();
      return;
    }
    void trackRun(a, () => postJson(`/api/workflows/${encodeURIComponent(a.id)}/run`));
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

  const running = run !== null && (run.state === 'starting' || run.state === 'running');
  const groups = groupAutomations(automations ?? [], site);
  const targetAutomation = automations?.find((a) => a.id === target) ?? null;

  const row = (a: Automation) => {
    const live = a.status === 'on';
    return (
      <button
        key={a.id}
        type="button"
        className={`cta ${live ? 'cta-run' : 'cta-design'}`}
        disabled={live && (running || run?.state === 'waiting')}
        onClick={() => activate(a)}
        title={live ? `Run ${a.name} now` : `${a.name} isn't on yet. Open it in the chat.`}
      >
        <span className="cta-icon" aria-hidden="true">
          {live ? '▶' : '✎'}
        </span>
        <span className="cta-name">{a.name}</span>
        <span className="cta-tag">{live ? 'Run' : 'Draft'}</span>
      </button>
    );
  };

  const banner =
    run !== null ? (
      <div className="mode-banner mode-run" data-testid="mode-banner" data-mode="run" role="status">
        <span className="mode-icon" aria-hidden="true">
          ▶
        </span>
        <div className="mode-text">
          <strong>
            {RUN_LABEL[run.state]}: {run.automation.name}
          </strong>
          <span>{RUN_DETAIL[run.state]}</span>
        </div>
        {!running && run.state !== 'waiting' && (
          <button type="button" className="mode-close" onClick={() => startDesigning(run.automation.id)}>
            Close
          </button>
        )}
      </div>
    ) : (
      <div className="mode-banner mode-design" data-testid="mode-banner" data-mode="design" role="status">
        <span className="mode-icon" aria-hidden="true">
          ✎
        </span>
        <div className="mode-text">
          <strong>Designing: {targetAutomation?.name ?? 'New automation'}</strong>
          <span>
            {targetAutomation === null
              ? "Say what you want done. I'll build it, and nothing runs for real."
              : targetAutomation.status === 'on'
                ? "This one is on, so changes apply to its next run. Chatting doesn't run it."
                : "Tell me what to change. Chatting doesn't run it."}
          </span>
        </div>
      </div>
    );

  const runView = run !== null && (
    <div className="run-view" data-testid="run-view">
      {run.error !== null && <p className="error">{run.error}</p>}
      {run.state !== 'refused' && (
        <ol className="run-steps">
          {[run.automation.trigger, ...run.automation.steps].map((step) => {
            const state = run.steps[step.id];
            const status = state?.status ?? 'pending';
            const proposed = (state?.output as { proposed?: { text?: unknown } } | undefined)?.proposed?.text;
            const waiting = status === 'waiting' && run.state === 'waiting';
            return (
              <li key={step.id} data-step={step.id} data-status={status} className="run-step">
                <span className="run-step-icon" aria-hidden="true">
                  {STEP_ICON[status] ?? '○'}
                </span>
                <div className="run-step-body">
                  <span className="run-step-title">{step.title}</span>
                  {state?.error !== undefined && <span className="error">{state.error}</span>}
                  {state?.error === undefined && state?.why !== undefined && !waiting && (
                    <span className="dim">{state.why}</span>
                  )}
                  {waiting && (
                    <div className="approval">
                      <p>{typeof step.config['question'] === 'string' ? step.config['question'] : 'Is this OK to use?'}</p>
                      <textarea
                        aria-label="Proposed text"
                        rows={4}
                        value={approvalText ?? (typeof proposed === 'string' ? proposed : '')}
                        onChange={(e) => setApprovalText(e.target.value)}
                      />
                      <div className="approval-actions">
                        <button
                          type="button"
                          className="primary"
                          onClick={() => void decide(step, typeof proposed === 'string' ? proposed : '', false)}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => void decide(step, typeof proposed === 'string' ? proposed : '', true)}
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );

  const lastAsk = transcript.map((t) => t.kind).lastIndexOf('ask');
  const chatView = run === null && (
    <div className="transcript" data-testid="transcript">
      {transcript.length === 0 && (
        <p className="dim empty">
          {target === null
            ? 'For example: “When someone asks about catering, save them as a lead and draft a reply.”'
            : 'Ask me to change anything about this automation.'}
        </p>
      )}
      {transcript.map((item, i) => (
        <div key={i} className={`msg msg-${item.kind}`}>
          {item.text}
          {item.kind === 'ask' && (
            <div className="chips">
              {item.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={i !== lastAsk || agentBusy}
                  onClick={() => void send(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {agentBusy && <p className="dim">Working on it…</p>}
    </div>
  );

  const designLabel = 'What the chat changes';

  return (
    <div className="control">
      <header className="brand-bar">
        <div>
          <h1>OneSaaS</h1>
          <p>One SaaS to rule them all</p>
        </div>
        <div className="brand-actions">
          <span
            className={`dot ${connected ? 'dot-on' : 'dot-off'}`}
            role="img"
            aria-label={connected ? 'Connected' : 'Not connected'}
            title={connected ? 'Connected' : 'Not connected. Is the app running?'}
          />
          <button type="button" className="icon-button" onClick={() => void openApp('/automate')} title="Open the app">
            ↗<span className="sr-only">Open the app</span>
          </button>
          <button type="button" className="icon-button" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
            ⚙
          </button>
        </div>
      </header>

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
        <button type="button" className="cta cta-new" onClick={() => startDesigning(null)}>
          <span className="cta-icon" aria-hidden="true">
            +
          </span>
          <span className="cta-name">Set up a new automation</span>
        </button>
      </div>

      {banner}

      <main className="activity">
        {runView}
        {chatView}
        {sendError !== null && <p className="error">{sendError}</p>}
        <div ref={chatEnd} />
      </main>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label className="composer-target">
          <span>{designLabel}</span>
          <select
            aria-label={designLabel}
            value={target ?? ''}
            disabled={agentBusy}
            onChange={(e) => startDesigning(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">A new automation</option>
            {(automations ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <textarea
          ref={chatInput}
          rows={2}
          placeholder={target === null ? 'Describe a new automation…' : `Change ${targetAutomation?.name ?? 'this automation'}…`}
          aria-label="Chat message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button type="submit" className="primary" disabled={agentBusy || input.trim() === ''}>
          Send
        </button>
      </form>

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
