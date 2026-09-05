interface RecordingSession {
  segmentCount: number;
  end: () => Promise<void>;
}

// One session per guild, multiple guilds per process.
const activeSessions = new Map<string, RecordingSession>();

export function getActiveSession(guildId: string): RecordingSession | null {
  return activeSessions.get(guildId) ?? null;
}

export function setActiveSession(guildId: string, session: RecordingSession | null): void {
  if (session === null) {
    activeSessions.delete(guildId);
  } else {
    activeSessions.set(guildId, session);
  }
}
