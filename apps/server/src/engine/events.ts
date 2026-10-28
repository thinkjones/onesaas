import type { Run, StepRun } from '@dad/shared';

export type EngineEvent = { type: 'run'; run: Run } | { type: 'step'; stepRun: StepRun };
