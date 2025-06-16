import { cnApp } from "src/styling";
import { cn } from "src/utils/cssb";
import { imBeginRoot, imEnd, imInit, imOn, imTextSpan, setAttr } from "src/utils/im-dom-utils";

export const BUTTON_CLASSES = [
    cnApp.solidBorder, 
    cn.row,
    cn.alignItemsCenter,
    cn.justifyContentCenter,
].join(" ");

export const BUTTON_STYLES = `border-radius: 6px; min-width: 1.4em; min-height: 1.4em; padding: 3px; margin: 5px;`;

function newButton() {
    return document.createElement("button");
}

export function imBeginButton() {
    imBeginRoot(newButton); {
        if (imInit()) {
            setAttr("class", BUTTON_CLASSES);
            setAttr("style", BUTTON_STYLES);
        }
    } // imEnd
};

export function imEndButton() {
    imEnd();
}

export function imButton(label: string): MouseEvent | null {
    let e: MouseEvent | null = null;

    imBeginButton(); {
        imTextSpan(label);
        e = imOn("click");
    } imEndButton();

    return e;
}

