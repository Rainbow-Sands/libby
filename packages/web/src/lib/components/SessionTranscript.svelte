<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { page } from "$app/state";
  import type { SessionRecap, SessionStatus } from "@rainbot/db";
  import { speakerHue } from "$lib/speakers";
  import {
    formatDuration,
    formatElapsed,
    lineKey,
    parseElapsed,
    splitMatches,
    type TranscriptLine,
    type TranscriptLinesEvent,
    type TranscriptLinesResponse,
    type TranscriptSearchMatch,
    type TranscriptSearchResponse,
    type TranscriptStats,
    type TranscriptTimelineBand,
  } from "$lib/transcript";

  let {
    campaignId,
    sessionId,
    active,
    status,
    recap = null,
    voices = $bindable(0),
    onstatus,
    oncomplete,
  }: {
    campaignId: string;
    sessionId: string;
    // The transcript is showing; lines load only then.
    active: boolean;
    status: SessionStatus | null;
    // The finished session's recap, for epic moments and timeline markers.
    recap?: SessionRecap | null;
    // How many people have spoken, for the live page's banner.
    voices?: number;
    onstatus: (status: SessionStatus | null) => void;
    oncomplete: (status: SessionStatus | null) => void;
  } = $props();

  interface Turn {
    id: string;
    timestamp: string;
    // Seconds since the session's first line.
    seconds: number;
    userId: string;
    speaker: string;
    characterName: string | null;
    text: string;
    // Sort keys of the lines that make up the turn.
    keys: string[];
  }

  type Row =
    | { kind: "turn"; id: string; turn: Turn }
    | { kind: "divider"; id: string; label: string }
    | { kind: "moment"; id: string; text: string };

  interface Marker {
    kind: "Thread" | "Loot" | "Epic" | "Ruling";
    label: string;
    seconds: number;
  }

  const base = $derived(`/campaigns/${campaignId}/sessions/${sessionId}/transcript`);
  // Lines this close to the edge of the viewport load the next page.
  const PRELOAD_MARGIN = "800px 0px";
  // Within this distance of the end of the transcript counts as "at the bottom".
  const FOLLOW_SLACK = 120;
  // A divider marks each half hour of a finished session.
  const DIVIDER_SECONDS = 30 * 60;
  const SEARCH_DELAY_MS = 250;

  // The loaded window of lines, sorted by when they were said.
  let lines = $state<TranscriptLine[]>([]);
  let hasBefore = $state(false);
  let hasAfter = $state(false);
  let stats = $state<TranscriptStats>({ turns: 0, speakers: [] });
  let startedAt = $state<string | null>(null);
  let durationSeconds = $state(0);
  let dmUserId = $state<string | null>(null);
  let timeline = $state<TranscriptTimelineBand[] | null>(null);
  let live = $state(false);
  let loaded = $state(false);
  let failed = $state(false);
  let loadingBefore = $state(false);
  let loadingAfter = $state(false);
  // At the newest lines, so new ones scroll into view.
  let following = $state(true);
  let unseen = $state(0);
  // Seconds into the session at the top of the viewport, for the timeline.
  let position = $state(0);
  // The turn whose link was just copied.
  let copied = $state<string | null>(null);

  // The find bar: what is typed, and the matches for what was last searched.
  let findText = $state("");
  let search = $state<{ query: string; matches: TranscriptSearchMatch[]; total: number } | null>(
    null,
  );
  let matchIndex = $state(-1);
  let searching = $state(false);
  let searchRun = 0;

  let list = $state<HTMLOListElement>();
  let findBar = $state<HTMLElement>();
  let topSentinel = $state<HTMLElement>();
  let bottomSentinel = $state<HTMLElement>();
  // Lines the stream sent before the first page arrived.
  let early: TranscriptLine[] = [];
  let source: EventSource | null = null;
  let generation = 0;

  $effect(() => {
    voices = stats.speakers.length;
  });

  function elapsed(timestamp: string): number {
    if (!startedAt) return 0;
    const ms = new Date(timestamp).getTime() - new Date(startedAt).getTime();
    return Number.isFinite(ms) ? Math.max(0, ms / 1000) : 0;
  }

  // Consecutive lines from one person read as one turn.
  let turns = $derived.by(() => {
    const result: Turn[] = [];
    for (const line of lines) {
      const previous = result.at(-1);
      if (previous?.userId === line.userId) {
        previous.text += ` ${line.text}`;
        previous.keys.push(lineKey(line));
        continue;
      }
      result.push({ ...line, seconds: elapsed(line.timestamp), keys: [lineKey(line)] });
    }
    return result;
  });

  let turnIdByKey = $derived(
    new Map(turns.flatMap((turn) => turn.keys.map((key) => [key, turn.id] as const))),
  );

  // The last loaded turn that started by `seconds`, unless the turn that
  // really did is outside the loaded window.
  function turnAt(seconds: number): Turn | null {
    if (turns.length === 0) return null;
    if (hasBefore && turns[0].seconds > seconds) return null;
    const index = turns.findLastIndex((turn) => turn.seconds <= seconds);
    if (index === -1) return null;
    if (hasAfter && index === turns.length - 1) return null;
    return turns[index];
  }

  // Recap and world citations link to "#at-<seconds>", counted from the
  // session's first line. Highlight the last turn that started by then, once
  // the loaded window reaches that far.
  let citedSeconds = $derived.by(() => {
    const match = /^#at-(\d+)$/.exec(page.url.hash);
    return match ? Number(match[1]) : null;
  });
  let citedTurn = $derived(citedSeconds === null ? null : (turnAt(citedSeconds)?.id ?? null));

  // Threads, loot, epic moments and rulings the recap placed in time.
  let markers = $derived.by(() => {
    const sections = recap?.sections;
    if (!sections) return [];
    const result: Marker[] = [];
    const add = (kind: Marker["kind"], label: string, at: string | null) => {
      const seconds = parseElapsed(at);
      if (seconds !== null) result.push({ kind, label, seconds });
    };
    for (const thread of sections.openThreads) add("Thread", thread.title, thread.at);
    for (const item of sections.loot) {
      add("Loot", item.holder ? `${item.item}, held by ${item.holder}` : item.item, item.at);
    }
    for (const moment of sections.epicMoments) add("Epic", moment.description, moment.at);
    for (const ruling of sections.rulings) add("Ruling", ruling.ruling, ruling.at);
    return result.toSorted((a, b) => a.seconds - b.seconds);
  });
  let currentMarker = $derived(markers.findLastIndex((marker) => marker.seconds <= position));

  // Turns, with half-hour dividers and the recap's epic moments between them.
  let rows = $derived.by(() => {
    const momentsBefore = new Map<string, string[]>();
    if (!live) {
      for (const marker of markers) {
        if (marker.kind !== "Epic") continue;
        const turn = turnAt(marker.seconds);
        if (turn) momentsBefore.set(turn.id, [...(momentsBefore.get(turn.id) ?? []), marker.label]);
      }
    }
    const result: Row[] = [];
    turns.forEach((turn, index) => {
      const previous = turns[index - 1];
      if (!live && previous) {
        const half = Math.floor(turn.seconds / DIVIDER_SECONDS);
        if (half > Math.floor(previous.seconds / DIVIDER_SECONDS)) {
          result.push({
            kind: "divider",
            id: `divider-${half}`,
            label: formatElapsed(half * DIVIDER_SECONDS),
          });
        }
      }
      (momentsBefore.get(turn.id) ?? []).forEach((text, n) => {
        result.push({ kind: "moment", id: `moment-${turn.id}-${n}`, text });
      });
      result.push({ kind: "turn", id: turn.id, turn });
    });
    return result;
  });

  let showTimeline = $derived(!live && Boolean(timeline?.length) && durationSeconds > 0);
  let timelineGradient = $derived.by(() => {
    if (!timeline || durationSeconds <= 0) return "none";
    const stops = timeline.map((band) => {
      const from = (band.from / durationSeconds) * 100;
      const to = (band.to / durationSeconds) * 100;
      return `hsl(${speakerHue(band.userId)} 48% 42%) ${from.toFixed(2)}% ${to.toFixed(2)}%`;
    });
    return `linear-gradient(${stops.join(", ")})`;
  });
  // Search matches on the timeline, one dot per half percent at most.
  let matchDots = $derived.by(() => {
    if (!search || durationSeconds <= 0) return [];
    const dots = new Set<number>();
    for (const match of search.matches) {
      dots.add(Math.round((match.seconds / durationSeconds) * 200) / 2);
    }
    return [...dots];
  });

  let matchKeys = $derived(new Set(search?.matches.map((match) => match.key) ?? []));
  let currentMatchTurn = $derived.by(() => {
    const match = search?.matches[matchIndex];
    return match ? (turnIdByKey.get(match.key) ?? null) : null;
  });

  let speakers = $derived(
    stats.speakers.toSorted((a, b) => Number(b.userId === dmUserId) - Number(a.userId === dmUserId)),
  );

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
    durationSeconds = result.durationSeconds;
    dmUserId = result.dmUserId;
    timeline = result.timeline;
    live = result.live;
  }

  function turnElement(id: string): HTMLElement | null {
    return list?.querySelector<HTMLElement>(`[data-turn="${CSS.escape(id)}"]`) ?? null;
  }

  // The site header and the sticky find bar cover the top of the viewport.
  function headerOffset(): number {
    const header =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) || 0;
    const bar = findBar?.getBoundingClientRect();
    return bar && bar.top <= header + 1 ? bar.bottom : header;
  }

  // Changes above the viewport would push what you are reading down; keep
  // the first visible row where it is.
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

  function scrollToTurn(id: string | null | undefined) {
    if (id) turnElement(id)?.scrollIntoView({ block: "center" });
  }

  function updateFollowing() {
    if (!list || hasAfter) {
      following = false;
      return;
    }
    following = list.getBoundingClientRect().bottom <= window.innerHeight + FOLLOW_SLACK;
    if (following) unseen = 0;
  }

  // The turn at the top of the viewport, for the timeline's notch.
  function updatePosition() {
    if (!list) return;
    const top = headerOffset();
    for (const element of list.querySelectorAll<HTMLElement>("[data-seconds]")) {
      if (element.getBoundingClientRect().bottom > top) {
        position = Number(element.dataset.seconds);
        return;
      }
    }
  }

  // Replace the loaded window: the start, the newest lines, the stretch
  // around a cited moment, or the stretch around one line.
  async function load(query: string, after: "top" | "end" | "cited" | { key: string }) {
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
      else if (after === "cited") scrollToTurn(citedTurn);
      else if (typeof after === "object") scrollToTurn(turnIdByKey.get(after.key));
      updateFollowing();
      updatePosition();
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

  // New lines that match the open search join its matches.
  function addLiveMatches(incoming: TranscriptLine[]) {
    if (!search) return;
    const needle = search.query.toLocaleLowerCase();
    const known = new Set(search.matches.map((match) => match.key));
    const fresh = incoming
      .filter((line) => !known.has(lineKey(line)) && line.text.toLocaleLowerCase().includes(needle))
      .map((line) => ({ key: lineKey(line), seconds: Math.floor(elapsed(line.timestamp)) }));
    if (fresh.length === 0) return;
    const current = search.matches[matchIndex]?.key;
    const matches = [...search.matches, ...fresh].toSorted((a, b) => a.key.localeCompare(b.key));
    search = { ...search, matches, total: search.total + fresh.length };
    if (current) matchIndex = matches.findIndex((match) => match.key === current);
  }

  async function receive(event: TranscriptLinesEvent) {
    stats = event.stats;
    addLiveMatches(event.lines);
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

  // Search the whole session, then go to the first match at or after where
  // you are reading.
  async function runSearch(text: string) {
    const query = text.trim();
    const run = ++searchRun;
    if (!query) {
      search = null;
      matchIndex = -1;
      searching = false;
      return;
    }
    searching = true;
    try {
      const response = await fetch(`${base}/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(`Transcript search failed: ${response.status}`);
      const result = (await response.json()) as TranscriptSearchResponse;
      if (run !== searchRun) return;
      search = result;
      const from = turns.find((turn) => turn.seconds >= position)?.keys[0] ?? "";
      const next = result.matches.findIndex((match) => match.key >= from);
      matchIndex = result.matches.length === 0 ? -1 : Math.max(0, next);
      if (matchIndex >= 0) await goToMatch(matchIndex);
    } catch (error) {
      console.error(error);
    } finally {
      if (run === searchRun) searching = false;
    }
  }

  async function goToMatch(index: number) {
    const match = search?.matches[index];
    if (!match) return;
    matchIndex = index;
    const loadedTurn = turnIdByKey.get(match.key);
    if (loadedTurn) scrollToTurn(loadedTurn);
    else await load(`around=${encodeURIComponent(match.key)}`, { key: match.key });
  }

  function stepMatch(direction: 1 | -1) {
    const count = search?.matches.length ?? 0;
    if (count === 0) return;
    void goToMatch((matchIndex + direction + count) % count);
  }

  function onFindKey(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (search?.query !== findText.trim()) void runSearch(findText);
      else stepMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      findText = "";
    }
  }

  $effect(() => {
    const text = findText;
    const timer = setTimeout(() => untrack(() => void runSearch(text)), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  });

  let matchCount = $derived.by(() => {
    if (!findText.trim()) return "";
    if (searching && search?.query !== findText.trim()) return "Searching…";
    if (!search || search.total === 0) return "No matches";
    return `${(matchIndex + 1).toLocaleString("en-CA")} of ${search.total.toLocaleString("en-CA")}`;
  });

  async function copyLink(turn: Turn) {
    const url = new URL(page.url);
    url.searchParams.set("tab", "transcript");
    // Rounded up: a citation opens at the last turn started by then.
    url.hash = `at-${Math.ceil(turn.seconds)}`;
    try {
      await navigator.clipboard.writeText(url.href);
      copied = turn.id;
      setTimeout(() => {
        if (copied === turn.id) copied = null;
      }, 2000);
    } catch (error) {
      console.error(error);
    }
  }

  onMount(() => {
    // Status updates matter on every tab, so the stream opens right away
    // unless the transcript will open it with its first page's cursor.
    if (!active) connect(null);
    // The browser's own scroll anchoring would pin whatever sits below the
    // transcript (even the loading row) while pages are added above it, and
    // keep loading forever. keepPosition() does the anchoring instead.
    const root = document.documentElement;
    const anchoring = root.style.overflowAnchor;
    root.style.overflowAnchor = "none";
    let frame = 0;
    const onScroll = () => {
      updateFollowing();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
      root.style.overflowAnchor = anchoring;
      source?.close();
    };
  });

  // Open at the cited moment, the newest lines while live, or the start; a
  // new citation link reloads around its moment.
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
</script>

{#snippet text(turn: Turn)}
  {#if search && turn.keys.some((key) => matchKeys.has(key))}
    {#each splitMatches(turn.text, search.query) as part, index (index)}
      {#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}
    {/each}
  {:else}
    {turn.text}
  {/if}
{/snippet}

{#snippet when(turn: Turn)}
  <div class="when">
    <a
      class="time"
      href="#at-{Math.ceil(turn.seconds)}"
      title={formatDate(turn.timestamp)}
      aria-label="{formatElapsed(turn.seconds)} into the session">{formatElapsed(turn.seconds)}</a
    >
    <button
      type="button"
      class="copy"
      onclick={() => copyLink(turn)}
      aria-label={copied === turn.id ? "Link copied" : "Copy link to this line"}
      title={copied === turn.id ? "Link copied" : "Copy link"}
    >
      {#if copied === turn.id}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"
          ><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path
            d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
          /></svg
        >
      {/if}
    </button>
  </div>
{/snippet}

{#if turns.length}
  <div class="transcript-layout" class:with-timeline={showTimeline}>
    <section class="transcript-view" aria-label="Session transcript">
      {#if !live}
        <header class="transcript-header">
          <h2>Table Transcript</h2>
          <span class="transcript-note"
            >{formatDuration(durationSeconds)} · {stats.turns.toLocaleString("en-CA")} turns ·
            machine-generated, may contain errors</span
          >
        </header>
      {/if}

      <div class="speaker-key" class:live aria-label="Speakers in this transcript">
        {#each speakers as speaker (speaker.userId)}
          <span class="speaker-chip" style={`--speaker-hue: ${speakerHue(speaker.userId)}`}>
            <span class="speaker-dot" aria-hidden="true"></span>
            {#if speaker.userId === dmUserId}
              <strong>DM</strong>
              <span>{speaker.speaker}</span>
            {:else if speaker.characterName}
              <strong>{speaker.characterName}</strong>
              <span>{speaker.speaker}</span>
            {:else}
              <strong>{speaker.speaker}</strong>
            {/if}
          </span>
        {/each}
      </div>

      <div class="find" role="search" bind:this={findBar}>
        <label for="transcript-find" class="visually-hidden">Find in transcript</label>
        <div class="find-box">
          <svg class="find-icon" viewBox="0 0 24 24" aria-hidden="true"
            ><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg
          >
          <input
            id="transcript-find"
            type="search"
            autocomplete="off"
            placeholder="Find in transcript"
            bind:value={findText}
            onkeydown={onFindKey}
          />
          <span class="find-count" aria-live="polite">{matchCount}</span>
          <button
            type="button"
            aria-label="Previous match"
            disabled={!search?.matches.length}
            onclick={() => stepMatch(-1)}
            ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg></button
          >
          <button
            type="button"
            aria-label="Next match"
            disabled={!search?.matches.length}
            onclick={() => stepMatch(1)}
            ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></button
          >
        </div>
        <span class="find-hint">
          {#if live}
            Searches the whole session so far. New matches are highlighted as they arrive.
          {:else}
            Searches the whole session.{#if showTimeline}{" "}Matches also show on the timeline.{/if}
          {/if}
        </span>
      </div>

      {#if hasBefore}
        <p class="loading" bind:this={topSentinel} aria-live="polite">
          <span class="spinner" aria-hidden="true"></span>
          Loading earlier dialogue…
        </p>
      {/if}
      <ol class="transcript-list" bind:this={list}>
        {#each rows as row (row.id)}
          {#if row.kind === "divider"}
            <li class="divider" aria-hidden="true"><span>{row.label}</span></li>
          {:else if row.kind === "moment"}
            <li class="moment">
              <svg viewBox="0 0 24 24" aria-hidden="true"
                ><path d="M12 3l2.6 5.5 6 .7-4.4 4.1 1.2 6-5.4-3-5.4 3 1.2-6L3.4 9.2l6-.7z" /></svg
              >
              <span><strong>Epic moment:</strong> {row.text}</span>
            </li>
          {:else}
            {@const turn = row.turn}
            <li
              data-turn={turn.id}
              data-seconds={Math.floor(turn.seconds)}
              class="turn"
              class:dm={turn.userId === dmUserId}
              class:cited={citedTurn === turn.id}
              class:current={currentMatchTurn === turn.id}
              style={`--speaker-hue: ${speakerHue(turn.userId)}`}
            >
              {@render when(turn)}
              {#if turn.userId === dmUserId}
                <div class="narration">
                  <span class="dm-label">DM · {turn.speaker}</span>
                  <p class="turn-text">{@render text(turn)}</p>
                </div>
              {:else}
                <div class="who">
                  <strong>{turn.characterName ?? turn.speaker}</strong>
                  {#if turn.characterName}<span>{turn.speaker}</span>{/if}
                </div>
                <p class="turn-text">{@render text(turn)}</p>
              {/if}
            </li>
          {/if}
        {/each}
      </ol>
      {#if hasAfter}
        <p class="loading after" bind:this={bottomSentinel} aria-live="polite">
          <span class="spinner" aria-hidden="true"></span>
          Loading more dialogue…
        </p>
      {/if}
      {#if live}
        <p class="listening">
          <span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>
          Listening. New lines appear a few seconds after they are spoken.
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

    {#if showTimeline}
      <aside class="timeline" aria-label="Session timeline">
        <div class="timeline-head">
          <h3>Session timeline</h3>
          <span>{formatElapsed(durationSeconds)}</span>
        </div>
        <div class="timeline-body">
          <div class="bar" style={`background: ${timelineGradient}`} aria-hidden="true">
            {#each matchDots as dot (dot)}
              <span class="match-dot" style={`top: ${dot}%`}></span>
            {/each}
            <span
              class="notch"
              style={`top: ${Math.min(100, (position / durationSeconds) * 100)}%`}
            ></span>
          </div>
          {#if markers.length}
            <ol class="markers">
              {#each markers as marker, index (index)}
                <li>
                  <a href="#at-{marker.seconds}" class:here={index === currentMarker}>
                    <span class="marker-meta"
                      ><span class="marker-kind">{marker.kind}</span><span
                        >{formatElapsed(marker.seconds)}</span
                      ></span
                    >
                    <span class="marker-label">{marker.label}</span>
                  </a>
                </li>
              {/each}
            </ol>
          {:else}
            <p class="timeline-empty">The recap has no moments placed in time.</p>
          {/if}
        </div>
        <p class="timeline-note">
          Colour shows who was talking. The notch is where you are{#if matchDots.length}; gold
            dots are search matches{/if}. Markers come from the recap.
        </p>
      </aside>
    {/if}
  </div>
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
  .transcript-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.25rem;
    align-items: start;
    margin-top: 0.75rem;
  }
  .transcript-layout.with-timeline {
    grid-template-columns: minmax(0, 1fr) 15.5rem;
  }
  @container (max-width: 860px) {
    .transcript-layout.with-timeline {
      grid-template-columns: minmax(0, 1fr);
    }
    .timeline {
      display: none;
    }
  }
  .transcript-view {
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 4px;
    /* clip, not hidden: hidden would trap the sticky find bar and jump button. */
    overflow: clip;
  }
  .transcript-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem 0.9rem;
    padding: 1rem 1.4rem 0.6rem;
  }
  .transcript-header h2 {
    margin: 0;
    font-size: 1.25rem;
  }
  .transcript-note {
    color: var(--ink-soft);
    font-size: 0.95rem;
  }
  .speaker-key {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    padding: 0 1.4rem 0.8rem;
  }
  .speaker-key.live {
    padding-top: 0.85rem;
  }
  .speaker-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.22rem 0.6rem;
    font-size: 0.86rem;
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
  .find {
    position: sticky;
    top: var(--header-height, 0px);
    z-index: 4;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.9rem;
    padding: 0.6rem 1.4rem;
    background: var(--surface-sunken);
    border-top: 1px solid var(--edge);
    border-bottom: 1px solid var(--edge);
    box-shadow: 0 2px 6px var(--shadow);
  }
  .find-box {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 0 1 22rem;
    min-width: 0;
    min-height: 44px;
    box-sizing: border-box;
    padding: 0 0.3rem 0 0.75rem;
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 4px;
  }
  .find-box:focus-within {
    border-color: var(--gold);
    outline: 2px solid color-mix(in srgb, var(--gold) 35%, transparent);
  }
  .find-icon {
    flex: 0 0 auto;
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: var(--ink-soft);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .find-box input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 1rem;
    color: var(--ink);
    background: transparent;
    border: 0;
    outline: none;
  }
  .find-box input::-webkit-search-cancel-button {
    display: none;
  }
  .find-count {
    font-size: 0.88rem;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .find-box button {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    color: var(--ink);
    background: transparent;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
  }
  .find-box button:hover:not(:disabled) {
    background: var(--surface-sunken);
  }
  .find-box button:disabled {
    cursor: default;
    opacity: 0.4;
  }
  .find-box button svg {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .find-hint {
    flex: 1 1 12rem;
    font-size: 0.88rem;
    color: var(--ink-soft);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
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
    padding: 0.35rem 1.4rem 1rem;
    list-style: none;
  }
  .turn {
    display: grid;
    grid-template-columns: 5.25rem 8.5rem minmax(0, 1fr);
    grid-template-areas: "when who text";
    gap: 0 1rem;
    align-items: start;
    padding: 0.5rem 0;
    scroll-margin-top: calc(var(--header-height, 0px) + 5rem);
  }
  .turn.dm {
    grid-template-columns: 5.25rem minmax(0, 1fr);
    grid-template-areas: "when text";
  }
  .turn.cited,
  .turn.current {
    margin: 0 -0.6rem;
    padding: 0.5rem 0.6rem;
    border-radius: 4px;
  }
  .turn.cited {
    background: color-mix(in srgb, var(--gold) 14%, transparent);
  }
  .turn.current {
    box-shadow: inset 3px 0 0 var(--gold);
  }
  .when {
    grid-area: when;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    height: 1.6rem;
    padding-top: 0.05rem;
  }
  .turn.dm .when {
    padding-top: 0.5rem;
  }
  .time {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--ink-soft);
    text-decoration: none;
  }
  .time:hover {
    color: var(--ink);
    text-decoration: underline;
  }
  .copy {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 1.6rem;
    height: 1.6rem;
    padding: 0;
    color: var(--ink-soft);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
  }
  .turn:hover .copy,
  .turn:focus-within .copy,
  .copy:focus-visible {
    opacity: 1;
  }
  @media (hover: none) {
    .copy {
      opacity: 1;
      background: transparent;
      border-color: transparent;
    }
  }
  .copy:hover {
    color: var(--ink);
    background: var(--surface-sunken);
  }
  .copy svg {
    width: 0.9rem;
    height: 0.9rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .who {
    grid-area: who;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    padding-top: 0.15rem;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .who strong {
    font-family: var(--font-display);
    font-size: 0.86rem;
    font-weight: 600;
    color: color-mix(in srgb, hsl(var(--speaker-hue) 55% 42%) 70%, var(--ink));
  }
  .who span {
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .narration {
    grid-area: text;
    min-width: 0;
    padding: 0.6rem 1rem;
    background: var(--surface-sunken);
    border-radius: 4px;
  }
  .dm-label {
    display: block;
    margin-bottom: 0.2rem;
    font-family: var(--font-display);
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    color: color-mix(in srgb, hsl(var(--speaker-hue) 55% 42%) 70%, var(--ink));
  }
  .turn-text {
    grid-area: text;
    max-width: 66ch;
    margin: 0;
    color: var(--ink);
    font-size: 1.05rem;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .narration .turn-text {
    font-style: italic;
  }
  .turn-text mark {
    padding: 0 1px;
    color: inherit;
    background: color-mix(in srgb, var(--gold) 38%, transparent);
    border-radius: 2px;
  }
  .turn.current .turn-text mark {
    background: color-mix(in srgb, var(--gold) 70%, transparent);
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0.75rem 0 0.35rem;
    font-family: var(--font-display);
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    color: var(--ink-soft);
  }
  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--edge);
  }
  .moment {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    margin: 0.6rem 0 0.25rem 6.25rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.95rem;
    color: var(--recap);
    background: var(--recap-soft);
    border-radius: 4px;
  }
  .moment svg {
    flex: 0 0 auto;
    width: 1rem;
    height: 1rem;
    margin-top: 0.15rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .moment strong {
    font-weight: 600;
  }
  .listening {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0;
    padding: 0.25rem 1.4rem 1rem 7.65rem;
    font-style: italic;
    color: var(--ink-soft);
  }
  .dots {
    display: inline-flex;
    gap: 0.25rem;
  }
  .dots span {
    width: 0.4rem;
    height: 0.4rem;
    background: var(--gold);
    border-radius: 50%;
    animation: pulse 1.4s ease-in-out infinite;
  }
  .dots span:nth-child(2) {
    animation-delay: 0.2s;
  }
  .dots span:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dots span {
      animation: none;
    }
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
  .timeline {
    position: sticky;
    top: calc(var(--header-height, 0px) + 1rem);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: calc(100vh - var(--header-height, 0px) - 2rem);
    box-sizing: border-box;
    padding: 1rem 1.1rem;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 4px;
  }
  .timeline-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .timeline-head h3 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 0.88rem;
    letter-spacing: 0.08em;
  }
  .timeline-head span,
  .marker-meta span:last-child {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--ink-soft);
  }
  .timeline-body {
    display: grid;
    grid-template-columns: 1.5rem minmax(0, 1fr);
    gap: 0 0.6rem;
    min-height: 12rem;
  }
  .bar {
    position: relative;
    width: 6px;
    margin-left: 0.6rem;
    border-radius: 3px;
  }
  .notch {
    position: absolute;
    left: -7px;
    width: 20px;
    height: 3px;
    margin-top: -1.5px;
    background: var(--ink);
    border-radius: 2px;
    transition: top 0.15s ease-out;
  }
  @media (prefers-reduced-motion: reduce) {
    .notch {
      transition: none;
    }
  }
  .match-dot {
    position: absolute;
    left: -10px;
    width: 5px;
    height: 5px;
    margin-top: -2.5px;
    background: var(--gold);
    border-radius: 50%;
  }
  .markers {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .markers a {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-bottom: 0.2rem;
    padding: 0.35rem 0.5rem;
    color: var(--ink);
    text-decoration: none;
    border-radius: 4px;
  }
  .markers a:hover {
    background: var(--surface-sunken);
  }
  .markers a.here {
    background: color-mix(in srgb, var(--gold) 18%, transparent);
  }
  .marker-meta {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .marker-kind {
    font-family: var(--font-display);
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
  }
  .marker-label {
    display: -webkit-box;
    overflow: hidden;
    font-size: 0.95rem;
    line-height: 1.3;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .timeline-empty,
  .timeline-note {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.4;
    color: var(--ink-soft);
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
      padding: 0.9rem 1rem 0.5rem;
    }
    .speaker-key {
      padding: 0 1rem 0.7rem;
    }
    .find {
      padding: 0.5rem 1rem;
    }
    .find-hint {
      display: none;
    }
    .loading {
      margin: 0 0.9rem;
    }
    .transcript-list {
      padding: 0.25rem 0.9rem 0.9rem;
    }
    .turn {
      grid-template-columns: 4.6rem minmax(0, 1fr);
      grid-template-areas:
        "when who"
        "when text";
      gap: 0.15rem 0.6rem;
    }
    .turn.dm {
      grid-template-columns: 4.6rem minmax(0, 1fr);
      grid-template-areas: "when text";
    }
    .who {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.4rem;
    }
    .moment {
      margin-left: 0;
    }
    .listening {
      padding-left: 1rem;
    }
  }
</style>
