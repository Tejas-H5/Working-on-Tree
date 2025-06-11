import { cssVars } from "src/styling";
import { cn, div, newCssBuilder, RenderGroup } from "src/utils/im-dom-utils";

const sg = newCssBuilder("checkbox");

const FG_COLOR = cssVars.fgColor;
const DISBALED_COLOR = cssVars.unfocusTextColor;

const cnL = {
    checkboxButton: sg.cn("checkboxButton", [
        // Doing the border radius only on hover was an accident, but it turns out to be a pretty nice interaction
        `:hover { outline: 1px solid currentColor; border-radius: 3px; }`,
    ]),
    solidBorderSmRounded: sg.cn("solidBorderSmRounded", [` { border: 1px solid currentColor; border-radius: 3px; }`]),
}

// TODO: replace label for `children` static parameter.
// NOTE: the main reason why we would want to inject the label as a child here is so that we may click on the 
// label to trigger the checkbox as well, just because it can be easier to do so.
export function Checkbox(rg: RenderGroup<{
    label?: string;
    value: boolean;
    disabled?: boolean;
    onChange(val: boolean): void;
}>) {
    return div({ class: [cn.row, cn.alignItemsCenter] }, [
        rg.style("color", s => s.disabled ? DISBALED_COLOR : FG_COLOR),
        rg.on("click", (s) => !s.disabled && s.onChange(!s.value)),
        div({ class: [cnL.solidBorderSmRounded], style: "padding: 4px; width: 0.65em; height: 0.65em;" }, [
            div({ style: "cursor: pointer;", class: [cnL.checkboxButton, cn.w100, cn.h100] }, [
                rg.style("backgroundColor", (s) => s.value ? "currentColor" : "")
            ]),
        ]),
        rg.if(s => !!s.label, rg =>
            div({ style: "width: 10px" }),
        ),
        rg.if(s => !!s.label, rg =>
            div({ style: "user-select: none" }, [
                rg.text((s) => s.label || "")
            ]),
        ),
    ]);
}
