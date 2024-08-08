import { Insertable, el, on } from "src/utils/dom-utils";

// TODO: make this a component

export function TextArea(): Insertable<HTMLTextAreaElement> {
    const textArea = el<HTMLTextAreaElement>("TEXTAREA", {
        class: "pre-wrap w-100 h-100",
        style: "border: 1px var(--fg-color) solid; padding: 0;"
    });

    textArea.el.addEventListener("keydown", (e) => {
        if (e.key === "Tab") {
            e.preventDefault();

            // HTML text area doesn't like tabs, we need this additional code to be able to insert tabs.
            // inserting a tab like this should also preserve undo, unlike value setting approaches
            // TODO: stop using deprecated API 
            //      (I doubt it will be a problem though - I bet most browsers will support this for a long while, else risk breaking a LOT of websites)
            // @ts-ignore
            document.execCommand("insertText", false, "\t");
        }
    })

    return textArea
}

