<script lang="ts">
  import type { PageData } from "./$types";
  import TaperedRule from "$lib/components/TaperedRule.svelte";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Libby</title></svelte:head>

{#if data.campaigns.length === 0}
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
        <a class="title" href="/campaigns/{campaign.id}">{campaign.name}</a>
        <span class="role">{campaign.role}</span>
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
    gap: 0.75rem;
  }
  .campaigns li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--surface);
    border: 1px solid var(--edge);
    border-left: 4px solid var(--accent);
    border-radius: 4px;
    padding: 0.9rem 1.2rem;
    box-shadow: 0 3px 10px var(--shadow);
  }
  .campaigns .title {
    font-family: var(--font-display);
    font-size: 1.15rem;
    color: var(--accent);
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
