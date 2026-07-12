<script lang="ts">
  import type { PageData } from "./$types";
  import TaperedRule from "$lib/components/TaperedRule.svelte";

  let { data }: { data: PageData } = $props();

  const dm = $derived(data.campaign.members.find((m) => m.role === "dm"));
  const players = $derived(data.campaign.members.filter((m) => m.role !== "dm"));

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
        <li>{player.username}</li>
      {/each}
    </ul>
  {/if}

  <h2>Sessions</h2>
  {#if data.isDm}
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
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 999px;
    padding: 0.3rem 0.9rem;
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
