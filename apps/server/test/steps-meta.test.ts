import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import { catalog } from '@onesaas/shared';
import { executors, type Bridge, type StepContext } from '../src/steps/registry.js';

function makeCtx(over: Partial<StepContext> = {}, bridge?: Bridge): StepContext {
  return {
    gateway: {} as StepContext['gateway'],
    tables: {} as StepContext['tables'],
    bridge: bridge ?? ({ call: vi.fn() } as unknown as Bridge),
    signal: new AbortController().signal,
    ...over,
  };
}

const IMAGE_INPUT = {
  text: 'Fresh sourdough this Saturday! 🍞 #bakery #fresh',
  image: { fileId: 'generated_abc123', mime: 'image/png', width: 1024, height: 1024 },
};
const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('meta.draftPost', () => {
  test('calls the bridge in the active tab and returns the handoff why', async () => {
    const call = vi.fn(async () => ({ textFilled: true, imageCopied: true }));
    const dataUrl = vi.fn(async () => DATA_URL);
    const result = await executors['meta.draftPost']!(
      {},
      IMAGE_INPUT,
      makeCtx({ files: { dataUrl } as unknown as StepContext['files'] }, { call } as unknown as Bridge),
    );
    expect(dataUrl).toHaveBeenCalledWith('generated_abc123');
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      'meta',
      'draftPost',
      { text: IMAGE_INPUT.text, imageDataUrl: DATA_URL },
      undefined,
      { tab: 'active' },
    );
    expect(result.output).toEqual({ prepared: true });
    expect(result.why).toBe(
      'Prepared the post in Meta Business Suite; paste the photo and press Publish.',
    );
    expect(catalog['meta.draftPost']!.outputSchema.safeParse(result.output).success).toBe(true);
  });

  test('sends text only when no photo is given', async () => {
    const call = vi.fn(async () => ({ textFilled: true, imageCopied: false }));
    const result = await executors['meta.draftPost']!(
      {},
      { text: 'Just words.' },
      makeCtx({}, { call } as unknown as Bridge),
    );
    expect(call).toHaveBeenCalledWith('meta', 'draftPost', { text: 'Just words.' }, undefined, {
      tab: 'active',
    });
    expect(result.output).toEqual({ prepared: true });
    expect(result.why).toBe(
      "Prepared the post in Meta Business Suite; check the text and press Publish.",
    );
  });

  test('retries once the tab navigates to the composer', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ navigated: true })
      .mockResolvedValueOnce({ textFilled: true, imageCopied: false });
    const result = await executors['meta.draftPost']!(
      {},
      { text: 'Hello.' },
      makeCtx({}, { call } as unknown as Bridge),
    );
    expect(call).toHaveBeenCalledTimes(2);
    expect(result.output).toEqual({ prepared: true });
  });

  test('fails closed when the bridge reports the text was not filled', async () => {
    const call = vi.fn(async () => ({ textFilled: false, imageCopied: true }));
    await expect(
      executors['meta.draftPost']!(
        {},
        IMAGE_INPUT,
        makeCtx(
          { files: { dataUrl: vi.fn(async () => DATA_URL) } as unknown as StepContext['files'] },
          { call } as unknown as Bridge,
        ),
      ),
    ).rejects.toThrow("The post text wasn't filled in Business Suite.");
  });

  test('fails closed when the bridge sends no output at all', async () => {
    const call = vi.fn(async () => undefined);
    await expect(
      executors['meta.draftPost']!({}, { text: 'Hello.' }, makeCtx({}, { call } as unknown as Bridge)),
    ).rejects.toThrow("The post text wasn't filled in Business Suite.");
  });

  test('fails closed when the composer never finishes loading', async () => {
    const call = vi.fn(async () => ({ navigated: true }));
    await expect(
      executors['meta.draftPost']!({}, { text: 'Hello.' }, makeCtx({}, { call } as unknown as Bridge)),
    ).rejects.toThrow("The Business Suite page didn't finish loading.");
    expect(call).toHaveBeenCalledTimes(3);
  });

  test('fails closed when the photo was sent but not copied', async () => {
    const call = vi.fn(async () => ({ textFilled: true, imageCopied: false }));
    await expect(
      executors['meta.draftPost']!(
        {},
        IMAGE_INPUT,
        makeCtx(
          { files: { dataUrl: vi.fn(async () => DATA_URL) } as unknown as StepContext['files'] },
          { call } as unknown as Bridge,
        ),
      ),
    ).rejects.toThrow("The photo wasn't copied to the clipboard.");
  });

  test('fails readably when photo storage is unavailable', async () => {
    const call = vi.fn();
    await expect(
      executors['meta.draftPost']!({}, IMAGE_INPUT, makeCtx({}, { call } as unknown as Bridge)),
    ).rejects.toThrow("Photos aren't available on this server.");
    expect(call).not.toHaveBeenCalled();
  });

  test('preview returns the preview why without calling the bridge', async () => {
    const call = vi.fn();
    const result = await executors['meta.draftPost']!.preview!(
      {},
      IMAGE_INPUT,
      makeCtx({}, { call } as unknown as Bridge),
    );
    expect(call).not.toHaveBeenCalled();
    expect(result.output).toEqual({ prepared: true });
    expect(result.why).toBe(
      'In a real run I would open a new post in Meta Business Suite with this text and photo.',
    );
    expect(catalog['meta.draftPost']!.outputSchema.safeParse(result.output).success).toBe(true);
  });

  test('preview mentions no photo when no photo is given', async () => {
    const call = vi.fn();
    const result = await executors['meta.draftPost']!.preview!(
      {},
      { text: 'Just words.' },
      makeCtx({}, { call } as unknown as Bridge),
    );
    expect(call).not.toHaveBeenCalled();
    expect(result.output).toEqual({ prepared: true });
    expect(result.why).toBe(
      'In a real run I would open a new post in Meta Business Suite with this text.',
    );
  });
});

describe('notify', () => {
  test('emits a notify event and leaves the step done', async () => {
    const events = new EventEmitter();
    const seen: unknown[] = [];
    events.on('event', (e) => seen.push(e));
    const result = await executors['notify']!(
      {},
      { text: 'New customer: Priya Nair' },
      makeCtx({ events }),
    );
    expect(seen).toEqual([{ type: 'notify', text: 'New customer: Priya Nair' }]);
    expect(result.output).toEqual({ notified: true });
    expect(result.why).toBe('Told you: New customer: Priya Nair');
    expect(result.wait).toBeUndefined();
    expect(catalog['notify']!.outputSchema.safeParse(result.output).success).toBe(true);
  });

  test('preview describes the message without emitting', async () => {
    const events = new EventEmitter();
    const seen: unknown[] = [];
    events.on('event', (e) => seen.push(e));
    const result = await executors['notify']!.preview!(
      {},
      { text: 'New customer: Priya Nair' },
      makeCtx({ events }),
    );
    expect(seen).toEqual([]);
    expect(result.output).toEqual({ notified: true });
    expect(result.why).toBe('In a real run I would tell you: New customer: Priya Nair');
  });

  test('fails readably without an event emitter', async () => {
    await expect(
      executors['notify']!({}, { text: 'Hi' }, makeCtx()),
    ).rejects.toThrow('Notifications are not available on this server.');
  });
});
