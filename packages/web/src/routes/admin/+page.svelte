<script lang="ts">
  import { enhance } from "$app/forms";
  import Breadcrumbs from "$lib/components/Breadcrumbs.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const STATUS_LABELS = { none: "None", active: "Active" } as const;

  function lastSignIn(value: Date | null): string {
    if (!value) return "Never";
    const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 30) return `${days} days ago`;
    return new Date(value).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  }
</script>

<svelte:head><title>Admin — Libby</title></svelte:head>

<Breadcrumbs items={[{ label: "Admin" }, { label: "Members" }]} />

<div class="panel">
  <h1>Members</h1>
  <p class="muted">
    Everyone who has signed in or been added by the bot. An active subscription lets a member
    create campaigns. Joining a campaign through an invite doesn't need one.
  </p>

  <div class="table">
    <table>
      <thead>
        <tr><th>Member</th><th>Campaigns</th><th>Last sign-in</th><th>Subscription</th></tr>
      </thead>
      <tbody>
        {#each data.users as user (user.id)}
          <tr>
            <td>
              <strong>{user.username}</strong>
              {#if user.isAdmin}<span class="badge">Admin</span>{/if}
            </td>
            <td class="num">DM of {user.dmCount} · player in {user.playerCount}</td>
            <td>{lastSignIn(user.lastSeenAt)}</td>
            <td>
              <form method="POST" action="?/subscription" use:enhance>
                <input type="hidden" name="userId" value={user.id} />
                <select
                  class="input"
                  name="status"
                  value={user.subscriptionStatus}
                  aria-label="{user.username}'s subscription"
                  onchange={(event) => event.currentTarget.form?.requestSubmit()}
                >
                  {#each Object.entries(STATUS_LABELS) as [value, label] (value)}
                    <option {value}>{label}</option>
                  {/each}
                </select>
                <noscript><button type="submit" class="btn quiet">Save</button></noscript>
                {#if form && "saved" in form && form.saved === user.id}
                  <span class="saved" role="status">Saved</span>
                {:else if form?.message && form.userId === user.id}
                  <span class="form-error" role="alert">{form.message}</span>
                {/if}
                {#if user.isAdmin}<span class="muted note">Admins can always create</span>{/if}
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .table {
    overflow-x: auto;
    margin-top: 1rem;
    border: 1px solid var(--edge);
    border-radius: 4px;
    background: var(--surface);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    min-width: 36rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.6rem 0.8rem;
    border-bottom: 1px solid var(--edge);
    vertical-align: middle;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  th {
    font-family: var(--font-display);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
    background: var(--surface-sunken);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .badge {
    font-family: var(--font-display);
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--info);
    background: var(--info-soft);
    border-radius: 3px;
    padding: 0.05rem 0.4rem;
    margin-left: 0.4rem;
    vertical-align: 0.15em;
  }
  .saved {
    color: var(--ok);
    font-size: 0.9rem;
  }
  .note {
    font-size: 0.85rem;
  }
</style>
