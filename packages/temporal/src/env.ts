function get(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const TEMPORAL_URL = get("TEMPORAL_URL");
export const INFERENCE_TRANSCRIBE_URL = get("INFERENCE_TRANSCRIBE_URL");
export const INFERENCE_SUMMARIZE_URL = get("INFERENCE_SUMMARIZE_URL");
