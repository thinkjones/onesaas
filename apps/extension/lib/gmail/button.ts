import type { RunStatus } from '@onesaas/shared';
import { SELECTORS, resolveToolbar } from './selectors.js';

export interface WorkflowButtonItem {
  workflowId: string;
  label: string;
}

/** Exact pill copy per status (M2 restyles; the strings stay). */
const STATUS_PILLS: Record<RunStatus, string> = {
  running: 'Working…',
  waiting: 'Waiting for you',
  done: '✓ Done',
  failed: 'Needs a look',
};

/** One run in the app. Clicks go through the background, which can reach the desktop app. */
export function runtimeUrl(workflowId: string, runId: string): string {
  return `http://localhost:5173/automations/${encodeURIComponent(workflowId)}?mode=runs&run=${encodeURIComponent(runId)}`;
}

/**
 * Render one button per workflow into the message toolbar. Idempotent: our
 * container (div.onesaas-gmail-buttons) is created once per toolbar and cleared +
 * re-rendered on every call, so MutationObserver refreshes never duplicate.
 * No-ops when there is no toolbar (thread list view has nowhere to inject).
 */
export function injectButtons(
  doc: Document,
  buttons: WorkflowButtonItem[],
  onClick: (workflowId: string) => void,
): void {
  const toolbar = resolveToolbar(doc);
  if (!toolbar) return;

  let container = toolbar.querySelector(
    `:scope > ${SELECTORS.buttonsContainer}`,
  ) as HTMLElement | null;
  if (!container) {
    container = doc.createElement('div');
    container.className = 'onesaas-gmail-buttons';
    container.style.display = 'inline-flex';
    container.style.gap = '6px';
    container.style.marginLeft = '8px';
    toolbar.appendChild(container);
  }
  container.replaceChildren();

  for (const { workflowId, label } of buttons) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset['workflowId'] = workflowId;
    button.textContent = label;
    button.style.fontSize = '12px';
    button.style.padding = '2px 8px';
    button.style.borderRadius = '999px';
    button.style.border = '1px solid #c7c7c7';
    button.style.background = '#fff';
    button.style.cursor = 'pointer';
    button.addEventListener('click', () => onClick(workflowId));
    container.appendChild(button);
  }
}

/**
 * Show a status pill on one of our buttons. dataset.status mirrors the status
 * for M2's benefit. Missing button (wrong thread, list view) is a no-op.
 *
 * With a runId the pill is a link to that run's runtime view (new tab — the
 * Gmail tab must stay open for the bridge); without one it is plain text.
 * The pill element is rebuilt only when its kind (link vs text) changes, so
 * repeat updates keep the same node.
 */
export function setButtonStatus(
  doc: Document,
  workflowId: string,
  status: RunStatus,
  runId?: string,
  /** Opens the run's path in the app; without it the link opens as a plain tab. */
  onOpenRun?: (path: string) => void,
): void {
  const container = doc.querySelector(SELECTORS.buttonsContainer);
  if (!container) return;
  // Match by dataset instead of a [data-workflow-id="..."] selector so odd
  // ids never break selector parsing.
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.dataset['workflowId'] === workflowId,
  );
  if (!button) return;

  button.dataset['status'] = status;
  const pill = button.querySelector(SELECTORS.statusPill) as HTMLElement | null;
  if (runId === undefined) {
    if (pill?.tagName === 'SPAN') {
      pill.textContent = STATUS_PILLS[status];
    } else {
      pill?.remove();
      const span = doc.createElement('span');
      span.className = 'onesaas-status-pill';
      span.style.marginLeft = '6px';
      span.style.fontSize = '12px';
      span.textContent = STATUS_PILLS[status];
      button.appendChild(span);
    }
    return;
  }
  const href = runtimeUrl(workflowId, runId);
  if (pill?.tagName === 'A') {
    (pill as HTMLAnchorElement).href = href;
    pill.textContent = STATUS_PILLS[status];
    return;
  }
  pill?.remove();
  const link = doc.createElement('a');
  link.className = 'onesaas-status-pill';
  link.style.marginLeft = '6px';
  link.style.fontSize = '12px';
  link.style.color = 'inherit';
  link.style.textDecoration = 'underline';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  // The pill sits INSIDE the trigger button: without this, clicking it would
  // bubble up and fire the workflow trigger as well.
  link.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!onOpenRun) return;
    e.preventDefault();
    const { pathname, search } = new URL(link.href);
    onOpenRun(`${pathname}${search}`);
  });
  link.textContent = STATUS_PILLS[status];
  button.appendChild(link);
}
