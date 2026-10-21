import { pageNames, summaryLine, type WorldPageSummary } from "@rainbot/db";
import type { WorldLinkPage } from "$lib/world";

export function toWorldLinkPages(world: WorldPageSummary[]): WorldLinkPage[] {
  return world.map((page) => ({
    slug: page.slug,
    kind: page.kind,
    name: page.content.name,
    names: pageNames(page.content),
    line: summaryLine(page.content.summary),
    status: page.content.status,
    avatarId: page.avatarId,
  }));
}
