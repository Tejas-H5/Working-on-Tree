import { Insertable, Renderable, div, newComponent } from "src/utils/dom-utils";
import { makeButton } from "./button";

type ModalArgs = { onClose(): void };

export function Modal(content: Insertable): Renderable<ModalArgs> {
    const closeButton = makeButton("X");
    const bgRect = div({ style: "background-color: var(--bg-color)" }, [
        div({ class: "row", style: "z-index: 9999;" }, [ 
            div({ class: "flex-1" }), 
            closeButton
        ]),
        content,
    ])
    const root = div({
        class: "modal-shadow fixed align-items-center justify-content-center row",
        style: `top: 0vh; left: 0vw; right: 0vw; bottom: 0vh; z-index: 9999;`
    }, [bgRect]);

    const component = newComponent<ModalArgs>(root, () => { });

    closeButton.el.addEventListener("click", () => component.args.onClose());

    // Clicking outside the modal should close it
    root.el.addEventListener("click", () => component.args.onClose());

    // Clicking inside the modal shouldn't close it
    bgRect.el.addEventListener("click", (e) => e.stopPropagation());

    return component;
}

