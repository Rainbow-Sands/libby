// Whether Ask Libby is open and how wide its pane is, shared by the header
// button and the pane. The width is remembered per browser.
const WIDTH_KEY = "ask-libby-width";
export const PANE_MIN = 320;
export const PANE_MAX = 720;

function storedWidth(): number {
  try {
    const value = Number(globalThis.localStorage?.getItem(WIDTH_KEY));
    if (Number.isFinite(value) && value >= PANE_MIN && value <= PANE_MAX) return value;
  } catch {
    // Storage can be blocked; the default width is fine.
  }
  return 400;
}

export const askLibby = $state({ open: false, width: storedWidth() });

export function saveWidth(width: number): void {
  askLibby.width = Math.round(Math.min(PANE_MAX, Math.max(PANE_MIN, width)));
  try {
    globalThis.localStorage?.setItem(WIDTH_KEY, String(askLibby.width));
  } catch {
    // Not remembered, but still applied.
  }
}
