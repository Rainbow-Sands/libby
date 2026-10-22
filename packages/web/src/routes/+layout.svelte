<script lang="ts">
  import type { Snippet } from "svelte";
  import type { LayoutData } from "./$types";
  import { page } from "$app/state";
  import AskLibby from "$lib/components/AskLibby.svelte";
  import { askLibby } from "$lib/ask-libby.svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import "../app.css";

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  // Ask Libby belongs to a campaign, so it appears on every page inside one.
  const campaignId = $derived(page.route.id?.startsWith("/campaigns/[id]") ? page.params.id : null);

  // The header stays on screen, so Ask Libby's pane and in-page jumps start
  // below it.
  // The border box, unrounded, so the pane lines up exactly with its edge.
  let headerBox = $state<ResizeObserverSize[]>();
  const headerHeight = $derived(headerBox?.[0]?.blockSize ?? 0);
  $effect(() => {
    document.documentElement.style.setProperty("--header-height", `${headerHeight}px`);
  });
</script>

<header bind:borderBoxSize={headerBox}>
  <div class="bar">
    <a href="/" class="brand">Libby</a>
    <nav>
      {#if data.user && campaignId}
        <button
          class="ask"
          type="button"
          aria-expanded={askLibby.open}
          onclick={() => (askLibby.open = !askLibby.open)}>Ask Libby</button
        >
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

<!-- The page column is a size container, so pages lay themselves out by the
     width they get, which shrinks while Ask Libby's pane is open beside them. -->
<div class="app">
<main class="column">
  {@render children()}
</main>
{#if data.user && campaignId}
  {#key campaignId}
    <AskLibby {campaignId} />
  {/key}
{/if}
</div>

<style>
  .app {
    display: flex;
    align-items: flex-start;
  }
  .column {
    flex: 1;
    min-width: 0;
    container-type: inline-size;
  }
  .ask {
    font-family: var(--font-display);
    font-size: 0.85rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--surface);
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 0.3rem 0.75rem;
    cursor: pointer;
  }
  .ask:hover {
    background: var(--accent-bright);
  }
  .ask[aria-expanded="true"] {
    box-shadow: 0 0 0 2px var(--gold);
  }
  .ask:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 40;
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
