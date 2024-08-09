import { RenderGroup, State, el } from "src/utils/dom-utils";

// NOTE: don't use this button in future projects. It's shite
export function Button(rg: RenderGroup, s: State<{ 
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
        rg.attr("class", () => s.args.className || ""),
        rg.attr("style", () => s.args.style || ""),
        rg.on("click", (e) => s.args.onClick(e)),
        rg.text(() => s.args.label),
    ]);
}

