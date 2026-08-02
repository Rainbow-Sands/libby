import postgres from "postgres";
import type { Transcript } from "@rainbot/db";
import {
  artifactContentHash,
  artifactObjectKey,
  getArtifactStorage,
  type UploadedArtifactObject,
} from "../storage.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing required environment variable: DATABASE_URL");

const sql = postgres(databaseUrl, { max: 1 });
const batchSize = 10;

interface LegacySessionRow {
  id: string;
  campaignId: string;
  transcript: Transcript | null;
  summary: string | null;
}

type ArtifactKind = "transcript" | "detailed_record";

async function assertNoActiveRuns(): Promise<void> {
  const [result] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from processing_runs
    where status not in ('done', 'failed')
  `;
  if ((result?.count ?? 0) > 0) {
    throw new Error(
      `Found ${result?.count} active processing runs. Stop Discord and the worker, then wait for or resolve every active run before migrating.`,
    );
  }
}

async function stageArtifact(
  session: LegacySessionRow,
  kind: ArtifactKind,
  body: string,
  contentType: string,
): Promise<boolean> {
  const sha256 = artifactContentHash(body);
  const objectKey = artifactObjectKey(
    session.campaignId,
    session.id,
    "legacy-import",
    kind,
    sha256,
  );
  const bucket = getArtifactStorage().bucket;
  const [existing] = await sql<{ bucket: string; objectKey: string; sha256: string }[]>`
    select
      bucket,
      object_key as "objectKey",
      sha256
    from session_artifact_migrations
    where session_id = ${session.id} and kind = ${kind}
  `;
  if (
    existing?.bucket === bucket &&
    existing.objectKey === objectKey &&
    existing.sha256 === sha256
  ) {
    return false;
  }

  const artifact = await getArtifactStorage().uploadArtifact(objectKey, body, contentType);
  await storeStagedArtifact(session.id, kind, artifact);
  return true;
}

async function storeStagedArtifact(
  sessionId: string,
  kind: ArtifactKind,
  artifact: UploadedArtifactObject,
): Promise<void> {
  await sql`
    insert into session_artifact_migrations (
      session_id,
      kind,
      bucket,
      object_key,
      content_type,
      format_version,
      byte_size,
      sha256
    )
    values (
      ${sessionId},
      ${kind},
      ${artifact.bucket},
      ${artifact.objectKey},
      ${artifact.contentType},
      ${artifact.formatVersion},
      ${artifact.byteSize},
      ${artifact.sha256}
    )
    on conflict (session_id, kind) do update set
      bucket = excluded.bucket,
      object_key = excluded.object_key,
      content_type = excluded.content_type,
      format_version = excluded.format_version,
      byte_size = excluded.byte_size,
      sha256 = excluded.sha256
  `;
}

async function migrate(): Promise<void> {
  await assertNoActiveRuns();
  await sql`
    create table if not exists session_artifact_migrations (
      session_id varchar(30) not null,
      kind varchar(30) not null check (kind in ('transcript', 'detailed_record')),
      bucket text not null,
      object_key text not null,
      content_type varchar(100) not null,
      format_version integer not null,
      byte_size bigint not null,
      sha256 varchar(64) not null,
      primary key (session_id, kind)
    )
  `;

  const [totals] = await sql<{ sessions: number; artifacts: number }[]>`
    select
      count(*)::int as sessions,
      (
        count(transcript) + count(summary)
      )::int as artifacts
    from sessions
    where transcript is not null or summary is not null
  `;
  console.log(
    `[artifact migration] ${totals?.sessions ?? 0} sessions and ${totals?.artifacts ?? 0} artifacts to verify`,
  );

  let cursor: string | null = null;
  let processedSessions = 0;
  let uploadedArtifacts = 0;
  while (true) {
    const rows: LegacySessionRow[] = await sql<LegacySessionRow[]>`
      select
        id,
        campaign_id as "campaignId",
        transcript,
        summary
      from sessions
      where
        (transcript is not null or summary is not null)
        and (${cursor}::varchar is null or id > ${cursor})
      order by id
      limit ${batchSize}
    `;
    if (rows.length === 0) break;

    for (const session of rows) {
      if (session.transcript) {
        const body = JSON.stringify(session.transcript);
        if (await stageArtifact(session, "transcript", body, "application/json")) {
          uploadedArtifacts++;
        }
      }
      if (session.summary !== null) {
        if (
          await stageArtifact(
            session,
            "detailed_record",
            session.summary,
            "text/markdown; charset=utf-8",
          )
        ) {
          uploadedArtifacts++;
        }
      }
      processedSessions++;
      cursor = session.id;
    }
    console.log(`[artifact migration] checked ${processedSessions} sessions`);
  }

  await assertNoActiveRuns();
  const [missing] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from sessions s
    where
      (
        s.transcript is not null
        and not exists (
          select 1
          from session_artifact_migrations m
          where m.session_id = s.id and m.kind = 'transcript'
        )
      )
      or
      (
        s.summary is not null
        and not exists (
          select 1
          from session_artifact_migrations m
          where m.session_id = s.id and m.kind = 'detailed_record'
        )
      )
  `;
  if ((missing?.count ?? 0) > 0) {
    throw new Error(`${missing?.count} sessions are missing staged artifact metadata`);
  }

  console.log(
    `[artifact migration] complete; uploaded ${uploadedArtifacts} new objects. The database migration can now publish them.`,
  );
}

try {
  await migrate();
} finally {
  await sql.end();
}
