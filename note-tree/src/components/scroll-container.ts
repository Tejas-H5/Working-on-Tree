import { Insertable, RenderGroup, cn, div, on, scrollIntoView } from "src/utils/dom-utils";

export function ScrollContainer(rg: RenderGroup<{
    rescrollMs?: number;
    axes?: "h" | "v" | "hv";
    scrollEl: Insertable<HTMLElement> | null;
}>) {
    const root = div({ class: [cn.overflowYAuto] });

    let scrollTimeout = 0;
    let lastScrollEl : Insertable<HTMLElement> | null | undefined = undefined;
    let lastWidth = 0;
    let newWidth = 0;
    let lastHeight = 0;
    let newHeight = 0;

    const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
            if (entry.target !== root.el) {
                continue;
            }

            newWidth = entry.contentRect.width;
            newHeight = entry.contentRect.width;
            break;
        }
    });

    observer.observe(root.el);

    function isH() {
        const s = rg.s;
        return s.axes === "h" || s.axes === "hv";
    }

    function isV() {
        // default to vertical
        const s = rg.s;
        return s.axes === "v" || s.axes === "hv" || !s.axes;
    }

    function scrollToLastElement() {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            const scrollParent = root.el;
            if (lastScrollEl) {
                // The same scroll container can be used for both or either axis!

                if (isH()) {
                    scrollIntoView(scrollParent, lastScrollEl, 0.5, true);
                }

                if (isV()) {
                    scrollIntoView(scrollParent, lastScrollEl, 0.5, false);
                }
            } else {
                scrollParent.scrollTop = 0;
            }
        }, 1);
    }

    function shouldRerender() {
        const s = rg.s;
        let shouldRerender = false;

        const { scrollEl } = s;

        if (scrollEl !== lastScrollEl) {
            lastScrollEl = scrollEl;
            shouldRerender = true;
        }

        if (isH()) {
            if (newWidth !== lastWidth) {
                lastWidth = newWidth;
                shouldRerender = true;
            }
        }

        if (isV()) {
            if (newHeight !== lastHeight) {
                lastHeight = newHeight;
                shouldRerender = true;
            }
        }

        return shouldRerender;
    }

    rg.preRenderFn(function renderScrollContainer(s) {
        if (!shouldRerender()) {
            return;
        }

        const { scrollEl } = s;

        lastScrollEl = scrollEl;
        scrollToLastElement();
    });

    on(root, "scroll", () => {
        const s = rg.s;
        const { rescrollMs } = s;

        if (!rescrollMs) {
            // We simply won't scroll back to where we were before.
            return;
        }

        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
             scrollToLastElement();
        }, rescrollMs);
    });

    return root;
}
