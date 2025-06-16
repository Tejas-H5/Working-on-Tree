import { imBeginRoot, imEnd, imInit, imMemo, imOn, imState, setAttr, setInputValue } from "src/utils/im-dom-utils";

function newInput() {
    return document.createElement("input");
}

function newTextInputState() {
    return { focused: false };
}

export type ImTextInputEvent = {
    type: "input" | "change";
    text: string;
};

export function imTextInput({
    value,
    focus,
    focusWithAllSelected,
    placeholder = "",
}: {
    value: string;
    /** 
     * Should this component recieve focus? 
     * It's up to you to make sure only one thing in your app is focused at a time.
     **/
    focus?: boolean;
    focusWithAllSelected?: boolean;
    placeholder?: string;
}): ImTextInputEvent | null {
    const s = imState(newTextInputState);

    let e: ImTextInputEvent | null = null;

    const input = imBeginRoot(newInput); {
        if (imInit()) {
            setAttr("type", "text");
        }

        if (imMemo(placeholder)) {
            setAttr("placeholder", placeholder);
        }

        if (document.activeElement !== input.root) {
            setInputValue(input.root, value);
        }

        const focusChanged = focus !== s.focused;
        if (focusChanged) {
            if (focus === true) {
                input.root.focus();
                if (focusWithAllSelected) {
                    input.root.selectionStart = 0;
                    input.root.selectionEnd = value.length;
                }
            } else if (focus === false) {
                input.root.blur();
            }
        }

        const inputEvent = imOn("input");
        if (inputEvent) {
            e = { type: "input", text: input.root.value };
        }

        const changeEvent = imOn("change");
        if (changeEvent) {
            e = { type: "change", text: input.root.value };
        }

        const focusEvent = imOn("focus");
        if (focusEvent) {
            s.focused = true;
        }

        const blurEvent = imOn("blur");
        if (blurEvent) {
            // lots of things can focus/unfocus this input, not just our prop. 
            // focused must always be up-to-date.
            s.focused = false;
        }
    } imEnd();

    return e;
}
