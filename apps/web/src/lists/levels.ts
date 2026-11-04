/** Columns that hold a level, which get filter chips and coloured pills. */
export function isLevelColumn(name: string): boolean {
  return /urgency|priority/i.test(name);
}
