import * as domUtils from "src/utils/dom-utils";
import { formatDate, parseYMDTDateTime } from "src/utils/datetime";
import { setText } from "src/utils/dom-utils";
import { Checkbox } from "./checkbox";

type DateTimeInputArgs = {
    readOnly: boolean;
    nullable: boolean;
    value: Date | null;
    label?: string;
    onChange(val: Date | null):void;
};

export function DateTimeInput(initialLabel?: string): domUtils.Renderable<DateTimeInputArgs> {
    const show = domUtils.div();
    const edit = domUtils.el<HTMLInputElement>("INPUT", { class: "pre-wrap" });
    const checkbox = Checkbox();
    const root = domUtils.div({ class: "row", style: "" }, [
        checkbox,
        domUtils.div(
            { class: "row align-items-center", style: "width: 100%; height: 100%; padding-left: 5px; padding-right: 5px" },
            [
                show, 
                edit,
            ]
        )
    ]);

    if (initialLabel) {
        checkbox.render({
            label: initialLabel,
            value: false,
            onChange: onCheckOrUncheck,
        });
    }

    let lastDate: Date | null = null;

    const component = domUtils.newComponent<DateTimeInputArgs>(root, renderDateTimeInput);

    function renderDateTimeInput() {
        const { value, label, readOnly, nullable } = component.args;

        const canEdit = readOnly && !!value;

        if (domUtils.setVisible(checkbox, !readOnly && nullable)) {
            checkbox.render({
                label,
                value: !!value,
                onChange: onCheckOrUncheck,
            });
        }

        const dateText = formatDate(value, undefined, true);

        if (domUtils.setVisible(show, canEdit)) {
            setText(show, dateText);
        }

        if (domUtils.setVisible(edit, !canEdit)) {
            if (!domUtils.isEditingInput(edit)) {
                domUtils.setInputValueAndResize(edit, dateText);
            }
        }

        lastDate = value;

        domUtils.setStyle(root, "color", !!value ? "" : "var(--unfocus-text-color)");
    }
    
    function onCheckOrUncheck(b: boolean) {
        const { onChange } = component.args;

        if (b) {
            onChange(lastDate || new Date());
        } else {
            onChange(null);
        }
    }

    function handleTextfieldEdit() {
        const { onChange } = component.args;
        const value = edit.el.value;

        const [date, err] = parseYMDTDateTime(value);

        if (date === null) {
            console.error("Error parsing date", value, err);
            onChange(lastDate);
            return;
        }

        onChange(date);
        edit.el.blur();
        // no render call here, onChange is responsible for rendering this component
    }

    edit.el.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            handleTextfieldEdit();
        }
    });

    edit.el.addEventListener("blur", () => {
        handleTextfieldEdit();
    });

    return component;
}
