<script lang="ts">
  import { tick, untrack } from "svelte";
  import { page } from "$app/state";
  import { marked } from "marked";
  import { Chat } from "@ai-sdk/svelte";
  import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";
  import WorldEditCard from "./WorldEditCard.svelte";
  import { KIND_LABELS } from "$lib/world";
  import { askLibby, saveWidth, PANE_MIN } from "$lib/ask-libby.svelte";
  import type { ProposedWorldEdit } from "$lib/world-edit";
  import type { WorldPageKind } from "@rainbot/db";

  // One conversation per campaign, kept while the person moves between its
  // pages. Each question is sent with the page they are on, so "this page"
  // means what they are looking at.
  let { campaignId }: { campaignId: string } = $props();

  type Context =
    | { kind: "campaign" }
    | { kind: "world" }
    | { kind: "page"; slug: string }
    | { kind: "session"; sessionId: string };

  // Beside the page when the window can spare the pane and still leave the
  // page this much room; full screen otherwise.
  const PAGE_MIN = 360;
  let input = $state("");
  let viewport = $state(1280);
  const fullscreen = $derived(viewport < PANE_MIN + PAGE_MIN);
  const paneWidth = $derived(Math.min(askLibby.width, viewport - PAGE_MIN));
  // Cleared by the chip's ✕ until the person moves to another page.
  let scoped = $state(true);
  let inputEl = $state<HTMLInputElement | null>(null);

  const here = $derived.by((): { context: Context; label: string | null } => {
    const data = page.data as Record<string, any>;
    switch (page.route.id) {
      case "/campaigns/[id]/world/[slug]": {
        const detail = data.page;
        const kind = detail?.kind as WorldPageKind | undefined;
        const name = detail?.content?.name ?? page.params.slug;
        return {
          context: { kind: "page", slug: page.params.slug ?? "" },
          label: kind ? `${name} · ${KIND_LABELS[kind]}` : name,
        };
      }
      case "/campaigns/[id]/sessions/[sessionId]": {
        const number = data.sequence?.number;
        const title = data.session?.title ?? "Untitled session";
        return {
          context: { kind: "session", sessionId: page.params.sessionId ?? "" },
          label: number ? `Session ${number} · ${title}` : title,
        };
      }
      case "/campaigns/[id]/world":
        return { context: { kind: "world" }, label: "The world" };
      default:
        return { context: { kind: "campaign" }, label: null };
    }
  });

  $effect(() => {
    void page.url.pathname;
    untrack(() => (scoped = true));
  });

  const context = $derived<Context>(scoped ? here.context : { kind: "campaign" });

  const chat = untrack(
    () =>
      new Chat({
        transport: new DefaultChatTransport({
          api: `/campaigns/${campaignId}/chat`,
          body: () => ({ context }),
        }),
      }),
  );

  const busy = $derived(chat.status === "submitted" || chat.status === "streaming");
  const awaitingResponse = $derived.by(() => {
    if (!busy) return false;
    const last = chat.messages.at(-1);
    return !last || last.role !== "assistant" || last.parts.every((part) => part.type === "step-start");
  });

  function messageText(message: UIMessage): string {
    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  }

  function renderMarkdown(text: string): string {
    return marked(text) as string;
  }

  const TOOL_LINES: Record<string, [string, string]> = {
    readPage: ["Reading a world page", "Read a world page"],
    readSession: ["Reading a session's notes", "Read a session's notes"],
    readTranscript: ["Reading a session's transcript", "Read a session's transcript"],
  };

  function toolLine(name: string, done: boolean): string {
    const [doing, did] = TOOL_LINES[name] ?? ["Checking the records", "Checked the records"];
    return done ? did : `${doing}…`;
  }

  $effect(() => {
    if (!askLibby.open) return;
    void tick().then(() => inputEl?.focus());
  });

  // Dragging the pane's left edge resizes it.
  function startResize(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => saveWidth(viewport - moveEvent.clientX);
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
  }

  function resizeByKey(event: KeyboardEvent) {
    if (event.key === "ArrowLeft") saveWidth(askLibby.width + 24);
    if (event.key === "ArrowRight") saveWidth(askLibby.width - 24);
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    input = "";
    chat.sendMessage({ text });
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && askLibby.open) askLibby.open = false;
  }
</script>

<svelte:window {onkeydown} bind:innerWidth={viewport} />

<!-- Kept mounted while closed, so the conversation survives. -->
<aside
  class="pane"
  class:fullscreen
  hidden={!askLibby.open}
  aria-label="Ask Libby"
  style:width={fullscreen ? null : `${paneWidth}px`}
>
  {#if !fullscreen}
    <button
      class="grip"
      type="button"
      aria-label="Resize Ask Libby with the arrow keys or by dragging"
      onpointerdown={startResize}
      onkeydown={resizeByKey}
    ></button>
  {/if}

  {#if scoped && here.label}
    <div class="context">
      Looking at
      <span class="chip">
        {here.label}
        <button type="button" aria-label="Ask about the whole campaign instead" onclick={() => (scoped = false)}
          >✕</button
        >
      </span>
    </div>
  {:else}
    <div class="context">Asking about the whole campaign</div>
  {/if}

  <div class="log" role="log" aria-live="polite">
    {#if chat.messages.length === 0}
      <p class="hint">
        Ask what happened, or tell Libby when the world gets something wrong. She'll show you exactly what
        she'd change before anything is saved.
      </p>
    {/if}
    {#each chat.messages as message (message.id)}
      {#if message.role === "user"}
        <div class="message user"><p>{messageText(message)}</p></div>
      {:else}
        <div class="message assistant">
          {#each message.parts as part, index (index)}
            {#if part.type === "reasoning" && part.text}
              <details class="reasoning" open={part.state === "streaming"}>
                <summary>{part.state === "streaming" ? "Libby is thinking…" : "Libby's thinking"}</summary>
                <div class="prose reasoning-content">{@html renderMarkdown(part.text)}</div>
              </details>
            {:else if part.type === "text" && part.text}
              <div class="prose">{@html renderMarkdown(part.text)}</div>
            {:else if isToolUIPart(part)}
              {@const name = getToolName(part)}
              {#if name === "proposeChanges"}
                {#if part.state === "output-available"}
                  <WorldEditCard proposal={part.output as ProposedWorldEdit} {campaignId} />
                {:else if part.state === "output-error"}
                  <p class="error">Libby couldn't put that change together.</p>
                {:else}
                  <p class="tool">Preparing changes…</p>
                {/if}
              {:else}
                <p class="tool">{toolLine(name, part.state === "output-available")}</p>
              {/if}
            {/if}
          {/each}
        </div>
      {/if}
    {/each}
    {#if awaitingResponse}
      <div class="message assistant"><p class="thinking">Libby searches the mirrorways…</p></div>
    {/if}
    {#if chat.error}
      <p class="error">Something went wrong. Please try again.</p>
    {/if}
  </div>

  <form onsubmit={submit}>
    <input
      bind:this={inputEl}
      type="text"
      bind:value={input}
      placeholder={here.context.kind === "page"
        ? "Ask about this page, or say what's wrong"
        : "What did the party decide to do?"}
      autocomplete="off"
      aria-label="Message Libby"
      disabled={busy}
    />
    <button class="send" type="submit" disabled={busy || input.trim() === ""}>Ask</button>
  </form>
</aside>

<style>
  .pane[hidden] {
    display: none;
  }
  /* A column beside the page that stays in view while the page scrolls. */
  .pane {
    position: sticky;
    top: var(--header-height, 0px);
    flex: none;
    height: calc(100dvh - var(--header-height, 0px));
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-left: 1px solid var(--edge);
    container-type: inline-size;
  }
  /* Under the header, whose Ask Libby button closes it again. */
  .pane.fullscreen {
    position: fixed;
    inset: var(--header-height, 0px) 0 0 0;
    z-index: 30;
    height: auto;
    border-left: 0;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .grip {
    padding: 0;
    border: 0;
    background: none;
    position: absolute;
    top: 0;
    bottom: 0;
    left: -4px;
    width: 8px;
    cursor: col-resize;
    z-index: 1;
  }
  .grip:hover,
  .grip:focus-visible {
    outline: none;
    background: linear-gradient(
      to right,
      transparent 3px,
      var(--gold) 3px,
      var(--gold) 5px,
      transparent 5px
    );
  }
  .context {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    padding: 0.6rem 1rem 0;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
  .chip {
    display: inline-flex;
    gap: 0.3rem;
    align-items: center;
    padding: 0.05rem 0.2rem 0.05rem 0.6rem;
    border: 1px solid var(--edge);
    border-radius: 999px;
    background: var(--surface-sunken);
    color: var(--ink);
  }
  .chip button {
    border: 0;
    background: none;
    color: var(--ink-soft);
    cursor: pointer;
    padding: 0 0.35rem;
  }
  .log {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
  }
  .hint {
    margin: 0;
    color: var(--ink-soft);
    font-style: italic;
  }
  .message {
    display: grid;
    gap: 0.5rem;
    max-width: 100%;
    line-height: 1.55;
  }
  .message.user {
    justify-self: end;
    align-self: flex-end;
    max-width: 90%;
    padding: 0.5rem 0.8rem;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 6px;
  }
  .message.assistant {
    align-self: stretch;
    padding-left: 0.75rem;
    border-left: 3px solid var(--gold);
  }
  .message p {
    margin: 0;
  }
  .tool {
    color: var(--ink-soft);
    font-size: 0.85rem;
    font-style: italic;
  }
  .thinking {
    color: var(--ink-soft);
    font-style: italic;
  }
  .reasoning {
    color: var(--ink-soft);
  }
  .reasoning summary {
    cursor: pointer;
    font-family: var(--font-display);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .reasoning-content {
    margin-top: 0.4rem;
    font-size: 0.88rem;
  }
  .error {
    color: var(--accent-bright);
  }
  .prose :global(p) {
    margin: 0.4em 0;
  }
  .prose :global(p:first-child) {
    margin-top: 0;
  }
  .prose :global(p:last-child) {
    margin-bottom: 0;
  }
  .prose :global(ul),
  .prose :global(ol) {
    padding-left: 1.4em;
    margin: 0.4em 0;
  }
  .prose :global(strong) {
    color: var(--gold);
  }
  form {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--edge);
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 0.5rem 0.7rem;
    font-family: var(--font-body);
    font-size: 1rem;
    color: var(--ink);
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 6px;
  }
  input:focus {
    outline: none;
    border-color: var(--gold);
  }
  .send {
    padding: 0.5rem 1.1rem;
    font-family: var(--font-display);
    color: var(--surface);
    background: var(--accent);
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }
  .send:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
</style>
