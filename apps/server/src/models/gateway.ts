import type OpenAI from 'openai';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { costUsd } from './pricing.js';

export type ModelRole = 'builder' | 'planner' | 'triage' | 'vision';

export type ModelProvider = 'meta' | 'glimmer';

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

/** One row of GET /api/models/status: where a role runs and whether it is up. */
export interface ModelStatus {
  role: ModelRole;
  provider: ModelProvider;
  model: string;
  healthy: boolean;
  note?: string;
}

/** Shown whenever triage is served by Spark because Glimmer is unavailable. */
export const GLIMMER_DOWN_NOTE = "Glimmer isn't running on this computer";

/** How often the gateway re-checks a configured Glimmer (revives it too). */
export const GLIMMER_RECHECK_MS = 60_000;

const DEFAULT_ROLES: Record<ModelRole, string> = {
  builder: 'muse-spark-1.3',
  planner: 'muse-wonder-1.0',
  triage: 'muse-spark-1.3',
  vision: 'muse-spark-1.3',
};

const ROLE_ORDER: ModelRole[] = ['builder', 'planner', 'triage', 'vision'];

export interface CreateGatewayOptions {
  client: Pick<OpenAI, 'chat'>;
  roles?: Partial<Record<ModelRole, string>>;
}

export interface RoleAssignment {
  provider: ModelProvider;
  model: string;
}

export interface CreateGatewayProvidersOptions {
  providers: { meta: Pick<OpenAI, 'chat'>; glimmer?: Pick<OpenAI, 'chat'> };
  roles?: Partial<Record<ModelRole, RoleAssignment>>;
  /**
   * Enables Glimmer health tracking: an initial check at construction plus a
   * re-check every 60 s (which also revives Glimmer when LM Studio comes
   * back). Without it, glimmer-assigned roles behave as permanently down
   * (straight to the Spark fallback). `fetchFn` is a test seam; production
   * uses global fetch.
   */
  glimmerHealth?: {
    baseUrl: string;
    model: string;
    fetchFn?: typeof fetch;
  };
}

export interface GatewayHealth {
  /** The per-role rows served by GET /api/models/status. */
  status(): ModelStatus[];
  /**
   * Settles once the initial Glimmer check completes: true when triage runs
   * on Glimmer, false when it falls back to Spark (down or unconfigured).
   */
  ready(): Promise<boolean>;
  /** Runs one health check now (what the 60 s interval runs); true = healthy. */
  recheck(): Promise<boolean>;
  /** Stops the re-check interval. Safe to call when there is none. */
  stop(): void;
}

/**
 * Glimmer health probe: GET <baseUrl>/models must list the model (LM Studio
 * answers in OpenAI's { data: [{ id }] } shape). Any failure — network,
 * non-200, unparseable body, model absent, 3 s timeout — is simply false,
 * never a throw, so boot and the re-check interval cannot crash on it.
 */
export async function checkGlimmer(
  baseUrl: string,
  model: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body?.data)) return false;
    return body.data.some((m) => (m as { id?: unknown } | null | undefined)?.id === model);
  } catch {
    return false;
  }
}

/**
 * Shared json_schema completion plumbing for chatJson/visionJson: same strict
 * response_format, same parse/validate/cost behavior, same error strings.
 * Only the message list differs (vision carries an image_url part).
 *
 * `jsonObject` is the Glimmer path: LM Studio may not support `json_schema`,
 * so the call uses `json_object` with the schema inlined into the system
 * prompt instead. Parsing and zod validation are identical either way, and
 * Glimmer calls always report costUsd 0 (local inference, no meter).
 */
async function completeJson<T>(
  client: Pick<OpenAI, 'chat'>,
  model: string,
  messages: AgentMessage[],
  schema: z.ZodType<T>,
  schemaName: string,
  jsonObject: boolean,
): Promise<ChatJsonResult<T>> {
  const jsonSchema = zodToJsonSchema(schema, { target: 'openAi' });
  const completion = await client.chat.completions.create(
    jsonObject
      ? {
          model,
          messages: withSchemaInSystem(messages, schemaName, jsonSchema),
          response_format: { type: 'json_object' },
        }
      : {
          model,
          messages,
          response_format: {
            type: 'json_schema',
            json_schema: { name: schemaName, strict: true, schema: jsonSchema },
          },
        },
  );
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
    costUsd: jsonObject ? 0 : costUsd(model, input, output),
  };
}

/**
 * Appends the JSON schema to the system prompt for json_object calls. When no
 * system message exists (vision), one is prepended; the meta json_schema path
 * never passes through here, so its messages stay byte-identical.
 */
function withSchemaInSystem(
  messages: AgentMessage[],
  schemaName: string,
  jsonSchema: object,
): AgentMessage[] {
  const instruction = `Reply with a single JSON object matching the "${schemaName}" schema:\n${JSON.stringify(jsonSchema)}`;
  let found = false;
  const mapped = messages.map((m) => {
    if (m.role !== 'system' || typeof m.content !== 'string') return m;
    found = true;
    return { ...m, content: `${m.content}\n\n${instruction}` };
  });
  return found ? mapped : [{ role: 'system', content: instruction }, ...mapped];
}

export function createGateway(
  o: CreateGatewayOptions | CreateGatewayProvidersOptions,
): Gateway & GatewayHealth {
  const providers: { meta: Pick<OpenAI, 'chat'>; glimmer?: Pick<OpenAI, 'chat'> } =
    'providers' in o ? o.providers : { meta: o.client };
  // Legacy string roles mean "that model on meta"; the providers shape assigns
  // a provider per role. Either way every role ends up with an assignment.
  const stringRoles = 'providers' in o ? undefined : o.roles;
  const assignedRoles = 'providers' in o ? o.roles : undefined;
  const roles: Record<ModelRole, RoleAssignment> = Object.fromEntries(
    ROLE_ORDER.map((role) => {
      const override =
        assignedRoles?.[role] ??
        (stringRoles?.[role] === undefined
          ? undefined
          : { provider: 'meta' as const, model: stringRoles[role] as string });
      return [role, override ?? { provider: 'meta' as const, model: DEFAULT_ROLES[role] }];
    }),
  ) as Record<ModelRole, RoleAssignment>;
  const meta = providers.meta;

  // Glimmer health: starts down (triage serves from Spark) until a check
  // passes. Only roles assigned to glimmer consult it; only triage ever is.
  const health = 'providers' in o ? o.glimmerHealth : undefined;
  const glimmerClient = providers.glimmer;
  const glimmerTracked = glimmerClient !== undefined && health !== undefined;
  let glimmerHealthy = false;
  const runCheck = async (): Promise<boolean> => {
    if (!glimmerTracked) return false;
    glimmerHealthy = await checkGlimmer(health.baseUrl, health.model, health.fetchFn ?? fetch);
    return glimmerHealthy;
  };
  const readyPromise = runCheck();
  // The 60 s re-check both notices outages and revives Glimmer when LM Studio
  // comes back. Unref'd (voice/proxy.ts idiom) so it never holds the process
  // open; stop() clears it for tests and shutdown.
  let timer: ReturnType<typeof setInterval> | undefined;
  if (glimmerTracked) {
    timer = setInterval(() => {
      void runCheck();
    }, GLIMMER_RECHECK_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  // Where a chatJson call goes: glimmer-assigned roles use the local model
  // while healthy, else the role's meta default on Spark-family json_schema.
  const useGlimmer = (role: ModelRole): boolean =>
    roles[role].provider === 'glimmer' && glimmerTracked && glimmerHealthy;

  const status = (): ModelStatus[] =>
    ROLE_ORDER.map((role) => {
      const assignment = roles[role];
      if (assignment.provider === 'glimmer') {
        return glimmerHealthy
          ? { role, provider: 'glimmer' as const, model: assignment.model, healthy: true }
          : {
              role,
              provider: 'glimmer' as const,
              model: assignment.model,
              healthy: false,
              note: GLIMMER_DOWN_NOTE,
            };
      }
      return {
        role,
        provider: 'meta' as const,
        model: assignment.model,
        healthy: true,
        // Triage on Spark is always the Glimmer fallback (unconfigured or
        // down); other roles live on meta by design and carry no note.
        ...(role === 'triage' ? { note: GLIMMER_DOWN_NOTE } : {}),
      };
    });

  return {
    status,
    ready: () => readyPromise,
    recheck: () => runCheck(),
    stop: () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
    async chatJson<T>(opts: ChatJsonOptions<T>): Promise<ChatJsonResult<T>> {
      if (useGlimmer(opts.role)) {
        try {
          return await completeJson(
            glimmerClient as Pick<OpenAI, 'chat'>,
            roles[opts.role].model,
            [
              { role: 'system', content: opts.system },
              { role: 'user', content: opts.user },
            ],
            opts.schema,
            opts.schemaName,
            true,
          );
        } catch {
          // Any Glimmer failure — socket error, bad JSON, schema mismatch —
          // marks it unhealthy (later calls skip it until a re-check revives
          // it) and this call falls back to Spark immediately.
          glimmerHealthy = false;
        }
      }
      const fallbackModel =
        roles[opts.role].provider === 'glimmer' ? DEFAULT_ROLES[opts.role] : roles[opts.role].model;
      return completeJson(
        meta,
        fallbackModel,
        [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        opts.schema,
        opts.schemaName,
        false,
      );
    },
    async visionJson<T>(opts: VisionJsonOptions<T>): Promise<ChatJsonResult<T>> {
      // Only triage routes to Glimmer; vision always reads on meta.
      return completeJson(
        meta,
        roles[opts.role].provider === 'meta' ? roles[opts.role].model : DEFAULT_ROLES[opts.role],
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
        false,
      );
    },
    async chatTools(opts: ChatToolsOptions): Promise<ChatToolsResult> {
      // Only triage routes to Glimmer, and triage never calls tools.
      const model =
        roles[opts.role].provider === 'meta' ? roles[opts.role].model : DEFAULT_ROLES[opts.role];
      const completion = await meta.chat.completions.create({
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
