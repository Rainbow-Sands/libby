<script lang="ts">
  import type { WorldPageKind } from "@rainbot/db";
  import { invalidateAll } from "$app/navigation";
  import WorldAvatar from "./WorldAvatar.svelte";
  import { avatarHref } from "$lib/world";

  let {
    campaignId,
    slug,
    name,
    kind,
    avatarId,
  }: {
    campaignId: string;
    slug: string;
    name: string;
    kind: WorldPageKind;
    avatarId: string | null;
  } = $props();

  // The chosen picture is cropped to a square in the browser and resized, so
  // the server only ever stores a small image.
  const PREVIEW = 240;
  const OUTPUT = 512;
  const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
  const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

  let dialog = $state<HTMLDialogElement>();
  let canvas = $state<HTMLCanvasElement>();
  let image = $state<HTMLImageElement | null>(null);
  let zoom = $state(1);
  let offset = $state({ x: 0, y: 0 });
  let drag: { x: number; y: number; start: { x: number; y: number } } | null = null;
  let busy = $state(false);
  let message = $state<string | null>(null);

  const endpoint = $derived(`/campaigns/${campaignId}/world/${encodeURIComponent(slug)}/avatar`);

  function open() {
    image = null;
    message = null;
    zoom = 1;
    offset = { x: 0, y: 0 };
    dialog?.showModal();
  }

  function close() {
    dialog?.close();
  }

  function choose(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!ACCEPT.includes(file.type)) {
      message = "Choose a PNG, JPEG or WebP picture.";
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      message = "That picture is larger than 5 MB.";
      return;
    }
    const url = URL.createObjectURL(file);
    const loaded = new Image();
    loaded.addEventListener(
      "load",
      () => {
        image = loaded;
        zoom = 1;
        offset = { x: 0, y: 0 };
        message = null;
      },
      { once: true },
    );
    loaded.addEventListener(
      "error",
      () => {
        message = "That file could not be read as a picture.";
        URL.revokeObjectURL(url);
      },
      { once: true },
    );
    loaded.src = url;
  }

  // Where the picture lands on a square of the given size: scaled to cover it,
  // zoomed, and shifted by the drag offset, never leaving a gap at an edge.
  function placement(size: number) {
    if (!image) return null;
    const ratio = size / PREVIEW;
    const scale = Math.max(size / image.width, size / image.height) * zoom;
    const width = image.width * scale;
    const height = image.height * scale;
    const maxX = (width - size) / 2;
    const maxY = (height - size) / 2;
    const x = Math.min(maxX, Math.max(-maxX, offset.x * ratio));
    const y = Math.min(maxY, Math.max(-maxY, offset.y * ratio));
    return { left: (size - width) / 2 + x, top: (size - height) / 2 + y, width, height };
  }

  function draw(target: HTMLCanvasElement, size: number) {
    const place = placement(size);
    const context = target.getContext("2d");
    if (!place || !context || !image) return;
    context.clearRect(0, 0, size, size);
    context.imageSmoothingQuality = "high";
    context.drawImage(image, place.left, place.top, place.width, place.height);
  }

  $effect(() => {
    // Redraw whenever the picture, zoom or position changes.
    void [image, zoom, offset.x, offset.y];
    if (canvas) draw(canvas, PREVIEW);
  });

  function clampOffset() {
    const place = placement(PREVIEW);
    if (!place) return;
    offset = {
      x: place.left + (place.width - PREVIEW) / 2,
      y: place.top + (place.height - PREVIEW) / 2,
    };
  }

  function pointerDown(event: PointerEvent) {
    if (!image) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, start: { ...offset } };
  }

  function pointerMove(event: PointerEvent) {
    if (!drag) return;
    offset = {
      x: drag.start.x + event.clientX - drag.x,
      y: drag.start.y + event.clientY - drag.y,
    };
  }

  function pointerUp() {
    drag = null;
    clampOffset();
  }

  async function save() {
    if (!image) return;
    busy = true;
    message = null;
    try {
      const output = document.createElement("canvas");
      output.width = OUTPUT;
      output.height = OUTPUT;
      draw(output, OUTPUT);
      // Browsers that cannot encode WebP fall back to PNG on their own.
      const blob = await new Promise<Blob | null>((resolve) =>
        output.toBlob(resolve, "image/webp", 0.9),
      );
      if (!blob) throw new Error("The picture could not be prepared.");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": blob.type },
        body: blob,
      });
      if (!response.ok) throw new Error((await response.text()) || "The upload failed.");
      close();
      await invalidateAll();
    } catch (error) {
      message = error instanceof Error ? error.message : "The upload failed.";
    } finally {
      busy = false;
    }
  }

  async function remove() {
    busy = true;
    message = null;
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.text()) || "The avatar was not removed.");
      close();
      await invalidateAll();
    } catch (error) {
      message = error instanceof Error ? error.message : "The avatar was not removed.";
    } finally {
      busy = false;
    }
  }
</script>

<div class="slot">
  <WorldAvatar src={avatarHref(campaignId, avatarId)} {name} {kind} size="lg" />
  <button
    class="camera"
    class:invite={!avatarId}
    type="button"
    onclick={open}
    aria-label={avatarId ? "Change avatar" : "Upload avatar"}
    title={avatarId ? "Change avatar" : "Upload avatar"}
    ><svg viewBox="0 0 24 24" aria-hidden="true"
      ><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg
    ></button
  >
</div>

<dialog bind:this={dialog} aria-labelledby="avatar-title">
  <form method="dialog" class="sheet" onsubmit={(event) => event.preventDefault()}>
    <h2 id="avatar-title">Avatar for {name}</h2>

    {#if image}
      <div
        class="crop"
        role="presentation"
        onpointerdown={pointerDown}
        onpointermove={pointerMove}
        onpointerup={pointerUp}
        onpointercancel={pointerUp}
      >
        <canvas bind:this={canvas} width={PREVIEW} height={PREVIEW}></canvas>
        <span class="ring" aria-hidden="true"></span>
      </div>
      <label class="zoom">
        <span>Zoom</span>
        <input type="range" min="1" max="4" step="0.01" bind:value={zoom} onchange={clampOffset} />
      </label>
      <p class="hint">Drag the picture to position it in the frame.</p>
    {:else}
      <label class="pick">
        <input type="file" accept={ACCEPT.join(",")} onchange={choose} />
        <span>Choose a picture</span>
      </label>
    {/if}
    <p class="hint">PNG, JPEG or WebP, up to 5 MB. It is cropped to a square before uploading.</p>
    {#if message}<p class="error" role="alert">{message}</p>{/if}

    <div class="actions">
      {#if avatarId}
        <button class="small" type="button" disabled={busy} onclick={remove}>Remove avatar</button>
      {/if}
      {#if image}
        <label class="small change">
          <input type="file" accept={ACCEPT.join(",")} onchange={choose} />
          Choose another
        </label>
      {/if}
      <button class="small" type="button" onclick={close}>Cancel</button>
      <button class="small primary" type="button" disabled={!image || busy} onclick={save}
        >{busy ? "Saving…" : "Save"}</button
      >
    </div>
  </form>
</dialog>

<style>
  .slot {
    position: relative;
    flex: 0 0 auto;
  }
  .camera {
    position: absolute;
    right: -0.5rem;
    bottom: -0.5rem;
    display: grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    padding: 0;
    color: var(--ink);
    cursor: pointer;
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 10px;
    box-shadow: 0 2px 6px var(--shadow);
  }
  .camera:hover {
    border-color: var(--gold);
  }
  .camera.invite {
    color: var(--info);
    background: var(--info-soft);
    border-color: color-mix(in srgb, var(--info) 45%, var(--edge));
  }
  .camera svg {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .small {
    padding: 0.15rem 0.5rem;
    font-family: var(--font-display);
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink);
    cursor: pointer;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 3px;
  }
  .small:hover:not(:disabled) {
    border-color: var(--gold);
  }
  .small:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .small.primary {
    color: var(--surface);
    background: var(--accent);
    border-color: var(--accent);
  }
  dialog {
    width: min(26rem, calc(100vw - 2rem));
    padding: 0;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
    box-shadow: 0 10px 30px var(--shadow);
  }
  dialog::backdrop {
    background: rgba(20, 14, 8, 0.45);
  }
  .sheet {
    display: grid;
    gap: 0.8rem;
    padding: 1rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .crop {
    position: relative;
    justify-self: center;
    width: 240px;
    height: 240px;
    overflow: hidden;
    touch-action: none;
    cursor: grab;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 4px;
  }
  .crop:active {
    cursor: grabbing;
  }
  canvas {
    display: block;
  }
  .ring {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  /* The avatar's rounded-square frame; the shadow dims the corners it cuts. */
  .ring::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 2px solid #f6e7c4;
    border-radius: 24%;
    box-shadow: 0 0 0 4rem rgba(20, 14, 8, 0.55);
  }
  .zoom {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    font-size: 0.9rem;
    color: var(--ink-soft);
  }
  .zoom input {
    flex: 1;
    accent-color: var(--accent);
  }
  .pick {
    display: grid;
    place-items: center;
    min-height: 8rem;
    font-family: var(--font-display);
    color: var(--accent);
    cursor: pointer;
    background: var(--surface-sunken);
    border: 1px dashed var(--gold);
    border-radius: 4px;
  }
  .pick input,
  .change input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .change {
    position: relative;
  }
  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .error {
    margin: 0;
    font-size: 0.9rem;
    color: var(--accent-bright);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
  }
</style>
