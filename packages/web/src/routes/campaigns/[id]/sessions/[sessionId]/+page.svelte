<script lang="ts">
  import { marked } from "marked";
  import type { PageData } from "./$types";
  import { page } from "$app/state";
  import TaperedRule from "$lib/components/TaperedRule.svelte";
  import SessionChat from "$lib/components/SessionChat.svelte";

  let { data }: { data: PageData } = $props();

  type SessionTab = "recap" | "summary" | "transcript";

  function sessionTab(value: string | null): SessionTab {
    return value === "summary" || value === "transcript" ? value : "recap";
  }

  let activeTab = $derived(sessionTab(page.url.searchParams.get("tab")));

  function formatDate(d: Date | string): string {
    return new Date(d).toLocaleString("en-CA", {
      dateStyle: "long",
      timeStyle: "short",
    });
  }

  function renderMarkdown(text: string): string {
    return marked(text) as string;
  }
</script>

<svelte:head>
  <title>{data.session.title ?? formatDate(data.session.startedAt)} — Session</title>
  <meta property="og:title" content={data.preview.title}>
  <meta property="og:description" content={data.preview.description}>
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content={data.preview.title}>
  <meta name="twitter:description" content={data.preview.description}>
</svelte:head>

<p><a href="/campaigns/{data.session.campaignId}">← Campaign</a></p>

<div class="panel">
  <p class="eyebrow">A Reflection in the Mirrorways</p>
  <h1>{data.session.title ?? formatDate(data.session.startedAt)}</h1>
  {#if data.session.title}
    <p class="muted session-date">{formatDate(data.session.startedAt)}</p>
  {/if}
  <TaperedRule />
  <p class="muted status">Status: {data.session.status}</p>

  {#if data.canViewDetails}
    {#if data.session.status === "done"}
      <SessionChat
        sessionId={data.session.id}
        campaignId={data.session.campaignId}
      />
    {:else}
      <p class="empty chat-pending">
        Libby can answer questions once this session finishes processing.
      </p>
    {/if}

    <div class="tabs" role="tablist">
      <a
        role="tab"
        href="?tab=recap"
        aria-selected={activeTab === "recap"}
        class:active={activeTab === "recap"}>Recap</a
      >
      <a
        role="tab"
        href="?tab=summary"
        aria-selected={activeTab === "summary"}
        class:active={activeTab === "summary"}>Detailed Record</a
      >
      <a
        role="tab"
        href="?tab=transcript"
        aria-selected={activeTab === "transcript"}
        class:active={activeTab === "transcript"}>Transcript</a
      >
    </div>

    <div role="tabpanel" hidden={activeTab !== "recap"}>
      {#if data.session.recap}
        <div class="prose">{@html renderMarkdown(data.session.recap)}</div>
      {:else}
        <p class="empty">The bards have not yet composed this tale.</p>
      {/if}
    </div>

    <div role="tabpanel" hidden={activeTab !== "summary"}>
      {#if data.session.summary}
        <div class="prose">{@html renderMarkdown(data.session.summary)}</div>
      {:else}
        <p class="empty">Not yet available.</p>
      {/if}
    </div>

    <div role="tabpanel" hidden={activeTab !== "transcript"}>
      {#if data.transcriptText}
        <pre class="transcript">{data.transcriptText}</pre>
      {:else}
        <p class="empty">Not yet available.</p>
      {/if}
    </div>
  {:else}
    <p class="preview-description">{data.preview.description}</p>
    <p class="empty">Log in with Discord to view the complete session.</p>
    <p><a class="button" href="/auth/login">Log in with Discord</a></p>
  {/if}
</div>

<style>
  .session-date {
    margin-top: -0.5rem;
  }
  .status {
    margin-top: -0.5rem;
  }
  .preview-description {
    line-height: 1.7;
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin: 1.25rem 0 0.5rem;
    border-bottom: 1px solid var(--edge);
  }
  .tabs a {
    padding: 0.5rem 1rem;
    font-family: var(--font-display);
    font-size: 1rem;
    color: var(--ink-soft);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    text-decoration: none;
  }
  .tabs a:hover {
    color: var(--ink);
  }
  .tabs a.active {
    color: var(--gold);
    border-bottom-color: var(--gold);
  }
  .prose {
    line-height: 1.7;
  }
  .prose :global(p) {
    margin: 0.75em 0;
  }
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3) {
    font-family: var(--font-display);
    color: var(--gold);
    margin: 1.25em 0 0.5em;
  }
  .prose :global(ul),
  .prose :global(ol) {
    padding-left: 1.5em;
    margin: 0.75em 0;
  }
  .prose :global(li) {
    margin: 0.25em 0;
  }
  .prose :global(strong) {
    color: var(--text-emphasis, var(--gold));
  }
  .prose :global(em) {
    font-style: italic;
  }
  .transcript {
    font-family: var(--font-mono);
    font-size: 0.9rem;
    line-height: 1.5;
    white-space: pre-wrap;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-left: 3px solid var(--gold);
    border-radius: 4px;
    padding: 1rem 1.2rem;
    overflow-x: auto;
  }
</style>
