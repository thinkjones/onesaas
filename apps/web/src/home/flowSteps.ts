import { catalog, type FlowIconName, type FlowStep, type Workflow } from '@onesaas/shared';

const ICON_BY_TYPE: Record<string, FlowIconName> = {
  'trigger.gmailButton': 'MousePointerClick',
  'trigger.manual': 'Play',
  'trigger.email': 'Mail',
  'trigger.upload': 'Camera',
  'ai.classify': 'Tags',
  'ai.extract': 'Sparkles',
  'ai.write': 'PenLine',
  'table.upsert': 'Database',
  'table.insert': 'Database',
  'table.query': 'Search',
  'gmail.read': 'Inbox',
  'gmail.draftReply': 'Send',
  'calendar.freeBusy': 'Calendar',
  'calendar.createEvent': 'Calendar',
  'approval.ask': 'ShieldCheck',
  'image.cutout': 'Image',
  'image.generate': 'Image',
  'image.edit': 'Image',
  'meta.draftPost': 'Send',
  notify: 'Bell',
  'code.transform': 'Calculator',
};

/**
 * An automation's steps in the order they run. The saved step list is in the
 * order they were added, so walk the links from the trigger; anything not
 * linked goes last.
 */
export function flowStepsOf(wf: Workflow): FlowStep[] {
  const byId = new Map([wf.trigger, ...wf.steps].map((s) => [s.id, s]));
  const seen = new Set<string>([wf.trigger.id]);
  const order = [wf.trigger.id];
  for (let i = 0; i < order.length; i += 1) {
    for (const e of wf.edges) {
      if (e.from === order[i] && byId.has(e.to) && !seen.has(e.to)) {
        seen.add(e.to);
        order.push(e.to);
      }
    }
  }
  for (const s of wf.steps) if (!seen.has(s.id)) order.push(s.id);
  return order.map((id) => {
    const { type } = byId.get(id)!;
    return { icon: ICON_BY_TYPE[type] ?? 'Zap', kind: catalog[type as keyof typeof catalog]?.kind ?? 'act' };
  });
}
