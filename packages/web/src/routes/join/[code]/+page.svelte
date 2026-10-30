<script lang="ts">
  import { page } from "$app/state";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const others = $derived(
    data.invite.players.length === 0
      ? "No players have joined yet."
      : `${data.invite.players.join(", ")} ${data.invite.players.length === 1 ? "has" : "have"} joined.`,
  );
</script>

<svelte:head><title>Join {data.invite.name} — Libby</title></svelte:head>

<div class="panel join">
  <p class="eyebrow">Invitation</p>
  <h1>Join {data.invite.name}</h1>
  <p class="muted">
    {#if data.invite.dmName}{data.invite.dmName} is the DM.{/if}
    {others}
  </p>

  {#if data.user}
    {#if form?.message}
      <p class="form-error" role="alert">{form.message}</p>
    {/if}
    <form method="POST">
      <label class="field">
        Your character's name
        <input class="input" name="characterName" maxlength="100" required autocomplete="off" />
      </label>
      <button type="submit" class="btn">Join campaign</button>
      <p class="muted">
        Signed in as {data.user.username}.
        <a href="/auth/logout">Not you?</a>
      </p>
    </form>
  {:else}
    <p>
      <a class="btn" href="/auth/login?returnTo={encodeURIComponent(page.url.pathname)}"
        >Sign in with Discord to join</a
      >
    </p>
  {/if}
</div>

<style>
  .join {
    max-width: 30rem;
    margin: 2rem auto 0;
  }
  .join h1 {
    font-size: 1.9rem;
  }
  form {
    display: grid;
    gap: 1rem;
    margin-top: 1rem;
  }
  form p {
    margin: 0;
  }
</style>
