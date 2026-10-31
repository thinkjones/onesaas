// CLI wrapper for `pnpm demo:reset`. The importable implementation lives in
// apps/server/src/demoReset.ts (format, safety and design documented there),
// including runDemoResetCli — the argv parser + exit-code mapper exercised by
// apps/server/test/demo-reset.test.ts. This file only forwards process.argv
// and exits. Importing this module never exits.
import {
  demoReset,
  runDemoResetCli,
  saveDemoProfile,
  type DemoProfile,
  type DemoResetOptions,
} from '../apps/server/src/demoReset.js';

export { demoReset, runDemoResetCli, saveDemoProfile };
export type { DemoProfile, DemoResetOptions };

// No top-level await: the root package is CJS, so tsx compiles this as CJS
// (same convention as scripts/run-flow1.ts). Importing this module never
// exits; only direct execution runs the CLI.
const invokedAs = process.argv[1] ?? '';
if (invokedAs.endsWith('demo-reset.ts') || invokedAs.endsWith('demo-reset.js')) {
  void runDemoResetCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
