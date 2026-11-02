import { useMutation, useQueryClient } from '@tanstack/react-query';
import PanelRightOpen from 'lucide-react/icons/panel-right-open';
import SearchX from 'lucide-react/icons/search-x';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import ActivityLog, { type ActivityEntry } from '../agent/ActivityLog.tsx';
import AgentPanel from '../agent/AgentPanel.tsx';
import { useAgent } from '../agent/useAgent.ts';
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
 * run. The chat sits on the right (1/3, collapsible) in BOTH modes, at
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
 * refresh, and back-nav can never fire a duplicate turn. A NEW agentPrompt
 * arriving while mounted (a bad-id tell-me-more routed here by the fallback)
 * is picked up as the next opening send the same way.
 */
export default function WorkflowPage({ onAgentPrefill }: WorkflowPageProps = {}) {
  const { workflowId } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const workflowQuery = useWorkflow(workflowId ?? '');
  // One conversation per page mount, shared by the design Start box and the
  // chat panel (Bug #4) — a turn started in one place continues in the other.
  const agent = useAgent(workflowId ?? '');
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
  // A routed-while-mounted prompt (see above) lands without a remount, so
  // the initializer never re-runs — sync new arrivals into the opening send
  // via the previous-render pattern (HomePage's prefill does the same; an
  // effect would be set-state-in-effect). Consume-once still holds: the send
  // clears both this state and the history entry, so a delivered prompt
  // never re-applies.
  const [appliedAgentPrompt, setAppliedAgentPrompt] = useState(initialPrompt);
  const locationPromptState = location.state as { agentPrompt?: unknown } | null;
  const locationAgentPrompt =
    typeof locationPromptState?.agentPrompt === 'string'
      ? locationPromptState.agentPrompt
      : undefined;
  if (locationAgentPrompt !== appliedAgentPrompt) {
    setAppliedAgentPrompt(locationAgentPrompt);
    if (locationAgentPrompt !== undefined) setInitialPrompt(locationAgentPrompt);
  }

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

  // RHS "Recent changes" log (Bug #4): design actions append lines newest
  // first, capped at 20. Before the early returns with every other hook.
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const logActivity = useCallback((text: string) => {
    setActivity((prev) => [{ at: new Date().toISOString(), text }, ...prev].slice(0, 20));
  }, []);

  // Explain's "Tell me more" (step boxes, runs, inspector…): open the
  // chat and send "Tell me more about <label>" through the panel's
  // sendRequest seam. Before the early returns with every other hook. The
  // handler claims the event only while the reducer resolves (pending counts:
  // the send fires once the page loads); settled without data (not-found,
  // fetch error) it leaves the event for TellMeMoreFallback, which routes to
  // a live panel instead of swallowing it into invisible state here. The
  // claim is scoped to the claiming workflowId: a pending bad id ALSO gets
  // routed by the fallback (the id is not yet known-bad), and the same
  // component survives that navigation — without the scope check the target
  // would fire both the stale sendRequest AND the routed initialPrompt.
  const [tellMeMore, setTellMeMore] = useState<
    { text: string; nonce: number; workflowId: string | undefined } | undefined
  >();
  // Monotonic per mount: Date.now() could collapse two rapid requests.
  const tellMeMoreNonce = useRef(0);
  useEffect(() => {
    const onTellMeMore = (e: Event): void => {
      const message = (e as CustomEvent<{ message?: unknown }>).detail?.message;
      if (typeof message !== 'string' || message.trim().length === 0) return;
      if (!workflowQuery.isPending && !workflowQuery.data) return;
      setPanelCollapsed(false);
      tellMeMoreNonce.current += 1;
      setTellMeMore({ text: message.trim(), nonce: tellMeMoreNonce.current, workflowId });
    };
    window.addEventListener(TELL_ME_MORE_EVENT, onTellMeMore);
    return () => window.removeEventListener(TELL_ME_MORE_EVENT, onTellMeMore);
  }, [workflowId, workflowQuery.data, workflowQuery.isPending]);

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
      <ModeSwitch mode={mode} onModeChange={handleModeChange} />
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-[2]">
          {mode === 'design' ? (
            <DesignView
              workflowId={workflowQuery.data.id}
              agent={agent}
              logActivity={logActivity}
              onRequestRuntime={handleRequestRuntime}
            />
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
            Show chat
          </AppButton>
        ) : (
          <div className="flex min-w-[300px] flex-[1] shrink-0 flex-col gap-4">
            {mode === 'design' && activity.length > 0 && <ActivityLog entries={activity} />}
            <AgentPanel
              agent={agent}
              prefill={agentPrefill}
              onPrefillConsumed={handlePrefillConsumed}
              initialPrompt={initialPrompt}
              onInitialSent={handleInitialSent}
              sendRequest={
                tellMeMore !== undefined && tellMeMore.workflowId === workflowId
                  ? { text: tellMeMore.text, nonce: tellMeMore.nonce }
                  : undefined
              }
              onCollapse={() => setPanelCollapsed(true)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
