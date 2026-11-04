import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// The side panel ties its colors to the main app (Craft tokens): panel.css
// carries the §2 subset in both schemes, and App references tokens instead
// of hardcoded colors. jsdom can't assert computed styles, so these tests
// pin the wiring at the source level (plain file reads — no bundler).

const here = dirname(fileURLToPath(import.meta.url));
const panelCss = readFileSync(join(here, '../entrypoints/sidepanel/panel.css'), 'utf8');
const appSource = readFileSync(join(here, '../entrypoints/sidepanel/App.tsx'), 'utf8');
const controlSource = readFileSync(join(here, '../entrypoints/sidepanel/ControlPlane.tsx'), 'utf8');

// Every token App.tsx may reference — each must exist in panel.css.
const TOKENS = [
  '--font-ui',
  '--bg-sidebar',
  '--bg-raised',
  '--bg-input',
  '--border',
  '--border-strong',
  '--text',
  '--text-dim',
  '--accent',
  '--on-accent',
  '--danger',
  '--radius',
  '--radius-s',
];

describe('sidepanel theme', () => {
  test('panel.css defines every token the panel uses, in both schemes', () => {
    for (const token of TOKENS) {
      expect(panelCss).toContain(`${token}:`);
    }
    expect(panelCss).toContain('prefers-color-scheme: dark');
  });

  test('App references tokens, never hardcoded colors', () => {
    expect(appSource).toContain('var(--');
    expect(appSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(controlSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
