import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MICROPHONE_ERROR_MESSAGE, useVoice } from './useVoice.ts';

function stubGetUserMedia(impl: () => Promise<MediaStream>): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(impl) },
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useVoice', () => {
  test('getUserMedia NotAllowedError gives state error and the microphone message', async () => {
    stubGetUserMedia(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));

    const { result } = renderHook(() => useVoice());
    expect(result.current.state).toBe('idle');

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe(MICROPHONE_ERROR_MESSAGE);
    expect(MICROPHONE_ERROR_MESSAGE).toBe(
      "I can't hear you. Check your microphone in Chrome's settings.",
    );
  });

  test('stop without start stays idle', async () => {
    const { result } = renderHook(() => useVoice());
    act(() => {
      result.current.stop();
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.partial).toBe('');
  });
});
