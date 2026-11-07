<script lang="ts">
  import { marked } from "marked";
  import type { ActionData, PageData } from "./$types";
  import { page } from "$app/state";
  import { goto, invalidateAll } from "$app/navigation";
  import Breadcrumbs from "$lib/components/Breadcrumbs.svelte";
  import TaperedRule from "$lib/components/TaperedRule.svelte";
  import SessionRecap from "$lib/components/SessionRecap.svelte";
  import WorldChanges from "$lib/components/WorldChanges.svelte";
  import SessionTranscript from "$lib/components/SessionTranscript.svelte";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  type SessionTab = "recap" | "world" | "transcript";
  type Neighbour = NonNullable<NonNullable<PageData["sequence"]>["previous"]>;
  type SessionStatus = PageData["session"]["status"];

  let streamedStatus = $state<SessionStatus | null>(null);
  let sessionStatus = $derived(streamedStatus ?? data.session.status);

  function sessionTab(value: string | null): SessionTab {
    return value === "transcript" || value === "world" ? value : "recap";
  }

  let activeTab = $derived(sessionTab(page.url.searchParams.get("tab")));
  // Regenerating waits until the session is no longer being processed.
  let busy = $derived(["recording", "transcribing", "summarizing"].includes(data.session.status));
  // Until the session is done there is no recap or world to show, so the
  // page is just the live transcript, without tabs.
  let inProgress = $derived(
    data.canViewDetails &&
      ["recording", "closing", "transcribing", "summarizing"].includes(data.session.status),
  );
  let voices = $state(0);
  let now = $state(Date.now());

  $effect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  function formatClock(d: Date | string): string {
    return new Date(d).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
  }

  function formatSoFar(from: Date | string): string {
    const minutes = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60_000));
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
  }

  function formatDate(d: Date | string): string {
    return new Date(d).toLocaleString("en-CA", {
      dateStyle: "long",
      timeStyle: "short",
    });
  }

  function renderMarkdown(text: string): string {
    return marked(text) as string;
  }

  function confirmRegeneration(event: SubmitEvent) {
    if (!window.confirm("Regenerate the recap and title from this transcript?")) {
      event.preventDefault();
    }
  }

  function confirmTranscriptRegeneration(event: SubmitEvent) {
    if (
      !window.confirm(
        "Re-transcribe every saved audio clip and regenerate the recap and title?",
      )
    ) {
      event.preventDefault();
    }
  }

  function confirmFailedTranscriptionRetry(event: SubmitEvent) {
    if (
      !window.confirm(
        "Re-transcribe only the failed audio clips and regenerate the recap and title?",
      )
    ) {
      event.preventDefault();
    }
  }

  function onTranscriptComplete(status: SessionStatus | null) {
    streamedStatus = status;
    // Leaving the live page, stay on the transcript you were reading.
    if (inProgress) {
      void goto("?tab=transcript", { replaceState: true, noScroll: true, invalidateAll: true });
    } else if (status === "done") void invalidateAll();
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

{#if data.sequence}
  <Breadcrumbs
    items={[
      { label: data.sequence.campaignName, href: `/campaigns/${data.session.campaignId}` },
      { label: `Session ${data.sequence.number}` },
    ]}
  />
{/if}

{#snippet stepper(target: Neighbour | null, label: string, forward: boolean)}
  {#if target}
    <a
      class="btn quiet step"
      href="/campaigns/{data.session.campaignId}/sessions/{target.id}"
      aria-label="{label}: Session {target.number}"
      title={target.title ?? undefined}
      >{#if !forward}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg
        >{/if}S{target.number}{#if forward}<svg viewBox="0 0 24 24" aria-hidden="true"
          ><path d="M9 6l6 6-6 6" /></svg
        >{/if}</a
    >
  {/if}
{/snippet}

<div class="panel">
  <div class="title-row">
    <div class="title">
      <p class="eyebrow">
        {#if data.sequence}Session {data.sequence.number} ·{/if}
        {formatDate(data.session.startedAt)}
      </p>
      <h1>
        {data.session.title ?? (inProgress ? "Session in progress" : formatDate(data.session.startedAt))}
      </h1>
    </div>
    <div class="actions">
      {#if data.sequence}
        {@render stepper(data.sequence.previous, "Previous", false)}
        {@render stepper(data.sequence.next, "Next", true)}
      {/if}
      {#if data.canViewDetails && data.canRegenerate}
        <details class="manage">
          <summary class="btn quiet step" aria-label="Manage session" title="Manage session"
            ><svg viewBox="0 0 24 24" aria-hidden="true"
              ><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle
                cx="19"
                cy="12"
                r="1.6"
              /></svg
            ></summary
          >
          <div class="menu">
            {#if data.hasTranscript}
              <form method="POST" action="?/regenerate" onsubmit={confirmRegeneration}>
                <button type="submit" disabled={busy}>Regenerate recap and title</button>
              </form>
            {/if}
            <form method="POST" action="?/regenerateTranscript" onsubmit={confirmTranscriptRegeneration}>
              <button type="submit" disabled={busy}>Regenerate transcript</button>
            </form>
            {#if data.failedTranscriptions > 0}
              <form
                method="POST"
                action="?/retryFailedTranscriptions"
                onsubmit={confirmFailedTranscriptionRetry}
              >
                <button type="submit"
                  >Retry {data.failedTranscriptions} failed {data.failedTranscriptions === 1
                    ? "clip"
                    : "clips"}</button
                >
              </form>
            {/if}
          </div>
        </details>
      {/if}
    </div>
  </div>
  <TaperedRule />
  {#if sessionStatus && sessionStatus !== "done" && !inProgress}
    <p class="status"><span class="pill status-{sessionStatus}">{sessionStatus}</span></p>
  {/if}

  {#if inProgress}
    {#if form?.message}
      <p class="error" role="alert">{form.message}</p>
    {/if}
    <div class="live-banner" class:recording={sessionStatus === "recording"}>
      <span class="live-state"
        ><span class="live-dot" aria-hidden="true"></span>{sessionStatus === "recording"
          ? "Recording"
          : sessionStatus === "summarizing"
            ? "Writing the recap"
            : "Transcribing"}</span
      >
      <span class="live-facts">
        Started {formatClock(data.session.startedAt)}
        {#if sessionStatus === "recording"}· {formatSoFar(data.session.startedAt)} so far{/if}
        {#if voices > 0}· {voices} {voices === 1 ? "voice" : "voices"}{/if}
      </span>
      <span class="live-note">
        {sessionStatus === "summarizing"
          ? "The recap and world changes appear here in a few minutes."
          : "The recap and world changes appear here once the session ends."}
      </span>
    </div>
    <SessionTranscript
      campaignId={data.session.campaignId}
      sessionId={data.session.id}
      active
      status={sessionStatus}
      bind:voices
      onstatus={(status) => (streamedStatus = status)}
      oncomplete={onTranscriptComplete}
    />
  {:else if data.canViewDetails}
    {#if form?.message}
      <p class="error" role="alert">{form.message}</p>
    {/if}
    {#if page.url.searchParams.has("regenerating") || sessionStatus === "summarizing"}
      <p class="muted">Regeneration is running. Refresh this page to see its progress.</p>
    {/if}
    {#if page.url.searchParams.has("regeneratingTranscript")}
      <p class="muted">
        Transcript regeneration is running. Refresh this page to see its progress.
      </p>
    {/if}

    <div class="tabs" role="tablist">
      <a
        role="tab"
        href="?tab=recap"
        aria-selected={activeTab === "recap"}
        class:active={activeTab === "recap"}>Recap</a
      >
      {#if data.worldChangeCount !== null}
        <a
          role="tab"
          href="?tab=world"
          aria-selected={activeTab === "world"}
          class:active={activeTab === "world"}
          >World changes{#if data.worldChangeCount}<span class="count"
              >{data.worldChangeCount}</span
            >{/if}</a
        >
      {/if}
      <a
        role="tab"
        href="?tab=transcript"
        aria-selected={activeTab === "transcript"}
        class:active={activeTab === "transcript"}>Transcript</a
      >
    </div>

    <div role="tabpanel" hidden={activeTab !== "recap"}>
      {#if activeTab !== "recap"}
        <!-- Rendered only while open; another tab's load has no world to link. -->
      {:else if data.session.recapSections}
        <SessionRecap
          recap={data.session.recapSections}
          world={data.world}
          links={data.recapLinks}
        />
      {:else if data.session.recap}
        <div class="prose">{@html renderMarkdown(data.session.recap)}</div>
      {:else}
        <p class="empty">The bards have not yet composed this tale.</p>
      {/if}
    </div>

    {#if data.worldChanges}
      <div role="tabpanel" hidden={activeTab !== "world"}>
        <WorldChanges
          changes={data.worldChanges}
          campaignId={data.session.campaignId}
          sessionId={data.session.id}
        />
      </div>
    {/if}

    <div role="tabpanel" hidden={activeTab !== "transcript"}>
      <SessionTranscript
        campaignId={data.session.campaignId}
        sessionId={data.session.id}
        active={activeTab === "transcript"}
        status={sessionStatus}
        recap={data.session.recapSections}
        onstatus={(status) => (streamedStatus = status)}
        oncomplete={onTranscriptComplete}
      />
    </div>
  {:else}
    <p class="preview-description">{data.preview.description}</p>
    <p class="empty">Log in with Discord to view the complete session.</p>
    <p><a class="btn" href="/auth/login">Log in with Discord</a></p>
  {/if}

  {#if data.sequence && (data.sequence.previous || data.sequence.next)}
    <nav class="neighbours" aria-label="Neighbouring sessions">
      {#if data.sequence.previous}
        {@const previous = data.sequence.previous}
        <a href="/campaigns/{data.session.campaignId}/sessions/{previous.id}">
          <span class="eyebrow">← Session {previous.number}</span>
          <span class="neighbour-title">{previous.title ?? "Untitled session"}</span>
        </a>
      {/if}
      {#if data.sequence.next}
        {@const next = data.sequence.next}
        <a class="next" href="/campaigns/{data.session.campaignId}/sessions/{next.id}">
          <span class="eyebrow">Session {next.number} →</span>
          <span class="neighbour-title">{next.title ?? "Untitled session"}</span>
        </a>
      {/if}
    </nav>
  {/if}
</div>

<style>
  .title-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-start;
    justify-content: space-between;
  }
  .title {
    flex: 1 1 28rem;
    min-width: 0;
  }
  .title .eyebrow {
    margin: 0;
  }
  .title h1 {
    margin: 0.25rem 0 0;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .step {
    gap: 0.3rem;
    padding: 0.4rem 0.7rem;
    font-size: 0.78rem;
  }
  .step svg {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .step svg circle {
    fill: currentColor;
    stroke: none;
  }
  .manage {
    position: relative;
  }
  .manage summary {
    list-style: none;
  }
  .manage summary::-webkit-details-marker {
    display: none;
  }
  .menu {
    position: absolute;
    top: calc(100% + 0.35rem);
    right: 0;
    z-index: 20;
    display: grid;
    min-width: 15rem;
    padding: 0.35rem;
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 8px;
    box-shadow: 0 8px 24px var(--shadow);
  }
  .menu form {
    margin: 0;
  }
  /* Once the buttons wrap under the title they sit at the left edge. */
  @container (max-width: 720px) {
    .menu {
      right: auto;
      left: 0;
    }
  }
  .menu button {
    width: 100%;
    padding: 0.5rem 0.7rem;
    font: inherit;
    font-size: 0.98rem;
    text-align: left;
    color: var(--ink);
    cursor: pointer;
    background: none;
    border: 0;
    border-radius: 6px;
  }
  .menu button:hover:not(:disabled) {
    background: var(--surface-sunken);
  }
  .menu button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .status {
    margin: 0 0 0.75rem;
  }
  .pill {
    padding: 0.12rem 0.6rem;
    font-family: var(--font-display);
    font-size: 0.66rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--warn);
    background: var(--warn-soft);
    border-radius: 999px;
  }
  .pill.status-failed {
    color: var(--accent-bright);
    background: color-mix(in srgb, var(--accent-bright) 14%, transparent);
  }
  .live-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.9rem;
    margin: 0 0 0.5rem;
    padding: 0.7rem 1rem;
    background: var(--ok-soft);
    border: 1px solid color-mix(in srgb, var(--ok) 30%, transparent);
    border-radius: 4px;
  }
  .live-state {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-display);
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ok);
  }
  .live-dot {
    width: 0.6rem;
    height: 0.6rem;
    background: currentColor;
    border-radius: 50%;
    box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 22%, transparent);
  }
  .live-banner.recording .live-dot {
    animation: breathe 2s ease-in-out infinite;
  }
  @keyframes breathe {
    50% {
      box-shadow: 0 0 0 7px color-mix(in srgb, currentColor 10%, transparent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .live-banner.recording .live-dot {
      animation: none;
    }
  }
  .live-facts {
    color: var(--ink);
  }
  .live-note {
    margin-left: auto;
    font-size: 0.95rem;
    color: var(--ink-soft);
  }
  .preview-description {
    line-height: 1.7;
  }
  .neighbours {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    justify-content: space-between;
    margin-top: 2rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--edge);
  }
  .neighbours a {
    display: grid;
    gap: 0.1rem;
    max-width: 22rem;
    line-height: 1.3;
  }
  .neighbours a:hover {
    text-decoration: none;
  }
  .neighbours .next {
    margin-left: auto;
    text-align: right;
  }
  .neighbour-title {
    font-family: var(--font-display);
  }
  .error {
    color: var(--accent-bright);
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin: 0.5rem 0 1.5rem;
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
  @container (max-width: 520px) {
    .tabs {
      gap: 0;
    }
    .tabs a {
      padding: 0.5rem 0.5rem;
      font-size: 0.88rem;
      white-space: nowrap;
    }
  }
  .count {
    margin-left: 0.4rem;
    padding: 0 0.45em;
    font-family: var(--font-body);
    font-size: 0.8rem;
    color: var(--ink-soft);
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 999px;
  }
  .prose {
    max-width: 44rem;
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
</style>
