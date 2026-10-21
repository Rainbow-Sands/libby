<script lang="ts">
  import type { SessionWorldChanges } from "@rainbot/db";
  import WorldAvatar from "./WorldAvatar.svelte";
  import { KIND_LABELS, avatarHref, transcriptHref, worldPageHref } from "$lib/world";

  let {
    changes,
    campaignId,
    sessionId,
  }: { changes: SessionWorldChanges; campaignId: string; sessionId: string } = $props();

  const created = $derived(changes.pages.filter((page) => page.created).length);
  const updated = $derived(changes.pages.length - created);
  const duplicates = $derived(changes.report?.possibleDuplicates ?? []);
  const corrections = $derived(changes.report?.nameCorrections ?? []);

  function elapsedSeconds(at: string | null): number | null {
    const match = at ? /^(\d+):([0-5]\d):([0-5]\d)$/.exec(at) : null;
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
  }
</script>

{#snippet cite(at: string | null)}
  {@const seconds = elapsedSeconds(at)}
  {#if seconds !== null}
    <a class="ts" href={transcriptHref(campaignId, sessionId, seconds)}>{at}</a>
  {/if}
{/snippet}

<div class="changes">
  {#if changes.status === null}
    <p class="empty">The world has not been updated from this session yet.</p>
  {:else if changes.status === "pending"}
    <p class="empty">Libby is still updating the world from this session.</p>
  {:else if changes.status === "failed"}
    <p class="empty">Libby could not update the world from this session.</p>
  {:else if changes.status === "skipped"}
    <p class="empty">This session had no notes for Libby to update the world from.</p>
  {:else if changes.pages.length === 0 && duplicates.length === 0}
    <p class="empty">This session did not change the world.</p>
  {:else}
    <p class="muted">
      {plural(created, "new page", "new pages")}, {updated} updated{#if duplicates.length}, {plural(
          duplicates.length,
          "possible duplicate",
          "possible duplicates",
        )}{/if}.
    </p>
  {/if}

  <ul>
    {#each duplicates as pair, index (index)}
      <li class="change">
        <div class="head">
          <span class="pill warn">Possible duplicate</span>
          <b>{pair.first}</b> <span class="muted">and</span> <b>{pair.second}</b>
        </div>
        <p class="note">{pair.reason}</p>
      </li>
    {/each}

    {#each changes.pages as change (change.slug)}
      <li class="change">
        <div class="head">
          <span class="pill {change.created ? 'ok' : 'info'}"
            >{change.created ? "New" : "Updated"}</span
          >
          <WorldAvatar
            src={avatarHref(campaignId, change.avatarId)}
            name={change.name}
            kind={change.kind}
            size="sm"
          />
          <a class="name" href={worldPageHref(campaignId, change.slug, sessionId)}
            >{change.name}</a
          >
          <span class="muted"
            >{KIND_LABELS[change.kind]}{#if change.holder}&nbsp;· held by {change.holder}{/if}</span
          >
        </div>
        <ul class="diff">
          {#if change.renamedFrom}
            <li class="meta">Renamed from “{change.renamedFrom}”</li>
          {/if}
          {#if change.status}
            <li class="meta">Status: {change.status.from ?? "none"} → {change.status.to ?? "none"}</li>
          {/if}
          {#each change.superseded as fact (fact.id)}
            <li class="del">{fact.text}</li>
          {/each}
          {#each change.added as fact (fact.id)}
            <li class="add">{fact.text} {@render cite(fact.at)}</li>
          {/each}
          {#if change.summary}
            <li class="meta">{change.summary}</li>
          {/if}
        </ul>
      </li>
    {/each}

    {#if corrections.length}
      <li class="change">
        <div class="head"><span class="pill">Spelling</span><b>Name corrections</b></div>
        <p class="note">
          {#each corrections as fix, index (index)}{#if index > 0}{" · "}{/if}“{fix.heard}” → {fix.canonical}{/each}
        </p>
      </li>
    {/if}
  </ul>
</div>

<style>
  .changes {
    display: grid;
    gap: 0.75rem;
  }
  .changes > p {
    margin: 0;
  }
  ul {
    display: grid;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .change {
    display: grid;
    gap: 0.4rem;
    padding: 0.65rem 0.85rem;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 4px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .head b,
  .name {
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--accent);
  }
  .note {
    margin: 0;
    font-size: 0.95rem;
    color: var(--ink-soft);
  }
  .diff {
    gap: 0.25rem;
    font-size: 0.95rem;
  }
  .diff li {
    padding-left: 1.1rem;
    position: relative;
  }
  .diff li::before {
    position: absolute;
    left: 0;
    font-family: var(--font-mono);
    color: var(--ink-soft);
  }
  .add::before {
    content: "+";
    color: var(--ok) !important;
  }
  .del {
    color: var(--ink-soft);
    text-decoration: line-through;
  }
  .del::before {
    content: "−";
  }
  .meta {
    color: var(--ink-soft);
    font-style: italic;
  }
  .meta::before {
    content: "·";
  }
  .pill {
    padding: 0.15em 0.6em;
    font-family: var(--font-display);
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--ink-soft);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 999px;
  }
  .pill.ok {
    color: var(--ok);
    background: var(--ok-soft);
    border-color: transparent;
  }
  .pill.info {
    color: var(--info);
    background: var(--info-soft);
    border-color: transparent;
  }
  .pill.warn {
    color: var(--warn);
    background: var(--warn-soft);
    border-color: transparent;
  }
  .ts {
    padding: 0 0.35em;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    white-space: nowrap;
    color: var(--ink-soft);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 3px;
  }
</style>
