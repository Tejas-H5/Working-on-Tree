import { Renderable, div, newComponent, newRenderGroup, newStyleGenerator, on, setClass } from "src/utils/dom-utils";

type CheckboxArguments = {
    label?: string;
    value: boolean;
    onChange(val: boolean): void;
}

const sg = newStyleGenerator();
const cnCheckbox = sg.makeClass("checkbox-button", [
    ` { cursor: pointer; }`,
    `.checked { background-color: var(--fg-color); }`,
    // Doing the border radius only on hover was an accident, but it turns out to be a pretty nice interaction
    `:hover { outline: 1px solid var(--fg-color); border-radius: 3px; }`,
]);

export function Checkbox(initialLabel?: string): Renderable<CheckboxArguments> {
    const rg = newRenderGroup();
    const checkbox = div({ class: "row align-items-center" }, [
        div({ class: "solid-border-sm-rounded", style: "padding: 4px; width: 0.65em; height: 0.65em;" }, [
            rg(
                div({ class: `${cnCheckbox} w-100 h-100` }),
                (el) => setClass(el, "checked", c.args.value)
            )
        ]),
        div({ style: "width: 10px" }),
        div({ style: "user-select: none" }, [ 
            rg.text(() => c.args.label || initialLabel || "") 
        ]),
    ]);

    const c = newComponent<CheckboxArguments>(checkbox, rg.render);

    on(checkbox, "click", () => {
        c.args.onChange(!c.args.value);
    });

    return c;
}
