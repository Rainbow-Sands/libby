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

  function formatDate(d: Date | string): string {
    return new Date(d).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
</script>

<svelte:head><title>{data.campaign.name}</title></svelte:head>

<p><a href="/">← All campaigns</a></p>

<div class="panel">
  <p class="eyebrow">Campaign</p>
  <h1>{data.campaign.name}</h1>
  <TaperedRule />
  {#if data.campaign.description}
    <p>{data.campaign.description}</p>
  {/if}

  <h2>Dungeon Master</h2>
  <p class="lead">{dm ? dm.username : "—"}</p>

  <h2>Party</h2>
  {#if players.length === 0}
    <p class="empty">No players yet.</p>
  {:else}
    <ul class="party">
      {#each players as player (player.id)}
        {@const page = data.characterPages[player.id]}
        <li>
          {#if player.characterName}
            <WorldAvatar
              src={avatarHref(data.campaign.id, page?.avatarId ?? null)}
              name={player.characterName}
              kind="character"
              size="sm"
            />
            {#if page}
              <a class="character" href={worldPageHref(data.campaign.id, page.slug)}
                >{player.characterName}</a
              >
            {:else}
              <span class="character">{player.characterName}</span>
            {/if}
            <span class="muted">· {player.username}</span>
          {:else}
            {player.username}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <h2>World</h2>
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
    <p><a href="/campaigns/{data.campaign.id}/world">Explore the world →</a></p>
  {/if}

  <h2>Sessions</h2>
  {#if data.canIngest}
    <p><a class="button" href="/campaigns/{data.campaign.id}/ingest">Ingest audio session</a></p>
  {/if}
  {#if data.campaign.sessions.length === 0}
    <p class="empty">No sessions recorded yet.</p>
  {:else}
    <ul class="sessions">
      {#each data.campaign.sessions as session (session.id)}
        <li>
          <a href="/campaigns/{data.campaign.id}/sessions/{session.id}">
            <span class="session-title">{session.title ?? formatDate(session.startedAt)}</span>
            {#if session.title}
              <span class="session-date">{formatDate(session.startedAt)}</span>
            {/if}
          </a>
          <span class="status status-{session.status}">{session.status}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .lead {
    font-size: 1.2rem;
  }
  .party {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .party li {
    display: inline-flex;
    gap: 0.45rem;
    align-items: center;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 999px;
    padding: 0.3rem 0.9rem;
  }
  .party li:has(:global(.av)) {
    padding-left: 0.3rem;
  }
  .character {
    font-weight: 600;
  }
  .world {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(6rem, 1fr));
    gap: 0.6rem;
    margin-bottom: 0.75rem;
  }
  .tile {
    display: grid;
    padding: 0.55rem 0.8rem;
    color: var(--ink);
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 4px;
  }
  .tile:hover {
    text-decoration: none;
    border-color: var(--gold);
  }
  .tile b {
    font-family: var(--font-display);
    font-size: 1.3rem;
    color: var(--accent);
  }
  .tile span {
    font-size: 0.88rem;
    color: var(--ink-soft);
  }
  .sessions {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.5rem;
  }
  .sessions li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 4px;
    padding: 0.65rem 1rem;
  }
  .sessions a {
    font-family: var(--font-display);
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .session-date {
    font-family: var(--font-body, inherit);
    font-size: 0.78rem;
    color: var(--ink-soft);
  }
  .status {
    font-family: var(--font-display);
    font-size: 0.62rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-soft);
    border: 1px solid var(--edge);
    border-radius: 999px;
    padding: 0.12rem 0.55rem;
  }
  .status-done {
    color: #2f6b34;
    border-color: #2f6b34;
  }
  .status-failed {
    color: var(--accent-bright);
    border-color: var(--accent-bright);
  }
  .button {
    display: inline-block;
    background: var(--accent);
    color: var(--surface);
    border-radius: 4px;
    padding: 0.5rem 0.8rem;
    font-family: var(--font-display);
  }
</style>
