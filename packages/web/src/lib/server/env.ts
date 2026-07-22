import { building } from "$app/environment";
import { env } from "$env/dynamic/private";

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
export const INFERENCE_URL = get("INFERENCE_URL");
export const MEDIA_PATH = get("MEDIA_PATH");
export const TEMPORAL_URL = get("TEMPORAL_URL");
export const CHAT_MODEL = get("CHAT_MODEL", "qwen3.5-9b");
