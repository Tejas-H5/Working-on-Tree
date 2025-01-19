import { cnApp } from "src/styling";
import { RenderGroup, el } from "src/utils/dom-utils";

const BUTTON_CLASSES = cnApp.solidBorder;

// NOTE: don't use this button in future projects. It's shite
export function Button(c: RenderGroup<{ 
    label: string; 
    toggled?: boolean;
    inline?: boolean;
    className?: string; 
    style?: string;
    onClick: (e: MouseEvent) => void;
}>) {
    const buttonClass = `solid-border align-items-center justify-content-center ` + BUTTON_CLASSES;
    const buttonStyle = `border-radius: 6px; min-width: 25px; padding: 3px; margin: 5px;`
    return el<HTMLButtonElement>("BUTTON", { 
        type: "button",
        class: []
    }, [
        c.attr("class", (s) => buttonClass + (s.className || "") + " "),
        c.attr("style", (s) => buttonStyle + (s.style || "")),
        c.class("inline-block", (s) => !!s.inline),
        c.class("inverted", (s) => !!s.toggled),
        c.on("click", (s, e) => s.onClick(e)),
        c.text((s) => s.label),
    ]);
}

