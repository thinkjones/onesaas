import { render } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import TextSizeProvider from './TextSizeProvider.tsx';

afterEach(() => {
  const el = document.documentElement;
  el.removeAttribute('data-text-size');
  el.style.fontSize = '';
});

test('xlarge sets the html font-size to 21px', () => {
  render(
    <TextSizeProvider textSize="xlarge">
      <p>child</p>
    </TextSizeProvider>,
  );
  expect(document.documentElement.style.fontSize).toBe('21px');
});

test('sets data-text-size on <html> and renders children', () => {
  const { getByText } = render(
    <TextSizeProvider textSize="large">
      <p>hello</p>
    </TextSizeProvider>,
  );
  expect(document.documentElement.dataset.textSize).toBe('large');
  expect(document.documentElement.style.fontSize).toBe('19px');
  expect(getByText('hello')).toBeTruthy();
});

test('normal is 17px', () => {
  const { rerender, unmount } = render(
    <TextSizeProvider textSize="normal">
      <p>child</p>
    </TextSizeProvider>,
  );
  expect(document.documentElement.style.fontSize).toBe('17px');
  rerender(
    <TextSizeProvider textSize="large">
      <p>child</p>
    </TextSizeProvider>,
  );
  expect(document.documentElement.style.fontSize).toBe('19px');
  unmount();
});
