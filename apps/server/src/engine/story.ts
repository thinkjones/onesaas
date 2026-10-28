import { topoOrder, type StepRun, type Workflow } from '@dad/shared';

// A plain-English summary of a run for the runtime screen header: the done
// steps' whys in topological order (triggers skipped), chunked into lines of
// at most 3 steps joined with " → ", with the first line prefixed by the
// trigger's summary. A failed step appends a stopped-at line; a waiting run
// ends with a waiting line (last, so it wins when both are present). Only
// `done` whys are content — skipped steps read as gaps, not story beats.
//
// The "1–4 lines" in the plan describes milestone-scale flows (flow 1 lands 2
// lines); longer flows produce more lines rather than dropping story beats.
export function buildRunStory(wf: Workflow, steps: StepRun[]): string[] {
  const order = topoOrder(wf);
  const byStepId = new Map(steps.map((s) => [s.stepId, s]));
  const titleById = new Map<string, string>([[wf.trigger.id, wf.trigger.title]]);
  for (const s of wf.steps) titleById.set(s.id, s.title);

  const whys: string[] = [];
  for (const id of order) {
    if (id === wf.trigger.id) continue;
    const stepRun = byStepId.get(id);
    // The engine always writes a why on done; the guard is for crafted rows.
    if (stepRun?.status === 'done' && stepRun.why) whys.push(stepRun.why);
  }

  const lines: string[] = [];
  for (let i = 0; i < whys.length; i += 3) {
    lines.push(whys.slice(i, i + 3).join(' → '));
  }
  // A run with no done steps still gets one line: the trigger summary alone.
  lines[0] = lines[0] ? `${wf.trigger.summary} → ${lines[0]}` : wf.trigger.summary;

  const failedId = order.find((id) => byStepId.get(id)?.status === 'failed');
  if (failedId !== undefined) {
    // Titles and errors come from the run's own version and the engine, so
    // both fallbacks are purely defensive against malformed rows.
    const title = titleById.get(failedId) ?? failedId;
    const error = byStepId.get(failedId)!.error ?? 'Something went wrong.';
    lines.push(`Stopped at "${title}": ${error}`);
  }
  const waitingId = order.find((id) => byStepId.get(id)?.status === 'waiting');
  if (waitingId !== undefined) {
    const title = titleById.get(waitingId) ?? waitingId;
    lines.push(`Waiting for you to check "${title}".`);
  }
  return lines;
}
