function get(name: string, fallback?: string): string {
  const value = process.env[name];
  if (fallback !== undefined && !value) return fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getThinkingBudget(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const budget = Number(value);
  if (!Number.isInteger(budget) || budget < -1) {
    throw new Error(`${name} must be -1, 0, or a positive integer`);
  }
  return budget;
}

export const TEMPORAL_URL = get("TEMPORAL_URL");
export const INFERENCE_URL = get("INFERENCE_URL");
export const DISCORD_TOKEN = get("DISCORD_TOKEN");
export const WEB_URL = get("WEB_URL");
export const TRANSCRIPTION_MODEL = get("TRANSCRIPTION_MODEL", "whisper-large-v3-turbo");
export const SUMMARIZATION_MODEL = get("SUMMARIZATION_MODEL", "qwen3.6-35b-a3b");
export const SUMMARIZATION_THINKING_BUDGET = getThinkingBudget(
  "SUMMARIZATION_THINKING_BUDGET",
  8192,
);
