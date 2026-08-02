CREATE TABLE IF NOT EXISTS "session_artifact_migrations" (
	"session_id" varchar(30) NOT NULL,
	"kind" varchar(30) NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"format_version" integer NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	CONSTRAINT "session_artifact_migrations_session_id_kind_pk" PRIMARY KEY("session_id","kind"),
	CONSTRAINT "session_artifact_migrations_kind_check" CHECK ("kind" IN ('transcript', 'detailed_record'))
);
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "processing_runs"
		WHERE "status" NOT IN ('done', 'failed')
	) THEN
		RAISE EXCEPTION 'Cannot migrate session artifacts while processing runs are active';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "sessions" s
		WHERE
			(
				s."transcript" IS NOT NULL
				AND NOT EXISTS (
					SELECT 1
					FROM "session_artifact_migrations" m
					WHERE m."session_id" = s."id" AND m."kind" = 'transcript'
				)
			)
			OR
			(
				s."summary" IS NOT NULL
				AND NOT EXISTS (
					SELECT 1
					FROM "session_artifact_migrations" m
					WHERE m."session_id" = s."id" AND m."kind" = 'detailed_record'
				)
			)
	) THEN
		RAISE EXCEPTION 'Session artifacts have not been staged; run pnpm --filter @rainbot/worker migrate:session-artifacts before deploying';
	END IF;
END $$;
--> statement-breakpoint
INSERT INTO "session_artifacts" (
	"session_id",
	"generated_by_run_id",
	"kind",
	"bucket",
	"object_key",
	"content_type",
	"format_version",
	"byte_size",
	"sha256",
	"is_current"
)
SELECT
	m."session_id",
	NULL,
	m."kind",
	m."bucket",
	m."object_key",
	m."content_type",
	m."format_version",
	m."byte_size",
	m."sha256",
	true
FROM "session_artifact_migrations" m
INNER JOIN "sessions" s ON s."id" = m."session_id"
WHERE
	(m."kind" = 'transcript' AND s."transcript" IS NOT NULL)
	OR
	(m."kind" = 'detailed_record' AND s."summary" IS NOT NULL)
ON CONFLICT ("session_id", "kind") WHERE "is_current" = true
DO UPDATE SET
	"bucket" = EXCLUDED."bucket",
	"object_key" = EXCLUDED."object_key",
	"content_type" = EXCLUDED."content_type",
	"format_version" = EXCLUDED."format_version",
	"byte_size" = EXCLUDED."byte_size",
	"sha256" = EXCLUDED."sha256";
--> statement-breakpoint
ALTER TABLE "processing_runs" DROP COLUMN "transcript";
--> statement-breakpoint
ALTER TABLE "processing_runs" DROP COLUMN "summary";
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "transcript";
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "summary";
--> statement-breakpoint
DROP TABLE "session_artifact_migrations";
