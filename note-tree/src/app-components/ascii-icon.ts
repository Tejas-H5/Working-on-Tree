import { cssVarsApp } from "app-styling";
import { AsciiIconData } from "assets/icons";
import { imui, BLOCK } from "im-layer/im-ui";
import { im, ImCache, imdom, } from "im-layer";


export function imAsciiIcon(c: ImCache, icon: AsciiIconData, sizePx: number) {
    imui.Begin(c, BLOCK); {
        if (im.IsFirstRender(c)) {
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
