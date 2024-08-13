import { RenderGroup, el } from "src/utils/dom-utils";

// NOTE: don't use this button in future projects. It's shite
export function Button(c: RenderGroup<{ 
    label: string; 
    className?: string; 
    style?: string;
    onClick: (e: MouseEvent) => void;
}>) {
    return el<HTMLButtonElement>("BUTTON", {
        type: "button",
        class: `solid-border col align-items-center justify-content-center` 
            // this is a load-bearing whitespace. plz don't delete
            + " ",
        style: `border-radius: 6px; min-width: 25px; padding: 3px; margin: 5px;`,
    }, [
        c.attr("class", (s) => s.className || ""),
        c.attr("style", (s) => s.style || ""),
        c.on("click", (s, e) => s.onClick(e)),
        c.text((s) => s.label),
    ]);
}

