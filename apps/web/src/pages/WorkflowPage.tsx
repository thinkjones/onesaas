import { PanelRightOpen, SearchX, TriangleAlert } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';
import AgentPanel from '../agent/AgentPanel.tsx';
import { useWorkflow } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
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
 * The helper panel sits on the right (380px, collapsible) in BOTH modes, at
 * the same tree position so switching modes never remounts it mid-turn. "Fix
 * this step" sets `agentPrefill` to `"<title>" stopped with: <error>. Can you
 * help me fix it?` and opens design mode on the failed step; the panel
 * consumes the state as its initial input (clearing it on consume and on
 * send). The handoff string is pinned by WorkflowPage.test.tsx via the
 * `onAgentPrefill` probe. HomePage's one-sentence start arrives as location
 * state (`agentPrompt`) and is captured once per mount as the opening send.
 */
export default function WorkflowPage({ onAgentPrefill }: WorkflowPageProps = {}) {
  const { workflowId } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const workflowQuery = useWorkflow(workflowId ?? '');
  const mode = parseModeParam(params.get('mode'));
  const [agentPrefill, setAgentPrefill] = useState<string | undefined>();
  // Collapsed state lives here per page-mount (no persistence yet).
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [initialPrompt] = useState<string | undefined>(() => {
    const state = location.state as { agentPrompt?: unknown } | null;
    return typeof state?.agentPrompt === 'string' ? state.agentPrompt : undefined;
  });

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

  const handlePrefillConsumed = useCallback(() => setAgentPrefill(undefined), []);

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
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          {mode === 'design' ? (
            <DesignView workflowId={workflowQuery.data.id} onRequestRuntime={handleRequestRuntime} />
          ) : (
            <RuntimeView workflowId={workflowQuery.data.id} onFixStep={handleFixStep} />
          )}
        </div>
        {panelCollapsed ? (
          <AppButton variant="outline" onClick={() => setPanelCollapsed(false)}>
            <PanelRightOpen />
            Show helper
          </AppButton>
        ) : (
          <div className="w-[380px] shrink-0">
            <AgentPanel
              workflowId={workflowQuery.data.id}
              prefill={agentPrefill}
              onPrefillConsumed={handlePrefillConsumed}
              initialPrompt={initialPrompt}
              onCollapse={() => setPanelCollapsed(true)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
