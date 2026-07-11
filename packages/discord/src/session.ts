import {
  Events,
  type Client,
  type VoiceBasedChannel,
  type VoiceState,
} from "discord.js";
import { joinVoiceChannel, EndBehaviorType } from "@discordjs/voice";
import prism from "prism-media";
import { mkdirSync } from "fs";
import { spawn } from "child_process";
import path from "path";
import type { WorkflowHandle } from "@temporalio/client";
import { getActiveSession, setActiveSession } from "./recording.ts";
import {
  segmentRecorded,
  sessionEnded,
} from "@rainbot/temporal";
import type { SegmentRef } from "@rainbot/temporal";

const SAMPLE_RATE = 48000;
const CHANNELS = 2;

function startActivation(
  sessionDir: string,
  segmentId: string,
  userId: string,
  username: string,
  connection: ReturnType<typeof joinVoiceChannel>,
  onDone: (ref: SegmentRef) => void,
  activeUsers: Set<string>
): void {
  if (activeUsers.has(userId)) return;
  activeUsers.add(userId);

  const timestamp = new Date().toISOString();
  const audioFile = `clips/${segmentId}.ogg`;
  const outputPath = path.join(sessionDir, audioFile);

  const audioStream = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 2000 },
  });

  const opusDecoder = new prism.opus.Decoder({
    rate: SAMPLE_RATE,
    channels: CHANNELS,
    frameSize: 960,
  });

  const ffmpegProcess = spawn("ffmpeg", [
    "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS),
    "-i", "pipe:0",
    "-c:a", "libopus", "-b:a", "64k",
    outputPath,
  ]);

  ffmpegProcess.on("error", (err) =>
    console.error(`ffmpeg error (${userId}):`, err)
  );

  // A malformed Opus packet (packet loss, jitter, etc.) is a normal occurrence
  // on a live voice connection. Without a listener here, Node treats it as an
  // unhandled 'error' event and crashes the whole process. Instead, just end
  // this activation early — same as a normal end-of-speech — so the rest of
  // the session keeps recording.
  const onStreamError = (err: unknown) => {
    console.error(`audio stream error (${userId}):`, err);
    audioStream.unpipe(opusDecoder as any);
    opusDecoder.unpipe(ffmpegProcess.stdin! as any);
    audioStream.destroy();
    opusDecoder.destroy();
    ffmpegProcess.stdin?.end();
  };
  audioStream.on("error", onStreamError);
  opusDecoder.on("error", onStreamError);

  audioStream.pipe(opusDecoder as any);
  opusDecoder.pipe(ffmpegProcess.stdin! as any);

  ffmpegProcess.on("close", (code) => {
    activeUsers.delete(userId);
    if (code === 0) {
      onDone({ segmentId, audioFile, timestamp, userId, username });
    }
  });
}

export function attachRecordingSession(
  client: Client,
  voiceChannel: VoiceBasedChannel,
  workflowHandle: WorkflowHandle,
  guildId: string,
  channelId: string,
  sessionId: string,
  sessionDir: string
): void {
  mkdirSync(path.join(sessionDir, "clips"), { recursive: true });
  mkdirSync(path.join(sessionDir, "transcripts"), { recursive: true });

  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator as any,
    selfDeaf: false,
  });

  let segmentCounter = 0;
  const activeUsers = new Set<string>();

  const onSegmentDone = (ref: SegmentRef) => {
    workflowHandle
      .signal(segmentRecorded, ref)
      .catch((err: unknown) => console.error("[workflow] signal error:", err));
  };

  const endSession = async () => {
    if (!getActiveSession(guildId)) return;
    client.off(Events.VoiceStateUpdate, voiceStateHandler);
    for (const stream of connection.receiver.subscriptions.values()) {
      stream.destroy();
    }
    connection.destroy();
    setActiveSession(guildId, null);
    await workflowHandle
      .signal(sessionEnded)
      .catch((err: unknown) =>
        console.error("[workflow] sessionEnded signal error:", err)
      );
    console.log(`[session] ended — ${guildId}:${sessionId}`);
  };

  const voiceStateHandler = (oldState: VoiceState, _newState: VoiceState) => {
    if (oldState.channelId !== channelId) return;
    if (oldState.member?.user.bot) return;
    const channel = oldState.guild.channels.cache.get(channelId);
    if (!channel?.isVoiceBased()) return;
    const humanCount = [...(channel as VoiceBasedChannel).members.values()].filter(
      (m) => !m.user.bot
    ).length;
    if (humanCount === 0) {
      console.log("[session] voice channel empty, auto-ending");
      endSession().catch((err: unknown) =>
        console.error("[session] auto-end error:", err)
      );
    }
  };

  client.on(Events.VoiceStateUpdate, voiceStateHandler);

  setActiveSession(guildId, {
    connection,
    guildId,
    channelId,
    sessionId,
    sessionDir,
    segmentCount: 0,
    activeUsers,
    workflowHandle,
    end: endSession,
  });

  connection.receiver.speaking.on("start", (userId: string) => {
    const segId = String(segmentCounter++).padStart(4, "0");
    // Resolve a readable label for the transcript. Use the account username so it
    // matches the username stored for campaign members; fall back to the id.
    const username =
      voiceChannel.guild.members.cache.get(userId)?.user.username ?? userId;
    startActivation(
      sessionDir,
      segId,
      userId,
      username,
      connection,
      onSegmentDone,
      activeUsers
    );
    const session = getActiveSession(guildId);
    if (session) session.segmentCount = segmentCounter;
  });

  console.log(`[session] attached — ${guildId}:${sessionId}`);
}
