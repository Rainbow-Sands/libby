<script lang="ts">
  import type { SessionRecap } from "@rainbot/db";
  import {
    recapFieldLinker,
    type LinkedText as Segments,
    type RecapLink,
  } from "@rainbot/db/world-links";
  import LinkedMarkdown from "./LinkedMarkdown.svelte";
  import LinkedText from "./LinkedText.svelte";
  import WorldAvatar from "./WorldAvatar.svelte";
  import { linkMarkdown } from "$lib/linked-markdown";
  import { speakerHue } from "$lib/speakers";
  import { avatarHref, worldPageHref, type WorldLinkPage, type WorldLinks } from "$lib/world";

  let {
    recap,
    world = null,
    links = [],
  }: { recap: SessionRecap; world?: WorldLinks | null; links?: RecapLink[] } = $props();

  const sections = $derived(recap.sections);

  // Only phrases the linking model tied to a page link, so a name that means
  // someone else here stays plain. Running text links each page's first
  // mention, in reading order; titled entries (threads, loot, new faces) link
  // whatever they name.
  const byField = $derived.by(() => {
    const fields = new Map<string, RecapLink[]>();
    for (const link of world ? links : []) {
      fields.set(link.field, [...(fields.get(link.field) ?? []), link]);
    }
    return fields;
  });
  const linked = $derived.by(() => {
    const seen = new Set<string>();
    const linker = (field: string) => recapFieldLinker(byField.get(field) ?? [], seen);
    return {
      recap: linkMarkdown(sections.recap, linker("recap")),
      leftOff: linker("leftOff")(sections.leftOff),
      moments: sections.epicMoments.map((moment, index) =>
        linker(`epicMoments.${index}`)(moment.description),
      ),
    };
  });
  function linkField(field: string, text: string): Segments {
    return recapFieldLinker(byField.get(field) ?? [])(text);
  }
  const bySlug = $derived(new Map(world?.pages.map((page) => [page.slug, page])));
  // The page a new face is, when the linking model tied its name to one.
  function facePage(index: number): WorldLinkPage | undefined {
    const slug = byField.get(`newFaces.${index}`)?.[0]?.slug;
    return slug ? bySlug.get(slug) : undefined;
  }
  const totalWords = $derived(recap.stats.speakers.reduce((sum, s) => sum + s.words, 0));

  const STATUS_LABELS = {
    new: "New",
    advanced: "Advanced",
    resolved: "Resolved",
    open: "Still open",
  } as const;

  const KIND_LABELS = {
    character: "Character",
    npc: "NPC",
    location: "Place",
    faction: "Faction",
    item: "Item",
    other: "Other",
  } as const;

  // "h:mm:ss" from the transcript's elapsed-time markers. The transcript tab
  // scrolls to the turn nearest this offset.
  function elapsedSeconds(at: string | null): number | null {
    const match = at ? /^(\d+):([0-5]\d):([0-5]\d)$/.exec(at) : null;
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  function formatDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.round((totalSeconds % 3600) / 60);
    return hours > 0 ? `${hours} h ${minutes} m` : `${minutes} m`;
  }

  function percent(words: number): number {
    return totalWords > 0 ? Math.round((words / totalWords) * 100) : 0;
  }
</script>

{#snippet named(field: string, text: string)}
  <LinkedText segments={linkField(field, text)} {world} />
{/snippet}

{#snippet cite(at: string | null)}
  {@const seconds = elapsedSeconds(at)}
  {#if seconds !== null}
    <a class="ts" href="?tab=transcript#at-{seconds}" title="Open the transcript here">{at}</a>
  {/if}
{/snippet}

<div class="recap with-rail">
  <div class="main">
    <!-- The Recap tab names this section, so it has no heading of its own. -->
    <section class="rsec" aria-label="Recap">
      <div class="prose"><LinkedMarkdown blocks={linked.recap} {world} /></div>
    </section>

    {#if sections.loot.length}
      <section class="rsec">
        <h3>Loot</h3>
        <div class="loot-wrap">
          <table class="loot">
            <tbody>
              {#each sections.loot as item, index (index)}
                <tr>
                  <td><strong>{@render named(`loot.${index}.item`, item.item)}</strong> {@render cite(item.at)}</td>
                  <td>
                    {#if item.holder}{@render named(`loot.${index}.holder`, item.holder)}{:else}Unclear{/if}
                  </td>
                  <td class="muted">{item.note}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    {#if sections.epicMoments.length}
      <section class="rsec">
        <h3>Epic moments</h3>
        <div class="epic">
          {#each sections.epicMoments as moment, index (index)}
            <blockquote>
              <p><LinkedText segments={linked.moments[index]} {world} /></p>
              <cite>
                {#if moment.quote}
                  “{moment.quote}”{#if moment.speaker}&nbsp;· {moment.speaker}{/if}
                {/if}
                {@render cite(moment.at)}
              </cite>
            </blockquote>
          {/each}
        </div>
      </section>
    {/if}

    {#if sections.newFaces.length}
      <section class="rsec">
        <h3>New faces &amp; places</h3>
        <div class="chips">
          {#each sections.newFaces as face, index (index)}
            {@const page = facePage(index)}
            <span class="chip" class:with-avatar={page && world}>
              {#if page && world}
                <WorldAvatar
                  src={avatarHref(world.campaignId, page.avatarId)}
                  name={page.name}
                  kind={page.kind}
                  size="sm"
                />
              {/if}
              <span class="kind">{KIND_LABELS[face.kind]}</span>
              {#if page && world}
                <a href={worldPageHref(world.campaignId, page.slug, world.asOf)}>{face.name}</a>
              {:else}
                {face.name}
              {/if}
            </span>
          {/each}
        </div>
      </section>
    {/if}

    {#if sections.rulings.length}
      <section class="rsec">
        <h3>Rulings</h3>
        <ul class="rulings">
          {#each sections.rulings as ruling, index (index)}
            <li>{ruling.ruling} {@render cite(ruling.at)}</li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if recap.stats.speakers.length}
      <section class="rsec">
        <h3>At the table</h3>
        <div class="stats">
          <div class="stat"><b>{formatDuration(recap.stats.durationSeconds)}</b><span>recorded</span></div>
          <div class="stat">
            <b>{recap.stats.speakers.length} {recap.stats.speakers.length === 1 ? "voice" : "voices"}</b>
            <span>at the table</span>
          </div>
        </div>
        <div class="bar" role="img" aria-label="Share of words spoken by each person">
          {#each recap.stats.speakers as speaker (speaker.userId)}
            <i
              style={`width: ${percent(speaker.words)}%; --speaker-hue: ${speakerHue(speaker.userId)}`}
            ></i>
          {/each}
        </div>
        <ul class="legend">
          {#each recap.stats.speakers as speaker (speaker.userId)}
            <li style={`--speaker-hue: ${speakerHue(speaker.userId)}`}>
              <span class="dot" aria-hidden="true"></span>
              <strong>{speaker.name}</strong>
              {#if speaker.characterName}<span class="muted">as {speaker.characterName}</span>{/if}
              <span class="share">{percent(speaker.words)}%</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>

  <!-- What the table needs before the next session sits beside the story. -->
  <aside class="rail" aria-label="Where things stand">
    <section class="box">
      <h3>Where we left off</h3>
      <p class="left-off"><LinkedText segments={linked.leftOff} {world} /></p>
    </section>

    {#if sections.openThreads.length}
      <section class="box">
        <h3>Open threads</h3>
        <ul class="threads">
          {#each sections.openThreads as thread, index (index)}
            <li>
              <span class="pill status-{thread.status}">{STATUS_LABELS[thread.status]}</span>
              <span
                ><strong>{@render named(`openThreads.${index}`, thread.title)}</strong>
                {@render cite(thread.at)}</span
              >
              <p class="why">{thread.note}</p>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </aside>
</div>

<style>
  .main {
    display: grid;
    gap: 1rem;
    min-width: 0;
  }
  .rsec {
    display: grid;
    gap: 0.55rem;
  }
  .rsec + .rsec {
    padding-top: 1rem;
    border-top: 1px solid var(--edge);
  }
  h3 {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.15rem;
    color: var(--gold);
  }
  .sub {
    font-family: var(--font-body);
    font-size: 0.9rem;
    font-style: italic;
    font-weight: 400;
    color: var(--ink-soft);
  }
  p {
    margin: 0;
  }
  .prose {
    line-height: 1.7;
  }
  .prose :global(p) {
    margin: 0 0 0.75em;
  }
  .prose :global(p:last-child) {
    margin-bottom: 0;
  }
  .prose :global(strong) {
    color: var(--text-emphasis, var(--gold));
  }
  .rail h3 {
    font-size: 1rem;
  }
  .left-off {
    font-size: 0.98rem;
    font-style: italic;
    line-height: 1.55;
  }
  .ts {
    padding: 0 0.35em;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-style: normal;
    white-space: nowrap;
    color: var(--ink-soft);
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 3px;
  }
  .ts:hover {
    color: var(--link-hover);
    text-decoration: none;
  }
  .threads,
  .rulings,
  .legend {
    display: grid;
    gap: 0.55rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .threads {
    gap: 0.8rem;
  }
  .threads li {
    display: grid;
    gap: 0.15rem;
    justify-items: start;
    line-height: 1.4;
  }
  .threads strong {
    color: var(--accent);
  }
  .why {
    font-size: 0.92rem;
    color: var(--ink-soft);
  }
  .pill {
    justify-self: start;
    padding: 0.15em 0.6em;
    font-family: var(--font-display);
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    border-radius: 999px;
  }
  .status-new {
    color: var(--warn);
    background: var(--warn-soft);
  }
  .status-advanced {
    color: var(--info);
    background: var(--info-soft);
  }
  .status-resolved {
    color: var(--ok);
    background: var(--ok-soft);
  }
  .status-open {
    color: var(--ink-soft);
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
  }
  .loot-wrap {
    overflow-x: auto;
  }
  .loot {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.98rem;
  }
  .loot td {
    padding: 0.4rem 0.6rem;
    vertical-align: top;
    border-bottom: 1px solid color-mix(in srgb, var(--edge) 68%, transparent);
  }
  .loot tr:last-child td {
    border-bottom: 0;
  }
  .epic {
    display: grid;
    gap: 0.75rem;
  }
  blockquote {
    display: grid;
    gap: 0.2rem;
    margin: 0;
    padding-left: 0.9rem;
    border-left: 3px solid var(--gold);
  }
  cite {
    font-size: 0.92rem;
    font-style: normal;
    color: var(--ink-soft);
  }
  .rulings {
    padding-left: 1.2em;
    list-style: disc;
    gap: 0.3rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.12rem 0.65rem;
    font-weight: 600;
    color: var(--accent);
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 999px;
  }
  .chip.with-avatar {
    padding-left: 0.25rem;
  }
  .kind {
    font-family: var(--font-display);
    font-size: 0.6rem;
    font-weight: 400;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gold);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.6rem;
  }
  .stat {
    padding: 0.5rem 0.75rem;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 4px;
  }
  .stat b {
    display: block;
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  .stat span {
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .bar {
    display: flex;
    height: 6px;
    overflow: hidden;
    background: var(--edge);
    border-radius: 3px;
  }
  .bar i {
    display: block;
    height: 100%;
    background: hsl(var(--speaker-hue) 48% 42%);
  }
  .legend {
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.3rem 1rem;
    font-size: 0.92rem;
  }
  .legend li {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    min-width: 0;
  }
  .dot {
    flex: 0 0 auto;
    width: 0.55rem;
    height: 0.55rem;
    background: hsl(var(--speaker-hue) 48% 42%);
    border-radius: 50%;
  }
  .share {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: var(--ink-soft);
  }
</style>
