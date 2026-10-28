import { createApp } from '../src/app.js';

test('GET /health returns ok', async () => {
  const res = await createApp({}).request('/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
