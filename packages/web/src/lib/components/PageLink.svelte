<script lang="ts">
  import WorldAvatar from "./WorldAvatar.svelte";
  import { KIND_LABELS, avatarHref, worldPageHref, type WorldLinkPage } from "$lib/world";

  // A plain inline link to a world page. Hovering or focusing it shows the
  // page's avatar and first line; touch screens just follow the link.
  let {
    campaignId,
    asOf = null,
    page,
    text,
  }: { campaignId: string; asOf?: string | null; page: WorldLinkPage; text?: string } = $props();
</script>

<span class="hov"
  ><a class="wl" href={worldPageHref(campaignId, page.slug, asOf)}>{text ?? page.name}</a
  ><span class="card" role="tooltip"
    ><WorldAvatar
      src={avatarHref(campaignId, page.avatarId)}
      name={page.name}
      kind={page.kind}
      size="md"
    /><span class="body"
      ><span class="kind">{KIND_LABELS[page.kind]}{page.status ? ` · ${page.status}` : ""}</span
      ><b>{page.name}</b>{#if page.line}<span class="line">{page.line}</span>{/if}</span
    ></span
  ></span
>

<style>
  .hov {
    position: relative;
    display: inline;
  }
  .wl {
    border-bottom: 1px dotted color-mix(in srgb, var(--link) 60%, transparent);
  }
  .wl:hover {
    text-decoration: none;
    border-bottom-style: solid;
  }
  .card {
    position: absolute;
    top: calc(100% + 0.35rem);
    left: 0;
    z-index: 20;
    display: none;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.65rem;
    align-items: center;
    width: 17rem;
    max-width: 80vw;
    padding: 0.6rem 0.7rem;
    font-family: var(--font-body);
    font-size: 0.88rem;
    font-style: normal;
    font-weight: 400;
    line-height: 1.4;
    text-align: left;
    text-transform: none;
    letter-spacing: normal;
    white-space: normal;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
    box-shadow: 0 8px 24px var(--shadow);
    pointer-events: none;
  }
  .body {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }
  .kind {
    font-family: var(--font-display);
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gold);
  }
  b {
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--accent);
  }
  .line {
    color: var(--ink-soft);
  }
  @media (hover: hover) {
    .hov:hover .card,
    .hov:focus-within .card {
      display: grid;
    }
  }
</style>
