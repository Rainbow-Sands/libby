<script lang="ts">
  import type { WorldPageKind } from "@rainbot/db";
  import { speakerHue } from "$lib/speakers";

  type Size = "xs" | "sm" | "md" | "lg";

  let {
    src,
    name,
    kind,
    size = "sm",
  }: { src: string | null; name: string; kind: WorldPageKind; size?: Size } = $props();

  // People get initials; everything else gets a small icon for its kind.
  const GLYPHS: Partial<Record<WorldPageKind, string>> = {
    location: "M5 20h14M7 20V9l5-4 5 4v11M10 20v-4h4v4",
    item: "M6 9l3-4h6l3 4-6 10zM6 9h12M10 5l2 4 2-4M12 9v10",
    faction: "M7 21V4M7 5h10l-2 3.5 2 3.5H7",
    quest: "M7 4h9a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1H8a2 2 0 0 1-2-2V5M9 9h6M9 12h6M9 15h4",
    other: "M12 4l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z",
  };

  const initials = $derived(
    name
      .replace(/^(the|a|an)\s+/i, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word.charAt(0).toLocaleUpperCase())
      .join("") || "?",
  );
  const glyph = $derived(GLYPHS[kind]);
</script>

{#if src}
  <img class="av {size}" {src} alt="" loading="lazy" decoding="async" />
{:else}
  <span class="av ph {size}" style={`--h: ${speakerHue(name)}`} aria-hidden="true">
    {#if glyph}
      <svg viewBox="0 0 24 24"><path d={glyph} /></svg>
    {:else}
      {initials}
    {/if}
  </span>
{/if}

<style>
  .av {
    --size: 1.6rem;
    flex: 0 0 auto;
    display: inline-grid;
    place-items: center;
    width: var(--size);
    height: var(--size);
    border: 1.5px solid var(--gold);
    /* A rounded square, at every size. */
    border-radius: 24%;
    object-fit: cover;
    vertical-align: middle;
    background: var(--surface-sunken);
  }
  .ph {
    overflow: hidden;
    font-family: var(--font-display);
    font-size: calc(var(--size) * 0.38);
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0.02em;
    color: hsl(var(--h) 45% 26%);
    background: hsl(var(--h) 38% 84%);
    border-style: dashed;
    border-color: color-mix(in srgb, var(--gold) 70%, transparent);
  }
  :global(:root[data-theme="dark"]) .ph {
    color: hsl(var(--h) 45% 78%);
    background: hsl(var(--h) 25% 22%);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme])) .ph {
      color: hsl(var(--h) 45% 78%);
      background: hsl(var(--h) 25% 22%);
    }
  }
  svg {
    width: 58%;
    height: 58%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .xs {
    --size: 1.15rem;
    border-width: 1px;
  }
  .sm {
    --size: 1.6rem;
  }
  .md {
    --size: 2.4rem;
  }
  .lg {
    --size: 5.5rem;
    border-width: 2px;
  }
</style>
