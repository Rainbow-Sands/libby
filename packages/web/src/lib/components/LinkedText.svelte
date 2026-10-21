<script lang="ts">
  import type { LinkedText } from "@rainbot/db";
  import PageLink from "./PageLink.svelte";
  import type { WorldLinks } from "$lib/world";

  let { segments, world }: { segments: LinkedText; world: WorldLinks | null } = $props();

  const bySlug = $derived(new Map(world?.pages.map((page) => [page.slug, page])));
</script>

{#each segments as segment, index (index)}{@const page = segment.slug
    ? bySlug.get(segment.slug)
    : undefined}{#if page && world}<PageLink
      campaignId={world.campaignId}
      asOf={world.asOf}
      {page}
      text={segment.text}
    />{:else}{segment.text}{/if}{/each}
