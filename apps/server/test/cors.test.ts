import { createApp } from '../src/app.js';

// The Tauri desktop shell (Bug #6) calls the API cross-origin (window at
// localhost:5173 / tauri.localhost -> 127.0.0.1:8787), so the loopback
// server must answer CORS for our own origins — and refuse anyone else's.
test('GET echoes ACAO for the Tauri + localhost dev origins', async () => {
  for (const origin of ['https://tauri.localhost', 'http://localhost:5173', 'http://127.0.0.1:5174']) {
    const res = await createApp({}).request('/health', { headers: { Origin: origin } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
  }
});

test('GET sends no ACAO for foreign origins', async () => {
  const res = await createApp({}).request('/health', { headers: { Origin: 'https://evil.com' } });
  expect(res.status).toBe(200);
  expect(res.headers.get('access-control-allow-origin')).toBeNull();
});

test('extension origins pass CORS (the popup POSTs revoke/focus cross-origin)', async () => {
  for (const origin of [
    'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef',
    'moz-extension://12345678-1234-1234-1234-123456789012',
  ]) {
    const res = await createApp({}).request('/health', { headers: { Origin: origin } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
  }
});

test('preflight approves JSON POSTs from our origins', async () => {
  const res = await createApp({}).request('/api/workflows', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://tauri.localhost',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  expect(res.status).toBe(204);
  expect(res.headers.get('access-control-allow-origin')).toBe('https://tauri.localhost');
  expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/);
});
