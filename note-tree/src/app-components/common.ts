import { cssVarsApp } from "src/app-styling";
import { imBegin, imSize, NA, PERCENT, PX } from "src/components/core/layout";
import { newCssBuilder } from "src/utils/cssb";
import { HORIZONTAL, imEnd, imMemo, imIsFirstishRender, setClass, setStyle, VERTICAL } from "src/utils/im-dom-utils";

const cssb = newCssBuilder();
const cnHLine = cssb.cn("hline", [
    ` { transition: opacity 0.1s linear, height 0.1s linear; }`
]);

export function imLine(
    type: typeof HORIZONTAL | typeof VERTICAL,
    widthPx: number = 2,
    visible = true
) {
    let height = visible ? widthPx : 0;
    let heightUnit = PX;
    const isH = type === HORIZONTAL;

    imBegin(); imSize(
        !isH ? height : 100, !isH ? heightUnit : PERCENT,
         isH ? height : 100,  isH ? heightUnit : PERCENT,
    ); {
        if (imIsFirstishRender()) {
            setStyle("backgroundColor", cssVarsApp.fgColor);
            setClass(cnHLine);
        }

        if (imMemo(visible)) {
            setStyle("opacity", "" + (visible ? 1 : 0));
        }
    } imEnd();
}

export function imHLineDivider() {
    imBegin(); imSize(0, NA, 10, PX); imEnd();
}

