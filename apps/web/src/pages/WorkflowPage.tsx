import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PanelRightOpen, SearchX, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import AgentPanel from '../agent/AgentPanel.tsx';
import { uploadPhoto, useAgentEvents, useWorkflow, type AgentEvent } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import DesignView from '../design/DesignView.tsx';
import { TELL_ME_MORE_EVENT } from '../explain/useAltClickExplain.ts';
import EmptyState from '../design/EmptyState.tsx';
import UploadDrop from '../design/UploadDrop.tsx';
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
 * Photo-triggered flows (trigger.upload) get an UploadDrop above the runtime
 * view: dropping a photo posts it to the upload route and jumps to the new
 * run. The helper panel sits on the right (380px, collapsible) in BOTH modes, at
 * the same tree position so switching modes never remounts it mid-turn. When
 * the agent starts a second reducer mid-turn (create_workflow), its `switched`
 * event navigates this page to the new reducer's design view (the workflows
 * list is invalidated first, so the new reducer resolves instead of showing
 * not-found). "Fix
 * this step" sets `agentPrefill` to `"<title>" stopped with: <error>. Can you
 * help me fix it?` and opens design mode on the failed step; the panel
 * consumes the state as its initial input (clearing it on consume and on
 * send). The handoff string is pinned by WorkflowPage.test.tsx via the
 * `onAgentPrefill` probe. HomePage's one-sentence start arrives as location
 * state (`agentPrompt`), is captured once per mount as the opening send, and
 * is consumed after the first send — both the page-held prompt AND the
 * history entry (replaced without `agentPrompt`) — so collapse/reopen,
 * refresh, and back-nav can never fire a duplicate turn.
 */
export default function WorkflowPage({ onAgentPrefill }: WorkflowPageProps = {}) {
  const { workflowId } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const workflowQuery = useWorkflow(workflowId ?? '');
  const mode = parseModeParam(params.get('mode'));
  const queryClient = useQueryClient();
  // Photo-triggered flows start runs by dropping a photo (runtime mode only).
  // On success the runs list refetches and the view jumps to the new run
  // (clearing ?step=, which belongs to the previous run — same idiom as
  // RuntimeView's run switching). Failures surface the server's message.
  const upload = useMutation({
    mutationFn: (file: File) => uploadPhoto(workflowId ?? '', file),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['runs', workflowId] });
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('run', result.run.id);
        next.delete('step');
        return next;
      });
    },
  });
  const [agentPrefill, setAgentPrefill] = useState<string | undefined>();
  // Collapsed state lives here per page-mount (no persistence yet).
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(() => {
    const state = location.state as { agentPrompt?: unknown } | null;
    return typeof state?.agentPrompt === 'string' ? state.agentPrompt : undefined;
  });

  // Follow the agent when it starts a second reducer: the `switched`
  // event names the new reducer, and the web navigates there (design mode,
  // where the build lands). Runs before the early returns below with every
  // other hook; the handler no-ops until a switch arrives.
  const handleAgentSwitch = useCallback(
    (e: AgentEvent) => {
      if (e.type !== 'switched') return;
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      navigate(`/reducers/${e.workflowId}?mode=design`);
    },
    [navigate, queryClient],
  );
  useAgentEvents(workflowId ?? '', handleAgentSwitch);

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

  // Explain's "Tell me more" (step boxes, runs, inspector…): open the
  // helper and send "Tell me more about <label>" through the panel's
  // sendRequest seam. Before the early returns with every other hook.
  const [tellMeMore, setTellMeMore] = useState<{ text: string; nonce: number } | undefined>();
  useEffect(() => {
    const onTellMeMore = (e: Event): void => {
      const message = (e as CustomEvent<{ message?: unknown }>).detail?.message;
      if (typeof message !== 'string' || message.trim().length === 0) return;
      setPanelCollapsed(false);
      setTellMeMore({ text: message.trim(), nonce: Date.now() });
    };
    window.addEventListener(TELL_ME_MORE_EVENT, onTellMeMore);
    return () => window.removeEventListener(TELL_ME_MORE_EVENT, onTellMeMore);
  }, []);

  // Consume-once for the opening prompt (mirrors the prefill seam, but the
  // panel's own once-guard dies on collapse/reopen, so the PAGE must clear
  // it). history.state ALSO survives refresh/back-nav — and a page-level ref
  // would not — so the history entry itself is replaced without `agentPrompt`
  // (a same-path `replace`, so back still leaves the page). Any other state
  // keys are preserved.
  const handleInitialSent = useCallback(() => {
    setInitialPrompt(undefined);
    const state = location.state as Record<string, unknown> | null;
    if (typeof state?.agentPrompt === 'string') {
      const next = { ...state };
      delete next.agentPrompt;
      navigate(`${location.pathname}${location.search}`, { replace: true, state: next });
    }
  }, [location.pathname, location.search, location.state, navigate]);

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

  const rawPrompt = workflowQuery.data.trigger.config['prompt'];
  const uploadPrompt = typeof rawPrompt === 'string' ? rawPrompt : 'Drop a photo here';
  const showUploadDrop = mode === 'runtime' && workflowQuery.data.trigger.type === 'trigger.upload';

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{workflowQuery.data.name}</h1>
      <ModeSwitch mode={mode} onModeChange={handleModeChange} />
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          {mode === 'design' ? (
            <DesignView workflowId={workflowQuery.data.id} onRequestRuntime={handleRequestRuntime} />
          ) : (
            <div className="flex flex-col gap-4">
              {showUploadDrop && (
                <div className="flex flex-col gap-2">
                  <UploadDrop
                    prompt={uploadPrompt}
                    onUpload={(file) => upload.mutate(file)}
                    disabled={upload.isPending}
                  />
                  {upload.isError && (
                    <p role="alert" className="text-base text-destructive">
                      {upload.error instanceof Error ? upload.error.message : 'The upload failed.'}
                    </p>
                  )}
                </div>
              )}
              <RuntimeView workflowId={workflowQuery.data.id} onFixStep={handleFixStep} />
            </div>
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
              onInitialSent={handleInitialSent}
              sendRequest={tellMeMore}
              onCollapse={() => setPanelCollapsed(true)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
