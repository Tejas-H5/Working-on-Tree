import { Insertable, div, newComponent, scrollIntoViewV } from "src/utils/dom-utils";

export function ScrollContainerV() {
    const scrollContainer = div({ class: "flex-1", style: "overflow-y: auto;" });

    let scrollTimeout = 0;
    let lastScrollEl : Insertable | null | undefined = undefined;
    let lastHeight = 0;
    const component = newComponent<{ rescrollMs?: number, scrollEl: Insertable | null }>(scrollContainer, renderScrollContainer);

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
        const { scrollEl } = component.args;
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

    scrollContainer.el.addEventListener("scroll", () => {
        const { rescrollMs } = component.args;

        if (!rescrollMs) {
            // We simply won't scroll back to where we were before.
            return;
        }

        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
             scrollToLastElement();
        }, rescrollMs);
    });

    return component;
}
