import { newCssBuilder } from "src/utils/cssb";
import { ImCache, imMemo, isFirstishRender } from "src/utils/im-core";
import { EL_INPUT, elSetAttr, elSetClass, EV_BLUR, EV_INPUT, getGlobalEventSystem, imElBegin, imElEnd, imOn } from "src/utils/im-dom";
import { imFlex } from "./core/layout";
import { cssVars } from "./core/stylesheets";
import { imTextAreaBegin, imTextAreaEnd } from "./editable-text-area";

const cssb = newCssBuilder();

const cnInput = cssb.newClassName("im-text-input");
cssb.s(`
input.${cnInput} {
    all: unset;
    resize: none;
    width: 100%;
    box-sizing: border-box;
    padding: 5px;
}

input.${cnInput}:focus, input.${cnInput}:hover {
    background-color: ${cssVars.bg2};
}
`);


export function imTextInputBegin(c: ImCache, {
    value,
    placeholder = "",
}: {
    value: string;
    placeholder?: string;
}) {
    const input = imElBegin(c, EL_INPUT); {
        if (isFirstishRender(c)) {
            elSetClass(c, cnInput);
            elSetAttr(c, "type", "text");
        }

        if (imMemo(c, placeholder)) {
            elSetAttr(c, "placeholder", placeholder);
        }

        if (imMemo(c, value)) {
            input.root.value = value;
        }

    } // imElEnd(c, EL_INPUT);

    return input;
}

export function imTextInputEnd(c: ImCache) {
    imElEnd(c, EL_INPUT);
}

function getLineEnding(str: string): string {
    if (str.endsWith("\r\n")) return "\r\n";
    if (str.endsWith("\n")) return "\n";
    if (str.endsWith("\r")) return "\r";
    return "";
}

export function imTextInputOneLine(
    c: ImCache,
    currentName: string,
    placeholder: string = "Enter new name",
    hasFocus = true,
    allowMultipleLines = false, // xd
) {
    let val: { newName?: string; submit?: boolean; cancel?: boolean; } | null = null;

    // Autosizing works better if we use a text area here.
    const [,input] = imTextAreaBegin(c, {
        value: currentName,
        placeholder: placeholder,
    }); imFlex(c); {
        if (imMemo(c, hasFocus)) {
            setTimeout(() => {
                input.focus();
                input.select();
            }, 20);
        }

        const inputEvent = imOn(c, EV_INPUT);
        const blur = imOn(c, EV_BLUR);
        const keyboard = getGlobalEventSystem().keyboard;

        let lineEnding: string | undefined;
        if (inputEvent) {
            lineEnding = getLineEnding(input.value);
            if (lineEnding.length === 0 || allowMultipleLines) {
                val = { newName: input.value };
            } else {
                // This should submit the input
            }
        } 

        if (allowMultipleLines) {
            // If multiple lines, need both Shift and enter.
            if (
                (keyboard.keyDown?.key === "Enter" && keyboard.keyDown.shiftKey) ||
                blur
            ) {
                let value = input.value;
                val = { submit: true, newName: value }
            } 
        } else {
            if (
                keyboard.keyDown?.key === "Enter" || 
                blur || 
                lineEnding
            ) {
                let value = input.value;
                if (lineEnding) {
                    value = value.slice(0, value.length - lineEnding.length);
                }

                val = { submit: true, newName: value }
            } 
        }

        if (!val && keyboard.keyDown?.key === "Escape") {
            val = { cancel: true }
        }
    } imTextAreaEnd(c);

    return val;
}
