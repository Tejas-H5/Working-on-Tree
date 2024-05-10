// TODO: import the missing CSS styles

import { Insertable, Renderable, div, el, makeComponent, setClass, setInputValue, setInputValueAndResize, setStyle, setTextContent, setVisible } from "./dom-utils";
import { addDays, floorDateLocalTime, formatDate, parseYMDTDateTime } from "./datetime";

type ModalArgs = { onClose(): void };

export function Modal(content: Insertable): Renderable<ModalArgs> {
    const closeButton = makeButton("X");
    const bgRect = div({ style: "background-color: var(--bg-color)" }, [
        div({ class: "row", style: "z-index: 9999;" }, [ 
            div({ class: "flex-1" }), 
            closeButton
        ]),
        content,
    ])
    const root = div({
        class: "modal-shadow fixed align-items-center justify-content-center row",
        style: `top: 0vh; left: 0vw; right: 0vw; bottom: 0vh; z-index: 9999;`
    }, [bgRect]);

    const component = makeComponent<ModalArgs>(root, () => { });

    closeButton.el.addEventListener("click", () => component.args.onClose());

    // Clicking outside the modal should close it
    root.el.addEventListener("click", () => component.args.onClose());

    // Clicking inside the modal shouldn't close it
    bgRect.el.addEventListener("click", (e) => e.stopPropagation());

    return component;
}

type FractionBarArgs = {
    fraction: number;
    text: string;
    focused: boolean;
}
export function FractionBar(): Renderable<FractionBarArgs> {
    const baseStyles = `padding-bottom:0;padding-left: 10px;`;

    const invertedText = div({ style: baseStyles + "background-color: var(--fg-color); color: var(--bg-color)" });
    const bar = div({ class: "flex-1 pre", style: "overflow: hidden;text-wrap: none;" }, [invertedText])
    const normalText = div({ style: baseStyles });

    const root = div({ class: "relative" }, [
        normalText,
        div({ class: "absolute-fill" }, [
            bar
        ])
    ]);

    const component = makeComponent<FractionBarArgs>(root, () => {
        const { fraction, text, focused } = component.args;

        setTextContent(invertedText, text);
        setTextContent(normalText, text);
        bar.el.style.width = (100 * fraction) + "%";
        setStyle(root, "backgroundColor", focused ? "var(--bg-color-focus)" : "");
    });

    return component;
}

export function makeButton(text: string, classes: string = "", styles: string = "") {
    return el(
        "BUTTON",
        {
            type: "button",
            class: `solid-border ${classes} flex`,
            style: `min-width: 25px; padding: 3px; margin: 5px; justify-content: center; ${styles}`,
        },
        [text]
    );
}

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

    const component = makeComponent<DateTimeInputArgs>(root, () => {
        const { value, label, readOnly, nullable } = component.args;
        const canEdit = readOnly && !!value;

        if (setVisible(checkbox, !readOnly && nullable)) {
            checkbox.render({
                label,
                value: !!value,
                onChange: onCheckOrUncheck,
            });
        }

        if (value) {
            lastDate = value;
        }

        const dateText = formatDate(value, undefined, true);

        if (setVisible(show, canEdit)) {
            setTextContent(show, dateText);
        }

        if (setVisible(edit, !canEdit)) {
            setInputValueAndResize(edit, dateText);
        }

        setStyle(root, "color", !!value ? "var(--fg-color)" : "var(--unfocus-text-color)");
    });
    
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

export function DateTimeInputEx(clazz?: string): Renderable<DateTimeInputArgs> {
    let dateTimeInput, zeroButton, incrDay, decrDay, incrWeek, decrWeek, incrMonth, decrMonth;
    const root = div({ class: "row " + (clazz || "") }, [
        div({}, [dateTimeInput = DateTimeInput()]),
        zeroButton = makeButton("0am"),
        incrDay = makeButton("+1d"),
        decrDay = makeButton("-1d"),
        incrWeek = makeButton("+7d"),
        decrWeek = makeButton("-7d"),
        incrMonth = makeButton("+30d"),
        decrMonth = makeButton("-30d"),
    ]);

    const component = makeComponent<DateTimeInputArgs>(root, () => {
        dateTimeInput.render(component.args);
    });

    function updateDate(updateFn: (d: Date) => void) {
        const { value, onChange } = component.args;
        if (value) {
            const newDate = new Date(value);
            updateFn(newDate);
            onChange(newDate);
        }
    }

    zeroButton.el.addEventListener("click", () => {
        updateDate((d) => floorDateLocalTime(d));
    });

    incrDay.el.addEventListener("click", () => {
        updateDate((d) => addDays(d, 1));
    });

    incrWeek.el.addEventListener("click", () => {
        updateDate((d) => addDays(d, 7));
    });

    incrMonth.el.addEventListener("click", () => {
        updateDate((d) => addDays(d, 30));
    });

    decrDay.el.addEventListener("click", () => {
        updateDate((d) => addDays(d, -1));
    });

    decrWeek.el.addEventListener("click", () => {
        updateDate((d) => addDays(d, -7));
    });

    decrMonth.el.addEventListener("click", () => {
        updateDate((d) => addDays(d, -30));
    });

    return component;
}

// Don't export this type, it's terrible. 
// Keeps tempting me into making form abstractions, which I should avoid until typescript introduces Exact<T>, 
// When I can add OneLevelDeepForm<T> = { [key in T]: Renderable<GenericInputArguments<T[key]>> }.
//      (it doesnt work now, because renderables need ALL their props to render correctly, 
//          but they can be implicitly downcasted into Renderable<GenericInput<T>>)
type GenericInputArguments<T> = {
    label?: string;
    value: T;
    onChange(val: T): void;
}

export function Checkbox(initialLabel?: string): Renderable<GenericInputArguments<boolean>> {
    const label = div({ style: "user-select: none" }, initialLabel !== undefined ? [initialLabel] : undefined);
    const button = div({ class: "checkbox w-100 h-100", style: "cursor: pointer;" });
    const checkbox = div({ class: "row align-items-center" }, [
        div({ class: "solid-border-sm-rounded", style: "padding: 4px; width: 0.65em; height: 0.65em;" }, [
            button,
        ]),
        div({ style: "width: 10px" }),
        label
    ]);

    const component = makeComponent<GenericInputArguments<boolean>>(checkbox, () => {
        const { value, label: labelText } = component.args;

        if (labelText !== undefined) {
            setTextContent(label, labelText);
        }
        setClass(button, "checked", value);
    });

    checkbox.el.addEventListener("click", () => {
        component.args.onChange(!component.args.value);
    });

    return component;
}

export function TextField(initialLabel?: string): Renderable<GenericInputArguments<string>> {
    const input = el<HTMLInputElement>("INPUT", { class: "pre-wrap w-100" });
    const label = div({}, initialLabel ? [ initialLabel ] : undefined);
    const root = div({class: "row"}, [
        label,
        div({style: "width: 20px"}),
        input
    ]);

    const component = makeComponent<GenericInputArguments<string>>(root, () => {
        const { value, label: labelText } = component.args;

        setInputValue(input, value);
        if (labelText) {
            setTextContent(label, labelText);
        }
    });

    input.el.addEventListener("input", () => {
        component.args.onChange(input.el.value);
    });

    return component;
}
