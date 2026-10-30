import type { Run, StepRun } from '@dad/shared';

export type EngineEvent =
  | { type: 'run'; run: Run }
  | { type: 'step'; stepRun: StepRun }
  | { type: 'notify'; text: string }
  // M5 Task 4: a background mood-image run finished (POST /api/mood/generate).
  | { type: 'mood'; fileIds: string[] };
