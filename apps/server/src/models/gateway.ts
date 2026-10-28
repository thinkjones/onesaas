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

export interface Gateway {
  chatJson<T>(o: ChatJsonOptions<T>): Promise<ChatJsonResult<T>>;
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

export function createGateway(o: CreateGatewayOptions): Gateway {
  const roles: Record<ModelRole, string> = { ...DEFAULT_ROLES, ...o.roles };
  const client = o.client;
  return {
    async chatJson<T>(opts: ChatJsonOptions<T>): Promise<ChatJsonResult<T>> {
      const model = roles[opts.role];
      const jsonSchema = zodToJsonSchema(opts.schema, { target: 'openAi' });
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: opts.schemaName, strict: true, schema: jsonSchema },
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
      const validated = opts.schema.safeParse(parsed);
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
    },
  };
}
