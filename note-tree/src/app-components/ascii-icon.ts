import { cssVarsApp } from "src/app-styling";
import { AsciiIconData } from "src/assets/icons";
import { BLOCK, imLayout, imLayoutEnd } from "src/components/core/layout";
import { ImCache, imMemo, isFirstishRender } from "src/utils/im-core";
import { elSetStyle, imStr } from "src/utils/im-dom";

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

        if (imMemo(c, sizePx)) elSetStyle(c, "fontSize", sizePx + "px");

        imStr(c, icon);
    } imLayoutEnd(c);

    return icon;
}
