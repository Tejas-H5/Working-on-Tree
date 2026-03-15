import { cssVarsApp } from "src/app-styling";
import { AsciiIconData } from "src/assets/icons";
import { imui, BLOCK, ROW, COL, PX, NA } from "src/utils/im-js/im-ui";
import { im, ImCache, imdom, el, ev, } from "src/utils/im-js";


export function imAsciiIcon(c: ImCache, icon: AsciiIconData, sizePx: number) {
    imui.Begin(c, BLOCK); {
        if (im.isFirstishRender(c)) {
            imdom.setStyle(c, "userSelect", "none");
            imdom.setStyle(c, "whiteSpace", "pre");
            imdom.setStyle(c, "fontFamily", "Courier");
            imdom.setStyle(c, "fontWeight", "bold");
            imdom.setStyle(c, "lineHeight", "1");
            imdom.setStyle(c, "textShadow", `1px 1px 0px ${cssVarsApp.fgColor}`);
        }

        if (im.Memo(c, sizePx)) imdom.setStyle(c, "fontSize", sizePx + "px");

        imdom.Str(c, icon);
    } imui.End(c);

    return icon;
}
