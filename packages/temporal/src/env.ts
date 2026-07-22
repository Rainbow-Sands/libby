function get(name: string, fallback?: string): string {
  const value = process.env[name];
  if (fallback !== undefined && !value) return fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const TEMPORAL_URL = get("TEMPORAL_URL");
export const INFERENCE_URL = get("INFERENCE_URL");
export const TRANSCRIPTION_MODEL = get("TRANSCRIPTION_MODEL", "whisper-large-v3-turbo");
export const SUMMARIZATION_MODEL = get("SUMMARIZATION_MODEL", "qwen3.6-35b-a3b");
