-- Existing transcripts are plain simplified text, not valid JSON, and we're
-- pre-production, so there's no need to preserve them across the format
-- change — clear them rather than carrying a legacy-string code path forever.
ALTER TABLE "sessions" ALTER COLUMN "transcript" SET DATA TYPE jsonb USING NULL;