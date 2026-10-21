<script lang="ts">
  import type { PageData } from "./$types";
  import TaperedRule from "$lib/components/TaperedRule.svelte";

  let { data }: { data: PageData } = $props();

  function formatDate(d: Date | string): string {
    return new Date(d).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
</script>

<svelte:head><title>Libby</title></svelte:head>

{#if data.user && data.campaigns.length === 0}
  <div class="panel hero">
    <p class="eyebrow">Keeper of the Mirrorways</p>
    <h1>No campaigns yet</h1>
    <TaperedRule />
    <p class="muted">
      You are not in any campaigns. Ask your Dungeon Master to add you, and they will appear here.
    </p>
  </div>
{:else if data.campaigns.length === 0}
  <div class="panel hero">
    <p class="eyebrow">Keeper of the Mirrorways</p>
    <h1>Welcome, adventurer</h1>
    <TaperedRule />
    <p class="muted">
      Log in with Discord and let Libby draw your campaigns from the mirrorways —
      their sessions, transcripts, and recaps.
    </p>
    <p><a class="btn" href="/auth/login">Log in with Discord</a></p>
  </div>
{:else}
  <p class="eyebrow">From the Mirrorways</p>
  <h1>Campaigns</h1>
  <TaperedRule />
  <ul class="campaigns">
    {#each data.campaigns as campaign (campaign.id)}
      <li>
        <a href="/campaigns/{campaign.id}">
          <span class="head">
            <span class="title">{campaign.name}</span>
            <span class="role">{campaign.role}</span>
          </span>
          <span class="meta">
            {campaign.sessionCount}
            {campaign.sessionCount === 1 ? "session" : "sessions"}{#if campaign.lastPlayedAt}&nbsp;· last played {formatDate(campaign.lastPlayedAt)}{/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .hero {
    text-align: center;
  }
  .hero .btn {
    margin-top: 0.5rem;
  }
  .campaigns {
    list-style: none;
    padding: 0;
    margin: 1rem 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
    gap: 0.9rem;
  }
  .campaigns li {
    display: grid;
  }
  .campaigns a {
    display: grid;
    gap: 0.35rem;
    align-content: start;
    padding: 1.1rem 1.25rem;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-top: 3px solid var(--accent);
    border-radius: 8px;
    box-shadow: 0 3px 10px var(--shadow);
  }
  .campaigns a:hover {
    color: var(--ink);
    text-decoration: none;
    border-color: var(--gold);
    border-top-color: var(--accent-bright);
  }
  .head {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
  }
  .title {
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--accent);
  }
  .meta {
    font-size: 0.95rem;
    color: var(--ink-soft);
  }
  .role {
    font-family: var(--font-display);
    font-size: 0.65rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--gold);
    border: 1px solid var(--gold);
    border-radius: 999px;
    padding: 0.15rem 0.6rem;
  }
</style>
