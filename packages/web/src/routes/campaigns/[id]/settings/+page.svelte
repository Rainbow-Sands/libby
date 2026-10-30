<script lang="ts">
  import { enhance } from "$app/forms";
  import Breadcrumbs from "$lib/components/Breadcrumbs.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Settings — {data.campaign.name}</title></svelte:head>

<Breadcrumbs
  items={[
    { label: data.campaign.name, href: `/campaigns/${data.campaign.id}` },
    { label: "Settings" },
  ]}
/>

<div class="panel">
  <p class="eyebrow">{data.campaign.name}</p>
  <h1>Campaign settings</h1>

  {#if form?.message}
    <p class="form-error" role="alert">{form.message}</p>
  {/if}

  <form method="POST" use:enhance={() => async ({ update }) => update({ reset: false })}>
    <label class="field">
      Name
      <input class="input" name="name" value={data.campaign.name} maxlength="200" required />
    </label>
    <label class="field">
      Description
      <textarea class="input" name="description" rows="3">{data.campaign.description ?? ""}</textarea>
    </label>
    <div class="actions">
      <button type="submit" class="btn">Save</button>
      {#if form?.saved}<span role="status">Saved.</span>{/if}
    </div>
  </form>
</div>

<div class="panel discord">
  <h2>Discord</h2>
  {#if data.campaign.guildName}
    <p>
      Linked to <strong>{data.campaign.guildName}</strong>.
      {#if data.reminderChannel}
        Reminders post in <strong>#{data.reminderChannel}</strong>. To change the channel, run
        <code>/reminder</code> in the channel you want.
      {:else}
        Run <code>/reminder</code> in a channel to post session reminders there.
      {/if}
    </p>
  {:else}
    <p>
      Not linked to a Discord server. To record sessions with the Discord bot, run
      <code>/link-campaign</code> in your server and pick this campaign.
    </p>
  {/if}
</div>

<style>
  form {
    display: grid;
    gap: 1rem;
    max-width: 36rem;
    margin-top: 1rem;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .discord {
    margin-top: 1.25rem;
  }
  .discord h2,
  .discord p {
    margin: 0 0 0.5rem;
  }
  code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--surface-sunken);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
