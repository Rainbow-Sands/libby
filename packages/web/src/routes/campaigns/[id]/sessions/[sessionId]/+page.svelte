<script lang="ts">
  import { marked } from "marked";
  import type { ActionData, PageData } from "./$types";
  import { page } from "$app/state";
  import { invalidateAll } from "$app/navigation";
  import { onMount, tick } from "svelte";
  import Breadcrumbs from "$lib/components/Breadcrumbs.svelte";
  import TaperedRule from "$lib/components/TaperedRule.svelte";
  import SessionRecap from "$lib/components/SessionRecap.svelte";
  import WorldChanges from "$lib/components/WorldChanges.svelte";
  import { speakerHue } from "$lib/speakers";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  type SessionTab = "recap" | "world" | "transcript";
  type Neighbour = NonNullable<NonNullable<PageData["sequence"]>["previous"]>;
  type TranscriptTurn = NonNullable<PageData["transcriptTurns"]>[number];
  type SessionStatus = PageData["session"]["status"];
  interface LiveTranscriptSnippet extends TranscriptTurn {
    id: string;
  }

  let streamedStatus = $state<SessionStatus | null>(null);
  let liveTranscriptSnippets = $state<LiveTranscriptSnippet[]>([]);
  let sessionStatus = $derived(streamedStatus ?? data.session.status);
  let transcriptTurns = $derived(
    data.transcriptTurns?.length ? data.transcriptTurns : liveTranscriptSnippets,
  );

  function sessionTab(value: string | null): SessionTab {
    return value === "transcript" || value === "world" ? value : "recap";
  }

  let activeTab = $derived(sessionTab(page.url.searchParams.get("tab")));
  // Regenerating waits until the session is no longer being processed.
  let busy = $derived(["recording", "transcribing", "summarizing"].includes(data.session.status));

  // Recap citations link to "?tab=transcript#at-<seconds>", an elapsed offset
  // from the first utterance, matching the markers the model cited. Highlight
  // the last turn that started at or before it.
  let citedTurn = $derived.by(() => {
    const match = /^#at-(\d+)$/.exec(page.url.hash);
    if (!match || activeTab !== "transcript" || transcriptTurns.length === 0) return null;
    const startMs = new Date(transcriptTurns[0].timestamp).getTime();
    const targetMs = startMs + Number(match[1]) * 1000;
    const index = transcriptTurns.findLastIndex(
      (turn) => new Date(turn.timestamp).getTime() <= targetMs,
    );
    return Math.max(index, 0);
  });

  $effect(() => {
    const index = citedTurn;
    if (index === null) return;
    void tick().then(() =>
      document.getElementById(`turn-${index}`)?.scrollIntoView({ block: "center" }),
    );
  });

  function formatDate(d: Date | string): string {
    return new Date(d).toLocaleString("en-CA", {
      dateStyle: "long",
      timeStyle: "short",
    });
  }

  function renderMarkdown(text: string): string {
    return marked(text) as string;
  }

  function formatTranscriptTime(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Unknown time";
    return date.toLocaleTimeString("en-CA", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function speakerInitial(speaker: string): string {
    return speaker.trim().charAt(0).toLocaleUpperCase() || "?";
  }

  function transcriptSpeakers(turns: TranscriptTurn[]): TranscriptTurn[] {
    return [...new Map(turns.map((turn) => [turn.userId, turn])).values()];
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

  onMount(() => {
    if (!data.canViewDetails || ["done", "failed"].includes(data.session.status)) return;

    const source = new EventSource(
      `/campaigns/${data.session.campaignId}/sessions/${data.session.id}/transcript/events`,
    );
    source.addEventListener("snippet", (event) => {
      const snippet = JSON.parse((event as MessageEvent<string>).data) as LiveTranscriptSnippet;
      liveTranscriptSnippets = [
        ...liveTranscriptSnippets.filter((candidate) => candidate.id !== snippet.id),
        snippet,
      ].toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
    });
    source.addEventListener("status", (event) => {
      const update = JSON.parse((event as MessageEvent<string>).data) as {
        status: SessionStatus | null;
      };
      streamedStatus = update.status;
    });
    source.addEventListener("complete", (event) => {
      const update = JSON.parse((event as MessageEvent<string>).data) as {
        status: SessionStatus | null;
      };
      streamedStatus = update.status;
      source.close();
      if (update.status === "done") void invalidateAll();
    });

    return () => source.close();
  });
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
      <h1>{data.session.title ?? formatDate(data.session.startedAt)}</h1>
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
  {#if sessionStatus && sessionStatus !== "done"}
    <p class="status"><span class="pill status-{sessionStatus}">{sessionStatus}</span></p>
  {/if}

  {#if data.canViewDetails}
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
      {#if transcriptTurns.length}
        {@const speakers = transcriptSpeakers(transcriptTurns)}
        <section class="transcript-view" aria-label="Session transcript">
          <header class="transcript-header">
            <div>
              <p class="eyebrow">Recorded Dialogue</p>
              <h2>Table Transcript</h2>
              <p class="transcript-note">
                Machine-generated from the session audio. Names and wording may contain errors.
              </p>
            </div>
            <div class="transcript-stats" aria-label="Transcript statistics">
              <span>{transcriptTurns.length} speaker turns</span>
              <span>{speakers.length} voices</span>
            </div>
          </header>

          <div class="speaker-key" aria-label="Speakers in this transcript">
            {#each speakers as speaker (speaker.userId)}
              <span class="speaker-chip" style={`--speaker-hue: ${speakerHue(speaker.userId)}`}>
                <span class="speaker-dot" aria-hidden="true"></span>
                <strong>{speaker.speaker}</strong>
                {#if speaker.characterName}
                  <span>as {speaker.characterName}</span>
                {/if}
              </span>
            {/each}
          </div>

          <ol class="transcript-list">
            {#each transcriptTurns as turn, index (`${turn.timestamp}-${turn.userId}-${index}`)}
              <li
                id="turn-{index}"
                class="transcript-turn"
                class:cited={citedTurn === index}
                style={`--speaker-hue: ${speakerHue(turn.userId)}`}
              >
                <div class="speaker-avatar" aria-hidden="true">
                  {speakerInitial(turn.speaker)}
                </div>
                <div class="turn-content">
                  <div class="turn-meta">
                    <strong>{turn.speaker}</strong>
                    {#if turn.characterName}
                      <span class="character-name">as {turn.characterName}</span>
                    {/if}
                    <time datetime={turn.timestamp} title={formatDate(turn.timestamp)}>
                      {formatTranscriptTime(turn.timestamp)}
                    </time>
                  </div>
                  <p class="turn-text">{turn.text}</p>
                </div>
              </li>
            {/each}
          </ol>
        </section>
      {:else}
        <p class="empty">
          {sessionStatus === "recording" || sessionStatus === "closing" || sessionStatus === "transcribing"
            ? "Listening for transcription snippets…"
            : "Not yet available."}
        </p>
      {/if}
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
  .transcript-view {
    margin-top: 0.75rem;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 4px;
    overflow: hidden;
  }
  .transcript-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 1.25rem 1.4rem;
    background: linear-gradient(135deg, var(--surface), var(--surface-sunken));
    border-bottom: 1px solid var(--edge);
  }
  .transcript-header .eyebrow {
    margin-bottom: 0.2rem;
  }
  .transcript-header h2 {
    margin: 0;
  }
  .transcript-note {
    max-width: 38rem;
    margin: 0.4rem 0 0;
    color: var(--ink-soft);
    font-size: 0.95rem;
    line-height: 1.45;
  }
  .transcript-stats {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.4rem;
    flex: 0 0 auto;
  }
  .transcript-stats span {
    padding: 0.25rem 0.55rem;
    font-family: var(--font-display);
    font-size: 0.66rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 999px;
  }
  .speaker-key {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    padding: 0.8rem 1.4rem;
    background: var(--surface);
    border-bottom: 1px solid var(--edge);
  }
  .speaker-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.22rem 0.55rem;
    font-size: 0.82rem;
    color: var(--ink-soft);
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 999px;
  }
  .speaker-chip strong {
    color: var(--ink);
    font-weight: 600;
  }
  .speaker-dot {
    width: 0.55rem;
    height: 0.55rem;
    background: hsl(var(--speaker-hue) 48% 42%);
    border-radius: 50%;
  }
  .transcript-list {
    margin: 0;
    padding: 0.35rem 1.4rem;
    list-style: none;
  }
  .transcript-turn {
    display: grid;
    grid-template-columns: 2.35rem minmax(0, 1fr);
    gap: 0.85rem;
    padding: 1rem 0;
  }
  .transcript-turn.cited {
    margin: 0 -0.6rem;
    padding: 1rem 0.6rem;
    background: color-mix(in srgb, var(--gold) 14%, transparent);
    border-radius: 4px;
  }
  .transcript-turn + .transcript-turn {
    border-top: 1px solid color-mix(in srgb, var(--edge) 68%, transparent);
  }
  .speaker-avatar {
    display: grid;
    place-items: center;
    width: 2.35rem;
    height: 2.35rem;
    font-family: var(--font-display);
    font-size: 0.88rem;
    font-weight: 600;
    color: #fff;
    background: color-mix(in srgb, hsl(var(--speaker-hue) 48% 42%) 72%, #2b2018);
    border: 1px solid color-mix(in srgb, hsl(var(--speaker-hue) 48% 42%) 60%, var(--edge));
    border-radius: 24%;
    box-shadow: 0 1px 3px var(--shadow);
  }
  .turn-content {
    min-width: 0;
    padding-left: 0.85rem;
    border-left: 2px solid hsl(var(--speaker-hue) 42% 48%);
  }
  .turn-meta {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.35rem;
    line-height: 1.2;
  }
  .turn-meta strong {
    color: var(--ink);
    font-family: var(--font-display);
    font-size: 0.92rem;
    letter-spacing: 0.015em;
  }
  .character-name {
    color: var(--gold);
    font-size: 0.9rem;
    font-style: italic;
  }
  .turn-meta time {
    margin-left: auto;
    color: var(--ink-soft);
    font-family: var(--font-mono);
    font-size: 0.72rem;
    white-space: nowrap;
  }
  .turn-text {
    margin: 0.38rem 0 0;
    color: var(--ink);
    font-size: 1.02rem;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  @container (max-width: 640px) {
    .transcript-header {
      flex-direction: column;
      gap: 0.8rem;
      padding: 1rem;
    }
    .transcript-stats {
      justify-content: flex-start;
    }
    .speaker-key {
      padding: 0.7rem 1rem;
    }
    .transcript-list {
      padding: 0.25rem 0.9rem;
    }
    .transcript-turn {
      grid-template-columns: 2rem minmax(0, 1fr);
      gap: 0.65rem;
    }
    .speaker-avatar {
      width: 2rem;
      height: 2rem;
    }
    .turn-content {
      padding-left: 0.65rem;
    }
    .turn-meta time {
      width: 100%;
      margin-left: 0;
    }
  }
</style>
