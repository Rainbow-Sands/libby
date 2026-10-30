<script lang="ts">
  import Breadcrumbs from "$lib/components/Breadcrumbs.svelte";
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>New campaign — Libby</title></svelte:head>

<Breadcrumbs items={[{ label: "Campaigns", href: "/" }, { label: "New campaign" }]} />

<div class="panel">
  <h1>New campaign</h1>

  {#if form?.message}
    <p class="form-error" role="alert">{form.message}</p>
  {/if}

  <form method="POST">
    <label class="field">
      Name
      <input class="input" name="name" maxlength="200" required autocomplete="off" />
    </label>
    <label class="field">
      <span>Description <span class="muted">(optional)</span></span>
      <textarea class="input" name="description" rows="3">{form?.description ?? ""}</textarea>
    </label>
    <p class="muted">
      You'll be the DM. Next you can invite your players. To record with the Discord bot, run
      <code>/link-campaign</code> in your server.
    </p>
    <div>
      <button type="submit" class="btn">Create campaign</button>
    </div>
  </form>
</div>

<style>
  form {
    display: grid;
    gap: 1rem;
    max-width: 36rem;
  }
  form p {
    margin: 0;
  }
  code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--surface-sunken);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
