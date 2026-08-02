function get(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const DISCORD_TOKEN = get("DISCORD_TOKEN");
export const DISCORD_APPLICATION_ID = get("DISCORD_APPLICATION_ID");
export const S3_BUCKET_AUDIO = get("S3_BUCKET_AUDIO");
export const S3_REGION = get("S3_REGION");
