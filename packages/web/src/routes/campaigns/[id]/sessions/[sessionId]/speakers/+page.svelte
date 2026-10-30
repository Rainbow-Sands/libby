<script lang="ts">
  import { enhance } from "$app/forms";
  import Breadcrumbs from "$lib/components/Breadcrumbs.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  type Speaker = PageData["speakers"][number];

  function initialChoice(speaker: Speaker): string {
    if (speaker.ignored) return "ignore";
    if (speaker.guestName) return "guest";
    if (speaker.userId) return `member:${speaker.userId}`;
    if (speaker.suggestion) return `member:${speaker.suggestion.userId}`;
    return "";
  }

  // svelte-ignore state_referenced_locally
  let choices = $state<Record<string, string>>(
    Object.fromEntries(data.speakers.map((speaker) => [speaker.label, initialChoice(speaker)])),
  );
  // svelte-ignore state_referenced_locally
  let guests = $state<Record<string, string>>(
    Object.fromEntries(data.speakers.map((speaker) => [speaker.label, speaker.guestName ?? ""])),
  );

  let unnamed = $derived(
    data.speakers.filter((speaker) => {
      const choice = choices[speaker.label];
      return !choice || (choice === "guest" && !guests[speaker.label]?.trim());
    }).length,
  );
  let duration = $derived(
    Math.max(1, ...data.speakers.flatMap((speaker) => speaker.turns.map(([, end]) => end))),
  );

  // Speakers are numbered by talk time, so neighbouring numbers get hues far
  // apart.
  function hue(position: number): number {
    return (position * 137 + 20) % 360;
  }

  function talkTime(seconds: number): string {
    const minutes = Math.round(seconds / 60);
    if (minutes < 1) return `${Math.round(seconds)} s`;
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  function memberLabel(member: PageData["campaign"]["members"][number]): string {
    if (member.role === "dm") return `${member.username} (GM)`;
    return member.characterName ? `${member.username} (${member.characterName})` : member.username;
  }

  let playing = $state<string | null>(null);
  let audio: HTMLAudioElement | null = null;

  function play(segmentId: string) {
    audio?.pause();
    if (playing === segmentId) {
      playing = null;
      return;
    }
    audio = new Audio(
      `/campaigns/${data.campaign.id}/sessions/${data.sessionId}/speakers/${segmentId}`,
    );
    audio.addEventListener("ended", () => (playing = null));
    audio.addEventListener("error", () => (playing = null));
    playing = segmentId;
    void audio.play().catch(() => (playing = null));
  }

  function quote(speaker: Speaker): string | null {
    const text = speaker.samples.map((sample) => sample.text?.trim()).find(Boolean);
    return text ? `“${text}”` : null;
  }
</script>

<svelte:head><title>Who's who — {data.campaign.name}</title></svelte:head>

<Breadcrumbs
  items={[
    { label: data.campaign.name, href: `/campaigns/${data.campaign.id}` },
    {
      label: data.sequence ? `Session ${data.sequence.number}` : "Session",
      href: `/campaigns/${data.campaign.id}/sessions/${data.sessionId}`,
    },
    { label: "Who's who" },
  ]}
/>

<div class="panel">
  <h1>Who's who</h1>
  {#if data.speakers.length === 0}
    <p class="muted">
      {data.status === "detecting"
        ? "Libby is still listening for voices. This page fills in when speaker detection finishes."
        : "Libby didn't hear anyone in this recording."}
    </p>
  {:else}
    <p class="muted">
      Libby heard {data.speakers.length}
      {data.speakers.length === 1 ? "voice" : "voices"}. Play a sample and pick who it is. {data.confirmed
        ? "Changing a name writes the transcript and recap again."
        : "The recap is written once you confirm."}
    </p>

    <div class="timeline" aria-label="Who spoke when">
      {#each data.speakers as speaker (speaker.label)}
        {#each speaker.turns as [start, end], index (index)}
          <i
            style={`left: ${(start / duration) * 100}%; width: max(2px, ${((end - start) / duration) * 100}%); --speaker-hue: ${hue(speaker.position)}`}
          ></i>
        {/each}
      {/each}
    </div>

    {#if form?.message}
      <p class="form-error" role="alert">{form.message}</p>
    {/if}

    <form method="POST" action="?/confirm" use:enhance={() => async ({ update }) => update({ reset: false })}>
      <div class="list">
        {#each data.speakers as speaker (speaker.label)}
          {@const choice = choices[speaker.label]}
          <div class="who-row" style={`--speaker-hue: ${hue(speaker.position)}`}>
            <span class="dot" aria-hidden="true"></span>
            <span class="meta">
              <b>Speaker {speaker.position}</b>
              <span class="muted">{talkTime(speaker.talkSeconds)}</span>
              {#if speaker.suggestion && !speaker.userId && !speaker.guestName && !speaker.ignored}
                <span class="pill {speaker.suggestion.score >= 75 ? 'ok' : 'maybe'}"
                  >{speaker.suggestion.score >= 75 ? "Matches" : "Sounds like"}
                  {speaker.suggestion.username}'s voice · {speaker.suggestion.score}%</span
                >
              {:else if !choice}
                <span class="pill warn">No match yet</span>
              {/if}
            </span>
            <span class="ctl">
              {#each speaker.samples as sample, index (sample.segmentId)}
                <button
                  type="button"
                  class="play"
                  aria-label={`${playing === sample.segmentId ? "Stop" : "Play"} sample ${index + 1} of Speaker ${speaker.position}`}
                  aria-pressed={playing === sample.segmentId}
                  onclick={() => play(sample.segmentId)}
                  >{playing === sample.segmentId ? "■" : "▶"}</button
                >
              {/each}
              <select
                class="input"
                name={`choice:${speaker.label}`}
                aria-label={`Speaker ${speaker.position} is`}
                bind:value={choices[speaker.label]}
              >
                <option value="">Choose…</option>
                {#each data.campaign.members as member (member.id)}
                  <option value={`member:${member.id}`}>{memberLabel(member)}</option>
                {/each}
                <option value="guest">A guest…</option>
                <option value="ignore">Not part of the game</option>
              </select>
              {#if choice === "guest"}
                <input
                  class="input guest"
                  name={`guest:${speaker.label}`}
                  aria-label={`Guest name for Speaker ${speaker.position}`}
                  placeholder="Guest's name"
                  maxlength="100"
                  bind:value={guests[speaker.label]}
                />
              {/if}
            </span>
            {#if quote(speaker)}
              <span class="quote">{quote(speaker)}</span>
            {/if}
          </div>
        {/each}
      </div>
      <p class="muted">Several speakers can be the same person, such as a GM's villain voice.</p>
      <div class="actions">
        <button type="submit" class="btn" disabled={unnamed > 0}
          >{data.confirmed ? "Save and rewrite the recap" : "Confirm and write the recap"}</button
        >
        {#if !data.confirmed}
          <button type="submit" class="btn quiet" formaction="?/save" formnovalidate
            >Save for later</button
          >
        {/if}
        {#if unnamed > 0}
          <span class="muted"
            >{unnamed === 1 ? "One speaker still needs" : `${unnamed} speakers still need`} a name.</span
          >
        {:else if form?.saved}
          <span role="status">Saved.</span>
        {/if}
      </div>
    </form>
  {/if}
</div>

<style>
  h1 {
    margin-bottom: 0.4rem;
  }
  .timeline {
    position: relative;
    height: 1.1rem;
    margin: 1rem 0;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 3px;
    overflow: hidden;
  }
  .timeline i {
    position: absolute;
    top: 0;
    bottom: 0;
    background: hsl(var(--speaker-hue) 48% 46%);
  }
  .list {
    border: 1px solid var(--edge);
    border-radius: 6px;
    background: var(--surface);
  }
  .who-row {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.4rem 0.75rem;
    align-items: center;
    padding: 0.75rem;
    border-bottom: 1px solid var(--edge);
  }
  .who-row:last-child {
    border-bottom: 0;
  }
  .dot {
    align-self: start;
    margin-top: 0.4rem;
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    background: hsl(var(--speaker-hue) 48% 46%);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    min-width: 0;
  }
  .ctl {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .ctl select {
    min-width: 0;
    max-width: 100%;
  }
  .guest {
    width: 12rem;
    max-width: 100%;
  }
  .play {
    width: 2rem;
    height: 2rem;
    font: inherit;
    font-size: 0.8rem;
    color: var(--ink);
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 50%;
    cursor: pointer;
  }
  .play[aria-pressed="true"] {
    border-color: var(--gold);
  }
  .quote {
    grid-column: 2;
    color: var(--ink-soft);
    font-style: italic;
    overflow-wrap: anywhere;
  }
  .pill {
    padding: 0.1rem 0.55rem;
    font-size: 0.85rem;
    border-radius: 999px;
    color: var(--warn);
    background: var(--warn-soft);
  }
  .pill.ok {
    color: var(--ok);
    background: var(--ok-soft);
  }
  .pill.maybe {
    color: var(--ink-soft);
    background: var(--surface-sunken);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }
</style>
