import { cssVarsApp } from "./app-styling";
import { AsciiIconData } from "./assets/icons";
import { BLOCK, imLayout, imLayoutEnd } from "./components/core/layout";
import { ImCache, imMemo, isFirstishRender } from "./utils/im-core";
import { elSetStyle, imStr } from "./utils/im-dom";

export function imAsciiIcon(c: ImCache, icon: AsciiIconData, sizePx: number) {
    imLayout(c, BLOCK); {
        if (isFirstishRender(c)) {
            elSetStyle(c, "userSelect", "none");
            elSetStyle(c, "whiteSpace", "pre");
            elSetStyle(c, "fontFamily", "Courier");
            elSetStyle(c, "fontWeight", "bold");
            elSetStyle(c, "lineHeight", "1");
            elSetStyle(c, "textShadow", `1px 1px 0px ${cssVarsApp.fgColor}`);
        }

        imStr(c, icon.data);
        if (imMemo(c, sizePx)) elSetStyle(c, "fontSize", sizePx + "px");
    } imLayoutEnd(c);

    return icon;
}
