<script lang="ts">
  import type { PageData } from "./$types";
  import TaperedRule from "$lib/components/TaperedRule.svelte";
  import WorldAvatar from "$lib/components/WorldAvatar.svelte";
  import { avatarHref, worldPageHref } from "$lib/world";

  let { data }: { data: PageData } = $props();

  const dm = $derived(data.campaign.members.find((m) => m.role === "dm"));
  const players = $derived(data.campaign.members.filter((m) => m.role !== "dm"));
  const tiles = $derived(
    [
      { label: "Characters", count: data.world.counts.character ?? 0, kind: "character" },
      { label: "NPCs", count: data.world.counts.npc ?? 0, kind: "npc" },
      { label: "Places", count: data.world.counts.location ?? 0, kind: "location" },
      { label: "Open quests", count: data.world.openQuests, kind: "quest" },
      { label: "Items", count: data.world.counts.item ?? 0, kind: "item" },
      { label: "Factions", count: data.world.counts.faction ?? 0, kind: "faction" },
    ].filter((tile) => tile.count > 0),
  );

  // The newest sessions show first; the rest wait behind "Show all".
  const RECENT_SESSIONS = 12;
  let showAll = $state(false);
  const sessions = $derived(
    data.campaign.sessions.map((session, index) => ({
      ...session,
      number: data.campaign.sessions.length - index,
    })),
  );
  const shownSessions = $derived(showAll ? sessions : sessions.slice(0, RECENT_SESSIONS));
  const firstSession = $derived(data.campaign.sessions.at(-1));
  const sessionsSince = $derived(
    firstSession
      ? `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} since ${formatMonth(firstSession.startedAt)}`
      : "",
  );

  function formatDate(d: Date | string): string {
    return new Date(d).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function formatMonth(d: Date | string): string {
    return new Date(d).toLocaleDateString("en-CA", { year: "numeric", month: "long" });
  }
</script>

<svelte:head><title>{data.campaign.name}</title></svelte:head>

<div class="panel">
  <p class="eyebrow">Campaign</p>
  <h1>{data.campaign.name}</h1>
  {#if dm || firstSession}
    <p class="byline">
      {#if dm}Run by <span>{dm.username}</span>{/if}
      {#if dm && firstSession}·{/if}
      {#if firstSession}{sessionsSince}{/if}
    </p>
  {/if}
  <TaperedRule />
  {#if data.campaign.description}
    <p>{data.campaign.description}</p>
  {/if}

  <div class="with-rail">
    <section class="sessions" aria-labelledby="sessions-heading">
      <div class="sessions-head">
        <h2 id="sessions-heading">
          Sessions{#if sessions.length}&nbsp;<span>{sessions.length}</span>{/if}
        </h2>
        {#if data.canIngest}
          <a class="btn quiet" href="/campaigns/{data.campaign.id}/ingest"
            ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Upload a
            session</a
          >
        {/if}
      </div>
      {#if sessions.length === 0}
        <p class="empty">No sessions recorded yet.</p>
      {:else}
        <ol>
          {#each shownSessions as session (session.id)}
            <li>
              <a href="/campaigns/{data.campaign.id}/sessions/{session.id}">
                <span class="number">{session.number}</span>
                <span class="session-title">{session.title ?? "Untitled session"}</span>
                {#if session.status !== "done"}
                  <span class="status status-{session.status}">{session.status}</span>
                {/if}
                <span class="session-date">{formatDate(session.startedAt)}</span>
              </a>
            </li>
          {/each}
        </ol>
        {#if !showAll && sessions.length > RECENT_SESSIONS}
          <button class="btn quiet show-all" type="button" onclick={() => (showAll = true)}
            >Show all {sessions.length} sessions</button
          >
        {/if}
      {/if}
    </section>

    <aside class="rail" aria-label="Campaign details">
      <section class="box">
        <h2>Party</h2>
        {#if players.length === 0}
          <p class="empty">No players yet.</p>
        {:else}
          <ul class="party">
            {#each players as player (player.id)}
              {@const page = data.characterPages[player.id]}
              <li>
                <WorldAvatar
                  src={avatarHref(data.campaign.id, page?.avatarId ?? null)}
                  name={player.characterName ?? player.username}
                  kind="character"
                  size="md"
                />
                <span class="who">
                  {#if page && player.characterName}
                    <a class="character" href={worldPageHref(data.campaign.id, page.slug)}
                      >{player.characterName}</a
                    >
                  {:else}
                    <span class="character">{player.characterName ?? player.username}</span>
                  {/if}
                  {#if player.characterName}<span class="muted">{player.username}</span>{/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="box">
        <div class="box-head">
          <h2>World</h2>
          {#if data.world.total > 0}
            <a href="/campaigns/{data.campaign.id}/world">Explore →</a>
          {/if}
        </div>
        {#if data.world.total === 0}
          <p class="empty">
            The world wiki fills in from the session recaps. Its first pages appear after the next
            session finishes.
          </p>
        {:else}
          <div class="world">
            {#each tiles as tile (tile.label)}
              <a class="tile" href="/campaigns/{data.campaign.id}/world?kind={tile.kind}">
                <b>{tile.count}</b><span>{tile.label}</span>
              </a>
            {/each}
          </div>
        {/if}
      </section>

      {#if data.canManage}
        <section class="box">
          <h2>Manage</h2>
          <ul class="manage">
            <li>
              <a href="/campaigns/{data.campaign.id}/members">Members and invites</a>
              <span class="muted">{data.campaign.members.length}</span>
            </li>
            <li><a href="/campaigns/{data.campaign.id}/schedule">Schedule and recaps</a></li>
            <li><a href="/campaigns/{data.campaign.id}/settings">Campaign settings</a></li>
          </ul>
        </section>
      {/if}
    </aside>
  </div>
</div>

<style>
  .byline {
    margin: 0.2rem 0 0;
    color: var(--ink-soft);
  }
  .byline span {
    color: var(--ink);
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  h2 span {
    font-weight: 400;
    color: var(--ink-soft);
  }
  .sessions-head {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .btn.quiet svg {
    width: 0.9rem;
    height: 0.9rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .sessions ol {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sessions li a {
    display: grid;
    grid-template-columns: 2.5rem minmax(0, 1fr) auto auto;
    gap: 0.9rem;
    align-items: center;
    padding: 0.55rem 0.8rem;
    color: var(--ink);
    border: 1px solid transparent;
    border-radius: 6px;
  }
  .sessions li a:hover {
    color: var(--ink);
    text-decoration: none;
    background: var(--surface-sunken);
    border-color: var(--edge);
  }
  .number {
    font-family: var(--font-display);
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--gold);
  }
  .session-title {
    overflow: hidden;
    font-family: var(--font-display);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .session-date {
    grid-column: 4;
    font-size: 0.92rem;
    white-space: nowrap;
    color: var(--ink-soft);
  }
  .status {
    font-family: var(--font-display);
    font-size: 0.62rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--warn);
    background: var(--warn-soft);
    border-radius: 999px;
    padding: 0.12rem 0.55rem;
  }
  .status-failed {
    color: var(--accent-bright);
    background: color-mix(in srgb, var(--accent-bright) 14%, transparent);
  }
  .show-all {
    margin-top: 0.6rem;
  }
  .party {
    display: grid;
    gap: 0.7rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .party li {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  .who {
    display: grid;
    min-width: 0;
    line-height: 1.3;
  }
  .who .muted {
    font-size: 0.92rem;
  }
  .character {
    font-weight: 600;
  }
  .box-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .box-head a {
    font-size: 0.95rem;
  }
  .box .empty {
    margin: 0;
    font-size: 0.95rem;
  }
  .manage {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--edge);
    border-radius: 4px;
    background: var(--surface);
  }
  .manage li {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.45rem 0.75rem;
    border-bottom: 1px solid var(--edge);
  }
  .manage li:last-child {
    border-bottom: 0;
  }
  .world {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }
  .tile {
    display: grid;
    padding: 0.45rem 0.75rem;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
  }
  .tile:hover {
    color: var(--ink);
    text-decoration: none;
    border-color: var(--gold);
  }
  .tile b {
    font-family: var(--font-display);
    font-size: 1.25rem;
    line-height: 1.3;
    color: var(--accent);
  }
  .tile span {
    font-size: 0.88rem;
    color: var(--ink-soft);
  }
  @container (max-width: 560px) {
    .sessions li a {
      grid-template-columns: 2rem minmax(0, 1fr) auto;
      gap: 0.2rem 0.7rem;
    }
    .session-title {
      white-space: normal;
    }
    .session-date {
      grid-column: 2 / -1;
    }
  }
</style>
