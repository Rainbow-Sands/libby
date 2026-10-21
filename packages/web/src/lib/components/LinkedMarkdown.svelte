<script lang="ts">
  import LinkedText from "./LinkedText.svelte";
  import type { Block, Inline } from "$lib/linked-markdown";
  import type { WorldLinks } from "$lib/world";

  let { blocks, world }: { blocks: Block[]; world: WorldLinks | null } = $props();
</script>

{#snippet inlines(children: Inline[])}{#each children as child, index (index)}{#if child.type === "text"}<LinkedText
        segments={child.segments}
        {world}
      />{:else if child.type === "strong"}<strong>{@render inlines(child.children)}</strong
      >{:else if child.type === "em"}<em>{@render inlines(child.children)}</em
      >{:else if child.type === "del"}<del>{@render inlines(child.children)}</del
      >{:else if child.type === "code"}<code>{child.text}</code
      >{:else if child.type === "link"}<a href={child.href}>{@render inlines(child.children)}</a
      >{:else if child.type === "br"}<br />{/if}{/each}{/snippet}

{#each blocks as block, index (index)}
  {#if block.type === "paragraph"}
    <p>{@render inlines(block.children)}</p>
  {:else}
    {@html block.html}
  {/if}
{/each}
