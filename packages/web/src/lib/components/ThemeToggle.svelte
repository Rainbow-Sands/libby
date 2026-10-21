<script lang="ts">
  import { onMount } from "svelte";

  let theme = $state<"light" | "dark">("light");

  function effectiveTheme(): "light" | "dark" {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") return attr;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  onMount(() => {
    theme = effectiveTheme();
  });

  function toggle() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    // Persist in a cookie so the server can render the right theme on next load.
    document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
  }
</script>

<button
  class="theme-toggle"
  onclick={toggle}
  aria-label="Toggle light and dark theme"
  title="Toggle theme"
>
  {#if theme === "dark"}
    <!-- moon -->
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
      />
    </svg>
  {:else}
    <!-- sun -->
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </g>
    </svg>
  {/if}
</button>

<style>
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    color: var(--gold);
    background: transparent;
    border: 1px solid var(--edge);
    border-radius: 8px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .theme-toggle:hover {
    color: var(--accent-bright);
    border-color: var(--gold);
  }
</style>
