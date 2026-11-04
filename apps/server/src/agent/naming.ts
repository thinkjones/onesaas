import { z } from 'zod';
import type { Gateway } from '../models/gateway.js';

const MAX_WORDS = 5;
const MAX_LENGTH = 40;

const SYSTEM =
  'You name automations for a small business owner. Reply only with the JSON schema given. The name is 3 to 5 plain words saying what the automation does, in title style with no punctuation at the end. Good names: "Add to CRM", "Log Job", "Answer Customer Emails", "Chase Unpaid Bills".';

/** Whether a name is short enough to read at a glance. */
export function isShortName(name: string): boolean {
  return name.trim().split(/\s+/).length <= MAX_WORDS && name.trim().length <= MAX_LENGTH;
}

function cleaned(raw: string): string {
  return raw
    .trim()
    .replace(/^["'“‘]+|["'”’.!:]+$/g, '')
    .trim();
}

/** A short name for what the owner asked for, or null if the model's answer won't do. */
export async function shortNameFor(gateway: Gateway, request: string): Promise<string | null> {
  const { data } = await gateway.chatJson({
    role: 'builder',
    system: SYSTEM,
    user: `Name this automation:\n${request.slice(0, 1000)}`,
    schema: z.object({ name: z.string() }),
    schemaName: 'automation_name',
  });
  const name = cleaned(data.name);
  return name !== '' && isShortName(name) ? name : null;
}

/**
 * Whether this is still the placeholder made from the owner's first words. A
 * name they've chosen themselves is left alone.
 */
export function isPlaceholderName(name: string, request: string): boolean {
  const squash = (text: string): string => text.trim().split(/\s+/).join(' ').toLowerCase();
  return squash(request).startsWith(squash(name));
}
