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

    let blockMouseDown = false;

    // Clicking outside the modal should close it
    on(root, "mousedown", () => {
        if (!blockMouseDown) {
            s.args.onClose()
        }
        blockMouseDown = false;
    });

    // Clicking inside the modal shouldn't close it.
    // We can't simply stop propagation of this event to the nodes inside though, so we're doing it like this.
    on(bgRect, "mousedown", () => {
        blockMouseDown = true;
    });

    return newComponent(root, () => { }, s);
}

