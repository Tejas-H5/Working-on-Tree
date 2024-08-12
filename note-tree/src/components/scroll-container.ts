import { Insertable, RenderGroup, State, div, scrollIntoView } from "src/utils/dom-utils";

export function ScrollContainer(rg: RenderGroup, s: State<{
    rescrollMs?: number;
    axes?: "h" | "v" | "hv";
    scrollEl: Insertable<HTMLElement> | null;
}>) {
    const root = div({ class: "flex-1", style: "overflow-y: auto;" });

    let scrollTimeout = 0;
    let lastScrollEl : Insertable<HTMLElement> | null | undefined = undefined;
    let lastWidth = 0;
    let lastHeight = 0;

    function isH() {
        return s.args.axes === "h" || s.args.axes === "hv";
    }

    function isV() {
        // default to vertical
        return s.args.axes === "v" || s.args.axes === "hv" || !s.args.axes;
    }

    function scrollToLastElement() {
        clearTimeout(scrollTimeout);
        setTimeout(() => {
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
        let shouldRerender = false;

        const { scrollEl } = s.args;

        if (scrollEl !== lastScrollEl) {
            lastScrollEl = scrollEl;
            shouldRerender = true;
        }

        if (isH()) {
            const width = root.el.clientWidth;
            if (width !== lastWidth) {
                lastWidth = width;
                shouldRerender = true;
            }
        }

        if (isV()) {
            const height = root.el.clientHeight;
            if (height !== lastHeight) {
                lastHeight = height;
                shouldRerender = true;
            }
        }

        return shouldRerender;
    }

    rg.renderFn(function renderScrollContainer() {
        if (!shouldRerender()) {
            return;
        }

        const { scrollEl } = s.args;

        lastScrollEl = scrollEl;
        lastWidth = length;
        scrollToLastElement();
    });

    root.el.addEventListener("scroll", () => {
        const { rescrollMs } = s.args;

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
