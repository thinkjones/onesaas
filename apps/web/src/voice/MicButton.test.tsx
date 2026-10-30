import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import MicButton from './MicButton.tsx';
import type { UseVoiceResult, VoiceState } from './useVoice.ts';

type FinalCb = (text: string) => void;

/** A scripted useVoice double: the test drives finals through `emitFinal`. */
function createFakeVoice(overrides?: Partial<UseVoiceResult>): {
  voice: UseVoiceResult;
  emitFinal: (text: string) => void;
} {
  let finalCb: FinalCb | null = null;
  const voice: UseVoiceResult = {
    state: 'idle' as VoiceState,
    partial: '',
    error: undefined,
    start: vi.fn(async () => {}),
    stop: vi.fn(() => {}),
    onFinal: vi.fn((cb: FinalCb) => {
      finalCb = cb;
    }),
    ...overrides,
  };
  return {
    voice,
    emitFinal: (text: string) => {
      if (!finalCb) throw new Error('MicButton never registered onFinal');
      finalCb(text);
    },
  };
}

describe('MicButton', () => {
  test('an empty final does not send and shows the hint', () => {
    const onSend = vi.fn();
    const { voice, emitFinal } = createFakeVoice();
    render(<MicButton onSend={onSend} useVoiceFn={() => voice} />);

    act(() => {
      emitFinal('   ');
    });

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByText("I didn't catch that. Try again?")).not.toBeNull();
  });

  test('a non-empty final sends its text', () => {
    const onSend = vi.fn();
    const { voice, emitFinal } = createFakeVoice();
    render(<MicButton onSend={onSend} useVoiceFn={() => voice} />);

    act(() => {
      emitFinal('save them and draft a reply');
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('save them and draft a reply');
  });

  test('clicking toggles listening via start and stop', () => {
    const onSend = vi.fn();
    const start = vi.fn(async () => {});
    const stop = vi.fn(() => {});
    const { voice } = createFakeVoice({ start, stop, state: 'idle' });
    const { rerender } = render(<MicButton onSend={onSend} useVoiceFn={() => voice} />);
    const button = screen.getByRole('button', { name: /hold to talk/i });

    fireEvent.click(button);
    expect(start).toHaveBeenCalledTimes(1);

    rerender(
      <MicButton onSend={onSend} useVoiceFn={() => ({ ...voice, state: 'listening' })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /hold to talk/i }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test('while listening it shows the live partial', () => {
    const onSend = vi.fn();
    const { voice } = createFakeVoice({ state: 'listening', partial: 'when a customer' });
    render(<MicButton onSend={onSend} useVoiceFn={() => voice} />);

    expect(screen.getByText('when a customer')).not.toBeNull();
  });
});
