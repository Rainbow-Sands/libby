<script lang="ts">
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let rows = $state([{ id: 0 }]);
  let nextId = 1;

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

<svelte:head><title>Ingest audio — {data.campaign.name}</title></svelte:head>

<p><a href="/campaigns/{data.campaign.id}">← {data.campaign.name}</a></p>

<div class="panel">
  <p class="eyebrow">Manual session</p>
  <h1>Ingest audio</h1>
  <p>
    Add one long recording per speaker. All recordings are treated as starting together, so Whisper's
    per-utterance timestamps keep the combined transcript in session order.
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
</div>

<style>
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
