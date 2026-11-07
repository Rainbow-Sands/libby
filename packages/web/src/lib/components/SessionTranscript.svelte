<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { page } from "$app/state";
  import type { SessionStatus } from "@rainbot/db";
  import { speakerHue } from "$lib/speakers";
  import {
    lineKey,
    type TranscriptLine,
    type TranscriptLinesEvent,
    type TranscriptLinesResponse,
    type TranscriptStats,
  } from "$lib/transcript";

  let {
    campaignId,
    sessionId,
    active,
    status,
    onstatus,
    oncomplete,
  }: {
    campaignId: string;
    sessionId: string;
    // The transcript tab is open; lines load only then.
    active: boolean;
    status: SessionStatus | null;
    onstatus: (status: SessionStatus | null) => void;
    oncomplete: (status: SessionStatus | null) => void;
  } = $props();

  interface Turn {
    id: string;
    timestamp: string;
    userId: string;
    speaker: string;
    characterName: string | null;
    text: string;
  }

  const base = $derived(`/campaigns/${campaignId}/sessions/${sessionId}/transcript`);
  // Lines this close to the edge of the viewport load the next page.
  const PRELOAD_MARGIN = "800px 0px";
  // Within this distance of the end of the transcript counts as "at the bottom".
  const FOLLOW_SLACK = 120;

  // The loaded window of lines, sorted by when they were said.
  let lines = $state<TranscriptLine[]>([]);
  let hasBefore = $state(false);
  let hasAfter = $state(false);
  let stats = $state<TranscriptStats>({ turns: 0, speakers: [] });
  let startedAt = $state<string | null>(null);
  let live = $state(false);
  let loaded = $state(false);
  let failed = $state(false);
  let loadingBefore = $state(false);
  let loadingAfter = $state(false);
  // At the newest lines, so new ones scroll into view.
  let following = $state(true);
  let unseen = $state(0);

  let list = $state<HTMLOListElement>();
  let topSentinel = $state<HTMLElement>();
  let bottomSentinel = $state<HTMLElement>();
  // Lines the stream sent before the first page arrived.
  let early: TranscriptLine[] = [];
  let source: EventSource | null = null;
  let generation = 0;

  // Consecutive lines from one person read as one turn.
  let turns = $derived.by(() => {
    const result: Turn[] = [];
    for (const line of lines) {
      const previous = result.at(-1);
      if (previous?.userId === line.userId) {
        previous.text += ` ${line.text}`;
        continue;
      }
      result.push({ ...line });
    }
    return result;
  });

  // Recap and world citations link to "#at-<seconds>", counted from the
  // session's first line. Highlight the last turn that started by then, once
  // the loaded window reaches that far back.
  let citedSeconds = $derived.by(() => {
    const match = /^#at-(\d+)$/.exec(page.url.hash);
    return match ? Number(match[1]) : null;
  });
  let citedTurn = $derived.by(() => {
    if (citedSeconds === null || !startedAt || turns.length === 0) return null;
    const targetMs = new Date(startedAt).getTime() + citedSeconds * 1000;
    if (hasBefore && new Date(turns[0].timestamp).getTime() > targetMs) return null;
    return turns.findLast((turn) => new Date(turn.timestamp).getTime() <= targetMs)?.id ?? null;
  });

  // Streamed lines outside the loaded window would leave a gap; the page
  // that reaches them loads them instead.
  function within(range: TranscriptLine[], before: boolean, after: boolean) {
    const first = range[0] ? lineKey(range[0]) : null;
    const last = range.at(-1) ? lineKey(range.at(-1)!) : null;
    return (line: TranscriptLine) => {
      const key = lineKey(line);
      return (!before || (first !== null && key >= first)) && (!after || (last !== null && key <= last));
    };
  }

  function merge(current: TranscriptLine[], incoming: TranscriptLine[]): TranscriptLine[] {
    const byId = new Map(current.map((line) => [line.id, line]));
    for (const line of incoming) byId.set(line.id, line);
    return [...byId.values()].toSorted((a, b) => lineKey(a).localeCompare(lineKey(b)));
  }

  async function fetchLines(query: string): Promise<TranscriptLinesResponse | null> {
    const response = await fetch(`${base}/lines${query ? `?${query}` : ""}`);
    if (!response.ok) throw new Error(`Transcript request failed: ${response.status}`);
    return (await response.json()) as TranscriptLinesResponse;
  }

  function apply(result: TranscriptLinesResponse) {
    stats = result.stats;
    startedAt = result.startedAt;
    live = result.live;
  }

  function turnElement(id: string): HTMLElement | null {
    return list?.querySelector<HTMLElement>(`[data-turn="${CSS.escape(id)}"]`) ?? null;
  }

  function headerOffset(): number {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) || 0;
  }

  // Changes above the viewport would push what you are reading down; keep
  // the first visible turn where it is.
  async function keepPosition(change: () => void) {
    const top = headerOffset();
    const anchor = [...(list?.children ?? [])].find(
      (element) => element.getBoundingClientRect().bottom > top,
    );
    const before = anchor?.getBoundingClientRect().top;
    change();
    await tick();
    if (anchor?.isConnected && before !== undefined) {
      window.scrollBy(0, anchor.getBoundingClientRect().top - before);
    }
  }

  function scrollToEnd() {
    const last = list?.lastElementChild;
    last?.scrollIntoView({ block: "end" });
    following = true;
    unseen = 0;
  }

  function updateFollowing() {
    if (!list || hasAfter) {
      following = false;
      return;
    }
    following = list.getBoundingClientRect().bottom <= window.innerHeight + FOLLOW_SLACK;
    if (following) unseen = 0;
  }

  // Replace the loaded window: the start, the newest lines, or the stretch
  // around a cited moment.
  async function load(query: string, after: "top" | "end" | "cited") {
    const run = ++generation;
    failed = false;
    try {
      const result = await fetchLines(query);
      if (!result || run !== generation) return;
      apply(result);
      lines = merge(
        result.lines,
        early.filter(within(result.lines, result.hasBefore, result.hasAfter)),
      );
      early = [];
      hasBefore = result.hasBefore;
      hasAfter = result.hasAfter;
      loaded = true;
      unseen = 0;
      if (live && !source) connect(result.cursor);
      await tick();
      if (after === "end") scrollToEnd();
      else if (after === "cited" && citedTurn) {
        turnElement(citedTurn)?.scrollIntoView({ block: "center" });
      }
      updateFollowing();
    } catch (error) {
      console.error(error);
      if (run === generation) failed = true;
    }
  }

  async function loadBefore() {
    const first = lines[0];
    if (!first || loadingBefore || !hasBefore) return;
    loadingBefore = true;
    const run = generation;
    try {
      const result = await fetchLines(`before=${encodeURIComponent(lineKey(first))}`);
      if (!result || run !== generation) return;
      apply(result);
      await keepPosition(() => {
        lines = merge(lines, result.lines);
        hasBefore = result.hasBefore;
      });
    } catch (error) {
      console.error(error);
    } finally {
      loadingBefore = false;
    }
  }

  async function loadAfter() {
    const last = lines.at(-1);
    if (!last || loadingAfter || !hasAfter) return;
    loadingAfter = true;
    const run = generation;
    try {
      const result = await fetchLines(`after=${encodeURIComponent(lineKey(last))}`);
      if (!result || run !== generation) return;
      apply(result);
      lines = merge(lines, result.lines);
      hasAfter = result.hasAfter;
      await tick();
      updateFollowing();
    } catch (error) {
      console.error(error);
    } finally {
      loadingAfter = false;
    }
  }

  function jumpToLatest() {
    if (hasAfter) void load("end", "end");
    else scrollToEnd();
  }

  async function receive(event: TranscriptLinesEvent) {
    stats = event.stats;
    if (!loaded) {
      early = [...early, ...event.lines];
      return;
    }
    const last = lines.at(-1);
    const fits = event.lines.filter(within(lines, hasBefore, hasAfter));
    const wasFollowing = following && !hasAfter;
    if (wasFollowing) {
      lines = merge(lines, fits);
      await tick();
      scrollToEnd();
      return;
    }
    const newest = last ? lineKey(last) : "";
    unseen += event.lines.filter((line) => lineKey(line) > newest).length;
    await keepPosition(() => {
      lines = merge(lines, fits);
    });
  }

  function connect(since: string | null) {
    if (source || status === "done" || status === "failed") return;
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    source = new EventSource(`${base}/events${query}`);
    source.addEventListener("lines", (event) => {
      void receive(JSON.parse((event as MessageEvent<string>).data) as TranscriptLinesEvent);
    });
    source.addEventListener("status", (event) => {
      const update = JSON.parse((event as MessageEvent<string>).data) as {
        status: SessionStatus | null;
      };
      onstatus(update.status);
    });
    source.addEventListener("complete", (event) => {
      const update = JSON.parse((event as MessageEvent<string>).data) as {
        status: SessionStatus | null;
      };
      source?.close();
      live = false;
      unseen = 0;
      oncomplete(update.status);
    });
  }

  onMount(() => {
    // Status updates matter on every tab, so the stream opens right away
    // unless the transcript tab will open it with its first page's cursor.
    if (!active) connect(null);
    // The browser's own scroll anchoring would pin whatever sits below the
    // transcript (even the loading row) while pages are added above it, and
    // keep loading forever. keepPosition() does the anchoring instead.
    const root = document.documentElement;
    const anchoring = root.style.overflowAnchor;
    root.style.overflowAnchor = "none";
    const onScroll = () => updateFollowing();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      root.style.overflowAnchor = anchoring;
      source?.close();
    };
  });

  // Open the tab at the cited moment, the newest lines while live, or the
  // start; a new citation link reloads around its moment.
  $effect(() => {
    const seconds = citedSeconds;
    if (!active) return;
    untrack(() => {
      if (seconds !== null) void load(`at=${seconds}`, "cited");
      else if (!loaded) {
        const recording = status === "recording" || status === "closing" || status === "transcribing";
        void load(recording ? "end" : "", recording ? "end" : "top");
      }
    });
  });

  $effect(() => {
    // Rebuilt after every page, so a sentinel still in range loads the next.
    void lines.length;
    const targets = [hasBefore ? topSentinel : null, hasAfter ? bottomSentinel : null].filter(
      (target): target is HTMLElement => Boolean(target),
    );
    if (!active || targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.target === topSentinel) void loadBefore();
          else void loadAfter();
        }
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  });

  function formatDate(d: string): string {
    return new Date(d).toLocaleString("en-CA", { dateStyle: "long", timeStyle: "short" });
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
</script>

{#if turns.length}
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
        <span>{stats.turns.toLocaleString("en-CA")} speaker turns</span>
        <span>{stats.speakers.length} voices</span>
      </div>
    </header>

    <div class="speaker-key" aria-label="Speakers in this transcript">
      {#each stats.speakers as speaker (speaker.userId)}
        <span class="speaker-chip" style={`--speaker-hue: ${speakerHue(speaker.userId)}`}>
          <span class="speaker-dot" aria-hidden="true"></span>
          <strong>{speaker.speaker}</strong>
          {#if speaker.characterName}
            <span>as {speaker.characterName}</span>
          {/if}
        </span>
      {/each}
    </div>

    {#if hasBefore}
      <p class="loading" bind:this={topSentinel} aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        Loading earlier dialogue…
      </p>
    {/if}
    <ol class="transcript-list" bind:this={list}>
      {#each turns as turn (turn.id)}
        <li
          data-turn={turn.id}
          class="transcript-turn"
          class:cited={citedTurn === turn.id}
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
    {#if hasAfter}
      <p class="loading after" bind:this={bottomSentinel} aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        Loading more dialogue…
      </p>
    {/if}
    {#if live && !following && (unseen > 0 || hasAfter)}
      <div class="jump">
        <button type="button" onclick={jumpToLatest}>
          {unseen > 0 ? `${unseen} new ${unseen === 1 ? "line" : "lines"} · ` : ""}Jump to latest
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
        </button>
      </div>
    {/if}
  </section>
{:else if failed}
  <p class="empty">
    The transcript could not be loaded.
    <button type="button" class="retry" onclick={() => location.reload()}>Try again</button>
  </p>
{:else}
  <p class="empty">
    {#if !loaded}
      Loading the transcript…
    {:else if status === "recording" || status === "closing" || status === "transcribing"}
      Listening for transcription snippets…
    {:else}
      Not yet available.
    {/if}
  </p>
{/if}

<style>
  .transcript-view {
    margin-top: 0.75rem;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 4px;
    /* clip, not hidden: hidden would trap the sticky jump button. */
    overflow: clip;
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
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin: 0 1.4rem;
    padding: 0.8rem 0;
    color: var(--ink-soft);
    font-style: italic;
    border-bottom: 1px dashed var(--edge);
  }
  .loading.after {
    border-top: 1px dashed var(--edge);
    border-bottom: 0;
  }
  .spinner {
    width: 0.9rem;
    height: 0.9rem;
    border: 2px solid var(--edge);
    border-top-color: var(--gold);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
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
    scroll-margin-top: calc(var(--header-height, 0px) + 1rem);
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
  /* Zero height, so showing it never moves the transcript. */
  .jump {
    position: sticky;
    bottom: 1rem;
    height: 0;
    display: flex;
    justify-content: center;
  }
  .jump button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
    padding: 0 1.1rem;
    transform: translateY(-100%);
    font-family: var(--font-display);
    font-size: 0.82rem;
    letter-spacing: 0.04em;
    color: var(--surface);
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 999px;
    box-shadow: 0 3px 10px var(--shadow);
    cursor: pointer;
  }
  .jump button:hover {
    background: var(--accent-bright);
  }
  .jump button:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  .jump svg {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .retry {
    margin-left: 0.4rem;
    font: inherit;
    color: var(--link);
    background: none;
    border: 0;
    text-decoration: underline;
    cursor: pointer;
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
    .loading {
      margin: 0 0.9rem;
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
