import { el, on, RenderGroup, setInputValue, setInputValueAndResize } from "src/utils/dom-utils";

export function TextInput(rg: RenderGroup<{
    value: string;
    onChange(newValue: string): void;
    /** 
     * Should this component recieve focus? 
     * It's up to you to make sure only one thing in your app is focused at a time.
     **/
    focus?: boolean;
    focusWithAllSelected?: boolean;
    autoSize?: boolean;
}>) {
    const input = el<HTMLInputElement>("INPUT");

    let focused = false;

    rg.preRenderFn((s) => {
        if (document.activeElement !== input.el) {
            if (s.autoSize) {
                setInputValueAndResize(input, s.value);
            } else {
                setInputValue(input, s.value);
            }
        }

        if (s.focus !== undefined) {
            const changed = s.focus !== focused;

            if (changed) {
                if (s.focus) {
                    input.el.focus();
                    if (s.focusWithAllSelected) {
                        input.el.selectionStart = 0;
                        input.el.selectionEnd = s.value.length;
                    }
                } else {
                    input.el.blur();
                }
            } 
        }

    });

    function onChange() {
        rg.s.onChange(input.el.value);
    }

    on(input, "input", onChange);
    on(input, "change", onChange);

    // lots of things can focus/unfocus this input, not just our prop. let's respond to all of them.
    on(input, "blur", () => focused = false);
    on(input, "focus", () => focused = true);

    return input;
}
