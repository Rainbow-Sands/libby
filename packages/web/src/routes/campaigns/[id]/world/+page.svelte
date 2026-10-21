<script lang="ts">
  import type { WorldPageKind } from "@rainbot/db";
  import { page } from "$app/state";
  import Breadcrumbs from "$lib/components/Breadcrumbs.svelte";
  import TaperedRule from "$lib/components/TaperedRule.svelte";
  import WorldAvatar from "$lib/components/WorldAvatar.svelte";
  import { KIND_LABELS, KIND_PLURALS, avatarHref, worldPageHref } from "$lib/world";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  type IndexPage = PageData["pages"][number];

  const KIND_ORDER: WorldPageKind[] = [
    "character",
    "npc",
    "location",
    "faction",
    "quest",
    "item",
    "other",
  ];
  const QUEST_COLUMNS = [
    { status: "open", label: "Open" },
    { status: "resolved", label: "Resolved" },
    { status: "abandoned", label: "Abandoned" },
  ];
  // An open quest nobody has touched for this many sessions is marked stale.
  const STALE_AFTER = 3;

  let query = $state("");

  const counts = $derived(
    new Map(KIND_ORDER.map((kind) => [kind, data.pages.filter((p) => p.kind === kind).length])),
  );
  const kinds = $derived(KIND_ORDER.filter((kind) => (counts.get(kind) ?? 0) > 0));
  const activeKind = $derived.by((): WorldPageKind | null => {
    const requested = page.url.searchParams.get("kind");
    const match = kinds.find((kind) => kind === requested);
    if (match) return match;
    return kinds.includes("npc") ? "npc" : (kinds[0] ?? null);
  });

  function byRecent(a: IndexPage, b: IndexPage): number {
    return (b.changedIn ?? 0) - (a.changedIn ?? 0) || a.name.localeCompare(b.name);
  }

  const needle = $derived(query.trim().toLowerCase());
  const rows = $derived(
    needle
      ? data.pages
          .filter((p) => p.names.some((name) => name.toLowerCase().includes(needle)))
          .toSorted(byRecent)
      : data.pages.filter((p) => p.kind === activeKind).toSorted(byRecent),
  );

  function questColumn(status: string | null): string {
    return status === "resolved" || status === "abandoned" ? status : "open";
  }

  function isStale(p: IndexPage): boolean {
    return (
      questColumn(p.status) === "open" &&
      data.latestSession !== null &&
      p.changedIn !== null &&
      data.latestSession - p.changedIn >= STALE_AFTER
    );
  }

  function meta(p: IndexPage): string {
    if (p.changedIn === null) return "";
    return p.created ? `new in S${p.changedIn}` : `updated S${p.changedIn}`;
  }
</script>

<svelte:head><title>World — {data.campaign.name}</title></svelte:head>

<Breadcrumbs
  items={[{ label: data.campaign.name, href: `/campaigns/${data.campaign.id}` }, { label: "World" }]}
/>

<div class="panel">
  <p class="eyebrow">World{#if data.latestSession}&nbsp;· as of Session {data.latestSession}{/if}</p>
  <h1>{data.campaign.name}</h1>
  <TaperedRule />

  {#if data.pages.length === 0}
    <p class="empty">
      The world fills in as sessions are recapped. Its first pages appear after the next session
      finishes.
    </p>
  {:else}
    <div class="toolbar">
      <nav class="kinds" aria-label="Kinds of page">
        {#each kinds as kind (kind)}
          <a href="?kind={kind}" class:on={!needle && kind === activeKind} aria-current={!needle && kind === activeKind ? "page" : undefined}
            >{KIND_PLURALS[kind]} <span>{counts.get(kind)}</span></a
          >
        {/each}
      </nav>

      <input
        class="search"
        type="search"
        placeholder="Search names and aliases…"
        aria-label="Search names and aliases"
        bind:value={query}
      />
    </div>

    {#snippet row(p: IndexPage, showKind: boolean)}
      <li>
        <a class="entry" href={worldPageHref(data.campaign.id, p.slug)}>
          <WorldAvatar
            src={avatarHref(data.campaign.id, p.avatarId)}
            name={p.name}
            kind={p.kind}
            size="md"
          />
          <span class="text">
            <span class="head">
              <b>{p.name}</b>
              {#if showKind}<span class="kind">{KIND_LABELS[p.kind]}</span>{/if}
              <span class="meta">{meta(p)}</span>
            </span>
            {#if p.line}<span class="sub">{p.line}</span>{/if}
          </span>
        </a>
      </li>
    {/snippet}

    {#if needle}
      {#if rows.length === 0}
        <p class="empty">No page is called anything like “{query.trim()}”.</p>
      {:else}
        <ul class="rows">
          {#each rows as p (p.slug)}{@render row(p, true)}{/each}
        </ul>
      {/if}
    {:else if activeKind === "quest"}
      <div class="board">
        {#each QUEST_COLUMNS as column (column.status)}
          {@const quests = rows.filter((p) => questColumn(p.status) === column.status)}
          <section>
            <h3>{column.label} <span>{quests.length}</span></h3>
            {#each quests as p (p.slug)}
              <a class="card" class:stale={isStale(p)} href={worldPageHref(data.campaign.id, p.slug)}>
                <WorldAvatar
                  src={avatarHref(data.campaign.id, p.avatarId)}
                  name={p.name}
                  kind={p.kind}
                  size="sm"
                />
                <span>
                  <b>{p.name}</b>
                  {#if p.line}<span class="sub">{p.line}</span>{/if}
                  <span class="meta"
                    >{meta(p)}{#if isStale(p)}&nbsp;· untouched for a while{/if}</span
                  >
                </span>
              </a>
            {:else}
              <p class="empty">None.</p>
            {/each}
          </section>
        {/each}
      </div>
    {:else}
      <ul class="rows">
        {#each rows as p (p.slug)}{@render row(p, false)}{/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.1rem;
  }
  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .kinds a {
    padding: 0.2rem 0.75rem;
    font-family: var(--font-display);
    font-size: 0.85rem;
    color: var(--ink);
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 999px;
  }
  .kinds a span {
    color: var(--ink-soft);
  }
  .kinds a.on {
    color: #fbf4e3;
    background: var(--accent);
    border-color: var(--accent);
  }
  .kinds a.on span {
    color: inherit;
    opacity: 0.8;
  }
  .kinds a:hover {
    text-decoration: none;
  }
  .search {
    flex: 0 1 17rem;
    min-width: 12rem;
    padding: 0.45rem 0.75rem;
    font: inherit;
    font-size: 1rem;
    color: var(--ink);
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 6px;
  }
  .rows {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rows li {
    display: grid;
  }
  .entry {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.8rem;
    align-items: start;
    padding: 0.75rem 0.9rem;
    color: var(--ink);
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 8px;
  }
  .entry:hover {
    color: var(--ink);
    text-decoration: none;
    border-color: var(--gold);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 0.5rem;
    align-items: baseline;
  }
  .head b {
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--link);
  }
  .kind {
    font-family: var(--font-display);
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gold);
  }
  .sub {
    display: block;
    font-size: 0.92rem;
    line-height: 1.4;
    color: var(--ink-soft);
  }
  .meta {
    margin-left: auto;
    font-size: 0.82rem;
    white-space: nowrap;
    color: var(--ink-soft);
  }
  .board {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.8rem;
    margin-top: 0.5rem;
  }
  .board section {
    display: grid;
    gap: 0.5rem;
    align-content: start;
  }
  .board h3 {
    margin: 0;
    font-size: 1rem;
    color: var(--gold);
  }
  .board h3 span {
    color: var(--ink-soft);
  }
  .card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.55rem;
    align-items: start;
    padding: 0.55rem 0.65rem;
    color: var(--ink);
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 8px;
  }
  .card:hover {
    text-decoration: none;
    border-color: var(--gold);
  }
  .card b {
    display: block;
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--accent);
  }
  .card .meta {
    display: block;
    white-space: normal;
  }
  .card.stale {
    border-style: dashed;
  }
  @media (max-width: 680px) {
    .board {
      grid-template-columns: 1fr;
    }
  }
</style>
