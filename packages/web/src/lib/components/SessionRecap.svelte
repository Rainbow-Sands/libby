<script lang="ts">
  import { marked } from "marked";
  import type { SessionRecap } from "@rainbot/db";
  import { speakerHue } from "$lib/speakers";

  let { recap }: { recap: SessionRecap } = $props();

  const sections = $derived(recap.sections);
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

{#snippet cite(at: string | null)}
  {@const seconds = elapsedSeconds(at)}
  {#if seconds !== null}
    <a class="ts" href="?tab=transcript#at-{seconds}" title="Open the transcript here">{at}</a>
  {/if}
{/snippet}

<div class="recap">
  <section class="rsec">
    <h3>Recap</h3>
    <div class="prose">{@html marked(sections.recap) as string}</div>
  </section>

  <section class="rsec">
    <h3>Where we left off</h3>
    <p class="left-off">{sections.leftOff}</p>
  </section>

  {#if sections.openThreads.length}
    <section class="rsec">
      <h3>Open threads <span class="sub">still waiting on the party</span></h3>
      <ul class="threads">
        {#each sections.openThreads as thread, index (index)}
          <li>
            <span class="pill status-{thread.status}">{STATUS_LABELS[thread.status]}</span>
            <div>
              <strong>{thread.title}</strong>
              {@render cite(thread.at)}
              <p class="why">{thread.note}</p>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if sections.loot.length}
    <section class="rsec">
      <h3>Loot</h3>
      <div class="loot-wrap">
        <table class="loot">
          <tbody>
            {#each sections.loot as item, index (index)}
              <tr>
                <td><strong>{item.item}</strong> {@render cite(item.at)}</td>
                <td>{item.holder ?? "Unclear"}</td>
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
            <p>{moment.description}</p>
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
          <span class="chip"><span class="kind">{KIND_LABELS[face.kind]}</span>{face.name}</span>
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

<style>
  .recap {
    display: grid;
    gap: 1rem;
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
  .left-off {
    padding: 0.75rem 1rem;
    font-style: italic;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 4px;
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
  .threads li {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr);
    gap: 0.6rem;
    align-items: start;
  }
  .threads strong {
    color: var(--accent);
  }
  .why {
    font-size: 0.95rem;
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
  @media (max-width: 640px) {
    .threads li {
      grid-template-columns: 1fr;
      gap: 0.25rem;
    }
  }
</style>
