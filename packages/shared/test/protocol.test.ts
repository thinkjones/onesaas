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

test('hello carries optional client identity (old hellos still parse)', () => {
  expect(ExtensionToServer.parse({ type: 'hello', token: 't' })).toEqual({
    type: 'hello',
    token: 't',
  });
  expect(
    ExtensionToServer.parse({
      type: 'hello',
      token: 't',
      client: { profileEmail: 'dad@example.com' },
    }),
  ).toEqual({ type: 'hello', token: 't', client: { profileEmail: 'dad@example.com' } });
});

test('server ping carries an id; the pong reply echoes it', () => {
  expect(ServerToExtension.parse({ type: 'ping', id: 'p1' })).toEqual({ type: 'ping', id: 'p1' });
  expect(ExtensionToServer.parse({ type: 'pong', id: 'p1' })).toEqual({ type: 'pong', id: 'p1' });
  // The bare keep-alive pair is unchanged.
  expect(ServerToExtension.parse({ type: 'pong' })).toEqual({ type: 'pong' });
  expect(ExtensionToServer.parse({ type: 'ping' })).toEqual({ type: 'ping' });
});
