import type { PanelSite } from './sites.js';

// The fields of a workflow (GET /api/workflows) the side panel reads.
export interface AutomationStep {
  id: string;
  type: string;
  title: string;
  config: Record<string, unknown>;
}

export interface Automation {
  id: string;
  name: string;
  status: 'draft' | 'on' | 'off';
  trigger: AutomationStep;
  steps: AutomationStep[];
  edges?: { from: string; to: string }[];
}

/**
 * Steps in the order they run. The saved list is in the order they were added,
 * so walk the links from the trigger; anything not linked goes last.
 */
export function flowOrder(a: Automation): AutomationStep[] {
  const byId = new Map([a.trigger, ...a.steps].map((s) => [s.id, s]));
  const order = [a.trigger];
  const seen = new Set([a.trigger.id]);
  for (let i = 0; i < order.length; i += 1) {
    for (const e of a.edges ?? []) {
      const next = byId.get(e.to);
      if (e.from === order[i]!.id && next && !seen.has(next.id)) {
        seen.add(next.id);
        order.push(next);
      }
    }
  }
  for (const s of a.steps) if (!seen.has(s.id)) order.push(s);
  return order;
}

const GMAIL_TRIGGERS: ReadonlySet<string> = new Set(['trigger.gmailButton', 'trigger.email']);
const SITE_PREFIXES: Record<string, PanelSite> = {
  gmail: 'gmail',
  calendar: 'calendar',
  meta: 'meta',
};

/** The sites an automation works on, read from its trigger and step types. */
export function sitesOf(a: Automation): Set<PanelSite> {
  const sites = new Set<PanelSite>();
  if (GMAIL_TRIGGERS.has(a.trigger.type)) sites.add('gmail');
  for (const step of a.steps) {
    const site = SITE_PREFIXES[step.type.split('.')[0] ?? ''];
    if (site) sites.add(site);
  }
  return sites;
}

export function groupAutomations(
  list: Automation[],
  site: PanelSite | null,
): { onThisPage: Automation[]; others: Automation[] } {
  const onThisPage: Automation[] = [];
  const others: Automation[] = [];
  for (const a of list) (site !== null && sitesOf(a).has(site) ? onThisPage : others).push(a);
  return { onThisPage, others };
}
