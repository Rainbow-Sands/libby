function get(name: string, fallback?: string): string {
  const value = process.env[name];
  if (fallback !== undefined && !value) return fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

import { loadSummarizationConfig } from "./summarization-inference.ts";

export const TRANSCRIPTION_URL = get("TRANSCRIPTION_URL");
export const DISCORD_TOKEN = get("DISCORD_TOKEN");
export const WEB_URL = get("WEB_URL");
export const AUDIO_S3_REGION = get("AUDIO_S3_REGION");
export const AUDIO_S3_BUCKET = get("AUDIO_S3_BUCKET");
export const TRANSCRIPTION_MODEL = get("TRANSCRIPTION_MODEL", "whisper-large-v3-turbo");
export const SUMMARIZATION_CONFIG = loadSummarizationConfig(process.env);
