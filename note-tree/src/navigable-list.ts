import { imBegin, imFlex, imScrollContainer } from "./components/core/layout";
import { getAxisRaw, GlobalContext } from "./global-context";
import {
    deltaTimeSeconds,
    getScrollVH,
    UIRoot
} from "./utils/im-dom-utils";

// NOTE: if all we need is idx, let's just inline it.
export type NavigableList = {
    idx: number;
    scrollContainer: UIRoot<HTMLElement> | null;
    isScrolling: boolean;
    smoothScroll: boolean;
};

// NOTE: only works if called in the animation loop
export function getNavigableListInput(ctx: GlobalContext): number {
    const keyboard = ctx.keyboard;

    const pressedDelta = getAxisRaw(keyboard.downKey.pressed, keyboard.upKey.pressed) +
        getAxisRaw(keyboard.pageDownKey.pressed, keyboard.pageUpKey.pressed) * 10;

    return pressedDelta;
}

export function startScrolling(l: NavigableList, smoothScroll: boolean) {
    l.isScrolling = true;
    l.smoothScroll = smoothScroll;
}

export function imBeginNavigableListContainer(l: NavigableList): UIRoot<HTMLElement> {
    const scrollParent = imBegin(); imFlex(); imScrollContainer(); 
    l.scrollContainer = scrollParent;
    return scrollParent;
}

// NOTE: it's up to you to only ever call this on one item at a time
export function scrollNavigableList(l: NavigableList, root: UIRoot<HTMLElement>) {
    const scrollParent = l.scrollContainer;
    if (!scrollParent)  return;
    if (!l.isScrolling) return;

    const { scrollTop } = getScrollVH(
        scrollParent.root, root.root,
        0.5, null
    );

    if (Math.abs(scrollTop - scrollParent.root.scrollTop) < 0.1) {
        l.isScrolling = false;
    } else {
        if (l.smoothScroll) {
            scrollParent.root.scrollTop = lerp(
                scrollParent.root.scrollTop,
                scrollTop,
                20 * deltaTimeSeconds()
            );
        } else {
            scrollParent.root.scrollTop = scrollTop;
        }
    }
}

export function lerp(a: number, b: number, t: number): number {
    if (t > 1) t = 1;
    if (t < 0) t = 0;
    return a + (b - a) * t;
}

export function newNavigableList(): NavigableList {
    return {
        idx: 0,

        scrollContainer: null,
        isScrolling:     false,
        smoothScroll:    false,
    };
}

/** clamps the list idx. returns -1 if len is 0 */
export function clampedListIdx(idx: number, len: number): number {
    if (idx < 0) idx = 0;
    if (idx >= len) idx = len - 1;
    return idx;
}


