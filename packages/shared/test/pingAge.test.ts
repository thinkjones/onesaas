import { formatPingAge } from '../src/index.js';

const NOW = Date.parse('2026-05-01T12:00:00.000Z');

function iso(msBefore: number): string {
  return new Date(NOW - msBefore).toISOString();
}

test('null or undefined means never contacted', () => {
  expect(formatPingAge(null, NOW)).toBe('never');
  expect(formatPingAge(undefined, NOW)).toBe('never');
});

test('an unparseable stamp reads unknown, never throws', () => {
  expect(formatPingAge('not-a-date', NOW)).toBe('unknown');
});

test('a future stamp (clock skew) reads just now', () => {
  expect(formatPingAge(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
});

test('under 5s reads just now', () => {
  expect(formatPingAge(iso(0), NOW)).toBe('just now');
  expect(formatPingAge(iso(4_999), NOW)).toBe('just now');
});

test('under a minute reads Ns ago', () => {
  expect(formatPingAge(iso(5_000), NOW)).toBe('5s ago');
  expect(formatPingAge(iso(59_000), NOW)).toBe('59s ago');
});

test('under an hour reads Nm ago', () => {
  expect(formatPingAge(iso(60_000), NOW)).toBe('1m ago');
  expect(formatPingAge(iso(3_599_000), NOW)).toBe('59m ago');
});

test('under a day reads Nh ago', () => {
  expect(formatPingAge(iso(3_600_000), NOW)).toBe('1h ago');
  expect(formatPingAge(iso(86_399_000), NOW)).toBe('23h ago');
});

test('a day or older reads over a day ago', () => {
  expect(formatPingAge(iso(86_400_000), NOW)).toBe('over a day ago');
  expect(formatPingAge(iso(604_800_000), NOW)).toBe('over a day ago');
});
