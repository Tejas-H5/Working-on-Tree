import { formatDate, parseYMDTDateTime } from "src/utils/datetime";
import { Renderable, div, el, isEditingInput, newComponent, on, setInputValueAndResize, setStyle, setText, setVisible } from "src/utils/dom-utils";
import { Checkbox } from "./checkbox";

type DateTimeInputArgs = {
    readOnly: boolean;
    nullable: boolean;
    value: Date | null;
    label?: string;
    onChange(val: Date | null):void;
};

export function DateTimeInput(initialLabel?: string): Renderable<DateTimeInputArgs> {
    const show = div();
    const edit = el<HTMLInputElement>("INPUT", { class: "pre-wrap" });
    const checkbox = Checkbox();
    const root = div({ class: "row", style: "" }, [
        checkbox,
        div(
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

    const component = newComponent<DateTimeInputArgs>(root, renderDateTimeInput);

    function renderDateTimeInput() {
        const { value, label, readOnly, nullable } = component.args;

        const canEdit = readOnly && !!value;

        if (setVisible(checkbox, !readOnly && nullable)) {
            checkbox.render({
                label,
                value: !!value,
                onChange: onCheckOrUncheck,
            });
        }

        const dateText = formatDate(value, undefined, true);

        if (setVisible(show, canEdit)) {
            setText(show, dateText);
        }

        if (setVisible(edit, !canEdit)) {
            if (!isEditingInput(edit)) {
                setInputValueAndResize(edit, dateText);
            }
        }

        lastDate = value;

        setStyle(root, "color", !!value ? "" : "var(--unfocus-text-color)");
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

    on(edit, "keypress", (e) => {
        if (e.key === "Enter") {
            handleTextfieldEdit();
        }
    });

    on(edit, "blur", () => {
        handleTextfieldEdit();
    });

    return component;
}
