import { getAxisRaw, GlobalContext, newDiscoverableCommands } from "./global-context";

// TODO: maybe there should be a keyboard module instead?


export type ListPosition = {
    idx: number;
};

export function newListPosition() {
    return { idx: 0 };
}

/** clamps the list idx. returns -1 if len is 0 */
export function clampedListIdx(idx: number, len: number): number {
    return clampedListIdxRange(idx, 0, len);
}

export function clampedListIdxRange(idx: number, min: number, maxEx: number): number {
    if (idx < min) idx = min;
    if (idx >= maxEx) idx = maxEx - 1;
    return idx;
}

// NOTE: only works if called in the animation loop
export function getNavigableListInput(
    ctx: GlobalContext,
    idx: number,
    lo: number, hi: number
): ({ newIdx: number } | null) {
    if (hi <= lo) return null;

    const keyboard = ctx.keyboard;

    const oldIdx = idx;
    let newIdx = -1;

    // Arrays are rendered downards most of the time. traversing them by idx means that up goes down and down goes up

    if (keyboard.upKey.pressed)       newIdx = oldIdx - 1;
    if (keyboard.downKey.pressed)     newIdx = oldIdx + 1;
    if (keyboard.pageUpKey.pressed)   newIdx = oldIdx - 10;
    if (keyboard.pageDownKey.pressed) newIdx = oldIdx + 10;
    if (keyboard.homeKey.pressed)     newIdx = lo;
    if (keyboard.endKey.pressed)      newIdx = hi - 1;

    if (newIdx === -1) return null;

    newIdx = clampedListIdxRange(newIdx, lo, hi);
    return { newIdx };
}
