/**
 * Dad-friendly age for a last-ping stamp, shared by the app's Pairing page
 * and the extension popup so both sides describe freshness identically.
 * Total: nullish reads 'never', garbage reads 'unknown', future skew reads
 * 'just now' — never throws, so UI code can render it blind.
 */
export function formatPingAge(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (iso === null || iso === undefined) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';
  const diffMs = nowMs - then;
  if (diffMs < 5_000) return 'just now';
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return 'over a day ago';
}
