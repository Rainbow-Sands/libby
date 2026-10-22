<script lang="ts">
  import type { Snippet } from "svelte";
  import type { LayoutData } from "./$types";
  import { page } from "$app/state";
  import AskLibby from "$lib/components/AskLibby.svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import "../app.css";

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  // Ask Libby belongs to a campaign, so it appears on every page inside one.
  const campaignId = $derived(page.route.id?.startsWith("/campaigns/[id]") ? page.params.id : null);
</script>

<header>
  <div class="bar">
    <a href="/" class="brand">Libby</a>
    <nav>
      {#if data.user && campaignId}
        {#key campaignId}
          <AskLibby {campaignId} />
        {/key}
      {/if}
      {#if data.user}
        <span class="who">{data.user.username}</span>
        <a class="navlink" href="/auth/logout">Log out</a>
      {:else}
        <a class="navlink" href="/auth/login">Log in</a>
      {/if}
      <ThemeToggle />
    </nav>
  </div>
</header>

<main>
  {@render children()}
</main>

<style>
  header {
    background: var(--surface);
    border-bottom: 3px double var(--accent);
    box-shadow: 0 2px 10px var(--shadow);
  }
  /* Lines up with main's content edges. */
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.5rem;
    align-items: center;
    justify-content: space-between;
    max-width: 1040px;
    margin: 0 auto;
    padding: 0.85rem 1.5rem;
  }
  .brand {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.4rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .brand:hover {
    text-decoration: none;
    color: var(--accent-bright);
  }
  nav {
    display: flex;
    gap: 1.1rem;
    align-items: center;
  }
  .who {
    color: var(--ink-soft);
    font-style: italic;
  }
  .navlink {
    font-family: var(--font-display);
    font-size: 0.85rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  main {
    max-width: 1040px;
    margin: 0 auto;
    padding: 1.75rem 1.5rem 4rem;
  }
</style>
