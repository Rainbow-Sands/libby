import { building } from "$app/environment";
import { env } from "$env/dynamic/private";
import { loadChatInferenceConfig } from "$lib/server/chat-inference";

function get(name: string, fallback?: string): string {
  const value = env[name];
  if (fallback !== undefined && !value) return fallback;
  if (!value && !building) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value as string;
}

export const DISCORD_APPLICATION_ID = get("DISCORD_APPLICATION_ID");
export const DISCORD_CLIENT_SECRET = get("DISCORD_CLIENT_SECRET");
export const SESSION_SECRET = get("SESSION_SECRET");
export const S3_BUCKET_ARTIFACT = get("S3_BUCKET_ARTIFACT");
export const S3_BUCKET_AUDIO = get("S3_BUCKET_AUDIO");
export const S3_REGION = get("S3_REGION");
export const CHAT_INFERENCE_CONFIG = loadChatInferenceConfig(env, !building);
