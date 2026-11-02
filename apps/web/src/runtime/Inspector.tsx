import type { StepRun } from '@dad/shared';
import BoxIcon from 'lucide-react/icons/box';
import { useState } from 'react';
import type { ExplainTarget } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import StatusBadge from '../design/StatusBadge.tsx';
import Explain from '../explain/Explain.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { ScrollArea } from '../components/ui/scroll-area.tsx';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet.tsx';
import { formatCost, formatDateTime, formatDuration } from './format.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Any object carrying a `fileId` is a stored photo (FileRef): serve it. */
function imageUrlOf(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const fileId = value['fileId'];
  if (typeof fileId !== 'string' || fileId === '') return null;
  return `/api/files/${encodeURIComponent(fileId)}`;
}

/** A max-240px thumbnail that opens the photo full size on click. */
function FileThumb({ url }: { url: string }) {
  const [fullSize, setFullSize] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setFullSize(true)} aria-label="Open photo full size">
        <img
          src={url}
          alt="Photo thumbnail"
          style={{ maxWidth: 240, maxHeight: 240 }}
          className="rounded-[var(--radius)] object-cover"
        />
      </button>
      {fullSize && (
        <div
          role="dialog"
          aria-label="Full-size photo"
          onClick={() => setFullSize(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-term-bg/85 p-4"
        >
          <img
            src={url}
            alt="Full-size photo"
            className="max-h-full max-w-full rounded-[var(--radius)]"
          />
        </div>
      )}
    </>
  );
}

/** One scalar or nested value: photos as thumbnails, the rest as text/lists. */
function ValueView({ value }: { value: unknown }) {
  const thumb = imageUrlOf(value);
  if (thumb !== null) {
    return <FileThumb url={thumb} />;
  }
  if (value === null || value === undefined) return <span>—</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span>Nothing here.</span>;
    return (
      <ul className="flex flex-col gap-1">
        {value.map((item, i) => (
          <li key={i} className="text-base break-words">
            <ValueView value={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (isRecord(value)) {
    return <KvList record={value} />;
  }
  return <span>{String(value)}</span>;
}

/** Readable key-value list; nested objects recurse. */
function KvList({ record }: { record: Record<string, unknown> }) {
  const entries = Object.entries(record);
  if (entries.length === 0) return <p className="text-base text-muted-foreground">Nothing here.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map(([key, value]) => (
        <li key={key} className="text-base break-words">
          {isRecord(value) || Array.isArray(value) ? (
            <div>
              <p className="font-medium">{key}</p>
              <div className="ml-4 border-l border-border pl-3">
                <ValueView value={value} />
              </div>
            </div>
          ) : (
            // Scalar rows render as ONE text node ("name: Sarah Lee") so the
            // pair stays readable and findable; nested values keep the key
            // line + indented list above.
            <p>{`${key}: ${value === null || value === undefined ? '—' : String(value)}`}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface InspectorProps {
  /** Undefined when the step has no run record yet (still pending). */
  stepRun: StepRun | undefined;
  title: string;
  open: boolean;
  onClose(): void;
  /**
   * The step's calculation code (code.transform only): shown read-only in a
   * monospace block under the explanation. Undefined for every other step.
   */
  code?: string;
  /**
   * Explain-anything target + label (set by RuntimeView). Without both, the
   * `?` button and alt-click stay off.
   */
  explainTarget?: ExplainTarget;
  explainLabel?: string;
}

/**
 * The right-hand sheet for one step: title + status, the why in large text,
 * "What came in / out" as readable lists with raw JSON behind "Show details",
 * and the model/cost/duration/start-time meta block.
 *
 * Duration comes ONLY from the step's own durationMs — never from run.endedAt,
 * which is stale on non-terminal runs (failed→waiting retry leaves it behind).
 *
 * Skipped approvals carry `{ proposed }` output (deliberate server audit, see
 * engine.resolveApproval) — shown as "Proposed (skipped)" with the proposal
 * nested below, so Dad sees what he skipped instead of a bare `proposed` key.
 */
export default function Inspector({
  stepRun,
  title,
  open,
  onClose,
  code,
  explainTarget,
  explainLabel,
}: InspectorProps) {
  // Both or neither: without the pair the `?` button and alt-click stay off.
  const explain =
    explainTarget !== undefined && explainLabel !== undefined
      ? { target: explainTarget, label: explainLabel }
      : undefined;
  const [showDetails, setShowDetails] = useState(false);

  const skippedProposal =
    stepRun?.status === 'skipped' && isRecord(stepRun.output) && 'proposed' in stepRun.output
      ? (stepRun.output as Record<string, unknown>)['proposed']
      : undefined;

  // A bare FileRef as the WHOLE input/output renders as a photo, not as
  // fileId/mime rows (nested refs are caught by ValueView instead).
  const inputThumb = stepRun ? imageUrlOf(stepRun.input) : null;
  const outputThumb = stepRun && skippedProposal === undefined ? imageUrlOf(stepRun.output) : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <SheetContent side="right" aria-label={`Details for ${title}`}>
        <SheetHeader
          className="p-0 text-left"
          data-explain={
            explain ? dataExplainValue(explain.target, explain.label) : undefined
          }
        >
          <p className="flex items-center gap-1 text-[0.75rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
            <BoxIcon size={14} strokeWidth={1.75} aria-hidden />
            Step
          </p>
          <div className="flex items-center gap-1">
            <SheetTitle className="flex-1 text-xl">{title}</SheetTitle>
            {explain && <Explain target={explain.target} label={explain.label} />}
          </div>
          <div>
            <StatusBadge status={stepRun?.status ?? 'pending'} />
          </div>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          {stepRun === undefined ? (
            <p className="text-base text-muted-foreground">This step hasn&apos;t run yet.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {stepRun.why && <p className="text-xl font-medium">{stepRun.why}</p>}
              {code !== undefined && (
                <pre className="overflow-x-auto rounded-[var(--radius)] border border-border bg-muted p-3 font-mono text-sm break-words whitespace-pre-wrap">
                  {code}
                </pre>
              )}
              {stepRun.error && (
                <p role="alert" className="text-base text-destructive">
                  {stepRun.error}
                </p>
              )}

              <section>
                <h3 className="mb-2 text-base font-semibold">What came in</h3>
                {stepRun.input === undefined || stepRun.input === null ? (
                  <p className="text-base text-muted-foreground">Nothing came in yet.</p>
                ) : inputThumb !== null ? (
                  <FileThumb url={inputThumb} />
                ) : isRecord(stepRun.input) ? (
                  <KvList record={stepRun.input} />
                ) : (
                  <p className="text-base break-words">
                    <ValueView value={stepRun.input} />
                  </p>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-base font-semibold">What came out</h3>
                {skippedProposal !== undefined ? (
                  <div>
                    <p className="font-medium">Proposed (skipped)</p>
                    <div className="ml-4 border-l border-border pl-3">
                      <ValueView value={skippedProposal} />
                    </div>
                  </div>
                ) : stepRun.output === undefined || stepRun.output === null ? (
                  <p className="text-base text-muted-foreground">Nothing came out yet.</p>
                ) : outputThumb !== null ? (
                  <FileThumb url={outputThumb} />
                ) : isRecord(stepRun.output) ? (
                  <KvList record={stepRun.output} />
                ) : (
                  <p className="text-base break-words">
                    <ValueView value={stepRun.output} />
                  </p>
                )}
              </section>

              <AppButton
                variant="outline"
                onClick={() => setShowDetails((s) => !s)}
                aria-expanded={showDetails}
              >
                {showDetails ? 'Hide details' : 'Show details'}
              </AppButton>
              {showDetails && (
                <pre className="text-sm break-words whitespace-pre-wrap text-muted-foreground">
                  {JSON.stringify({ input: stepRun.input, output: stepRun.output }, null, 2)}
                </pre>
              )}

              <dl className="flex flex-col gap-1.5 border-t border-border pt-4">
                {stepRun.model !== undefined && (
                  <div className="flex gap-2 text-base">
                    <dt className="text-muted-foreground">Model:</dt>
                    <dd className="break-words">{stepRun.model}</dd>
                  </div>
                )}
                {stepRun.costUsd !== undefined && (
                  <div className="flex gap-2 text-base">
                    <dt className="text-muted-foreground">Cost:</dt>
                    <dd>{formatCost(stepRun.costUsd)}</dd>
                  </div>
                )}
                {stepRun.durationMs !== undefined && (
                  <div className="flex gap-2 text-base">
                    <dt className="text-muted-foreground">Duration:</dt>
                    <dd>{formatDuration(stepRun.durationMs)}</dd>
                  </div>
                )}
                <div className="flex gap-2 text-base">
                  <dt className="text-muted-foreground">Started:</dt>
                  <dd>{formatDateTime(stepRun.startedAt)}</dd>
                </div>
              </dl>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
