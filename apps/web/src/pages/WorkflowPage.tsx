import { SearchX, TriangleAlert } from 'lucide-react';
import { useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useWorkflow } from '../api.ts';
import EmptyState from '../design/EmptyState.tsx';
import { parseModeParam, type WorkflowMode } from '../runtime/params.ts';
import RuntimeView from '../runtime/RuntimeView.tsx';
import ModeSwitch from '../shell/ModeSwitch.tsx';

/**
 * The workflow screen: ModeSwitch on top, runtime view below. Param contract
 * (validated in runtime/params.ts, choices documented there):
 * - ?mode=: 'runtime' default; 'design' and garbage fall back to runtime (M3).
 * - unknown workflowId: useWorkflow resolves success+undefined → not-found.
 * - ?run=/?step=: validated in RuntimeView (newest run / closed inspector).
 */
export default function WorkflowPage() {
  const { workflowId } = useParams();
  const [params, setParams] = useSearchParams();
  const workflowQuery = useWorkflow(workflowId ?? '');
  const mode = parseModeParam(params.get('mode'));

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
      {/* mode is always 'runtime' until M3 wires the design branch. */}
      <RuntimeView workflowId={workflowQuery.data.id} />
    </div>
  );
}
