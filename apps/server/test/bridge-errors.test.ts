import { z } from 'zod';
import { BridgeError, createBridge, type Bridge, type WSContext } from '../src/bridge/bridge.js';
import { createPairing } from '../src/bridge/pairing.js';
import { withVisionFallback } from '../src/bridge/vision.js';
import { createGateway, type Gateway } from '../src/models/gateway.js';

const GMAIL_MSG = 'I need Gmail open in Chrome to do this.';

// ---------------------------------------------------------------------------
// Helpers (mirrors bridge.test.ts: fake socket driving attach() directly)
// ---------------------------------------------------------------------------

function makePairing() {
  const map = new Map<string, string>();
  return createPairing({
    get: (k: string) => map.get(k),
    set: (k: string, v: string) => {
      map.set(k, v);
    },
    del: (k: string) => {
      map.delete(k);
    },
  });
}

function fakeSocket() {
  const sent: any[] = [];
  const ws: WSContext & { sent: any[]; closed?: { code?: number; reason?: string } } = {
    sent,
    send: (d: string) => {
      sent.push(JSON.parse(d));
    },
    close: (code?: number, reason?: string) => {
      ws.closed = { code, reason };
      ws.onclose?.();
    },
    onmessage: null,
    onclose: null,
  };
  return ws;
}

/** Bridge with one hello-authed fake socket; returns the bridge + socket. */
function authedBridge() {
  const pairing = makePairing();
  const bridge = createBridge({ pairing });
  const token = pairing.redeem(pairing.start().code)!;
  const ws = fakeSocket();
  bridge.attach(ws);
  ws.onmessage!(JSON.stringify({ type: 'hello', token }));
  ws.sent.length = 0; // Drop the `ready`; what follows is cmd traffic.
  return { bridge, ws };
}

function lastCmdId(ws: { sent: any[] }): string {
  const cmd = ws.sent.at(-1);
  expect(cmd.type).toBe('cmd');
  return cmd.id as string;
}

// ---------------------------------------------------------------------------
// BridgeError mapping
// ---------------------------------------------------------------------------

describe('bridge error codes', () => {
  test('result {ok:false, code} rejects with a BridgeError carrying code + message', async () => {
    const { bridge, ws } = authedBridge();
    const callP = bridge.call('calendar', 'readEvents', { range: 'week' });
    ws.onmessage!(
      JSON.stringify({
        type: 'result',
        id: lastCmdId(ws),
        ok: false,
        error: 'selector .event-row not found',
        code: 'SELECTOR_MISSING',
      }),
    );
    const err = await callP.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BridgeError);
    expect(err).toBeInstanceOf(Error);
    expect((err as BridgeError).message).toBe('selector .event-row not found');
    expect((err as BridgeError).code).toBe('SELECTOR_MISSING');
  });

  test('result {ok:false} without code rejects with undefined code, message preserved', async () => {
    const { bridge, ws } = authedBridge();
    const callP = bridge.call('gmail', 'readOpenEmail', {});
    ws.onmessage!(
      JSON.stringify({ type: 'result', id: lastCmdId(ws), ok: false, error: 'boom' }),
    );
    const err = (await callP.then(
      () => null,
      (e: unknown) => e,
    )) as BridgeError;
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.message).toBe('boom');
    expect(err.code).toBeUndefined();
  });

  test('not-connected call rejects with NOT_OPEN and the unchanged site message', async () => {
    const bridge = createBridge({ pairing: makePairing() });
    const err = (await bridge.call('gmail', 'readOpenEmail', {}).then(
      () => null,
      (e: unknown) => e,
    )) as BridgeError;
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.message).toBe(GMAIL_MSG);
    expect(err.code).toBe('NOT_OPEN');
  });

  test('timeout rejects with TIMEOUT and the unchanged site message', async () => {
    const { bridge } = authedBridge();
    const err = (await bridge.call('gmail', 'readOpenEmail', {}, 20).then(
      () => null,
      (e: unknown) => e,
    )) as BridgeError;
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.message).toBe(GMAIL_MSG);
    expect(err.code).toBe('TIMEOUT');
  });

  test('cmd carries tab, defaulting to active', async () => {
    const { bridge, ws } = authedBridge();
    bridge.call('calendar', 'readEvents', {}).catch(() => {});
    expect(ws.sent.at(-1)).toMatchObject({ type: 'cmd', tab: 'active' });
    bridge.call('calendar', 'readEvents', {}, undefined, { tab: 'worker' }).catch(() => {});
    expect(ws.sent.at(-1)).toMatchObject({ type: 'cmd', tab: 'worker' });
  });
});

// ---------------------------------------------------------------------------
// withVisionFallback
// ---------------------------------------------------------------------------

const eventSchema = z.object({ events: z.array(z.object({ title: z.string() })) });

function fakeBridgeImpl(call: (...args: any[]) => Promise<unknown>): Pick<Bridge, 'call'> {
  return { call: call as Bridge['call'] };
}

describe('withVisionFallback', () => {
  test('SELECTOR_MISSING falls back to screenshot + vision', async () => {
    const calls: Array<{ site: unknown; action: unknown; input: unknown }> = [];
    const bridge = fakeBridgeImpl(async (site, action, input) => {
      calls.push({ site, action, input });
      if (action === 'readEvents') {
        throw new BridgeError('selector .event-row not found', 'SELECTOR_MISSING');
      }
      expect(action).toBe('screenshot');
      return { dataUrl: 'data:image/png;base64,AAAA' };
    });
    const visionCalls: unknown[] = [];
    const gateway = {
      visionJson: async (o: unknown) => {
        visionCalls.push(o);
        return { data: { events: [{ title: 'Dentist' }] }, model: 'muse-spark-1.3', costUsd: 0.01 };
      },
    } as unknown as Pick<Gateway, 'visionJson'>;

    const result = await withVisionFallback({
      bridge,
      gateway,
      site: 'calendar',
      action: 'readEvents',
      input: { range: 'week' },
      screenshotUrl: 'https://calendar.google.com/calendar',
      prompt: 'List events.',
      schema: eventSchema,
    });

    expect(result).toEqual({
      data: { events: [{ title: 'Dentist' }] },
      viaScreenshot: true,
      model: 'muse-spark-1.3',
      costUsd: 0.01,
    });
    expect(calls[1]).toEqual({
      site: 'calendar',
      action: 'screenshot',
      input: { site: 'calendar', url: 'https://calendar.google.com/calendar' },
    });
    expect(visionCalls).toHaveLength(1);
    expect(visionCalls[0]).toMatchObject({
      role: 'vision',
      prompt: 'List events.',
      imageDataUrl: 'data:image/png;base64,AAAA',
    });
  });

  test('success path never touches the gateway', async () => {
    const bridge = fakeBridgeImpl(async () => ({ events: [{ title: 'Direct' }] }));
    const gateway = { visionJson: vi.fn() } as unknown as Pick<Gateway, 'visionJson'>;
    const result = await withVisionFallback({
      bridge,
      gateway,
      site: 'calendar',
      action: 'readEvents',
      input: {},
      prompt: 'List events.',
      schema: eventSchema,
    });
    expect(result).toEqual({ data: { events: [{ title: 'Direct' }] }, viaScreenshot: false });
    expect(gateway.visionJson).not.toHaveBeenCalled();
  });

  test.each([['NOT_OPEN'], ['TIMEOUT'], ['HANDOFF'], [undefined]])(
    'non-selector error (code %s) propagates unchanged with no fallback',
    async (code) => {
      const original =
        code === undefined ? new Error('plain failure') : new BridgeError('site failure', code);
      let screenshotCalls = 0;
      const bridge = fakeBridgeImpl(async (_site, action) => {
        if (action === 'screenshot') screenshotCalls += 1;
        throw original;
      });
      const gateway = { visionJson: vi.fn() } as unknown as Pick<Gateway, 'visionJson'>;
      const err = await withVisionFallback({
        bridge,
        gateway,
        site: 'calendar',
        action: 'readEvents',
        input: {},
        prompt: 'List events.',
        schema: eventSchema,
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBe(original);
      expect(screenshotCalls).toBe(0);
      expect(gateway.visionJson).not.toHaveBeenCalled();
    },
  );

  test('screenshot failure propagates identically with no vision call', async () => {
    const original = new BridgeError('capture blew up', 'TIMEOUT');
    const bridge = fakeBridgeImpl(async (_site, action) => {
      if (action === 'readEvents') {
        throw new BridgeError('selector .event-row not found', 'SELECTOR_MISSING');
      }
      throw original;
    });
    const gateway = { visionJson: vi.fn() } as unknown as Pick<Gateway, 'visionJson'>;
    const err = await withVisionFallback({
      bridge,
      gateway,
      site: 'calendar',
      action: 'readEvents',
      input: {},
      prompt: 'List events.',
      schema: eventSchema,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBe(original);
    expect(gateway.visionJson).not.toHaveBeenCalled();
  });

  test('malformed screenshot output (missing dataUrl) throws a plain Error', async () => {
    const bridge = fakeBridgeImpl(async (_site, action) => {
      if (action === 'readEvents') {
        throw new BridgeError('selector .event-row not found', 'SELECTOR_MISSING');
      }
      return {}; // No dataUrl: fails the typeof shot?.dataUrl !== 'string' check.
    });
    const gateway = { visionJson: vi.fn() } as unknown as Pick<Gateway, 'visionJson'>;
    const err = await withVisionFallback({
      bridge,
      gateway,
      site: 'calendar',
      action: 'readEvents',
      input: {},
      prompt: 'List events.',
      schema: eventSchema,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BridgeError);
    expect((err as Error).message).toBe('Screenshot did not return a data URL.');
    expect(gateway.visionJson).not.toHaveBeenCalled();
  });

  test('visionJson failure propagates identically', async () => {
    const original = new Error('model down');
    const bridge = fakeBridgeImpl(async (_site, action) => {
      if (action === 'readEvents') {
        throw new BridgeError('selector .event-row not found', 'SELECTOR_MISSING');
      }
      return { dataUrl: 'data:image/png;base64,AAAA' };
    });
    const gateway = {
      visionJson: vi.fn(async () => {
        throw original;
      }),
    } as unknown as Pick<Gateway, 'visionJson'>;
    const err = await withVisionFallback({
      bridge,
      gateway,
      site: 'calendar',
      action: 'readEvents',
      input: {},
      prompt: 'List events.',
      schema: eventSchema,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// gateway.visionJson
// ---------------------------------------------------------------------------

describe('gateway visionJson', () => {
  test('sends vision model with an image_url data-URL part + strict schema', async () => {
    const sent: unknown[] = [];
    const client = {
      chat: {
        completions: {
          create: async (params: unknown) => {
            sent.push(params);
            return {
              choices: [{ message: { content: '{"events":[{"title":"Dentist"}]}' } }],
              usage: { prompt_tokens: 1000, completion_tokens: 500 },
            };
          },
        },
      },
    };
    const gateway = createGateway({ client: client as never });
    const result = await gateway.visionJson({
      role: 'vision',
      prompt: 'List events.',
      imageDataUrl: 'data:image/png;base64,AAAA',
      schema: eventSchema,
      schemaName: 'events',
    });
    expect(result.data).toEqual({ events: [{ title: 'Dentist' }] });
    expect(result.model).toBe('muse-spark-1.3');
    expect(result.tokens).toEqual({ input: 1000, output: 500 });
    expect(sent).toHaveLength(1);
    const params = sent[0] as Record<string, unknown>;
    expect(params['model']).toBe('muse-spark-1.3');
    expect(params['messages']).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'List events.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      },
    ]);
    expect(params['response_format']).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'events', strict: true },
    });
  });

  test('visionJson throws on schema mismatch like chatJson', async () => {
    const client = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: '{"events":[{"title":42}]}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 20 },
          }),
        },
      },
    };
    const gateway = createGateway({ client: client as never });
    await expect(
      gateway.visionJson({
        role: 'vision',
        prompt: 'List events.',
        imageDataUrl: 'data:image/png;base64,AAAA',
        schema: eventSchema,
        schemaName: 'events',
      }),
    ).rejects.toThrow(/^Model output did not match schema/);
  });
});
