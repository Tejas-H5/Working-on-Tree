import { Insertable, div, newComponent, newState, on, scrollIntoViewV } from "src/utils/dom-utils";

export function ScrollContainerV() {
    const s = newState<{ 
        rescrollMs?: number, 
        scrollEl: Insertable<HTMLElement> | null 
    }>();

    const scrollContainer = div({ class: "flex-1", style: "overflow-y: auto;" });

    let scrollTimeout = 0;
    let lastScrollEl : Insertable<HTMLElement> | null | undefined = undefined;
    let lastHeight = 0;

    function scrollToLastElement() {
        clearTimeout(scrollTimeout);
        setTimeout(() => {
            const scrollParent = scrollContainer.el;
            if (lastScrollEl) {
                scrollIntoViewV(scrollParent, lastScrollEl, 0.5);
            } else {
                scrollParent.scrollTop = 0;
            }
        }, 1);
    }

    function renderScrollContainer() {
        const { scrollEl } = s.args;
        let height = scrollContainer.el.clientHeight;

        if (
            lastScrollEl !== scrollEl ||
            lastHeight !== height
        ) {
            lastScrollEl = scrollEl;
            lastHeight = height;
            scrollToLastElement();
        }
    }

    on(scrollContainer, "scroll", () => {
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

    return newComponent(scrollContainer, renderScrollContainer, s);
}
