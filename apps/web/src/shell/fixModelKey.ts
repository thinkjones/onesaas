/** Settings, opened on the AI model endpoint with a note about the key. */
export const FIX_MODEL_KEY_PATH = '/settings?fix=model';

/** What a key that doesn't work means, in the owner's words. Settings and setup share it. */
export const KEY_PROBLEM = {
  missing: "I don't have an API key yet, so I can't think. Paste one to get started.",
  rejected: "The AI model turned down your API key. Paste a working one and I'll try again.",
} as const;
