import {
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  upsertSearchAttributes,
  workflowInfo,
} from "@temporalio/workflow";
import type * as activities from "../activities/transcribe.ts";
import type * as persistActivities from "../activities/persist.ts";
import type * as notifyActivities from "../activities/notify.ts";
import type { RegenerateSessionInput, SegmentRef, SessionInput, SessionStatus } from "../types.ts";

const { transcribeSegment, aggregateTranscript } = proxyActivities<typeof activities>({
  taskQueue: "rainbot-transcription",
  // Manual imports can be several hours of one speaker's audio. Heartbeats in
  // the activity still let Temporal detect a dead worker promptly.
  startToCloseTimeout: "4 hours",
  scheduleToCloseTimeout: "6 hours",
  retry: {
    maximumAttempts: 5,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
  },
});

const { summarize, recap, generateTitle } = proxyActivities<typeof activities>({
  taskQueue: "rainbot-summarization",
  startToCloseTimeout: "30 minutes",
  scheduleToCloseTimeout: "2 hours",
  retry: {
    maximumAttempts: 3,
    initialInterval: "10 seconds",
    backoffCoefficient: 2,
  },
});

const {
  recordSessionStart,
  updateSessionStatus,
  persistTranscript,
  persistSummary,
  persistRecap,
  persistTitle,
  prepareSessionRegeneration,
  updateRegenerationStatus,
} = proxyActivities<typeof persistActivities>({
  taskQueue: "rainbot-transcription",
  startToCloseTimeout: "1 minute",
  retry: {
    maximumAttempts: 10,
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
  },
});

const { postSessionLink } = proxyActivities<typeof notifyActivities>({
  taskQueue: "rainbot-transcription",
  startToCloseTimeout: "1 minute",
  retry: {
    maximumAttempts: 5,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
  },
});

const CONTINUE_AS_NEW_THRESHOLD = 500;

export const segmentRecorded = defineSignal<[SegmentRef]>("segmentRecorded");
export const sessionEnded = defineSignal("sessionEnded");
export const getStatus = defineQuery<SessionStatus>("getStatus");

interface SessionContinuation {
  carriedOverKeys: string[];
}

export async function regenerateSessionWorkflow(input: RegenerateSessionInput): Promise<void> {
  const source = await prepareSessionRegeneration(input.sessionId);
  await updateRegenerationStatus(input.sessionId, "summarizing");

  try {
    const summaryKey = await summarize(source.sessionDir, source.transcriptKey, source.campaignId);
    await persistSummary(source.sessionDir, input.sessionId, summaryKey);

    const recapKey = await recap(source.sessionDir, summaryKey);
    await persistRecap(source.sessionDir, input.sessionId, recapKey);

    const titleKey = await generateTitle(source.sessionDir, summaryKey);
    await persistTitle(source.sessionDir, input.sessionId, titleKey);

    await updateRegenerationStatus(input.sessionId, "done");
  } catch (err) {
    await updateRegenerationStatus(input.sessionId, "failed");
    throw err;
  }
}

export async function sessionWorkflow(
  input: SessionInput,
  continuation?: SessionContinuation,
): Promise<void> {
  const carriedOverKeys: string[] = continuation?.carriedOverKeys ?? [];
  const pending: Promise<string | null>[] = [];
  let ended = false;
  let segmentCount = 0;
  let transcribedCount = 0;
  let lastError: string | undefined;
  let phase: SessionStatus["phase"] = "recording";

  upsertSearchAttributes({
    GuildId: [input.guildId],
    ChannelId: [input.channelId],
    SegmentCount: [0],
  });

  // Record the session row once, on the original run (not on continue-as-new).
  if (!continuation) {
    await recordSessionStart({
      id: input.sessionId,
      campaignId: input.campaignId,
      channelId: input.channelId,
      sessionDir: input.sessionDir,
      workflowId: workflowInfo().workflowId,
    });
  }

  setHandler(segmentRecorded, (ref: SegmentRef) => {
    segmentCount++;
    pending.push(
      transcribeSegment(input.sessionDir, ref)
        .then((key) => {
          transcribedCount++;
          return key;
        })
        .catch((err: unknown) => {
          lastError = err instanceof Error ? err.message : String(err);
          return null;
        }),
    );
    upsertSearchAttributes({ SegmentCount: [segmentCount] });
  });

  setHandler(sessionEnded, () => {
    ended = true;
  });

  setHandler(getStatus, () => ({ phase, segmentCount, transcribedCount, lastError }));

  // Wait for session end, resetting the 1-hour idle timer on each new segment.
  let lastSegmentCount = 0;
  while (!ended) {
    lastSegmentCount = segmentCount;
    const hadActivity = await condition(() => segmentCount > lastSegmentCount || ended, "1 hour");
    if (!hadActivity) {
      ended = true; // idle timeout
    }

    if (segmentCount >= CONTINUE_AS_NEW_THRESHOLD && !ended) {
      const completedKeys = (await Promise.allSettled(pending))
        .filter((r): r is PromiseFulfilledResult<string | null> => r.status === "fulfilled")
        .map((r) => r.value)
        .filter((k): k is string => k !== null);
      await continueAsNew<typeof sessionWorkflow>(input, {
        carriedOverKeys: [...carriedOverKeys, ...completedKeys],
      });
    }
  }

  // Drain all in-flight transcriptions.
  phase = "transcribing";
  await updateSessionStatus(input.sessionId, "transcribing");

  const newKeys = (await Promise.allSettled(pending))
    .filter((r): r is PromiseFulfilledResult<string | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((k): k is string => k !== null);

  const allKeys = [...carriedOverKeys, ...newKeys];

  if (allKeys.length === 0) {
    phase = "done";
    await updateSessionStatus(input.sessionId, "done");
    return;
  }

  try {
    // Post-session pipeline.
    const transcriptKey = await aggregateTranscript(input.sessionDir, allKeys);
    await persistTranscript(input.sessionDir, input.sessionId, transcriptKey);

    phase = "summarizing";
    await updateSessionStatus(input.sessionId, "summarizing");

    const summaryKey = await summarize(input.sessionDir, transcriptKey, input.campaignId);
    await persistSummary(input.sessionDir, input.sessionId, summaryKey);

    const recapKey = await recap(input.sessionDir, summaryKey);
    await persistRecap(input.sessionDir, input.sessionId, recapKey);

    const titleKey = await generateTitle(input.sessionDir, summaryKey);
    await persistTitle(input.sessionDir, input.sessionId, titleKey);

    phase = "done";
    await updateSessionStatus(input.sessionId, "done");
  } catch (err) {
    phase = "failed";
    lastError = err instanceof Error ? err.message : String(err);
    await updateSessionStatus(input.sessionId, "failed");
    throw err;
  }

  if (input.notificationChannelId) {
    try {
      await postSessionLink({
        channelId: input.notificationChannelId,
        campaignId: input.campaignId,
        sessionId: input.sessionId,
      });
    } catch (err) {
      // A notification failure must not turn an otherwise completed session
      // into a failed processing run.
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
}
