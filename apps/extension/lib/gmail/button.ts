import type { RunStatus } from '@dad/shared';
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

/**
 * Render one button per workflow into the message toolbar. Idempotent: our
 * container (div.dad-gmail-buttons) is created once per toolbar and cleared +
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

  let container = toolbar.querySelector(':scope > div.dad-gmail-buttons') as HTMLElement | null;
  if (!container) {
    container = doc.createElement('div');
    container.className = 'dad-gmail-buttons';
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
 */
export function setButtonStatus(
  doc: Document,
  workflowId: string,
  status: RunStatus,
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
  let pill = button.querySelector(SELECTORS.statusPill) as HTMLElement | null;
  if (!pill) {
    pill = doc.createElement('span');
    pill.className = 'dad-status-pill';
    pill.style.marginLeft = '6px';
    pill.style.fontSize = '12px';
    button.appendChild(pill);
  }
  pill.textContent = STATUS_PILLS[status];
}
