// Condition helpers for workflow wires (split out of FlowEdge.tsx: the
// react/only-export-components lint only allows components in component
// files). The picker writes exactly one shape —
// `<stepId>.choice == '<option>'` — and the pill reads it back.

// Step ids are slugs (`slug-nanoid`), so `[\w-]` covers them.
const CHOICE_PATTERN = /^([\w-]+)\.choice == '([^']*)'$/;

/**
 * Pill text for a `when`: sort conditions read as "Only if: <option>",
 * anything else shows raw (future condition shapes stay honest).
 */
export function conditionLabel(when: string): string {
  const match = CHOICE_PATTERN.exec(when.trim());
  return match ? `Only if: ${match[2]}` : when;
}

/** The `when` for picking `option` on sort step `stepId`. */
export function choiceWhen(stepId: string, option: string): string {
  return `${stepId}.choice == '${option}'`;
}
