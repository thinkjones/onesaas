import jexl from 'jexl';

const jexlInstance = new jexl.Jexl();

const TEMPLATE_PATTERN = /\{\{(.+?)\}\}/g;

async function evalExpr(expr: string, ctx: Record<string, unknown>): Promise<unknown> {
  try {
    return (await jexlInstance.eval(expr, ctx)) as unknown;
  } catch {
    // Unresolvable refs and malformed expressions resolve to undefined so the
    // engine never crashes; M3's checkWorkflow surfaces bad refs to the author.
    return undefined;
  }
}

/** Resolve `{{expr}}` templates in each input value against `ctx` (jexl). A value that is exactly one expression keeps the raw eval result type (objects stay objects; a missing path resolves the value to `undefined`). Mixed text interpolates to a string, with missing/null refs rendered as an empty string. Values without templates pass through unchanged. */
export async function resolveBindings(
  inputs: Record<string, string>,
  ctx: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs)) {
    const matches = [...value.matchAll(TEMPLATE_PATTERN)];
    if (matches.length === 0) {
      out[key] = value;
    } else if (matches.length === 1 && matches[0][0] === value) {
      out[key] = await evalExpr(matches[0][1].trim(), ctx);
    } else {
      let text = value;
      for (const match of matches) {
        const evaluated = await evalExpr(match[1].trim(), ctx);
        text = text.replace(match[0], () => (evaluated == null ? '' : String(evaluated)));
      }
      out[key] = text;
    }
  }
  return out;
}

/** Evaluate a branch condition against `ctx`. Returns false when the expression errors, so a broken condition skips the branch. */
export async function evalCondition(expr: string, ctx: Record<string, unknown>): Promise<boolean> {
  try {
    return Boolean(await jexlInstance.eval(expr, ctx));
  } catch {
    return false;
  }
}
