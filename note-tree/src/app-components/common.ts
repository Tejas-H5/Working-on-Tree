import { cssVarsApp } from "src/app-styling";
import { imBegin, imSize, NOT_SET, PX } from "src/components/core/layout";
import { newCssBuilder } from "src/utils/cssb";
import { imEnd, imMemo, isFirstishRender, setClass, setStyle } from "src/utils/im-dom-utils";


const cssb = newCssBuilder();
const cnHLine = cssb.cn("hline", [
    ` { transition: opacity 0.1s linear, height 0.1s linear; }`
]);


export function imHLine(visible = true, heightPx: number = 2) {
    imBegin(); imSize(0, NOT_SET, visible ? heightPx : 0, PX); {
        if (isFirstishRender()) {
            setStyle("backgroundColor", cssVarsApp.fgColor);
            setClass(cnHLine);
        }

        if (imMemo(visible)) {
            setStyle("opacity", "" + (visible ? 1 : 0));
        }
    } imEnd();
}

export function imHLineDivider() {
    imBegin(); imSize(0, NOT_SET, 10, PX); imEnd();
}

