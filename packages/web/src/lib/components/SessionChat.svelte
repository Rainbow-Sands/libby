<script lang="ts">
  import { untrack } from "svelte";
  import { marked } from "marked";
  import { Chat } from "@ai-sdk/svelte";
  import { DefaultChatTransport, type UIMessage } from "ai";

  let { sessionId, campaignId }: { sessionId: string; campaignId: string } =
    $props();

  // Route params are fixed for this component's lifetime (a route change
  // remounts it), so capturing them once at construction is intentional.
  const chat = untrack(
    () =>
      new Chat({
        transport: new DefaultChatTransport({
          api: `/campaigns/${campaignId}/sessions/${sessionId}/chat`,
        }),
      })
  );

  let input = $state("");

  const busy = $derived(
    chat.status === "submitted" || chat.status === "streaming"
  );

  function messageText(message: UIMessage): string {
    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  }

  function messageReasoning(message: UIMessage): {
    text: string;
    streaming: boolean;
  } {
    const parts = message.parts.filter((part) => part.type === "reasoning");
    return {
      text: parts.map((part) => part.text).join(""),
      streaming: parts.some((part) => part.state === "streaming"),
    };
  }

  // Keep the placeholder up from the moment we send until the first token of
  // the assistant reply arrives (there's a gap where an empty assistant
  // message exists but has no text yet).
  const awaitingResponse = $derived.by(() => {
    if (!busy) return false;
    const last = chat.messages.at(-1);
    return (
      !last ||
      last.role !== "assistant" ||
      (messageText(last) === "" && messageReasoning(last).text === "")
    );
  });

  function renderMarkdown(text: string): string {
    return marked(text) as string;
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    input = "";
    chat.sendMessage({ text });
  }
</script>

<section class="chat" aria-label="Ask about this session">
  <h2>Ask Libby</h2>
  <p class="muted hint">
    Ask questions about what happened this session. Answers come only from the
    recording.
  </p>

  <div class="log" role="log" aria-live="polite">
    {#each chat.messages as message (message.id)}
      {@const text = messageText(message)}
      {@const reasoning = messageReasoning(message)}
      {#if message.role === "assistant"}
        {#if text || reasoning.text}
          <div class="message assistant">
            {#if reasoning.text}
              <details class="reasoning" open={reasoning.streaming}>
                <summary>{reasoning.streaming ? "Libby is thinking…" : "Libby's thinking"}</summary>
                <div class="prose reasoning-content">
                  {@html renderMarkdown(reasoning.text)}
                </div>
              </details>
            {/if}
            {#if text}
              <div class="prose">{@html renderMarkdown(text)}</div>
            {/if}
          </div>
        {/if}
      {:else}
        <div class="message user"><p>{text}</p></div>
      {/if}
    {/each}
    {#if awaitingResponse}
      <div class="message assistant">
        <p class="thinking">Libby searches the mirrorways…</p>
      </div>
    {/if}
    {#if chat.error}
      <p class="error">Something went wrong. Please try again.</p>
    {/if}
  </div>

  <form onsubmit={submit}>
    <input
      type="text"
      bind:value={input}
      placeholder="What did the party decide to do?"
      autocomplete="off"
      disabled={busy}
    />
    <button type="submit" disabled={busy || input.trim() === ""}>Ask</button>
  </form>
</section>

<style>
  .chat {
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--edge);
  }
  .hint {
    margin-top: -0.25rem;
  }
  .log {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 1rem 0;
  }
  .message {
    max-width: 90%;
    padding: 0.6rem 0.9rem;
    border-radius: 6px;
    line-height: 1.6;
  }
  .message.user {
    align-self: flex-end;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
  }
  .message.assistant {
    align-self: flex-start;
    background: var(--surface);
    border: 1px solid var(--edge);
    border-left: 3px solid var(--gold);
  }
  .message p {
    margin: 0;
  }
  .thinking {
    color: var(--ink-soft);
    font-style: italic;
  }
  .reasoning {
    margin-bottom: 0.6rem;
    color: var(--ink-soft);
    border-bottom: 1px solid var(--edge);
    padding-bottom: 0.5rem;
  }
  .reasoning summary {
    cursor: pointer;
    font-family: var(--font-display);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .reasoning-content {
    margin-top: 0.5rem;
    font-size: 0.9rem;
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
  }
  input {
    flex: 1;
    padding: 0.55rem 0.75rem;
    font-family: var(--font-body);
    font-size: 1rem;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
  }
  input:focus {
    outline: none;
    border-color: var(--gold);
  }
  button {
    padding: 0.55rem 1.25rem;
    font-family: var(--font-display);
    color: var(--surface);
    background: var(--accent);
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
