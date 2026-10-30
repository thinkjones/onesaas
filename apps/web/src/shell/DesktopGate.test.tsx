import { act, render } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import DesktopGate from './DesktopGate.tsx';

const GATE_MESSAGE = 'This works best on a bigger screen. Try a laptop or desktop.';

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

afterEach(() => {
  setViewportWidth(1440);
});

test('at 1100px it renders the gate message instead of children', () => {
  setViewportWidth(1100);
  const { getByText, queryByText } = render(
    <DesktopGate>
      <p>the app</p>
    </DesktopGate>,
  );
  expect(getByText(GATE_MESSAGE)).toBeTruthy();
  expect(queryByText('the app')).toBeNull();
});

test('at 1440px it renders children', () => {
  setViewportWidth(1440);
  const { getByText, queryByText } = render(
    <DesktopGate>
      <p>the app</p>
    </DesktopGate>,
  );
  expect(getByText('the app')).toBeTruthy();
  expect(queryByText(GATE_MESSAGE)).toBeNull();
});

test('it follows resizes across the 1280px boundary', () => {
  setViewportWidth(1440);
  const { getByText, queryByText } = render(
    <DesktopGate>
      <p>the app</p>
    </DesktopGate>,
  );
  act(() => {
    setViewportWidth(1000);
    window.dispatchEvent(new Event('resize'));
  });
  expect(getByText(GATE_MESSAGE)).toBeTruthy();
  expect(queryByText('the app')).toBeNull();
  act(() => {
    setViewportWidth(1280);
    window.dispatchEvent(new Event('resize'));
  });
  expect(getByText('the app')).toBeTruthy();
});
