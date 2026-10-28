import { useCallback, useEffect, useState } from 'react';
import type { Run, StepRun } from '@dad/shared';
import { getRun, getRuns, getWorkflows, useEvents, type EngineEvent } from './api.ts';

// StepRun carries stepId only, so titles come from the workflows list
// (trigger.id + steps[].id). Unknown ids fall back to the raw stepId.
function useTitles(): Map<string, string> {
  const [titles, setTitles] = useState(new Map<string, string>());
  useEffect(() => {
    let cancelled = false;
    getWorkflows()
      .then((wfs) => {
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const wf of wfs) {
          map.set(wf.trigger.id, wf.trigger.title);
          for (const s of wf.steps) map.set(s.id, s.title);
        }
        setTitles(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return titles;
}

function StepRow({ step, title }: { step: StepRun; title: string }) {
  return (
    <li data-status={step.status}>
      <div>
        {title} — {step.status}
      </div>
      {step.why && <p>{step.why}</p>}
      {step.model && <p>model: {step.model}</p>}
      {step.costUsd !== undefined && <p>cost: ${step.costUsd.toFixed(4)}</p>}
      {step.status === 'failed' && step.error && <p>{step.error}</p>}
      <details>
        <summary>details</summary>
        <pre>{JSON.stringify(step.input ?? null, null, 2)}</pre>
        <pre>{JSON.stringify(step.output ?? null, null, 2)}</pre>
      </details>
    </li>
  );
}

export default function RunLog() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const titles = useTitles();

  const refreshList = useCallback(() => {
    getRuns()
      .then((rs) => {
        setRuns(rs);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const openRun = useCallback((id: string) => {
    setOpenId(id);
    getRun(id)
      .then(({ steps }) => {
        // Rendered as returned: the repo yields insertion order, which matches
        // topological order for linear flows like flow 1.
        setSteps(steps);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const onEvent = useCallback(
    (e: EngineEvent) => {
      if (e.type === 'run') {
        refreshList();
      } else if (e.stepRun.runId === openId) {
        openRun(e.stepRun.runId);
      }
    },
    [openId, openRun, refreshList],
  );
  useEvents(onEvent);

  return (
    <section>
      <h2>Run log</h2>
      {error && <p>{error}</p>}
      <ul>
        {runs.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => openRun(r.id)}>
              {r.id}
            </button>{' '}
            {r.workflowId} — {r.status}
            {openId === r.id && (
              <ul>
                {steps.map((s) => (
                  <StepRow key={s.id} step={s} title={titles.get(s.stepId) ?? s.stepId} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
