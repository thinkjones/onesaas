import { vi } from 'vitest';
import { catalog } from '@dad/shared';
import { BridgeError } from '../src/bridge/bridge.js';
import type { Gateway } from '../src/models/gateway.js';
import { executors, type Bridge, type StepContext } from '../src/steps/registry.js';

// Clash/preview whys render times in the server-local zone (same contract as
// the engine's approvalTime); pin it so the expected strings are exact.
process.env.TZ = 'America/Los_Angeles';

function makeCtx(bridge: Bridge, gateway?: Gateway): StepContext {
  return {
    gateway: gateway ?? ({ visionJson: vi.fn() } as unknown as Gateway),
    tables: {} as StepContext['tables'],
    bridge,
    signal: new AbortController().signal,
  };
}

const DAY_URL = 'https://calendar.google.com/calendar/r/day/2026/11/3';
const SLOT = { start: '2026-11-03T15:00:00-08:00', end: '2026-11-03T16:00:00-08:00' };

describe('calendar.freeBusy', () => {
  test('one overlapping event gives free:false with the clash why', async () => {
    // 3–4 PM PST is 23:00–00:00Z.
    const overlapping = vi.fn(async () => ({
      events: [
        {
          title: 'Fence quote – Sarah',
          start: '2026-11-03T23:30:00.000Z',
          end: '2026-11-04T00:30:00.000Z',
        },
      ],
    }));
    const result = await executors['calendar.freeBusy']!(
      {},
      SLOT,
      makeCtx({ call: overlapping } as unknown as Bridge),
    );
    expect(result.output).toEqual({
      free: false,
      clashes: [
        {
          title: 'Fence quote – Sarah',
          start: '2026-11-03T23:30:00.000Z',
          end: '2026-11-04T00:30:00.000Z',
        },
      ],
    });
    expect(result.why).toBe('That clashes with "Fence quote – Sarah" at 3:30 PM.');
    expect(overlapping).toHaveBeenCalledWith(
      'calendar',
      'readDay',
      { url: DAY_URL },
      undefined,
      { tab: 'worker' },
    );
    expect(catalog['calendar.freeBusy']!.outputSchema.safeParse(result.output).success).toBe(true);
  });

  test('no overlaps gives free:true', async () => {
    const call = vi.fn(async () => ({
      events: [
        { title: 'Dentist checkup', start: '2026-11-03T17:00:00.000Z', end: '2026-11-03T18:00:00.000Z' },
      ],
    }));
    const result = await executors['calendar.freeBusy']!(
      {},
      SLOT,
      makeCtx({ call } as unknown as Bridge),
    );
    expect(result.output).toEqual({ free: true, clashes: [] });
    expect(result.why).toBe("You're free then.");
  });

  test('back-to-back events (half-open edges) are free', async () => {
    const call = vi.fn(async () => ({
      events: [
        // Ends exactly when the slot starts; starts exactly when it ends.
        { title: 'Before', start: '2026-11-03T22:00:00.000Z', end: '2026-11-03T23:00:00.000Z' },
        { title: 'After', start: '2026-11-04T00:00:00.000Z', end: '2026-11-04T01:00:00.000Z' },
      ],
    }));
    const result = await executors['calendar.freeBusy']!(
      {},
      SLOT,
      makeCtx({ call } as unknown as Bridge),
    );
    expect(result.output).toEqual({ free: true, clashes: [] });
    expect(result.why).toBe("You're free then.");
  });

  test('names the earliest clash when several overlap', async () => {
    const call = vi.fn(async () => ({
      events: [
        { title: 'Late overlap', start: '2026-11-03T23:45:00.000Z', end: '2026-11-04T00:15:00.000Z' },
        { title: 'Early overlap', start: '2026-11-03T23:10:00.000Z', end: '2026-11-03T23:20:00.000Z' },
      ],
    }));
    const result = await executors['calendar.freeBusy']!(
      {},
      SLOT,
      makeCtx({ call } as unknown as Bridge),
    );
    expect(result.why).toBe('That clashes with "Early overlap" at 3:10 PM.');
  });

  test('navigated:true retries the read on the day page', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ navigated: true })
      .mockResolvedValueOnce({ events: [] });
    const result = await executors['calendar.freeBusy']!(
      {},
      SLOT,
      makeCtx({ call } as unknown as Bridge),
    );
    expect(result.output).toEqual({ free: true, clashes: [] });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenNthCalledWith(2, 'calendar', 'readDay', { url: DAY_URL }, undefined, {
      tab: 'worker',
    });
  });

  test('SELECTOR_MISSING falls back to vision with the exact prompt and schema name', async () => {
    const call = vi.fn(async (_site: unknown, action: unknown) => {
      if (action === 'readDay') {
        throw new BridgeError('selector [role="grid"] not found', 'SELECTOR_MISSING');
      }
      if (action === 'screenshot') return { dataUrl: 'data:image/png;base64,AAAA' };
      throw new Error(`unexpected action: ${String(action)}`);
    });
    const visionJson = vi.fn(async (_o: unknown) => ({
      data: {
        events: [
          {
            title: 'Fence quote – Sarah',
            start: '2026-11-03T23:30:00.000Z',
            end: '2026-11-04T00:30:00.000Z',
          },
        ],
      },
      model: 'muse-spark-1.3',
      costUsd: 0.01,
    }));
    const result = await executors['calendar.freeBusy']!(
      {},
      SLOT,
      makeCtx({ call } as unknown as Bridge, { visionJson } as unknown as Gateway),
    );
    expect(result.output).toEqual({
      free: false,
      clashes: [
        {
          title: 'Fence quote – Sarah',
          start: '2026-11-03T23:30:00.000Z',
          end: '2026-11-04T00:30:00.000Z',
        },
      ],
    });
    expect(result.why).toBe(
      'That clashes with "Fence quote – Sarah" at 3:30 PM. ' +
        'I read your calendar from a screenshot because the page looked different.',
    );
    expect(result.model).toBe('muse-spark-1.3');
    expect(result.costUsd).toBe(0.01);
    expect(visionJson).toHaveBeenCalledTimes(1);
    const sent = visionJson.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent['prompt']).toBe('List every event visible on this calendar day with start and end times.');
    expect(sent['schemaName']).toBe('readDay');
    expect(sent['imageDataUrl']).toBe('data:image/png;base64,AAAA');
  });

  test('vision fallback on a free day appends the screenshot sentence', async () => {
    const call = vi.fn(async (_site: unknown, action: unknown) => {
      if (action === 'readDay') {
        throw new BridgeError('selector [role="grid"] not found', 'SELECTOR_MISSING');
      }
      return { dataUrl: 'data:image/png;base64,AAAA' };
    });
    const visionJson = vi.fn(async () => ({
      data: { events: [] },
      model: 'muse-spark-1.3',
      costUsd: 0.005,
    }));
    const result = await executors['calendar.freeBusy']!(
      {},
      SLOT,
      makeCtx({ call } as unknown as Bridge, { visionJson } as unknown as Gateway),
    );
    expect(result.output).toEqual({ free: true, clashes: [] });
    expect(result.why).toBe(
      "You're free then. I read your calendar from a screenshot because the page looked different.",
    );
  });

  test('time-only vision times are read on the queried day', async () => {
    const call = vi.fn(async (_site: unknown, action: unknown) => {
      if (action === 'readDay') {
        throw new BridgeError('selector [role="grid"] not found', 'SELECTOR_MISSING');
      }
      return { dataUrl: 'data:image/png;base64,AAAA' };
    });
    const visionJson = vi.fn(async () => ({
      data: { events: [{ title: 'Dentist checkup', start: '3:30 PM', end: '4:30 PM' }] },
      model: 'muse-spark-1.3',
      costUsd: 0.01,
    }));
    const result = await executors['calendar.freeBusy']!(
      {},
      SLOT,
      makeCtx({ call } as unknown as Bridge, { visionJson } as unknown as Gateway),
    );
    expect(result.output).toEqual({
      free: false,
      clashes: [{ title: 'Dentist checkup', start: '3:30 PM', end: '4:30 PM' }],
    });
    expect(result.why).toBe(
      'That clashes with "Dentist checkup" at 3:30 PM. ' +
        'I read your calendar from a screenshot because the page looked different.',
    );
  });

  test('derives an unpadded day URL from the input start', async () => {
    const call = vi.fn(async () => ({ events: [] }));
    await executors['calendar.freeBusy']!(
      {},
      { start: '2026-03-05T09:00:00-08:00', end: '2026-03-05T10:00:00-08:00' },
      makeCtx({ call } as unknown as Bridge),
    );
    expect(call).toHaveBeenCalledWith(
      'calendar',
      'readDay',
      { url: 'https://calendar.google.com/calendar/r/day/2026/3/5' },
      undefined,
      { tab: 'worker' },
    );
  });

  test('unparseable input times fail instead of reporting free', async () => {
    const call = vi.fn(async () => ({ events: [] }));
    await expect(
      executors['calendar.freeBusy']!(
        {},
        { start: 'not-a-time', end: SLOT.end },
        makeCtx({ call } as unknown as Bridge),
      ),
    ).rejects.toThrow();
    // Sanity: the no-false-free rule also holds when the END is garbage.
    await expect(
      executors['calendar.freeBusy']!(
        {},
        { start: SLOT.start, end: 'not-a-time' },
        makeCtx({ call } as unknown as Bridge),
      ),
    ).rejects.toThrow();
  });

  test('non-selector bridge errors propagate with no fallback', async () => {
    const original = new BridgeError('I need Google Calendar open in Chrome to do this.', 'NOT_OPEN');
    const call = vi.fn(async () => {
      throw original;
    });
    const visionJson = vi.fn();
    const err = await executors['calendar.freeBusy']!(
      {},
      SLOT,
      makeCtx({ call } as unknown as Bridge, { visionJson } as unknown as Gateway),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBe(original);
    expect(visionJson).not.toHaveBeenCalled();
  });

  test('fetch steps run for real in tests: no preview', () => {
    expect(executors['calendar.freeBusy']!.preview).toBeUndefined();
  });
});

describe('calendar.createEvent', () => {
  const INPUT = {
    title: 'Fence quote – Sarah',
    start: '2026-11-03T15:00:00-08:00',
    end: '2026-11-03T16:00:00-08:00',
  };

  test('saved event reports created:true', async () => {
    // Honest two-call sequence: navigate:true opens the template page
    // ({ navigated: true }), navigate:false clicks Save ({ saved: true }).
    const call = vi.fn().mockResolvedValueOnce({ navigated: true }).mockResolvedValueOnce({ saved: true });
    const result = await executors['calendar.createEvent']!(
      {},
      INPUT,
      makeCtx({ call } as unknown as Bridge),
    );
    expect(result.output).toEqual({ created: true });
    expect(result.why).toBe('Added "Fence quote – Sarah" to your calendar.');
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenNthCalledWith(
      1,
      'calendar',
      'createEvent',
      { ...INPUT, navigate: true },
      undefined,
      { tab: 'active' },
    );
    expect(call).toHaveBeenNthCalledWith(
      2,
      'calendar',
      'createEvent',
      { ...INPUT, navigate: false },
      undefined,
      { tab: 'active' },
    );
    expect(catalog['calendar.createEvent']!.outputSchema.safeParse(result.output).success).toBe(true);
  });

  test('unexpected first-response shape fails instead of reporting created:true', async () => {
    const call = vi.fn(async () => ({ saved: true }));
    await expect(
      executors['calendar.createEvent']!({}, INPUT, makeCtx({ call } as unknown as Bridge)),
    ).rejects.toThrow("I couldn't open the new event page.");
    expect(call).toHaveBeenCalledTimes(1);
  });

  test('navigates to the template page before saving', async () => {
    const call = vi.fn().mockResolvedValueOnce({ navigated: true }).mockResolvedValueOnce({ saved: true });
    const result = await executors['calendar.createEvent']!(
      {},
      INPUT,
      makeCtx({ call } as unknown as Bridge),
    );
    expect(result.output).toEqual({ created: true });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenNthCalledWith(
      1,
      'calendar',
      'createEvent',
      { ...INPUT, navigate: true },
      undefined,
      { tab: 'active' },
    );
    expect(call).toHaveBeenNthCalledWith(
      2,
      'calendar',
      'createEvent',
      { ...INPUT, navigate: false },
      undefined,
      { tab: 'active' },
    );
  });

  test('missing Save hands off with created:false', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ navigated: true })
      .mockRejectedValueOnce(new BridgeError("I couldn't find the Save button.", 'HANDOFF'));
    const result = await executors['calendar.createEvent']!(
      {},
      INPUT,
      makeCtx({ call } as unknown as Bridge),
    );
    expect(result.output).toEqual({ created: false });
    expect(result.why).toBe("I've filled in the event; press Save in Google Calendar.");
  });

  test('non-handoff bridge errors propagate', async () => {
    const original = new BridgeError('I need Google Calendar open in Chrome to do this.', 'TIMEOUT');
    const call = vi.fn(async () => {
      throw original;
    });
    const err = await executors['calendar.createEvent']!(
      {},
      INPUT,
      makeCtx({ call } as unknown as Bridge),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBe(original);
  });

  test('titleTemplate applies its {{title}} placeholder', async () => {
    const call = vi.fn().mockResolvedValueOnce({ navigated: true }).mockResolvedValueOnce({ saved: true });
    const result = await executors['calendar.createEvent']!(
      { titleTemplate: 'Work: {{title}}' },
      INPUT,
      makeCtx({ call } as unknown as Bridge),
    );
    expect(call).toHaveBeenCalledWith(
      'calendar',
      'createEvent',
      { ...INPUT, title: 'Work: Fence quote – Sarah', navigate: true },
      undefined,
      { tab: 'active' },
    );
    expect(result.why).toBe('Added "Work: Fence quote – Sarah" to your calendar.');
  });

  test('titleTemplate without the placeholder is used verbatim', async () => {
    const call = vi.fn().mockResolvedValueOnce({ navigated: true }).mockResolvedValueOnce({ saved: true });
    const result = await executors['calendar.createEvent']!(
      { titleTemplate: 'Focus block' },
      INPUT,
      makeCtx({ call } as unknown as Bridge),
    );
    expect(call).toHaveBeenCalledWith(
      'calendar',
      'createEvent',
      { ...INPUT, title: 'Focus block', navigate: true },
      undefined,
      { tab: 'active' },
    );
    expect(result.why).toBe('Added "Focus block" to your calendar.');
  });

  test('preview describes the event that would be added', async () => {
    const call = vi.fn();
    const result = await executors['calendar.createEvent']!.preview!(
      {},
      INPUT,
      makeCtx({ call } as unknown as Bridge),
    );
    expect(result.output).toEqual({ created: true });
    expect(result.why).toBe(
      'In a real run I would add "Fence quote – Sarah" to your calendar on November 3 at 3:00 PM.',
    );
    expect(call).not.toHaveBeenCalled();
  });

  test('preview uses the templated title', async () => {
    const result = await executors['calendar.createEvent']!.preview!(
      { titleTemplate: 'Work: {{title}}' },
      INPUT,
      makeCtx({ call: vi.fn() } as unknown as Bridge),
    );
    expect(result.why).toBe(
      'In a real run I would add "Work: Fence quote – Sarah" to your calendar on November 3 at 3:00 PM.',
    );
  });
});

test('calendar catalog entries have descriptions and valid schemas', () => {
  for (const type of ['calendar.freeBusy', 'calendar.createEvent']) {
    const def = catalog[type]!;
    expect(def.description.length).toBeGreaterThan(0);
    expect(typeof executors[type]).toBe('function');
  }
  expect(catalog['calendar.freeBusy']!.kind).toBe('fetch');
  expect(catalog['calendar.createEvent']!.kind).toBe('act');
  expect(() =>
    catalog['calendar.createEvent']!.configSchema.parse({ titleTemplate: 'Work: {{title}}' }),
  ).not.toThrow();
});
