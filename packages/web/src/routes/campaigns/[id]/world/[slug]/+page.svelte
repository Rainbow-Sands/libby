<script lang="ts">
  import { linkPageNames } from "@rainbot/db/world-links";
  import AvatarUploader from "$lib/components/AvatarUploader.svelte";
  import LinkedText from "$lib/components/LinkedText.svelte";
  import TaperedRule from "$lib/components/TaperedRule.svelte";
  import WorldAvatar from "$lib/components/WorldAvatar.svelte";
  import {
    KIND_LABELS,
    avatarHref,
    transcriptHref,
    worldPageHref,
    type WorldLinkPage,
  } from "$lib/world";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const detail = $derived(data.page);
  const content = $derived(detail.content);
  const sessionsById = $derived(new Map(data.sessions.map((session) => [session.id, session])));
  const asOfSession = $derived(data.asOf ? sessionsById.get(data.asOf) : undefined);
  const isQuest = $derived(detail.kind === "quest");
  const targets = $derived(
    data.world.pages
      .filter((page) => page.slug !== detail.slug)
      .map((page) => ({ slug: page.slug, names: page.names })),
  );
  const linkPages = $derived(new Map(data.world.pages.map((page) => [page.slug, page])));

  function linkFor(slug: string): WorldLinkPage | undefined {
    return linkPages.get(slug);
  }

  function sessionLabel(sessionId: string): string {
    const session = sessionsById.get(sessionId);
    if (!session) return "An earlier session";
    return `Session ${session.number}${session.title ? ` · ${session.title}` : ""}`;
  }

  function shortSession(sessionId: string): string {
    const session = sessionsById.get(sessionId);
    return session ? `S${session.number}` : "S?";
  }

  function elapsedSeconds(at: string | null): number | null {
    const match = at ? /^(\d+):([0-5]\d):([0-5]\d)$/.exec(at) : null;
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  function historyNote(entry: PageData["page"]["history"][number]): string {
    const parts: string[] = [];
    if (entry.created) parts.push("Created");
    if (!entry.created || entry.factsAdded > 1) {
      if (entry.factsAdded > 0) {
        parts.push(`${entry.factsAdded} ${entry.factsAdded === 1 ? "fact" : "facts"} added`);
      }
    }
    if (entry.factsSuperseded > 0) parts.push(`${entry.factsSuperseded} superseded`);
    return parts.join(", ") || "Updated";
  }

  function submitOnChange(event: Event) {
    (event.currentTarget as HTMLSelectElement).form?.requestSubmit();
  }
</script>

<svelte:head><title>{content?.name ?? "World page"} — {data.campaign.name}</title></svelte:head>

{#snippet source(sessionId: string, at: string | null)}
  <a class="src" href={transcriptHref(data.campaign.id, sessionId, elapsedSeconds(at))}
    >{shortSession(sessionId)}{#if at}&nbsp;· {at}{/if}</a
  >
{/snippet}

{#snippet pageLink(page: WorldLinkPage)}
  <a class="linked" href={worldPageHref(data.campaign.id, page.slug, data.asOf)}>
    <WorldAvatar
      src={avatarHref(data.campaign.id, page.avatarId)}
      name={page.name}
      kind={page.kind}
      size="sm"
    />
    <span>{page.name}</span>
  </a>
{/snippet}

<p><a href="/campaigns/{data.campaign.id}/world">← World</a></p>

{#if data.asOf && (detail.isSnapshot || !content)}
  <div class="snapshot">
    <span>
      {#if content}
        You're viewing this page as it stood after <strong>{sessionLabel(data.asOf)}</strong>.
      {:else}
        This page did not exist yet after <strong>{sessionLabel(data.asOf)}</strong>.
      {/if}
    </span>
    <span class="snapshot-actions">
      <form method="GET">
        <label class="visually-hidden" for="as-of">Show the page as of</label>
        <select id="as-of" name="asOf" onchange={submitOnChange}>
          {#each detail.history as entry (entry.sessionId)}
            <option value={entry.sessionId} selected={entry.sessionId === detail.revisionSessionId}
              >As of {sessionLabel(entry.sessionId)}</option
            >
          {/each}
        </select>
        <noscript><button class="small" type="submit">Show</button></noscript>
      </form>
      <a class="small" href={worldPageHref(data.campaign.id, detail.slug)}>View current</a>
    </span>
  </div>
{/if}

<div class="panel">
  <div class="page-head">
    <AvatarUploader
      campaignId={data.campaign.id}
      slug={detail.slug}
      name={content?.name ?? detail.slug}
      kind={detail.kind}
      avatarId={detail.avatarId}
    />
    <div class="who">
      <p class="eyebrow">
        {KIND_LABELS[detail.kind]}{#if detail.kind === "character" && data.player}&nbsp;· played by {data.player}{/if}{#if content?.status && !isQuest}&nbsp;· {content.status}{/if}
        {#if isQuest && content?.status}<span class="pill status-{content.status}"
            >{content.status}</span
          >{/if}
      </p>
      <h1>{content?.name ?? detail.slug}</h1>
    </div>
  </div>
  <TaperedRule />

  {#if content}
    <div class="page-grid">
      <div class="main">
        {#if content.summary}
          <p class="summary">
            <LinkedText segments={linkPageNames(content.summary, targets)} world={data.world} />
          </p>
        {/if}

        {#if content.facts.length}
          <h3>{isQuest ? "How it unfolded" : "Known facts"}</h3>
          <ul class="facts" class:timeline={isQuest}>
            {#each content.facts as fact (fact.id)}
              <li class:superseded={fact.supersededIn}>
                {#if isQuest}{@render source(fact.sessionId, fact.at)}{/if}
                <span class="fact"
                  ><LinkedText segments={linkPageNames(fact.text, targets)} world={data.world} /></span
                >
                {#if !isQuest}{@render source(fact.sessionId, fact.at)}{/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if detail.laterFacts > 0}
          <p class="muted later">
            Later sessions added {detail.laterFacts}
            {detail.laterFacts === 1 ? "fact" : "facts"} that this view hides.
            <a href={worldPageHref(data.campaign.id, detail.slug)}>View current</a>
          </p>
        {/if}

        {#if detail.moments.length}
          <h3>Epic moments</h3>
          <div class="moments">
            {#each detail.moments as moment, index (index)}
              <blockquote>
                <span class="from"
                  ><a href="/campaigns/{data.campaign.id}/sessions/{moment.sessionId}"
                    >{sessionLabel(moment.sessionId)}</a
                  >{#if moment.at}&nbsp;·
                    <a href={transcriptHref(data.campaign.id, moment.sessionId, elapsedSeconds(moment.at))}
                      >{moment.at}</a
                    >{/if}</span
                >
                <p>{moment.description}</p>
                {#if moment.quote}
                  <cite>“{moment.quote}”{#if moment.speaker}&nbsp;· {moment.speaker}{/if}</cite>
                {/if}
              </blockquote>
            {/each}
          </div>
        {/if}
      </div>

      <aside class="sidebar">
        <div class="box">
          <dl>
            <dt>Kind</dt>
            <dd>{KIND_LABELS[detail.kind]}</dd>
            {#if content.status}
              <dt>Status</dt>
              <dd>{content.status}</dd>
            {/if}
            {#if data.player}
              <dt>Player</dt>
              <dd>{data.player}</dd>
            {/if}
            {#if content.holder}
              <dt>Held by</dt>
              <dd>{content.holder}</dd>
            {/if}
            <dt>First seen</dt>
            <dd>
              <a href="/campaigns/{data.campaign.id}/sessions/{detail.createdInSessionId}"
                >{sessionLabel(detail.createdInSessionId)}</a
              >
            </dd>
          </dl>
        </div>

        {#if content.aliases.length}
          <div class="box">
            <h4>Also heard as</h4>
            <span>{content.aliases.join(", ")}</span>
          </div>
        {/if}

        {#if detail.related.length}
          <div class="box">
            <h4>{isQuest ? "Involves" : "Connected"}</h4>
            {#each detail.related as related (related.slug)}
              {@const page = linkFor(related.slug)}
              {#if page}{@render pageLink(page)}{/if}
            {/each}
          </div>
        {/if}

        {#if detail.carries.length}
          <div class="box">
            <h4>Carries</h4>
            {#each detail.carries as item (item.slug)}
              {@const page = linkFor(item.slug)}
              {#if page}{@render pageLink(page)}{/if}
            {/each}
          </div>
        {/if}

        {#if detail.history.length}
          <div class="box">
            <h4>Page history</h4>
            <ol class="history">
              {#each detail.history as entry (entry.sessionId)}
                {@const current = entry.sessionId === detail.revisionSessionId}
                <li class:current>
                  <a
                    class="n"
                    href={worldPageHref(data.campaign.id, detail.slug, entry.sessionId)}
                    title={sessionLabel(entry.sessionId)}>{shortSession(entry.sessionId)}</a
                  >
                  <span>{historyNote(entry)}{#if current && data.asOf}&nbsp;· viewing{/if}</span>
                </li>
              {/each}
            </ol>
          </div>
        {/if}
      </aside>
    </div>
  {:else}
    <p class="empty">
      {asOfSession ? `Nothing was known about this yet after Session ${asOfSession.number}.` : ""}
      <a href={worldPageHref(data.campaign.id, detail.slug)}>See the page as it stands now.</a>
    </p>
  {/if}
</div>

<style>
  .snapshot {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1rem;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    padding: 0.6rem 0.9rem;
    font-size: 0.95rem;
    background: var(--warn-soft);
    border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--edge));
    border-radius: 4px;
  }
  .snapshot-actions,
  .snapshot form {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin: 0;
  }
  .snapshot-actions,
  .snapshot form,
  select {
    min-width: 0;
    max-width: 100%;
  }
  select,
  .small {
    padding: 0.2rem 0.55rem;
    font-family: var(--font-display);
    font-size: 0.72rem;
    letter-spacing: 0.05em;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 3px;
  }
  .small {
    text-transform: uppercase;
  }
  .small:hover {
    text-decoration: none;
    border-color: var(--gold);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .page-head {
    display: flex;
    gap: 1.1rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .who {
    display: grid;
    gap: 0.3rem;
    min-width: 0;
  }
  .who .eyebrow,
  .who h1 {
    margin: 0;
  }
  .who h1 {
    overflow-wrap: anywhere;
  }
  .pill {
    margin-left: 0.4rem;
    padding: 0.1em 0.6em;
    font-size: 0.62rem;
    color: var(--info);
    background: var(--info-soft);
    border-radius: 999px;
  }
  .pill.status-resolved {
    color: var(--ok);
    background: var(--ok-soft);
  }
  .pill.status-abandoned {
    color: var(--ink-soft);
    background: var(--surface-sunken);
  }
  .page-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 15rem;
    gap: 1.5rem;
  }
  .main {
    display: grid;
    gap: 0.75rem;
    align-content: start;
  }
  .main p {
    margin: 0;
  }
  .summary {
    line-height: 1.7;
  }
  h3 {
    margin: 0.5rem 0 0;
    font-size: 1.1rem;
    color: var(--gold);
  }
  h4 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--gold);
  }
  .facts {
    display: grid;
    gap: 0.45rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .facts li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.6rem;
    align-items: baseline;
  }
  .facts li.superseded .fact {
    color: var(--ink-soft);
    text-decoration: line-through;
  }
  .facts.timeline {
    gap: 0.6rem;
    padding-left: 1rem;
    border-left: 2px solid var(--edge);
  }
  .facts.timeline li {
    grid-template-columns: 1fr;
    gap: 0.1rem;
    position: relative;
  }
  .facts.timeline li::before {
    content: "";
    position: absolute;
    left: calc(-1rem - 5px);
    top: 0.45rem;
    width: 8px;
    height: 8px;
    background: var(--gold);
    border-radius: 50%;
  }
  .src {
    font-family: var(--font-display);
    font-size: 0.66rem;
    letter-spacing: 0.06em;
    white-space: nowrap;
    color: var(--gold);
  }
  .later {
    font-size: 0.92rem;
  }
  .moments {
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
  .from {
    font-family: var(--font-display);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    color: var(--gold);
  }
  .from a {
    color: var(--gold);
  }
  cite {
    font-size: 0.92rem;
    font-style: normal;
    color: var(--ink-soft);
  }
  .sidebar {
    display: grid;
    gap: 0.8rem;
    align-content: start;
    font-size: 0.95rem;
  }
  .box {
    display: grid;
    gap: 0.35rem;
    padding: 0.7rem 0.85rem;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 4px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.7rem;
    margin: 0;
  }
  dt {
    color: var(--ink-soft);
  }
  dd {
    margin: 0;
  }
  .linked {
    display: flex;
    gap: 0.45rem;
    align-items: center;
  }
  .history {
    display: grid;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .history li {
    display: grid;
    grid-template-columns: 2.2rem 1fr;
    gap: 0.4rem;
  }
  .history .n {
    font-family: var(--font-display);
    color: var(--gold);
  }
  .history li.current span {
    font-weight: 600;
  }
  @media (max-width: 720px) {
    .page-grid {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 520px) {
    .page-head {
      gap: 0.8rem;
    }
    .who h1 {
      font-size: 1.8rem;
    }
  }
</style>
