import type OpenAI from 'openai';
import { createGateway, type AgentMessage, type ToolSpec } from '../src/models/gateway.js';
import { costUsd } from '../src/models/pricing.js';

const tools: ToolSpec[] = [
  { name: 'add_step', description: 'Add a step', parameters: { type: 'object', properties: {} } },
];

const messages: AgentMessage[] = [{ role: 'user', content: 'do it' }];

function fakeClient(response: unknown) {
  const calls: unknown[] = [];
  const client = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          calls.push(params);
          return response;
        },
      },
    },
  };
  return { client, calls };
}

function toolCallMessage(toolCalls: unknown[]): OpenAI.ChatCompletionMessage {
  return {
    role: 'assistant',
    content: null,
    refusal: null,
    tool_calls: toolCalls as never,
  } as OpenAI.ChatCompletionMessage;
}

test('chatTools sends tools as function specs with tool_choice auto', async () => {
  const { client, calls } = fakeClient({
    choices: [{ message: toolCallMessage([]) }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });
  const gateway = createGateway({ client: client as never });
  await gateway.chatTools({ role: 'builder', messages, tools });
  expect(calls).toHaveLength(1);
  const sent = calls[0] as Record<string, unknown>;
  expect(sent['model']).toBe('muse-spark-1.3');
  expect(sent['messages']).toEqual(messages);
  expect(sent['tool_choice']).toBe('auto');
  expect(sent['tools']).toEqual([
    { type: 'function', function: { name: 'add_step', description: 'Add a step', parameters: { type: 'object', properties: {} } } },
  ]);
});

test('chatTools parses two tool calls', async () => {
  const { client } = fakeClient({
    choices: [
      {
        message: toolCallMessage([
          { id: 'call_1', type: 'function', function: { name: 'add_step', arguments: '{"title":"A"}' } },
          { id: 'call_2', type: 'function', function: { name: 'add_step', arguments: '{"title":"B"}' } },
        ]),
      },
    ],
    usage: { prompt_tokens: 1000, completion_tokens: 2000 },
  });
  const gateway = createGateway({ client: client as never });
  const result = await gateway.chatTools({ role: 'builder', messages, tools });
  expect(result.toolCalls).toEqual([
    { id: 'call_1', name: 'add_step', args: { title: 'A' } },
    { id: 'call_2', name: 'add_step', args: { title: 'B' } },
  ]);
  expect(result.message.role).toBe('assistant');
  expect(result.model).toBe('muse-spark-1.3');
  expect(result.tokens).toEqual({ input: 1000, output: 2000 });
  expect(result.costUsd).toBe(costUsd('muse-spark-1.3', 1000, 2000));
});

test('chatTools yields argsError instead of throwing on bad JSON arguments', async () => {
  const { client } = fakeClient({
    choices: [
      {
        message: toolCallMessage([
          { id: 'call_1', type: 'function', function: { name: 'add_step', arguments: 'not json{' } },
        ]),
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });
  const gateway = createGateway({ client: client as never });
  const result = await gateway.chatTools({ role: 'builder', messages, tools });
  expect(result.toolCalls).toHaveLength(1);
  const call = result.toolCalls[0]!;
  expect(call.id).toBe('call_1');
  expect(call.name).toBe('add_step');
  expect(call.args).toBeUndefined();
  expect(call.argsError).toMatch(/^Arguments weren't valid JSON: /);
});

test('chatTools returns empty array when tool_calls is missing', async () => {
  const { client } = fakeClient({
    choices: [{ message: { role: 'assistant', content: 'hello' } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });
  const gateway = createGateway({ client: client as never });
  const result = await gateway.chatTools({ role: 'builder', messages, tools });
  expect(result.toolCalls).toEqual([]);
  expect(result.message.content).toBe('hello');
});

test('chatTools returns empty array when tool_calls is null', async () => {
  const { client } = fakeClient({
    choices: [{ message: { role: 'assistant', content: null, tool_calls: null } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });
  const gateway = createGateway({ client: client as never });
  const result = await gateway.chatTools({ role: 'builder', messages, tools });
  expect(result.toolCalls).toEqual([]);
});
