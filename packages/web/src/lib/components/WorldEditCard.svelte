<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { KIND_LABELS, worldPageHref } from "$lib/world";
  import type { ProposedWorldEdit } from "$lib/world-edit";

  let { proposal, campaignId }: { proposal: ProposedWorldEdit; campaignId: string } = $props();

  type CardState =
    | { kind: "proposed" }
    | { kind: "working" }
    | { kind: "applied"; editId: string }
    | { kind: "undone" }
    | { kind: "cancelled" };
  let card = $state<CardState>({ kind: "proposed" });
  let failure = $state<string | null>(null);

  const pageCount = $derived(proposal.pages.length + proposal.relinked.length);
  const changeCount = $derived(proposal.changes.length);

  function session(id: string | null): string | null {
    const number = id ? proposal.sessionNumbers[id] : undefined;
    return number ? `Session ${number}` : null;
  }

  async function post(url: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof result.error === "string" ? result.error : "That didn't work. Try again.");
    }
    return result;
  }

  async function apply() {
    failure = null;
    card = { kind: "working" };
    try {
      const result = await post(`/campaigns/${campaignId}/world/edits`, {
        summary: proposal.summary,
        remember: proposal.remember,
        changes: proposal.changes,
      });
      card = { kind: "applied", editId: String(result.editId) };
      await invalidateAll();
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      card = { kind: "proposed" };
    }
  }

  async function undo(editId: string) {
    failure = null;
    card = { kind: "working" };
    try {
      await post(`/campaigns/${campaignId}/world/edits/${editId}/undo`);
      card = { kind: "undone" };
      await invalidateAll();
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      card = { kind: "applied", editId };
    }
  }

  const PILLS = { new: "New page", edited: "Edit", removed: "Removed" } as const;
</script>

{#if proposal.errors.length}
  <p class="problem">Libby's proposal didn't fit the world: {proposal.errors.join(" ")}</p>
{:else}
  <div class="proposal" class:settled={card.kind === "cancelled" || card.kind === "undone"}>
    <header>
      <h4>{changeCount} {changeCount === 1 ? "change" : "changes"}</h4>
      <span class="scope">
        {#if session(proposal.fromSessionId)}Affects {session(proposal.fromSessionId)} onwards ·{/if}
        {pageCount}
        {pageCount === 1 ? "page" : "pages"}
      </span>
    </header>

    {#each proposal.pages as page (page.slug)}
      <section class="change">
        <div class="change-head">
          <span class="pill {page.change}">{PILLS[page.change]}</span>
          {#if page.change === "removed"}
            <span class="name">{page.name}</span>
          {:else}
            <a class="name" href={worldPageHref(campaignId, page.slug)}>{page.name}</a>
          {/if}
          <span class="kind">
            {KIND_LABELS[page.kind]}{#if page.change === "new" && session(page.fromSessionId)}
              · from {session(page.fromSessionId)}{/if}
          </span>
        </div>
        {#if page.change === "removed"}
          <p class="note">Folded into {page.mergedInto}. Its facts and names move there.</p>
        {:else if page.rows.length}
          <dl class="diff">
            {#each page.rows as row (row.label)}
              <dt>{row.label}</dt>
              <dd>
                {#each row.removed as value, index (index)}<del>{value}</del>{" "}{/each}
                {#each row.added as value, index (index)}<ins>{value}</ins>{" "}{/each}
              </dd>
            {/each}
          </dl>
        {:else}
          <p class="note">Only links and history change.</p>
        {/if}
      </section>
    {/each}

    {#if proposal.relinked.length}
      <section class="change">
        <div class="change-head">
          <span class="pill links">Links</span>
          <span class="name">
            {proposal.relinked.length}
            {proposal.relinked.length === 1 ? "other page" : "other pages"}
          </span>
        </div>
        <p class="note">{proposal.relinked.join(", ")} will link to the page that's kept.</p>
      </section>
    {/if}

    {#if proposal.remember}
      <section class="remember">
        <h5>Libby will remember</h5>
        <p>“{proposal.remember}”</p>
      </section>
    {/if}

    <footer role="status">
      {#if card.kind === "proposed"}
        <button class="primary" type="button" onclick={apply}>
          Apply {changeCount}
          {changeCount === 1 ? "change" : "changes"}
        </button>
        <button type="button" onclick={() => (card = { kind: "cancelled" })}>Cancel</button>
        <span class="note">Nothing changes until you apply.</span>
      {:else if card.kind === "working"}
        <span class="note">Working…</span>
      {:else if card.kind === "applied"}
        {@const editId = card.editId}
        <span class="done">Applied.</span>
        <button type="button" onclick={() => undo(editId)}>Undo</button>
      {:else if card.kind === "undone"}
        <span class="note">Undone. The world is back as it was.</span>
      {:else}
        <span class="note">Cancelled. Nothing was changed.</span>
      {/if}
    </footer>
    {#if failure}
      <p class="problem">{failure}</p>
    {/if}
  </div>
{/if}

<style>
  .proposal {
    display: grid;
    border: 1px solid var(--edge);
    border-radius: 6px;
    background: var(--surface-sunken);
    font-size: 0.95rem;
  }
  .proposal.settled {
    opacity: 0.7;
  }
  header,
  .change,
  .remember,
  footer {
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid var(--edge);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.75rem;
    justify-content: space-between;
    align-items: baseline;
  }
  h4,
  h5 {
    margin: 0;
    font-family: var(--font-display);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  h4 {
    font-size: 0.85rem;
    color: var(--ink);
  }
  h5 {
    font-size: 0.72rem;
    color: var(--ink-soft);
  }
  .scope,
  .kind,
  .note {
    color: var(--ink-soft);
  }
  .kind {
    font-style: italic;
    font-size: 0.85rem;
  }
  .change {
    display: grid;
    gap: 0.4rem;
  }
  .change-head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .name {
    font-weight: 600;
  }
  .pill {
    font-family: var(--font-display);
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
  }
  .pill.new {
    background: var(--ok-soft);
    color: var(--ok);
  }
  .pill.edited {
    background: var(--info-soft);
    color: var(--info);
  }
  .pill.removed {
    background: var(--warn-soft);
    color: var(--accent-bright);
  }
  .pill.links {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .diff {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.25rem 0.75rem;
    margin: 0;
  }
  .diff dt {
    color: var(--ink-soft);
  }
  .diff dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  del,
  ins {
    padding: 0 0.2rem;
    border-radius: 3px;
    text-decoration-thickness: 1px;
  }
  del {
    color: var(--accent-bright);
    background: var(--warn-soft);
  }
  ins {
    color: var(--ok);
    background: var(--ok-soft);
    text-decoration: none;
  }
  .remember p {
    margin: 0.2rem 0 0;
    font-style: italic;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    border-bottom: 0;
  }
  .done {
    color: var(--ok);
  }
  button {
    padding: 0.35rem 0.85rem;
    font-family: var(--font-display);
    font-size: 0.78rem;
    letter-spacing: 0.05em;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 4px;
    cursor: pointer;
  }
  button.primary {
    color: var(--surface);
    background: var(--accent);
    border-color: var(--accent);
  }
  button:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  .problem {
    margin: 0;
    padding: 0.5rem 0.85rem;
    color: var(--accent-bright);
  }
  @media (max-width: 30rem) {
    .diff {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
