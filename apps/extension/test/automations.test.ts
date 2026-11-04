import { describe, expect, test } from 'vitest';
import { groupAutomations, sitesOf, type Automation } from '../lib/automations.js';

function auto(id: string, trigger: string, steps: string[] = []): Automation {
  return {
    id,
    name: id,
    status: 'on',
    trigger: { id: 'trigger', type: trigger, title: 'T', config: {} },
    steps: steps.map((type, i) => ({ id: `s${i}`, type, title: type, config: {} })),
  };
}

describe('sitesOf', () => {
  test('Gmail triggers count as Gmail', () => {
    expect(sitesOf(auto('a', 'trigger.gmailButton'))).toEqual(new Set(['gmail']));
    expect(sitesOf(auto('b', 'trigger.email'))).toEqual(new Set(['gmail']));
  });

  test('steps add their own site', () => {
    const a = auto('a', 'trigger.manual', ['calendar.createEvent', 'ai.write', 'meta.draftPost']);
    expect(sitesOf(a)).toEqual(new Set(['calendar', 'meta']));
  });

  test('a site-free automation has none', () => {
    expect(sitesOf(auto('a', 'trigger.manual', ['ai.write']))).toEqual(new Set());
  });
});

describe('groupAutomations', () => {
  const gmail = auto('gmail', 'trigger.gmailButton');
  const calendar = auto('calendar', 'trigger.manual', ['calendar.freeBusy']);

  test('splits on the site in the active tab', () => {
    expect(groupAutomations([gmail, calendar], 'calendar')).toEqual({
      onThisPage: [calendar],
      others: [gmail],
    });
  });

  test('off any supported site, everything is under others', () => {
    expect(groupAutomations([gmail, calendar], null)).toEqual({
      onThisPage: [],
      others: [gmail, calendar],
    });
  });
});
