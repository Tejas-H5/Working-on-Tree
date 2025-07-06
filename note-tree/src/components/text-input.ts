import { newCssBuilder } from "src/utils/cssb";
import { imBeginRoot, imEnd, imMemo, imOn, isFirstRender, setAttr, setClass } from "src/utils/im-dom-utils";
import { cssVars } from "./core/stylesheets";
import { imGetTextInputEvent, type ImTextInputEvent } from "./core/input-utils";

function newInput() {
    return document.createElement("input");
}

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


export function imTextInput({
    placeholder = "",
}: {
    value: string;
    focusWithAllSelected?: boolean;
    placeholder?: string;
}): ImTextInputEvent | null {
    let e: ImTextInputEvent | null = null;

    const input = imBeginRoot(newInput); {
        if (isFirstRender()) {
            setClass(cnInput);
            setAttr("type", "text");
        }

        if (imMemo(placeholder)) {
            setAttr("placeholder", placeholder);
        }

        e = imGetTextInputEvent(input.root);
    } imEnd();

    return e;
}
