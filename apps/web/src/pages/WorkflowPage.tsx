import { SearchX, TriangleAlert } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useWorkflow } from '../api.ts';
import DesignView from '../design/DesignView.tsx';
import EmptyState from '../design/EmptyState.tsx';
import { parseModeParam, type WorkflowMode } from '../runtime/params.ts';
import RuntimeView, { type FixStepInfo } from '../runtime/RuntimeView.tsx';
import ModeSwitch from '../shell/ModeSwitch.tsx';

export interface WorkflowPageProps {
  /**
   * Test probe for the Task 7 seam: fired with the agent-input prefill text
   * whenever "Fix this step" sets it. Task 7's panel reads `agentPrefill`
   * state directly; this prop exists so tests can pin the handoff string.
   */
  onAgentPrefill?: (text: string) => void;
}

/**
 * The workflow screen: ModeSwitch on top, design or runtime view below. Param
 * contract (validated in runtime/params.ts, choices documented there):
 * - ?mode=: 'runtime' default, 'design' for the builder; garbage → runtime.
 * - unknown workflowId: useWorkflow resolves success+undefined → not-found.
 * - ?run=/?step=: validated in RuntimeView (newest run / closed inspector);
 *   DesignView reuses ?step= for its selection.
 *
 * Task 7 seam: this page holds `agentPrefill` state. "Fix this step" sets it
 * to `"<title>" stopped with: <error>. Can you help me fix it?` and opens
 * design mode on the failed step; Task 7's AgentPanel consumes the state as
 * its initial input. Nothing renders it yet — the handoff is pinned by
 * WorkflowPage.test.tsx via the `onAgentPrefill` probe.
 */
export default function WorkflowPage({ onAgentPrefill }: WorkflowPageProps = {}) {
  const { workflowId } = useParams();
  const [params, setParams] = useSearchParams();
  const workflowQuery = useWorkflow(workflowId ?? '');
  const mode = parseModeParam(params.get('mode'));
  // Task 7 consumes this (AgentPanel initial input); until then it is
  // write-only state + the probe above.
  const [agentPrefill, setAgentPrefill] = useState<string | undefined>();
  void agentPrefill;

  const handleModeChange = useCallback(
    (next: WorkflowMode) => {
      setParams((prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('mode', next);
        return updated;
      });
    },
    [setParams],
  );

  const handleFixStep = useCallback(
    (info: FixStepInfo) => {
      const prefill = `"${info.title}" stopped with: ${info.error}. Can you help me fix it?`;
      setAgentPrefill(prefill);
      onAgentPrefill?.(prefill);
      setParams((prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('mode', 'design');
        updated.set('step', info.stepId);
        return updated;
      });
    },
    [onAgentPrefill, setParams],
  );

  const handleRequestRuntime = useCallback(() => handleModeChange('runtime'), [handleModeChange]);

  if (workflowQuery.isPending) return <p className="text-base">Loading chore reducer…</p>;
  if (workflowQuery.isError || !workflowQuery.data) {
    if (workflowQuery.isError) {
      return (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load this chore reducer"
          hint="Check the server is running and try again."
        />
      );
    }
    return (
      <EmptyState
        icon={SearchX}
        title="Chore reducer not found"
        hint={`There is no chore reducer with id "${workflowId}".`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{workflowQuery.data.name}</h1>
      <ModeSwitch mode={mode} onModeChange={handleModeChange} />
      {mode === 'design' ? (
        <DesignView workflowId={workflowQuery.data.id} onRequestRuntime={handleRequestRuntime} />
      ) : (
        <RuntimeView workflowId={workflowQuery.data.id} onFixStep={handleFixStep} />
      )}
    </div>
  );
}
