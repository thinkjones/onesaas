import { catalog, type StepDef, type StepInstance, type Workflow } from '@dad/shared';
import { useState, type ReactNode } from 'react';
import AppButton from './AppButton.tsx';

export interface ConfigSave {
  config: Record<string, unknown>;
  inputs: Record<string, string>;
}

export interface ConfigFormProps {
  step: StepInstance;
  workflow: Workflow;
  onSave(patch: ConfigSave): void;
  saving?: boolean;
  /**
   * Step definition to render. Defaults to catalog[step.type]; tests inject
   * stand-ins for shapes no catalog config uses yet (number, boolean).
   * The parent must key this component by step.id (form state initializes
   * once from the step).
   */
  def?: StepDef;
}

// --- Zod introspection (duck-typed `_def` reads, no new dependency) ---
//
// The catalog's config/input/output schemas are zod schemas living in
// @dad/shared, which the web already imports. zod-to-json-schema is a
// SERVER-only dependency, and a schema-serving API route would be heavier
// than the problem warrants — so the form reads the shapes it needs straight
// off the zod objects. Only `_def.typeName`, `.shape`, `.options`, and the
// inner-type/default slots are touched; everything unrecognized degrades to
// `unsupported` (skipped in configs, whole-output binding in outputs) rather
// than crashing on a future catalog shape.

type ZodLike = {
  _def?: { typeName?: string; [slot: string]: unknown };
  [key: string]: unknown;
};

type FieldDesc =
  | { kind: 'string'; multiline: boolean; defaultValue: unknown }
  | { kind: 'number'; defaultValue: unknown }
  | { kind: 'boolean'; defaultValue: unknown }
  | { kind: 'enum'; options: string[]; defaultValue: unknown }
  | { kind: 'array'; item: Record<string, FieldDesc> }
  | { kind: 'unsupported' };

function typeNameOf(schema: unknown): string | undefined {
  return (schema as ZodLike | null | undefined)?._def?.typeName;
}

/** Strips ZodDefault/ZodOptional wrappers, capturing the outermost default. */
function unwrap(schema: unknown): { inner: unknown; defaultValue: unknown } {
  let current = schema;
  let defaultValue: unknown;
  for (;;) {
    const t = typeNameOf(current);
    if (t === 'ZodDefault') {
      const def = (current as ZodLike)._def!;
      if (defaultValue === undefined) {
        const get = def['defaultValue'];
        try {
          defaultValue = typeof get === 'function' ? (get as () => unknown)() : undefined;
        } catch {
          defaultValue = undefined;
        }
      }
      current = def['innerType'];
    } else if (t === 'ZodOptional') {
      current = (current as ZodLike)._def!['innerType'];
    } else {
      return { inner: current, defaultValue };
    }
  }
}

function objectShape(schema: unknown): Record<string, unknown> | undefined {
  if (typeNameOf(schema) !== 'ZodObject') return undefined;
  const shape = (schema as { shape?: unknown }).shape;
  return typeof shape === 'object' && shape !== null
    ? (shape as Record<string, unknown>)
    : undefined;
}

// Long-form text fields render as textareas, single-line strings as inputs.
const MULTILINE_FIELDS = new Set(['instructions', 'body', 'question']);

function describeField(name: string, schema: unknown): FieldDesc {
  const { inner, defaultValue } = unwrap(schema);
  switch (typeNameOf(inner)) {
    case 'ZodString':
      return { kind: 'string', multiline: MULTILINE_FIELDS.has(name), defaultValue };
    case 'ZodNumber':
      return { kind: 'number', defaultValue };
    case 'ZodBoolean':
      return { kind: 'boolean', defaultValue };
    case 'ZodEnum': {
      const raw =
        (inner as { options?: unknown }).options ?? (inner as ZodLike)._def?.['values'];
      const options = Array.isArray(raw) ? raw.filter((o): o is string => typeof o === 'string') : [];
      return { kind: 'enum', options, defaultValue };
    }
    case 'ZodArray': {
      // Config arrays are arrays of row objects (ai.extract fields); anything
      // else (arrays of scalars, nested arrays) is out of the form's depth.
      const shape = objectShape((inner as ZodLike)._def?.['type']);
      if (!shape) return { kind: 'unsupported' };
      const item: Record<string, FieldDesc> = {};
      for (const [key, value] of Object.entries(shape)) item[key] = describeField(key, value);
      return { kind: 'array', item };
    }
    default:
      return { kind: 'unsupported' };
  }
}

/**
 * Enumerable `{{stepId.path}}` bindings for one output schema: top-level
 * keys, plus one level of nesting for object-typed fields (so the trigger's
 * email surfaces as email, email.from, email.subject, …). Records, unknowns
 * and scalars enumerate nothing — the caller offers the bare {{stepId}}
 * whole-output binding for those instead.
 */
function outputPaths(schema: unknown): string[] {
  const shape = objectShape(unwrap(schema).inner);
  if (!shape) return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    paths.push(key);
    const sub = objectShape(unwrap(value).inner);
    if (sub) {
      for (const subKey of Object.keys(sub)) paths.push(`${key}.${subKey}`);
    }
  }
  return paths;
}

/**
 * Upstream steps in workflow order (trigger first). Mirrors the server's
 * upstreamIds — the web cannot import server code, so the BFS is restated.
 */
function upstreamSteps(workflow: Workflow, stepId: string): StepInstance[] {
  const incoming = new Map<string, string[]>();
  for (const e of workflow.edges) {
    const list = incoming.get(e.to);
    if (list) list.push(e.from);
    else incoming.set(e.to, [e.from]);
  }
  const seen = new Set<string>();
  const queue = [...(incoming.get(stepId) ?? [])];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    queue.push(...(incoming.get(cur) ?? []));
  }
  return [workflow.trigger, ...workflow.steps].filter((s) => seen.has(s.id));
}

function labelize(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** `email.subject` → `email subject` for picker labels (values keep the dots). */
function humanPath(path: string): string {
  return path
    .split('.')
    .map((seg) => seg.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase())
    .join(' ');
}

function singular(name: string): string {
  return name.endsWith('s') && name.length > 1 ? name.slice(0, -1) : name;
}

function defaultFor(desc: FieldDesc): unknown {
  switch (desc.kind) {
    case 'string':
      return typeof desc.defaultValue === 'string' ? desc.defaultValue : '';
    case 'number':
      return typeof desc.defaultValue === 'number' ? desc.defaultValue : 0;
    case 'boolean':
      return typeof desc.defaultValue === 'boolean' ? desc.defaultValue : false;
    case 'enum':
      return typeof desc.defaultValue === 'string' ? desc.defaultValue : (desc.options[0] ?? '');
    case 'array':
      return [];
    case 'unsupported':
      return undefined;
  }
}

function defaultRow(item: Record<string, FieldDesc>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, desc] of Object.entries(item)) {
    if (desc.kind !== 'unsupported' && desc.kind !== 'array') row[key] = defaultFor(desc);
  }
  return row;
}

type Row = Record<string, unknown>;

function asRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.map((r) => (typeof r === 'object' && r !== null ? { ...(r as Row) } : {}));
}

const inputClass =
  'min-h-10 w-full rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-base text-foreground';

/**
 * The settings form for one step: its `configSchema` fields (string,
 * multiline string, enum, number, boolean, array-of-objects tables) plus an
 * "Inputs" section where each binding is free text with a picker of upstream
 * step outputs. Saving hands the whole new config + inputs to onSave (the
 * parent sends `updateStep`); unknown step types still save inputs as
 * free text so nothing Dad typed is ever stranded.
 */
export default function ConfigForm({ step, workflow, onSave, saving, def }: ConfigFormProps) {
  const resolved = def ?? catalog[step.type];
  const shape = resolved ? objectShape(resolved.configSchema) : undefined;
  const descs: [string, FieldDesc][] = shape
    ? Object.entries(shape).map(([name, schema]) => [name, describeField(name, schema)])
    : [];

  const [config, setConfig] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = { ...step.config };
    for (const [name, desc] of descs) {
      if (desc.kind === 'unsupported') continue;
      if (desc.kind === 'array') initial[name] = asRows(initial[name]);
      else if (initial[name] === undefined) initial[name] = defaultFor(desc);
    }
    return initial;
  });
  const [inputs, setInputs] = useState<Record<string, string>>(() => ({ ...step.inputs }));

  const inputShape = resolved ? objectShape(resolved.inputSchema) : undefined;
  const inputKeys = [...(inputShape ? Object.keys(inputShape) : []), ...Object.keys(inputs)];
  const inputNames = [...new Set(inputKeys)];

  const upstreams = upstreamSteps(workflow, step.id);
  const outputOptions: { value: string; label: string }[] = [];
  for (const up of upstreams) {
    const upDef = catalog[up.type];
    const paths = upDef ? outputPaths(upDef.outputSchema) : [];
    if (paths.length === 0) {
      outputOptions.push({ value: `{{${up.id}}}`, label: `${up.title} → whole result` });
    } else {
      for (const p of paths) {
        outputOptions.push({ value: `{{${up.id}.${p}}}`, label: `${up.title} → ${humanPath(p)}` });
      }
    }
  }

  const setScalar = (name: string, value: unknown): void =>
    setConfig((prev) => ({ ...prev, [name]: value }));

  const setCell = (name: string, index: number, key: string, value: unknown): void =>
    setConfig((prev) => ({
      ...prev,
      [name]: asRows(prev[name]).map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));

  const addRow = (name: string, item: Record<string, FieldDesc>): void =>
    setConfig((prev) => ({ ...prev, [name]: [...asRows(prev[name]), defaultRow(item)] }));

  const removeRow = (name: string, index: number): void =>
    setConfig((prev) => ({ ...prev, [name]: asRows(prev[name]).filter((_, i) => i !== index) }));

  const renderScalarCell = (
    name: string,
    sub: string,
    desc: Exclude<FieldDesc, { kind: 'array' } | { kind: 'unsupported' }>,
    index: number,
    value: unknown,
  ): ReactNode => {
    const label = `${labelize(sub)} for ${singular(name)} ${index + 1}`;
    const onChange = (v: unknown): void => setCell(name, index, sub, v);
    if (desc.kind === 'enum') {
      return (
        <select
          aria-label={label}
          className={inputClass}
          value={typeof value === 'string' ? value : (desc.options[0] ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          {desc.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    if (desc.kind === 'boolean') {
      return (
        <input
          aria-label={label}
          type="checkbox"
          className="size-5"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    }
    if (desc.kind === 'number') {
      return (
        <input
          aria-label={label}
          type="number"
          className={inputClass}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
      );
    }
    return (
      <input
        aria-label={label}
        type="text"
        className={inputClass}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  };

  return (
    <form
      aria-label={`Settings for ${step.title}`}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ config, inputs });
      }}
    >
      <h2 className="text-xl font-semibold">Settings for {step.title}</h2>

      {resolved === undefined && (
        <p className="text-base text-muted-foreground">
          I don&apos;t know how to set up this step yet — its settings stay as they are.
        </p>
      )}

      {descs.map(([name, desc]) => {
        if (desc.kind === 'unsupported' || desc.kind === 'array') return null;
        const id = `${step.id}-config-${name}`;
        const value = config[name];
        // code.transform's code is agent-written and Dad never edits it: show
        // it read-only in a monospace block under its explanation. The value
        // still round-trips through `config` untouched on save.
        if (step.type === 'code.transform' && name === 'code') {
          return (
            <div key={name} className="flex flex-col gap-1.5">
              <p className="text-base font-medium">{labelize(name)}</p>
              <pre className="overflow-x-auto rounded-[var(--radius)] border border-border bg-muted p-3 font-mono text-sm break-words whitespace-pre-wrap">
                {typeof value === 'string' ? value : ''}
              </pre>
            </div>
          );
        }
        return (
          <div key={name} className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-base font-medium">
              {labelize(name)}
            </label>
            {desc.kind === 'enum' ? (
              <select
                id={id}
                className={inputClass}
                value={typeof value === 'string' ? value : (desc.options[0] ?? '')}
                onChange={(e) => setScalar(name, e.target.value)}
              >
                {desc.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : desc.kind === 'boolean' ? (
              <input
                id={id}
                type="checkbox"
                className="size-5"
                checked={value === true}
                onChange={(e) => setScalar(name, e.target.checked)}
              />
            ) : desc.kind === 'number' ? (
              <input
                id={id}
                type="number"
                className={inputClass}
                value={typeof value === 'number' ? value : ''}
                onChange={(e) => setScalar(name, e.target.value === '' ? 0 : Number(e.target.value))}
              />
            ) : desc.multiline ? (
              <textarea
                id={id}
                className={`${inputClass} min-h-24`}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => setScalar(name, e.target.value)}
              />
            ) : (
              <input
                id={id}
                type="text"
                className={inputClass}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => setScalar(name, e.target.value)}
              />
            )}
          </div>
        );
      })}

      {descs.map(([name, desc]) => {
        if (desc.kind !== 'array') return null;
        const rows = asRows(config[name]);
        const subs = Object.entries(desc.item).filter(
          (entry): entry is [string, Exclude<FieldDesc, { kind: 'array' } | { kind: 'unsupported' }>] =>
            entry[1].kind !== 'unsupported' && entry[1].kind !== 'array',
        );
        return (
          <div key={name} className="flex flex-col gap-2">
            <h3 className="text-base font-medium">{labelize(name)}</h3>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {subs.map(([sub]) => (
                    <th
                      key={sub}
                      scope="col"
                      className="px-2 py-1 text-left text-sm font-medium text-muted-foreground"
                    >
                      {labelize(sub)}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {subs.map(([sub, subDesc]) => (
                      <td key={sub} className="px-1 py-1">
                        {renderScalarCell(name, sub, subDesc, i, row[sub])}
                      </td>
                    ))}
                    <td className="px-1 py-1">
                      <AppButton
                        type="button"
                        variant="ghost"
                        aria-label={`Remove ${singular(name)} ${i + 1}`}
                        onClick={() => removeRow(name, i)}
                      >
                        Remove
                      </AppButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <AppButton type="button" variant="outline" onClick={() => addRow(name, desc.item)}>
              Add a {singular(name)}
            </AppButton>
          </div>
        );
      })}

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-medium">Inputs</h3>
        {inputNames.map((key) => {
          const id = `${step.id}-input-${key}`;
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-base font-medium">
                {labelize(key)}
              </label>
              <input
                id={id}
                type="text"
                className={inputClass}
                value={inputs[key] ?? ''}
                onChange={(e) => setInputs((prev) => ({ ...prev, [key]: e.target.value }))}
              />
              {upstreams.length > 0 && (
                <select
                  aria-label={`Pick an output for ${labelize(key)}`}
                  className={inputClass}
                  value=""
                  onChange={(e) => {
                    if (e.target.value !== '') {
                      setInputs((prev) => ({ ...prev, [key]: e.target.value }));
                    }
                  }}
                >
                  <option value="">Pick an earlier step&apos;s output…</option>
                  {outputOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
        {upstreams.length === 0 && (
          <p className="text-base text-muted-foreground">
            Connect this step after another step to pick its outputs.
          </p>
        )}
      </div>

      <AppButton type="submit" disabled={saving === true}>
        {saving === true ? 'Saving…' : 'Save'}
      </AppButton>
    </form>
  );
}
