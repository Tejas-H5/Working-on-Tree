import { imOn } from "src/utils/im-dom-utils";

export type ImTextInputEvent = {
    text: string;
    input?: HTMLElementEventMap["input"];
    change?: HTMLElementEventMap["change"];
    keydown?: HTMLElementEventMap["keydown"];
    keyup?: HTMLElementEventMap["keyup"];
};

export function imGetTextInputEvent(root: HTMLTextAreaElement | HTMLInputElement)  {
    let e: ImTextInputEvent | null = null;

    const inputEvent = imOn("input");
    const changeEvent = imOn("change");
    const keydownEvent = imOn("keydown");
    const keyupEvent = imOn("keyup");
    if (inputEvent) {
        e = { text: root.value, input: inputEvent };
    } else if (changeEvent) {
        e = { text: root.value, change: changeEvent };
    } else if (keydownEvent) {
        e = { text: root.value, keydown: keydownEvent };
    } else if (keyupEvent) {
        e = { text: root.value, keyup: keyupEvent };
    }

    return e;
}
