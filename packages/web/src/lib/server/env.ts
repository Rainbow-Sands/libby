import { building } from "$app/environment";
import { env } from "$env/dynamic/private";

function get(name: string): string {
  const value = env[name];
  if (!value && !building) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value as string;
}

export const DISCORD_APPLICATION_ID = get("DISCORD_APPLICATION_ID");
export const DISCORD_CLIENT_SECRET = get("DISCORD_CLIENT_SECRET");
export const SESSION_SECRET = get("SESSION_SECRET");
export const LLAMA_URL = get("LLAMA_URL");
// llama.cpp serves a single model, so the id is mostly cosmetic; override only if
// your server exposes a specific model name via /v1/models.
export const LLAMA_MODEL = env.LLAMA_MODEL ?? "local-model";
