import { error } from "@sveltejs/kit";
import {
  compareTranscriptLines,
  getCampaignAccess,
  getCampaignCast,
  getSessionDetail,
  getSessionStatus,
  listTranscribedSegments,
  transcriptLines,
  type TranscriptLine,
} from "@rainbot/db";
import { statsWithCharacters, withCharacters } from "$lib/server/transcript-lines";
import type { RequestHandler } from "./$types";

const encoder = new TextEncoder();
const TERMINAL_STATUSES = new Set(["done", "failed"]);

function event(name: string, data: unknown, id?: string): Uint8Array {
  const idLine = id ? `id: ${id}\n` : "";
  return encoder.encode(`${idLine}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Streams lines from clips transcribed at or after `since` (the cursor the
// lines endpoint returned), one batch per poll, with whole-session stats.
export const GET: RequestHandler = async ({ params, locals, request, url }) => {
  if (!locals.user) throw error(401, "Please log in to view this transcript.");

  const [session, access, cast] = await Promise.all([
    getSessionDetail(params.sessionId),
    getCampaignAccess(params.id, locals.user.id),
    getCampaignCast(params.id),
  ]);
  if (!session || session.campaignId !== params.id) throw error(404, "Session not found.");
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");

  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  if (since && Number.isNaN(since.getTime())) throw error(400, "Invalid since.");

  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const known = new Set<string>();
      let all: TranscriptLine[] = [];
      let cursor: Date | undefined;
      let lastStatus: string | null = null;

      // Lines not seen before, folded into the whole-session list.
      const take = (lines: TranscriptLine[]): TranscriptLine[] => {
        const fresh = lines.filter((line) => !known.has(line.id));
        for (const line of fresh) known.add(line.id);
        if (fresh.length > 0) all = [...all, ...fresh].toSorted(compareTranscriptLines);
        return fresh;
      };
      const advance = (latest: Date | null) => {
        if (latest && (!cursor || latest > cursor)) cursor = latest;
      };

      void (async () => {
        try {
          // Everything so far, for the stats, then what the client has not seen.
          const [everything, missed] = await Promise.all([
            listTranscribedSegments(session.id),
            since ? listTranscribedSegments(session.id, since) : null,
          ]);
          take(transcriptLines(everything.segments, []));
          advance(everything.latestTranscribedAt);
          let pending = missed ? transcriptLines(missed.segments, []) : [];

          while (true) {
            if (cancelled || request.signal.aborted) return;
            if (pending.length > 0) {
              controller.enqueue(
                event("lines", {
                  lines: withCharacters(pending, cast),
                  stats: statsWithCharacters(all, cast),
                }),
              );
            }

            await wait(1_000, request.signal);
            if (cancelled || request.signal.aborted) return;
            const [segments, status] = await Promise.all([
              listTranscribedSegments(session.id, cursor),
              getSessionStatus(session.id),
            ]);
            if (cancelled || request.signal.aborted) return;
            pending = take(transcriptLines(segments.segments, []));
            advance(segments.latestTranscribedAt);

            if (status !== lastStatus) {
              lastStatus = status;
              controller.enqueue(event("status", { status }));
            }
            if (!status || TERMINAL_STATUSES.has(status)) {
              if (pending.length > 0) {
                controller.enqueue(
                  event("lines", {
                    lines: withCharacters(pending, cast),
                    stats: statsWithCharacters(all, cast),
                  }),
                );
              }
              controller.enqueue(event("complete", { status }));
              controller.close();
              return;
            }

            controller.enqueue(encoder.encode(": keepalive\n\n"));
          }
        } catch (streamError) {
          if (!cancelled && !request.signal.aborted) controller.error(streamError);
        }
      })();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
};
