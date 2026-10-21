<script lang="ts">
  // The trail above a page's panel. The last item is the current page and is
  // not a link.
  let { items }: { items: { label: string; href?: string }[] } = $props();
</script>

<nav class="crumbs" aria-label="Breadcrumb">
  {#each items as item, index (index)}
    {#if index > 0}<span aria-hidden="true">/</span>{/if}
    {#if item.href}
      <a href={item.href}>{item.label}</a>
    {:else}
      <span aria-current="page">{item.label}</span>
    {/if}
  {/each}
</nav>
