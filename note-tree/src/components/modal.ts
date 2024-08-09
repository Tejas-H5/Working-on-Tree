import { Insertable, RenderGroup, State, div, setChildAt } from "src/utils/dom-utils";

export function Modal(rg: RenderGroup, s: State<{ onClose(): void; content: Insertable; }>) {
    const bgRect = div({ style: "background-color: var(--bg-color)" }, [
        rg.functionality(div => setChildAt(div, s.args.content, 0)),
    ]);

    const root = div({
        class: "modal-shadow fixed align-items-center justify-content-center row",
        style: `top: 0vh; left: 0vw; right: 0vw; bottom: 0vh; z-index: 9999;`
    }, [bgRect]);

    let blockMouseDown = false;

    // Clicking outside the modal should close it
    root.el.addEventListener("mousedown", () => {
        if (!blockMouseDown) {
            s.args.onClose()
        }
        blockMouseDown = false;
    });

    // Clicking inside the modal shouldn't close it.
    // We can't simply stop propagation of this event to the nodes inside though, so we're doing it like this.
    bgRect.el.addEventListener("mousedown", () => {
        blockMouseDown = true;
    });

    return root;
}

