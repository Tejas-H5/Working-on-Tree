import { cssVarsApp } from "src/app-styling";
import { BLOCK, imui, NA, PERCENT, PX } from "src/utils/im-js/im-ui";
import { im, ImCache, imdom } from "src/utils/im-js";

const cssb = imui.newCssBuilder();
const cnHLine = cssb.cn("hline", [
    ` { transition: opacity 0.1s linear, height 0.1s linear; }`
]);

export const LINE_HORIZONTAL = 1;
export const LINE_VERTICAL = 2;

export function imLine(
    c: ImCache,
    type: typeof LINE_HORIZONTAL | typeof LINE_VERTICAL,
    widthPx: number = 2,
    visible = true
) {
    let height = visible ? widthPx : 0;
    let heightUnit = PX;
    const isH = type === LINE_HORIZONTAL;

    imui.Begin(c, BLOCK); imui.Size(c,
        !isH ? height : 100, !isH ? heightUnit : PERCENT,
         isH ? height : 100,  isH ? heightUnit : PERCENT,
    ); {
        if (im.isFirstishRender(c)) {
            imdom.setStyle(c, "backgroundColor", cssVarsApp.fgColor);
            imdom.setClass(c, cnHLine);
        }

        if (im.Memo(c, visible)) {
            imdom.setStyle(c, "opacity", "" + (visible ? 1 : 0));
        }
    } imui.End(c);
}

export function imHLineDivider(c: ImCache) {
    imui.Begin(c, BLOCK); imui.Size(c, 0, NA, 10, PX); imui.End(c);
}

