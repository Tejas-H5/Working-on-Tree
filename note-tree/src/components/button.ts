import { ChildList, el } from "src/utils/dom-utils";

// NOTE: don't use this button in future projects. It's shite
export function makeButton(text: ChildList, classes: string = "", styles: string = "") {
    return el(
        "BUTTON",
        {
            type: "button",
            class: `solid-border ${classes} flex`,
            style: `border-radius: 6px; min-width: 25px; padding: 3px; margin: 5px; justify-content: center; ${styles}`,
        },
        text
    );
}

