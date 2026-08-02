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
export const S3_BUCKET_ARTIFACT = get("S3_BUCKET_ARTIFACT");
export const S3_BUCKET_AUDIO = get("S3_BUCKET_AUDIO");
export const S3_REGION = get("S3_REGION");
export const TRANSCRIPTION_MODEL = get("TRANSCRIPTION_MODEL", "whisper-large-v3-turbo");
export const SUMMARIZATION_CONFIG = loadSummarizationConfig(process.env);
