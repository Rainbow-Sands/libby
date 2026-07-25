function get(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const DISCORD_TOKEN = get("DISCORD_TOKEN");
export const DISCORD_APPLICATION_ID = get("DISCORD_APPLICATION_ID");
export const MEDIA_PATH = get("MEDIA_PATH");
export const REDIS_URL = get("REDIS_URL");
