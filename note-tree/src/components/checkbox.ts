import { RenderGroup, div, newStyleGenerator } from "src/utils/dom-utils";

const sg = newStyleGenerator();

const cnCheckbox = sg.makeClass("checkbox-button", [
    ` { cursor: pointer; }`,
    `.checked { background-color: var(--fg-color); }`,
    // Doing the border radius only on hover was an accident, but it turns out to be a pretty nice interaction
    `:hover { outline: 1px solid var(--fg-color); border-radius: 3px; }`,
]);

export function Checkbox(rg: RenderGroup<{
    label: string;
    value: boolean;
    onChange(val: boolean): void;
}>) {
    return div({ class: "row align-items-center" }, [
        rg.on("click", (s) => s.onChange(!s.value)),
        div({ class: "solid-border-sm-rounded", style: "padding: 4px; width: 0.65em; height: 0.65em;" }, [
            div({ class: `${cnCheckbox} w-100 h-100` }, [
                rg.class("checked", (s) => s.value)
            ]),
        ]),
        div({ style: "width: 10px" }),
        div({ style: "user-select: none" }, [
            rg.text((s) => s.label || "")
        ]),
    ]);
}
