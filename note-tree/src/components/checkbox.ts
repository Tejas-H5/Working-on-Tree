import { cssVars } from "src/styling";
import { cn, div, newCssBuilder, RenderGroup } from "src/utils/dom-utils";

const sg = newCssBuilder("checkbox");

const FG_COLOR = cssVars.fgColor;

const cnL = {
    checkboxButton: sg.cn("checkboxButton", [
        // Doing the border radius only on hover was an accident, but it turns out to be a pretty nice interaction
        `:hover { outline: 1px solid ${FG_COLOR}; border-radius: 3px; }`,
    ]),
    solidBorderSmRounded: sg.cn("solidBorderSmRounded", [` { border: 1px solid ${FG_COLOR}; border-radius: 3px; }`]),
}

export function Checkbox(rg: RenderGroup<{
    label: string;
    value: boolean;
    onChange(val: boolean): void;
}>) {
    return div({ class: [cn.row, cn.alignItemsCenter] }, [
        rg.on("click", (s) => s.onChange(!s.value)),
        div({ class: [cnL.solidBorderSmRounded], style: "padding: 4px; width: 0.65em; height: 0.65em;" }, [
            div({ style: "cursor: pointer;", class: [cnL.checkboxButton, cn.w100, cn.h100] }, [
                rg.style("backgroundColor", (s) => s.value ? FG_COLOR : "")
            ]),
        ]),
        div({ style: "width: 10px" }),
        div({ style: "user-select: none" }, [
            rg.text((s) => s.label || "")
        ]),
    ]);
}
