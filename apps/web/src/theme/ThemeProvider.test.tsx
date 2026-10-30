import { render } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import ThemeProvider from './ThemeProvider.tsx';

afterEach(() => {
  const el = document.documentElement;
  el.removeAttribute('data-theme');
  el.removeAttribute('data-text-size');
  el.style.fontSize = '';
});

test('workshop + xlarge sets the html font-size to 24px', () => {
  render(
    <ThemeProvider theme="workshop" textSize="xlarge">
      <p>child</p>
    </ThemeProvider>,
  );
  expect(document.documentElement.style.fontSize).toBe('24px');
});

test('sets data-theme and data-text-size on <html> and renders children', () => {
  const { getByText } = render(
    <ThemeProvider theme="evening" textSize="large">
      <p>hello</p>
    </ThemeProvider>,
  );
  expect(document.documentElement.dataset.theme).toBe('evening');
  expect(document.documentElement.dataset.textSize).toBe('large');
  expect(document.documentElement.style.fontSize).toBe('19px');
  expect(getByText('hello')).toBeTruthy();
});

test('morning + normal is 17px and workshop adds 3px', () => {
  const { rerender, unmount } = render(
    <ThemeProvider theme="morning" textSize="normal">
      <p>child</p>
    </ThemeProvider>,
  );
  expect(document.documentElement.style.fontSize).toBe('17px');
  rerender(
    <ThemeProvider theme="workshop" textSize="normal">
      <p>child</p>
    </ThemeProvider>,
  );
  expect(document.documentElement.style.fontSize).toBe('20px');
  unmount();
});
