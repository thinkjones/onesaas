import type OpenAI from 'openai';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { costUsd } from './pricing.js';

export type ModelRole = 'builder' | 'planner' | 'triage' | 'vision';

export interface ChatJsonResult<T> {
  data: T;
  model: string;
  tokens: { input: number; output: number };
  costUsd: number;
}

export interface ChatJsonOptions<T> {
  role: ModelRole;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
}

export type AgentMessage = OpenAI.ChatCompletionMessageParam;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: object;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  args: unknown;
  argsError?: string;
}

export interface ChatToolsOptions {
  role: ModelRole;
  messages: AgentMessage[];
  tools: ToolSpec[];
}

export interface ChatToolsResult {
  message: OpenAI.ChatCompletionMessage;
  toolCalls: ParsedToolCall[];
  model: string;
  tokens: { input: number; output: number };
  costUsd: number;
}

export interface VisionJsonOptions<T> {
  role: 'vision';
  prompt: string;
  imageDataUrl: string;
  schema: z.ZodType<T>;
  schemaName: string;
}

export interface Gateway {
  chatJson<T>(o: ChatJsonOptions<T>): Promise<ChatJsonResult<T>>;
  visionJson<T>(o: VisionJsonOptions<T>): Promise<ChatJsonResult<T>>;
  chatTools(o: ChatToolsOptions): Promise<ChatToolsResult>;
}

const DEFAULT_ROLES: Record<ModelRole, string> = {
  builder: 'muse-spark-1.3',
  planner: 'muse-wonder-1.0',
  triage: 'muse-spark-1.3',
  vision: 'muse-spark-1.3',
};

export interface CreateGatewayOptions {
  client: Pick<OpenAI, 'chat'>;
  roles?: Partial<Record<ModelRole, string>>;
}

/**
 * Shared json_schema completion plumbing for chatJson/visionJson: same strict
 * response_format, same parse/validate/cost behavior, same error strings.
 * Only the message list differs (vision carries an image_url part).
 */
async function completeJson<T>(
  client: Pick<OpenAI, 'chat'>,
  model: string,
  messages: AgentMessage[],
  schema: z.ZodType<T>,
  schemaName: string,
): Promise<ChatJsonResult<T>> {
  const jsonSchema = zodToJsonSchema(schema, { target: 'openAi' });
  const completion = await client.chat.completions.create({
    model,
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema: jsonSchema },
    },
  });
  const content = completion.choices[0]?.message.content;
  if (content === null || content === undefined || content === '') {
    throw new Error(`Model output did not match schema: empty response content (model ${model})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `Model output did not match schema: invalid JSON (model ${model}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Model output did not match schema: ${validated.error.message}`);
  }
  const input = completion.usage?.prompt_tokens ?? 0;
  const output = completion.usage?.completion_tokens ?? 0;
  return {
    data: validated.data,
    model,
    tokens: { input, output },
    costUsd: costUsd(model, input, output),
  };
}

export function createGateway(o: CreateGatewayOptions): Gateway {
  const roles: Record<ModelRole, string> = { ...DEFAULT_ROLES, ...o.roles };
  const client = o.client;
  return {
    async chatJson<T>(opts: ChatJsonOptions<T>): Promise<ChatJsonResult<T>> {
      return completeJson(
        client,
        roles[opts.role],
        [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        opts.schema,
        opts.schemaName,
      );
    },
    async visionJson<T>(opts: VisionJsonOptions<T>): Promise<ChatJsonResult<T>> {
      return completeJson(
        client,
        roles[opts.role],
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: opts.prompt },
              { type: 'image_url', image_url: { url: opts.imageDataUrl } },
            ],
          },
        ],
        opts.schema,
        opts.schemaName,
      );
    },
    async chatTools(opts: ChatToolsOptions): Promise<ChatToolsResult> {
      const model = roles[opts.role];
      const completion = await client.chat.completions.create({
        model,
        messages: opts.messages,
        tools: opts.tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters as Record<string, unknown>,
          },
        })),
        tool_choice: 'auto' as const,
      });
      const message = completion.choices[0]?.message as OpenAI.ChatCompletionMessage | undefined;
      if (!message) {
        throw new Error(`Model returned no message (model ${model})`);
      }
      const toolCalls: ParsedToolCall[] = [];
      for (const tc of message.tool_calls ?? []) {
        if (tc.type !== 'function') continue;
        let args: unknown;
        let argsError: string | undefined;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch (err) {
          args = undefined;
          argsError = `Arguments weren't valid JSON: ${err instanceof Error ? err.message : String(err)}`;
        }
        toolCalls.push({ id: tc.id, name: tc.function.name, args, ...(argsError ? { argsError } : {}) });
      }
      const input = completion.usage?.prompt_tokens ?? 0;
      const output = completion.usage?.completion_tokens ?? 0;
      return {
        message,
        toolCalls,
        model,
        tokens: { input, output },
        costUsd: costUsd(model, input, output),
      };
    },
  };
}
