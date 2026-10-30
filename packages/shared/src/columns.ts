import { z } from 'zod';

// The column types live here (not in apps/server) because the step catalog in
// @dad/shared needs them for ai.extract field configs, and shared cannot
// import from server. The server table store re-exports this union.
export type ColumnType = 'text' | 'number' | 'boolean' | 'date' | 'email' | 'datetime';

export const columnTypeSchema = z.enum(['text', 'number', 'boolean', 'date', 'email', 'datetime']);
