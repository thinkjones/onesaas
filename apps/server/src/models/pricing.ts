// USD per million tokens: [input, output].
const PRICES_PER_MILLION: Record<string, [number, number]> = {
  'muse-spark-1.3': [1.25, 4.25],
  'muse-wonder-1.0': [4.0, 20.0],
};

// USD per call for the image endpoints (no per-token price published).
const PRICES_PER_CALL: Record<string, number> = {
  'sam-3.1': 0.0025,
  'muse-image-1.0': 0.01,
};

/**
 * Cost of a chat completion in USD. Models without a listed price
 * (image, SAM, transcription, unknown chat models) return 0: they are
 * either billed per-call through other endpoints or have no published
 * per-token price, so the gateway treats their token cost as unknown.
 */
export function costUsd(model: string, input: number, output: number): number {
  const price = PRICES_PER_MILLION[model];
  if (!price) return 0;
  const [inputPerM, outputPerM] = price;
  return (input * inputPerM) / 1_000_000 + (output * outputPerM) / 1_000_000;
}

/**
 * Cost of one image-endpoint call in USD (SAM, Muse Image). Unknown models
 * return 0, matching costUsd's treatment of unlisted prices.
 */
export function callCostUsd(model: string): number {
  return PRICES_PER_CALL[model] ?? 0;
}
