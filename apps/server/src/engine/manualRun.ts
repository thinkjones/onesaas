import { emailSchema, type Workflow } from '@dad/shared';

/** Same deadline a "Try it" run gives Gmail to answer. */
const READ_EMAIL_TIMEOUT_MS = 5000;

/** The extension's surface a manual run needs (the real bridge satisfies it). */
export interface ManualRunBridge {
  call(site: 'gmail', action: string, input: unknown, timeoutMs?: number): Promise<unknown>;
}

/** Why a run can't start; the message is shown to Dad as is. */
export class ManualRunRefused extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
    this.name = 'ManualRunRefused';
  }
}

const NO_OPEN_EMAIL = 'Open an email in Gmail first, then press Run.';

async function readOpenEmail(bridge: ManualRunBridge) {
  let raw: unknown;
  try {
    raw = await bridge.call('gmail', 'readOpenEmail', {}, READ_EMAIL_TIMEOUT_MS);
  } catch {
    throw new ManualRunRefused(NO_OPEN_EMAIL, 409);
  }
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) throw new ManualRunRefused(NO_OPEN_EMAIL, 409);
  return parsed.data;
}

/**
 * The real trigger payload for a run Dad starts from the side panel. Unlike
 * "Try it" there is never a sample fallback: a real run on made-up data could
 * save or draft things from an email that doesn't exist. `page` is the tab the
 * panel read when Dad clicked; a manual trigger runs without it if it couldn't.
 */
export async function manualRunPayload(
  wf: Workflow,
  bridge: ManualRunBridge,
  page?: { url: string; title: string; text: string },
): Promise<unknown> {
  switch (wf.trigger.type) {
    case 'trigger.manual':
      return { payload: page ?? {} };
    case 'trigger.gmailButton':
      return { email: await readOpenEmail(bridge) };
    case 'trigger.email': {
      // This trigger's output carries a snippet, not the full body.
      const { body, ...email } = await readOpenEmail(bridge);
      return { email: { ...email, snippet: body } };
    }
    case 'trigger.upload':
      throw new ManualRunRefused('This automation starts from a photo. Choose one to run it.', 400);
    default:
      throw new ManualRunRefused(`This automation can't be started by hand.`, 400);
  }
}
