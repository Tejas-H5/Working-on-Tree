import { newCssBuilder } from "src/utils/cssb";
import { im, ImCache, imdom, el, ev, } from "src/utils/im-js";

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
    const input = imdom.ElBegin(c, el.INPUT); {
        if (im.isFirstishRender(c)) {
            imdom.setClass(c, cnInput);
            imdom.setAttr(c, "type", "text");
        }

        if (im.Memo(c, placeholder)) {
            imdom.setAttr(c, "placeholder", placeholder);
        }

        if (im.Memo(c, value)) {
            input.root.value = value;
        }

    } // imdom.ElEnd(c, el.INPUT);

    return input;
}

export function imTextInputEnd(c: ImCache) {
    imdom.ElEnd(c, el.INPUT);
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
        if (im.Memo(c, hasFocus)) {
            setTimeout(() => {
                input.focus();
                input.select();
            }, 20);
        }

        const inputEvent = imdom.On(c, ev.INPUT);
        const blur = imdom.On(c, ev.BLUR);
        const keyboard = imdom.getKeyboard();

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
