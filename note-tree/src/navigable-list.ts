import { imBeginScrollContainer, newScrollContainer, ScrollContainer } from "./components/scroll-container";
import { getAxisRaw, GlobalContext } from "./global-context";
import { imEnd, imState } from "./utils/im-dom-utils";

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
export function getNavigableListInput(ctx: GlobalContext): number {
    const keyboard = ctx.keyboard;

    // Arrays are rendered downards most of the time. traversing them by idx means that up goes down and down goes up
    const pressedDelta = getAxisRaw(keyboard.upKey.pressed, keyboard.downKey.pressed) +
        getAxisRaw(keyboard.pageUpKey.pressed, keyboard.pageDownKey.pressed) * 10;

    return pressedDelta;
}
