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

type DateTimeInputArgs = {
    readOnly: boolean;
    date: Date;
    onChange(date: Date | undefined): void;
}

export function DateTimeInput(): Renderable<DateTimeInputArgs> {
    const show = div();
    const edit = el<HTMLInputElement>("INPUT", { class: "pre-wrap" });
    const root = div(
        { class: "row align-items-center", style: "width: 100%; height: 100%; padding-left: 5px" },
        [show, edit]
    );

    let lastDate: Date | undefined = undefined;

    const component = makeComponent<DateTimeInputArgs>(root, () => {
        const { date, readOnly } = component.args;

        lastDate = date;
        const dateText = formatDate(date);

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

        // no render call here, onChange is responsible for rendering stuff
    }

    edit.el.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            handleChange();
        }
    });

    return component;
}

type CheckboxArguments = {
    label: string;
    checked: boolean;
    // The call-site should already have access to the value of checked. So why would I pass it
    // back to them through here?
    onToggle():void;
}

export function Checkbox(): Renderable<CheckboxArguments> {
    const label = div({});
    const button = div({ class: "checkbox w-100 h-100", style: "cursor: pointer;" });
    const checkbox = div({ class: "row align-items-center" }, [
        div({ class: "solid-border-sm", style: "padding: 4px; width: 0.65em; height: 0.65em;"}, [
            button, 
        ]),
        div({ style: "width: 20px"}),
        label
    ]);

    const component = makeComponent<CheckboxArguments>(checkbox, () => {
        const { checked, label: labelText } = component.args;

        setTextContent(label, labelText);
        setClass(button, "checked", checked);
    });

    button.el.addEventListener("click", () => {
        component.args.onToggle();
    })

    return component;
}