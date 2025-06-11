import {
    HORIZONTAL,
    imBeginDiv,
    imMemo,
    imOn,
    imRef,
    imTrackSize,
    scrollIntoViewVH,
    setClass,
    UIRoot,
    VERTICAL
} from "src/utils/im-dom-utils";
import { cn } from "src/utils/cssb";

type ScrollContainerState = {
    root: UIRoot<HTMLDivElement>;
    scrollTimeout: number;
    lastWidth: number;
    newWidth: number;
    lastHeight: number;
    newHeight: number;
    scrollTo: HTMLElement | null;
    isScrolling: boolean;
};

function newScrollContainerState(root: UIRoot<HTMLDivElement>): ScrollContainerState {
    return {
        root,
        scrollTimeout: 0,
        lastWidth: 0,
        newWidth: 0,
        lastHeight: 0,
        newHeight: 0,
        scrollTo: null,
        isScrolling: false,
    };
}

export function imBeginScrollContainer(
    axes = VERTICAL,
    /** After we scroll manually, how long should we wait before we scroll back to the focused element? */
    rescrollMs?: number,
) {
    const root = imBeginDiv(); // {
    const stateRef = imRef<ScrollContainerState>();
    if (stateRef.val === null) {
        stateRef.val = newScrollContainerState(root);
        setClass(cn.overflowYAuto);
    }
    const s = stateRef.val;

    const { size } = imTrackSize();

    const widthChanged = imMemo(size.width);
    const heightChanged = imMemo(size.height);
    const scrollToChanged = imMemo(s.scrollTo);

    const horizontal = axes & HORIZONTAL;
    const vertical = axes & VERTICAL;

    if (
        scrollToChanged ||
        (vertical && heightChanged) ||
        (horizontal && widthChanged) 
    ) {
        s.isScrolling = true;
    }

    const scroll = imOn("scroll");
    if (scroll) {
        if (rescrollMs) {
            clearTimeout(s.scrollTimeout);
            s.scrollTimeout = setTimeout(() => {
                s.isScrolling = true;
            }, rescrollMs);
        }
    }

    if (s.isScrolling) {
        s.isScrolling = false;
        // TODO: we can now consider implementing smooth-scroll, since we're running in an animation loop.
        
        clearTimeout(s.scrollTimeout);
        s.scrollTimeout = setTimeout(() => {
            const scrollParent = s.root.root;
            if (s.scrollTo) {
                // The same scroll container can be used for both or either axis!

                if (horizontal) {
                    const hOffset = horizontal ? 0.5 : null;
                    const vOffset = vertical ? 0.5 : null;

                    scrollIntoViewVH(scrollParent, s.scrollTo, hOffset, vOffset);
                }
            }
        }, 1);
    }

    // imEnd();

    return s;
}
