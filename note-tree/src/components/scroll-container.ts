import { COL, imBegin, imFlex, imScrollOverflow } from "./core/layout";
import {
    getDeltaTimeSeconds,
    getScrollVH,
    UIRoot
} from "src/utils/im-dom-utils";


// NOTE: if all we need is idx, let's just inline it.
export type ScrollContainer = {
    root: UIRoot<HTMLElement> | null;
    isScrolling:     boolean;
    smoothScroll:    boolean;
};

export function startScrolling(l: ScrollContainer, smoothScroll: boolean) {
    l.isScrolling = true;
    l.smoothScroll = smoothScroll;
}

export function imBeginScrollContainer(l: ScrollContainer): UIRoot<HTMLElement> {
    const scrollParent = imBegin(COL); imFlex(); imScrollOverflow();
    l.root = scrollParent;
    return scrollParent;
}

// NOTE: it's up to you to only ever call this on one item at a time
// TODO: move this into ScrollContainer, make this a side-effect of ending the container
export function scrollToItem(l: ScrollContainer, root: UIRoot<HTMLElement>) {
    const scrollParent = l.root;
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
                20 * getDeltaTimeSeconds()
            );
        } else {
            scrollParent.root.scrollTop = scrollTop;
        }
    }
}

function lerp(a: number, b: number, t: number): number {
    if (t > 1) t = 1;
    if (t < 0) t = 0;
    return a + (b - a) * t;
}

export function newScrollContainer(): ScrollContainer {
    return {
        root: null,
        isScrolling:     false,
        smoothScroll:    false,
    };
}

