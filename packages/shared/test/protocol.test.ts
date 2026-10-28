import { ExtensionToServer, ServerToExtension } from '../src/index.js';

test('protocol rejects a result message without ok', () => {
  expect(() => ExtensionToServer.parse({ type: 'result', id: 'r1', output: {} })).toThrow();
});

test('protocol rejects a result ok:false without error', () => {
  expect(() => ExtensionToServer.parse({ type: 'result', id: 'r1', ok: false })).toThrow();
});

test('protocol rejects a cmd with a bad site', () => {
  expect(() => ServerToExtension.parse({ type: 'cmd', id: 'c1', site: 'outlook', action: 'read', input: {} })).toThrow();
});

test('protocol rejects a garbage type in both unions', () => {
  expect(() => ExtensionToServer.parse({ type: 'explode' })).toThrow();
  expect(() => ServerToExtension.parse({ type: 'explode' })).toThrow();
});

test('protocol strips unknown extra keys instead of rejecting', () => {
  const msg = ExtensionToServer.parse({ type: 'ping', extra: 1 });
  expect(msg).toEqual({ type: 'ping' });
  expect('extra' in msg).toBe(false);
});
