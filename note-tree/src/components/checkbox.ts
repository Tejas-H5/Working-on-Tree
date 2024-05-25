import { Renderable, div, newComponent, setClass, setText } from "src/utils/dom-utils";

type CheckboxArguments = {
    label?: string;
    value: boolean;
    onChange(val: boolean): void;
}

export function Checkbox(initialLabel?: string): Renderable<CheckboxArguments> {
    const label = div({ style: "user-select: none" }, initialLabel !== undefined ? [initialLabel] : undefined);
    const button = div({ class: "checkbox w-100 h-100", style: "cursor: pointer;" });
    const checkbox = div({ class: "row align-items-center" }, [
        div({ class: "solid-border-sm-rounded", style: "padding: 4px; width: 0.65em; height: 0.65em;" }, [
            button,
        ]),
        div({ style: "width: 10px" }),
        label
    ]);

    const component = newComponent<CheckboxArguments>(checkbox, () => {
        const { value, label: labelText } = component.args;

        if (labelText !== undefined) {
            setText(label, labelText);
        }
        setClass(button, "checked", value);
    });

    checkbox.el.addEventListener("click", () => {
        component.args.onChange(!component.args.value);
    });

    return component;
}
