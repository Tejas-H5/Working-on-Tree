import { Insertable, div, newComponent, newState, on } from "src/utils/dom-utils";

export type ModalArgs = { onClose(): void };

export function Modal(content: Insertable) {
    const s = newState<ModalArgs>({
        onClose() { }
    });

    const bgRect = div({ style: "background-color: var(--bg-color)" }, [
        content,
    ])
    const root = div({
        class: "modal-shadow fixed align-items-center justify-content-center row",
        style: `top: 0vh; left: 0vw; right: 0vw; bottom: 0vh; z-index: 9999;`
    }, [bgRect]);


    // Clicking outside the modal should close it
    on(root, "click", () => s.args.onClose());

    // Clicking inside the modal shouldn't close it
    on(bgRect, "click", (e) => e.stopPropagation());

    return newComponent(root, () => { }, s);
}

