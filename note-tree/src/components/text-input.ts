import { newCssBuilder } from "src/utils/cssb";
import { imBeginRoot, imEnd, imMemo, imIsFirstishRender, setAttr, setClass } from "src/utils/im-dom-utils";
import { cssVars } from "./core/stylesheets";

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
export function imBeginTextInput({
    value,
    placeholder = "",
}: {
    value: string;
    placeholder?: string;
}) {
    const input = imBeginRoot(newInput); {
        if (imIsFirstishRender()) {
            setClass(cnInput);
            setAttr("type", "text");
        }

        if (imMemo(placeholder)) {
            setAttr("placeholder", placeholder);
        }

        if (imMemo(value)) {
            input.root.value = value;
        }

    } // imEnd();

    return input;
}

export function imEndTextInput() {
    imEnd();
}


