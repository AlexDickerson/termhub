// Pure helpers for the xterm lifecycle that the useXterm hook drives. Kept
// separate from useXterm.ts so they can be unit-tested without pulling
// xterm.js (which references the browser `self` global at import time and
// blows up under Vitest's default node environment).

// Estimate cols/rows from a container's bounding rect so the xterm renderer
// has sane initial dimensions before FitAddon refines them on first paint.
// The 12px padding / 8.5px-per-col / 17px-per-row constants come from the
// rendered font; they're approximations, not exact, and the immediate
// FitAddon call corrects any drift.
export function estimateInitialDims(
  rect: { width: number; height: number },
  minRows: number,
): { cols: number; rows: number } {
  return {
    cols: Math.max(20, Math.floor((rect.width - 12) / 8.5)),
    rows: Math.max(minRows, Math.floor((rect.height - 12) / 17)),
  }
}

// xterm's pixel rounding can leave the scrollbar one line short of ybase
// when the user scrolls down after new output arrived while they were
// scrolled up. When the viewport advances downward to within 1 line of
// ybase, snap all the way so the final line stays reachable.
//
// We only snap on downward motion (newYdisp > prevYdisp) so the user can
// still scroll up from the bottom without being yanked back.
export function shouldSnapToBottom(
  prevYdisp: number,
  newYdisp: number,
  ybase: number,
): boolean {
  return newYdisp > prevYdisp && newYdisp >= ybase - 1 && newYdisp < ybase
}
