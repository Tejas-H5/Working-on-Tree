import { cssVarsApp } from "./app-styling";
import { AsciiIconData } from "./assets/icons";
import { imBegin } from "./components/core/layout";
import { imEnd, imIsFirstishRender, imMemo } from "./utils/im-utils-core";
import { setStyle, setText } from "./utils/im-utils-dom";

export function imAsciiIcon(icon: AsciiIconData, sizePx: number) {
    imBegin(); {
        if (imIsFirstishRender()) {
            setStyle("userSelect", "none");
            setStyle("whiteSpace", "pre");
            setStyle("fontFamily", "Courier");
            setStyle("fontWeight", "bold");
            setStyle("lineHeight", "1");
            setStyle("textShadow", `1px 1px 0px ${cssVarsApp.fgColor}`);
        }

        setText(icon.data);
        if (imMemo(sizePx)) setStyle("fontSize", sizePx + "px");
    } imEnd();

    return icon;
}
