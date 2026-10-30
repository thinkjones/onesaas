import { render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import MoodBackdrop from './MoodBackdrop.tsx';

// M5 Task 4: mood images + design-mode backdrop (backdrop half).

function mockReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('with no generated ids renders /mood/default-1.jpg', () => {
  mockReducedMotion(false);
  const { container } = render(<MoodBackdrop visible fileIds={[]} />);
  const imgs = container.querySelectorAll('img');
  expect(imgs.length).toBeGreaterThan(0);
  expect(imgs[0]!.getAttribute('src')).toBe('/mood/default-1.jpg');
});

test('with reduced motion has no animation class', () => {
  mockReducedMotion(true);
  const { container } = render(<MoodBackdrop visible fileIds={[]} />);
  expect(container.querySelector('.mood-backdrop-drift')).toBeNull();
  expect(container.querySelector('.mood-backdrop-fade')).toBeNull();
});

test('without reduced motion the drift animation applies', () => {
  mockReducedMotion(false);
  const { container } = render(<MoodBackdrop visible fileIds={[]} />);
  expect(container.querySelector('.mood-backdrop-drift')).not.toBeNull();
});

test('generated ids render as /api/files/:id instead of the defaults', () => {
  mockReducedMotion(false);
  const { container } = render(<MoodBackdrop visible fileIds={['abc123', 'def456']} />);
  const srcs = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
  expect(srcs).toEqual(['/api/files/abc123', '/api/files/def456']);
});

test('visible=false hides the layer (600ms fade handled in CSS)', () => {
  mockReducedMotion(false);
  const { container, rerender } = render(<MoodBackdrop visible fileIds={[]} />);
  expect(container.querySelector('.mood-backdrop-hidden')).toBeNull();
  rerender(<MoodBackdrop visible={false} fileIds={[]} />);
  expect(container.querySelector('.mood-backdrop-hidden')).not.toBeNull();
});
