import { describe, expect, test, vi } from 'vitest';
import { createServer } from '../src/main.js';

const EMAIL = {
  from: 'priya@acme.co',
  fromName: 'Priya',
  subject: 'Weekend catering',
  body: 'Do you cater weekends?',
  threadId: 'thread-1',
};

function setup(triggerType: string, triggerConfig: Record<string, unknown>) {
  const server = createServer({ dbFile: ':memory:' });
  const wf = server.ops.create({ name: 'Chore', description: 'A chore' });
  const res = server.ops.setTrigger(wf.id, { type: triggerType, config: triggerConfig }, { by: 'owner' });
  if (!res.ok) throw new Error(res.error);
  return { server, id: wf.id };
}

function turnOn(server: ReturnType<typeof createServer>, id: string) {
  const res = server.ops.setStatus(id, 'on', { by: 'owner' });
  if (!res.ok) throw new Error(res.error);
}

const post = (server: ReturnType<typeof createServer>, id: string) =>
  server.app.request(`/api/workflows/${id}/run`, { method: 'POST' });

describe('POST /api/workflows/:id/run', () => {
  test('a manual run carries the page the panel read, and rejects a bad one', async () => {
    const { server, id } = setup('trigger.manual', {});
    turnOn(server, id);
    const page = { url: 'https://example.com/job', title: 'Job', text: 'Pastry chef' };
    const send = (body: unknown) =>
      server.app.request(`/api/workflows/${id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await send({ page: { ...page, text: 'x'.repeat(30_001) } })).status).toBe(400);
    expect((await send({ page })).status).toBe(200);
    expect(server.repo.listRuns({ workflowId: id })[0]!.triggerPayload).toEqual({ payload: page });
  });

  test('an unknown automation is a 404', async () => {
    const { server } = setup('trigger.manual', {});
    expect((await post(server, 'nope')).status).toBe(404);
  });

  test('an automation that is not on is refused, with no run', async () => {
    const { server, id } = setup('trigger.manual', {});
    const res = await post(server, id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/turn/i);
    expect(server.repo.listRuns({ workflowId: id })).toEqual([]);
  });

  test('a manual automation runs for real and returns the run and steps', async () => {
    const { server, id } = setup('trigger.manual', {});
    turnOn(server, id);
    const res = await post(server, id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { kind: string; status: string }; steps: unknown[] };
    expect(body.run.kind).toBe('live');
    expect(body.run.status).toBe('done');
    expect(body.steps.length).toBeGreaterThan(0);
  });

  test('a Gmail button automation runs on the email open in Gmail', async () => {
    const { server, id } = setup('trigger.gmailButton', { label: 'Go' });
    turnOn(server, id);
    const call = vi.spyOn(server.bridge, 'call').mockResolvedValue(EMAIL);
    const res = await post(server, id);
    expect(res.status).toBe(200);
    expect(call.mock.calls[0]?.slice(0, 2)).toEqual(['gmail', 'readOpenEmail']);
    const run = server.repo.listRuns({ workflowId: id })[0]!;
    expect(run.triggerPayload).toEqual({ email: EMAIL });
  });

  test('a new-email automation gets the snippet shape its trigger requires', async () => {
    const { server, id } = setup('trigger.email', { onlyCustomerEmails: true });
    turnOn(server, id);
    vi.spyOn(server.bridge, 'call').mockResolvedValue(EMAIL);
    const body = (await (await post(server, id)).json()) as { run: { status: string } };
    expect(body.run.status).toBe('done');
    const run = server.repo.listRuns({ workflowId: id })[0]!;
    expect(run.triggerPayload).toEqual({
      email: {
        threadId: 'thread-1',
        from: 'priya@acme.co',
        fromName: 'Priya',
        subject: 'Weekend catering',
        snippet: 'Do you cater weekends?',
      },
    });
  });

  test('with no email open it asks for one and starts no run', async () => {
    const { server, id } = setup('trigger.gmailButton', { label: 'Go' });
    turnOn(server, id);
    vi.spyOn(server.bridge, 'call').mockRejectedValue(new Error('NOT_OPEN'));
    const res = await post(server, id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/open an email/i);
    expect(server.repo.listRuns({ workflowId: id })).toEqual([]);
  });

  test('a malformed email from the bridge also starts no run', async () => {
    const { server, id } = setup('trigger.gmailButton', { label: 'Go' });
    turnOn(server, id);
    vi.spyOn(server.bridge, 'call').mockResolvedValue({ subject: 'only' });
    expect((await post(server, id)).status).toBe(409);
    expect(server.repo.listRuns({ workflowId: id })).toEqual([]);
  });

  test('a photo automation points at the upload route', async () => {
    const { server, id } = setup('trigger.upload', {});
    turnOn(server, id);
    const res = await post(server, id);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/photo/i);
  });
});
