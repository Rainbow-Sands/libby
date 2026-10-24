-- Quest statuses were free text, so the model sometimes wrote "completed",
-- "failed" and the like, and a quest could be "abandoned". World updates now
-- choose open or resolved; this maps what earlier sessions stored onto those.
-- A quest the party gave up stays open and goes dormant once it stops coming
-- up, so everything that does not mean resolved becomes open.
CREATE FUNCTION pg_temp.quest_status(status text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN status IS NULL THEN NULL
    WHEN regexp_replace(lower(trim(status)), '[\s_-]+', ' ', 'g') IN (
      'resolved', 'complete', 'completed', 'done', 'finished', 'fulfilled',
      'accomplished', 'solved', 'succeeded', 'success'
    ) THEN 'resolved'
    ELSE 'open'
  END
$$;--> statement-breakpoint
UPDATE "world_page_revisions" AS r
SET "content" = jsonb_set(r."content", '{status}', to_jsonb(pg_temp.quest_status(r."content"->>'status')))
FROM "world_pages" AS p
WHERE p."id" = r."page_id"
  AND p."kind" = 'quest'
  AND r."content"->>'status' IS NOT NULL
  AND r."content"->>'status' NOT IN ('open', 'resolved');--> statement-breakpoint
-- The status changes each session's World tab lists, so they read the same.
UPDATE "world_updates" AS u
SET "changes" = (
  SELECT jsonb_agg(
    CASE
      WHEN p."kind" = 'quest' AND jsonb_typeof(e.change->'status') = 'object' THEN
        CASE
          WHEN pg_temp.quest_status(e.change->'status'->>'from')
            IS NOT DISTINCT FROM pg_temp.quest_status(e.change->'status'->>'to')
          THEN jsonb_set(e.change, '{status}', 'null'::jsonb)
          ELSE jsonb_set(e.change, '{status}', jsonb_build_object(
            'from', pg_temp.quest_status(e.change->'status'->>'from'),
            'to', pg_temp.quest_status(e.change->'status'->>'to')
          ))
        END
      ELSE e.change
    END
    ORDER BY e.position
  )
  FROM jsonb_array_elements(u."changes") WITH ORDINALITY AS e(change, position)
  LEFT JOIN "world_pages" AS p ON p."id"::text = e.change->>'pageId'
)
WHERE jsonb_typeof(u."changes") = 'array' AND jsonb_array_length(u."changes") > 0;
--> statement-breakpoint
-- Recaps no longer mark threads abandoned. A thread given up that session was
-- still moved by it, and its note says why. Runs hold the recap they wrote
-- until it is stored on the session.
UPDATE "sessions"
SET "recap_sections" = jsonb_set("recap_sections", '{sections,openThreads}', (
  SELECT jsonb_agg(
    CASE WHEN t.thread->>'status' = 'abandoned'
      THEN jsonb_set(t.thread, '{status}', '"advanced"')
      ELSE t.thread
    END
    ORDER BY t.position
  )
  FROM jsonb_array_elements("recap_sections"->'sections'->'openThreads') WITH ORDINALITY AS t(thread, position)
))
WHERE jsonb_path_exists("recap_sections", '$.sections.openThreads[*] ? (@.status == "abandoned")');
--> statement-breakpoint
UPDATE "processing_runs"
SET "recap_sections" = jsonb_set("recap_sections", '{sections,openThreads}', (
  SELECT jsonb_agg(
    CASE WHEN t.thread->>'status' = 'abandoned'
      THEN jsonb_set(t.thread, '{status}', '"advanced"')
      ELSE t.thread
    END
    ORDER BY t.position
  )
  FROM jsonb_array_elements("recap_sections"->'sections'->'openThreads') WITH ORDINALITY AS t(thread, position)
))
WHERE jsonb_path_exists("recap_sections", '$.sections.openThreads[*] ? (@.status == "abandoned")');
