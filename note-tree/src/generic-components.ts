// TODO: import the missing CSS styles

import { Insertable, Renderable, div, el, makeComponent, setClass, setInputValue, setTextContent, setVisible } from "./dom-utils";
import { formatDate, parseYMDTDateTime } from "./utils";

type ModalArgs = { onClose(): void };

export function Modal(content: Insertable): Renderable<ModalArgs> {
    const closeButton = makeButton("X");

    const root = div({ 
        class: "modal-shadow fixed", 
        style: `width: 94vw; left: 3vw; right: 3vw; height: 94vh; top: 3vh; bottom: 3vh;` + 
            `background-color: var(--bg-color); z-index: 9999;`
    }, [
        div({ class: "relative absolute-fill" }, [
            div({ class: "absolute", style: "top: 0; right: 0;" }, [ closeButton ]),
            content
        ])
    ]);

    const component = makeComponent<ModalArgs>(root, () => {});

    closeButton.el.addEventListener("click", () => {
        const { onClose } = component.args;
        onClose();
    });

    return component;
}

type FractionBarArgs = {
    fraction: number;
    text: string;
}
export function FractionBar() : Renderable<FractionBarArgs> {
    const baseStyles = `padding:5px;padding-bottom:0;`;

    const invertedText = div({ style: baseStyles + "background-color: var(--fg-color); color: var(--bg-color)" });
    const bar = div({ class: "flex-1", style: "overflow: hidden; white-space: nowrap;" }, [ invertedText ])

    const normalText = div({ style: baseStyles });

    const root = div({ class: "relative" }, [
        normalText, 
        div({ class: "absolute-fill" }, [
            bar
        ])
    ]);

    const component = makeComponent<FractionBarArgs>(root, () => {
        const { fraction, text } = component.args;

        setTextContent(invertedText, text);
        setTextContent(normalText, text);
        bar.el.style.width = (100 * fraction) + "%";
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

type DateTimeInputArgs = GenericInputArguments<Date | null> & {
    readOnly: boolean;
};

export function DateTimeInput(): Renderable<DateTimeInputArgs> {
    const show = div();
    const edit = el<HTMLInputElement>("INPUT", { class: "pre-wrap" });
    const root = div(
        { class: "row align-items-center", style: "width: 100%; height: 100%; padding-left: 5px" },
        [show, edit]
    );

    let lastDate: Date | null = null;

    const component = makeComponent<DateTimeInputArgs>(root, () => {
        const { value, readOnly } = component.args;

        lastDate = value;
        const dateText = value ? formatDate(value) : "<no date>";

        if (setVisible(show, readOnly)) {
            setTextContent(show, dateText);
        }

        if (setVisible(edit, !readOnly)) {
            setInputValue(edit, dateText);
        }
    });

    function handleChange() {
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
        // no render call here, onChange is responsible for rendering stuff
    }

    edit.el.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            handleChange();
        }
    });

    edit.el.addEventListener("blur", () => {
        component.rerender(component.args);
    });

    return component;
}

export function DateTimeInputEx(clazz?: string): Renderable<DateTimeInputArgs> {
    let dateTimeInput, zeroButton, incrDay, decrDay;
    const root = div({ class: "row " + (clazz || "") }, [
        div({}, [dateTimeInput = DateTimeInput()]),
        zeroButton = makeButton("0am"),
        incrDay = makeButton("day + 1"),
        decrDay = makeButton("day - 1"),
    ]);

    const component = makeComponent<DateTimeInputArgs>(root, () => {
        dateTimeInput.rerender(component.args);
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
        updateDate((d) => d.setHours(0, 0, 0, 0));
    });

    incrDay.el.addEventListener("click", () => {
        updateDate((d) => d.setDate(d.getDate() + 1));
    });

    decrDay.el.addEventListener("click", () => {
        updateDate((d) => d.setDate(d.getDate() - 1));
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
    onChange(val: T):void;
}

export function Checkbox(initialLabel?: string): Renderable<GenericInputArguments<boolean>> {
    const label = div({}, initialLabel !== undefined ? [ initialLabel ] : undefined);
    const button = div({ class: "checkbox w-100 h-100", style: "cursor: pointer;" });
    const checkbox = div({ class: "row align-items-center" }, [
        div({ class: "solid-border-sm", style: "padding: 4px; width: 0.65em; height: 0.65em;"}, [
            button, 
        ]),
        div({ style: "width: 20px"}),
        label
    ]);

    const component = makeComponent<GenericInputArguments<boolean>>(checkbox, () => {
        const { value, label: labelText } = component.args;

        if (labelText !== undefined) {
            setTextContent(label, labelText);
        }
        setClass(button, "checked", value);
    });

    button.el.addEventListener("click", () => {
        component.args.onChange(!component.args.value);
    })

    return component;
}