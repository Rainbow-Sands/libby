<script lang="ts">
  import Breadcrumbs from "$lib/components/Breadcrumbs.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let rows = $state([{ id: 0 }]);
  let nextId = 1;

  // A failed per-player upload comes back to this page, so it reopens on that
  // form.
  // svelte-ignore state_referenced_locally
  let mode = $state<"room" | "tracks">(form?.message ? "tracks" : "room");

  let recording = $state<File | null>(null);
  let dragging = $state(false);
  let playedAt = $state(localDateTime(new Date()));
  // Everyone in the campaign is a fair first guess for who talks.
  // svelte-ignore state_referenced_locally
  let speakers = $state(String(Math.max(2, data.campaign.members.length)));
  let progress = $state<number | null>(null);
  let uploadError = $state<string | null>(null);

  function localDateTime(date: Date): string {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  function speakerOption(count: number): string {
    return count === 1 ? "Just 1" : `About ${count} (GM + ${count - 1} players)`;
  }

  function chooseFile(file: File | undefined) {
    uploadError = null;
    recording = file ?? null;
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    chooseFile(event.dataTransfer?.files[0]);
  }

  function fileSize(bytes: number): string {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  }

  // XMLHttpRequest, because fetch cannot report upload progress.
  function uploadRecording(event: SubmitEvent) {
    event.preventDefault();
    if (!recording || progress !== null) return;
    const file = recording;
    const started = new Date(playedAt);
    if (Number.isNaN(started.getTime())) {
      uploadError = "Choose when the session was played.";
      return;
    }
    const query = new URLSearchParams({ name: file.name, playedAt: started.toISOString() });
    if (speakers) query.set("speakers", speakers);

    const request = new XMLHttpRequest();
    request.open("POST", `/campaigns/${data.campaign.id}/ingest/recording?${query}`);
    request.setRequestHeader("content-type", file.type || "application/octet-stream");
    request.responseType = "json";
    request.upload.addEventListener("progress", (progressEvent) => {
      if (progressEvent.lengthComputable) progress = progressEvent.loaded / progressEvent.total;
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300 && request.response?.url) {
        window.location.assign(request.response.url);
        return;
      }
      progress = null;
      uploadError = request.response?.message ?? "The upload failed. Try again.";
    });
    request.addEventListener("error", () => {
      progress = null;
      uploadError = "The upload was interrupted. Check your connection and try again.";
    });
    progress = 0;
    uploadError = null;
    request.send(file);
  }

  function addRecording() {
    rows = [...rows, { id: nextId++ }];
  }

  function removeRecording(id: number) {
    if (rows.length > 1) rows = rows.filter((row) => row.id !== id);
  }

  function memberLabel(member: PageData["campaign"]["members"][number]): string {
    return member.characterName ? `${member.username} — ${member.characterName}` : member.username;
  }
</script>

<svelte:head><title>Upload a session — {data.campaign.name}</title></svelte:head>

<Breadcrumbs
  items={[
    { label: data.campaign.name, href: `/campaigns/${data.campaign.id}` },
    { label: "Upload a session" },
  ]}
/>

<div class="panel">
  <h1>Upload a session</h1>
  <div class="seg" role="group" aria-label="Recording type">
    <button type="button" aria-pressed={mode === "room"} onclick={() => (mode = "room")}
      >One recording of the table</button
    >
    <button type="button" aria-pressed={mode === "tracks"} onclick={() => (mode = "tracks")}
      >A file per player</button
    >
  </div>

  {#if mode === "room"}
  <p class="muted">
    One file from a phone or microphone in the middle of the table. Libby works out who is speaking
    and asks you to confirm.
  </p>

  <form class="room" onsubmit={uploadRecording}>
    <label
      class="drop"
      class:dragging
      ondragover={(event) => {
        event.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={onDrop}
    >
      {#if recording}
        <b>{recording.name}</b>
        <span class="muted">{fileSize(recording.size)} · <span class="link">choose another file</span></span>
      {:else}
        <b>Drop the recording here</b>
        <span class="muted"
          >or <span class="link">choose a file</span> · m4a, mp3, wav, ogg, flac</span
        >
      {/if}
      <input
        class="visually-hidden"
        type="file"
        accept="audio/*,.opus,.m4a"
        onchange={(event) => chooseFile(event.currentTarget.files?.[0])}
      />
    </label>

    <div class="details">
      <label class="field">
        Played on
        <input class="input" type="datetime-local" bind:value={playedAt} required />
      </label>
      <label class="field">
        People talking
        <select class="input" bind:value={speakers}>
          {#each Array.from({ length: 12 }, (_, index) => index + 1) as count (count)}
            <option value={String(count)}>{speakerOption(count)}</option>
          {/each}
          <option value="">Not sure</option>
        </select>
      </label>
    </div>

    {#if uploadError}
      <p class="form-error" role="alert">{uploadError}</p>
    {/if}
    {#if progress !== null}
      <div class="progress" role="progressbar" aria-label="Upload progress" aria-valuenow={Math.round(progress * 100)} aria-valuemin="0" aria-valuemax="100">
        <i style={`width: ${progress * 100}%`}></i>
      </div>
      <p class="muted" role="status">
        {progress < 1 ? `Uploading · ${Math.round(progress * 100)}%` : "Saving the recording…"}
      </p>
    {/if}
    <button type="submit" class="btn" disabled={!recording || progress !== null}
      >Upload and transcribe</button
    >
  </form>
  {:else}
  <p class="muted">
    Add one long recording per speaker, such as a Craig export. All recordings are treated as
    starting together, so Whisper's per-utterance timestamps keep the combined transcript in session
    order.
  </p>

  {#if form?.message}
    <p class="error" role="alert">{form.message}</p>
  {/if}

  <form method="POST" enctype="multipart/form-data">
    <div class="recordings">
      {#each rows as row (row.id)}
        <fieldset>
          <legend>Recording {row.id + 1}</legend>
          <label>
            Speaker
            <select name="userId" required>
              {#each data.campaign.members as member (member.id)}
                <option value={member.id}>{memberLabel(member)}</option>
              {/each}
            </select>
          </label>
          <label>
            Audio file
            <input name="audio" type="file" accept="audio/*,.opus" required />
          </label>
          {#if rows.length > 1}
            <button type="button" class="remove" onclick={() => removeRecording(row.id)}>Remove</button>
          {/if}
        </fieldset>
      {/each}
    </div>

    <div class="actions">
      <button type="button" class="secondary" onclick={addRecording}>Add another recording</button>
      <button type="submit">Start ingestion</button>
    </div>
  </form>
  {/if}
</div>

<style>
  h1 {
    margin-bottom: 0.75rem;
  }
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
    border: 1px solid var(--edge);
    border-radius: 4px;
    overflow: hidden;
  }
  .seg button {
    background: var(--surface);
    color: var(--ink);
    border-radius: 0;
    padding: 0.4rem 0.8rem;
  }
  .seg button[aria-pressed="true"] {
    background: var(--accent);
    color: var(--surface);
  }
  .room {
    display: grid;
    gap: 1rem;
  }
  .drop {
    display: grid;
    gap: 0.35rem;
    justify-items: center;
    padding: 1.6rem 1rem;
    text-align: center;
    background: var(--surface-sunken);
    border: 2px dashed var(--edge);
    border-radius: 6px;
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .drop.dragging,
  .drop:focus-within {
    border-color: var(--gold);
  }
  .link {
    color: var(--link);
    text-decoration: underline;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .details {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.75rem;
  }
  .room .btn {
    justify-self: start;
  }
  .progress {
    height: 0.5rem;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 999px;
    overflow: hidden;
  }
  .progress i {
    display: block;
    height: 100%;
    background: var(--gold);
  }
  .progress + p {
    margin: -0.5rem 0 0;
  }
  .recordings {
    display: grid;
    gap: 1rem;
  }
  fieldset {
    display: grid;
    gap: 0.75rem;
    border: 1px solid var(--edge);
    border-radius: 4px;
    padding: 1rem;
  }
  label {
    display: grid;
    gap: 0.35rem;
  }
  select, input {
    font: inherit;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1rem;
  }
  button {
    background: var(--accent);
    color: var(--surface);
    border: 0;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    padding: 0.5rem 0.8rem;
  }
  .secondary, .remove {
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    color: var(--ink);
  }
  .remove {
    justify-self: start;
  }
  .error {
    color: var(--accent-bright);
  }
</style>
