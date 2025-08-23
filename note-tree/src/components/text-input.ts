import { newCssBuilder } from "src/utils/cssb";
import { cssVars } from "./core/stylesheets";
import { EL_INPUT, elSetAttr, elSetClass, imElBlock } from "src/utils/im-dom";
import { ImCache, imMemo, isFirstishRender } from "src/utils/im-core";
import { imLayoutEnd } from "./core/layout";

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


// NOTE: this component is untested, since I mainly use text areas instead due to their extra capability.
export function imBeginTextInput(c: ImCache, {
    value,
    placeholder = "",
}: {
    value: string;
    placeholder?: string;
}) {
    const input = imElBlock(c, EL_INPUT); {
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

    } // imLayoutEnd(c);

    return input;
}

export function imEndTextInput(c: ImCache) {
    imLayoutEnd(c);
}


