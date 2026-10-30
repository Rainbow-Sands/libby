<script lang="ts">
  import { enhance } from "$app/forms";
  import Breadcrumbs from "$lib/components/Breadcrumbs.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // One row at a time is open for editing or confirming a removal.
  let editing = $state<string | null>(null);
  let removing = $state<string | null>(null);
  let copied = $state(false);
  let inviteInput = $state<HTMLInputElement>();

  async function copyInvite() {
    if (!data.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(data.inviteUrl);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      inviteInput?.select();
    }
  }

  function closeRow() {
    return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
      await update();
      if (result.type === "success") {
        editing = null;
        removing = null;
      }
    };
  }
</script>

<svelte:head><title>Members — {data.campaign.name}</title></svelte:head>

<Breadcrumbs
  items={[
    { label: data.campaign.name, href: `/campaigns/${data.campaign.id}` },
    { label: "Members" },
  ]}
/>

<div class="panel">
  <p class="eyebrow">{data.campaign.name}</p>
  <h1>Members</h1>

  <ul class="members">
    {#each data.members as member (member.id)}
      <li>
        <span class="who">
          <strong>{member.username}</strong>
          {#if member.role === "dm"}
            <span class="muted">DM</span>
          {:else if editing !== member.id}
            <span class="muted">{member.characterName ?? "No character yet"}</span>
          {/if}
        </span>

        {#if member.role === "player"}
          {#if editing === member.id}
            <form class="inline" method="POST" action="?/character" use:enhance={closeRow}>
              <input type="hidden" name="userId" value={member.id} />
              <input
                class="input"
                name="characterName"
                value={member.characterName ?? ""}
                maxlength="100"
                required
                aria-label="{member.username}'s character"
              />
              <button type="submit" class="btn">Save</button>
              <button type="button" class="btn quiet" onclick={() => (editing = null)}>Cancel</button>
            </form>
          {:else}
            <span class="row-actions">
              <button
                type="button"
                class="btn quiet"
                onclick={() => {
                  editing = member.id;
                  removing = null;
                }}>Edit</button
              >
              <button
                type="button"
                class="btn quiet"
                onclick={() => {
                  removing = member.id;
                  editing = null;
                }}>Remove</button
              >
            </span>
          {/if}

          {#if removing === member.id}
            <form class="confirm" method="POST" action="?/remove" use:enhance={closeRow}>
              <input type="hidden" name="userId" value={member.id} />
              <span>
                Remove {member.username} from {data.campaign.name}? Their lines in past transcripts
                and their character page stay.
              </span>
              <span class="row-actions">
                <button type="submit" class="btn">Remove {member.username}</button>
                <button type="button" class="btn quiet" onclick={() => (removing = null)}>Keep</button>
              </span>
            </form>
          {/if}

          {#if form?.message && "userId" in form && form.userId === member.id}
            <p class="form-error" role="alert">{form.message}</p>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
</div>

<div class="panel invite">
  <h2>Invite players</h2>
  {#if data.inviteUrl}
    <p class="muted">Anyone with this link can join after signing in with Discord.</p>
    <div class="invite-row">
      <input
        class="input"
        bind:this={inviteInput}
        value={data.inviteUrl}
        readonly
        aria-label="Invite link"
        onfocus={(event) => event.currentTarget.select()}
      />
      <button type="button" class="btn" onclick={copyInvite}>{copied ? "Copied" : "Copy link"}</button>
    </div>
  {/if}
  <form class="invite-row" method="POST" action="?/resetInvite" use:enhance>
    <button type="submit" class="btn quiet">Make a new link</button>
    <span class="muted">
      {#if form && "reset" in form}New link made. The old one no longer works.{:else}The old link
        stops working.{/if}
    </span>
  </form>
</div>

<style>
  .members {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
    border: 1px solid var(--edge);
    border-radius: 4px;
    background: var(--surface);
  }
  .members li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem 1rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--edge);
  }
  .members li:last-child {
    border-bottom: 0;
  }
  .who {
    flex: 1 1 10rem;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .row-actions,
  .inline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .inline {
    flex: 2 1 16rem;
  }
  .inline .input {
    flex: 1 1 10rem;
    min-width: 0;
  }
  .confirm {
    flex-basis: 100%;
    display: grid;
    gap: 0.6rem;
    padding: 0.7rem 0.9rem;
    background: var(--warn-soft);
    border-radius: 4px;
  }
  .members .form-error {
    flex-basis: 100%;
    margin: 0;
  }
  .invite {
    margin-top: 1.25rem;
    display: grid;
    gap: 0.75rem;
  }
  .invite h2,
  .invite p {
    margin: 0;
  }
  .invite-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
  }
  .invite-row .input {
    flex: 1 1 16rem;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 0.9rem;
  }
</style>
