import { getDeltaTimeSeconds, ImCache } from "src/utils/im-core";
import { COL, imFlex, imLayout, imScrollOverflow, ROW } from "./core/layout";
import { getScrollVH } from "src/utils/dom-utils";


// NOTE: if all we need is idx, let's just inline it.
export type ScrollContainer = {
    root: HTMLElement | null;
    isScrolling:     boolean;
    smoothScroll:    boolean;

    lastScrollTop:   number;
    lastScrollTopStableFrames: number;
};

export function newScrollContainer(): ScrollContainer {
    return {
        root:         null,
        isScrolling:  false,
        smoothScroll: false,

        lastScrollTop: -1,
        lastScrollTopStableFrames: 0,
    };
}

export function startScrolling(sc: ScrollContainer, smoothScroll: boolean) {
    sc.isScrolling = true;
    sc.smoothScroll = smoothScroll;
    sc.lastScrollTopStableFrames = 0;
    sc.lastScrollTop = -1;
}

export function imScrollContainerBegin(
    c: ImCache,
    sc: ScrollContainer,
    orientation: typeof ROW | typeof COL = COL
): HTMLElement {
    const scrollParent = imLayout(c, orientation); imFlex(c); imScrollOverflow(c, orientation === COL, orientation === ROW);
    sc.root = scrollParent;
    return scrollParent;
}

// NOTE: it's up to you to only ever call this on one item at a time
// TODO: move this into ScrollContainer, make this a side-effect of ending the container
export function scrollToItem(c: ImCache, l: ScrollContainer, root: HTMLElement) {
    const scrollParent = l.root;
    if (!scrollParent)  return;
    if (!l.isScrolling) return;
    if (root.parentNode === null) return;
    if (l.lastScrollTopStableFrames > 10) {
        l.isScrolling = false;
        return;
    }

    const { scrollTop } = getScrollVH(
        scrollParent, root,
        0.5, null
    );

    const currentScrollTop = scrollParent.scrollTop;

    if (Math.abs(scrollTop - scrollParent.scrollTop) < 0.1) {
        l.isScrolling = false;
    } else {
        if (l.smoothScroll) {
            scrollParent.scrollTop = lerp(currentScrollTop, scrollTop, 20 * getDeltaTimeSeconds(c));
        } else {
            scrollParent.scrollTop = scrollTop;
        }
    }

    if (l.lastScrollTop !== currentScrollTop) {
        l.lastScrollTop = currentScrollTop;
        l.lastScrollTopStableFrames = 0;
    }
    l.lastScrollTopStableFrames += 1;

}

function lerp(a: number, b: number, t: number): number {
    if (t > 1) t = 1;
    if (t < 0) t = 0;
    return a + (b - a) * t;
}

