import { getCurrentRoot, imOn, type UIRoot } from "src/utils/im-dom-utils";

export type FocusResultInstance = number & { __focusResut: void };

export const FOCUS_RESULT_NONE = 0       as FocusResultInstance;
export const FOCUS_RESULT_FOCUSED = 1    as FocusResultInstance;
export const FOCUS_RESULT_UNFOCUSED = 2  as FocusResultInstance;

export type FocusResult = typeof FOCUS_RESULT_NONE |
                          typeof FOCUS_RESULT_FOCUSED |
                          typeof FOCUS_RESULT_UNFOCUSED;
    

export function imFocusCurrentElement(focus: boolean | undefined): FocusResult {
    const input = getCurrentRoot() as UIRoot<HTMLInputElement | HTMLTextAreaElement>;

    const focused = document.activeElement === input.root;
    const focusChanged = focus !== focused;

    let result = FOCUS_RESULT_NONE;

    if (focusChanged) {
        if (focus === true) {
            input.root.focus();
            result = FOCUS_RESULT_FOCUSED;
        } else if (focus === false) {
            input.root.blur();
            result = FOCUS_RESULT_UNFOCUSED;
        }
    }

    return result
}

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
