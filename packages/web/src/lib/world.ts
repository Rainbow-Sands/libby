import type { WorldPageKind } from "@rainbot/db";

// What a link, hover card or avatar needs to know about a world page.
export interface WorldLinkPage {
  slug: string;
  kind: WorldPageKind;
  name: string;
  names: string[];
  line: string;
  status: string | null;
  avatarId: string | null;
}

// Links into the world at one point in its history: pages as they stood after
// the session `asOf`, or the current world when it is null.
export interface WorldLinks {
  campaignId: string;
  asOf: string | null;
  pages: WorldLinkPage[];
}

export const KIND_LABELS: Record<WorldPageKind, string> = {
  character: "Character",
  npc: "NPC",
  location: "Place",
  faction: "Faction",
  item: "Item",
  quest: "Quest",
  other: "Other",
};

export const KIND_PLURALS: Record<WorldPageKind, string> = {
  character: "Characters",
  npc: "NPCs",
  location: "Places",
  faction: "Factions",
  item: "Items",
  quest: "Quests",
  other: "Other",
};

export function worldPageHref(campaignId: string, slug: string, asOf: string | null = null) {
  const base = `/campaigns/${campaignId}/world/${encodeURIComponent(slug)}`;
  return asOf ? `${base}?asOf=${encodeURIComponent(asOf)}` : base;
}

export function avatarHref(campaignId: string, avatarId: string | null): string | null {
  return avatarId ? `/campaigns/${campaignId}/avatars/${avatarId}` : null;
}

export function transcriptHref(campaignId: string, sessionId: string, seconds: number | null) {
  const base = `/campaigns/${campaignId}/sessions/${sessionId}?tab=transcript`;
  return seconds === null ? base : `${base}#at-${seconds}`;
}
