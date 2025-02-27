import { cssVars } from "src/styling";
import { Insertable, RenderGroup, cn, div, el, setAttr, setClass, setInputValue, setStyle, setText, setVisible } from "src/utils/dom-utils";

export function newTextArea(
    initFn?: (el: Insertable<HTMLTextAreaElement>) => void,
): Insertable<HTMLTextAreaElement> {
    const textArea = el<HTMLTextAreaElement>("TEXTAREA", {
        class: [cn.preWrap, cn.w100, cn.h100],
        style: `border: 1px ${cssVars.fgColor} solid; padding: 0;`
    });

    initFn?.(textArea);

    return textArea
}

export type EditableTextAreaArgs = {
    text: string;
    isEditing: boolean;
    isOneLine?: boolean;
    onInput(text: string, textArea: HTMLTextAreaElement): void;
    onInputKeyDown(e: KeyboardEvent, textArea: HTMLTextAreaElement): void;
};

export function EditableTextArea(
    rg: RenderGroup<EditableTextAreaArgs>, 
    initFn?: (el: Insertable<HTMLTextAreaElement>,
) => void) {
    const whenEditing = newTextArea();
    setClass(whenEditing, cn.absolute, true);
    setStyle(whenEditing, "backgroundColor", "transparent");
    setStyle(whenEditing, "color", "transparent");

    const whenNotEditing = div({ class: [cn.handleLongWords] }, [
        rg.class(cn.preWrap, s => !s.isOneLine),
        rg.class(cn.pre, s => !!s.isOneLine),
        rg.class(cn.overflowHidden, s => !!s.isOneLine),
        rg.class(cn.noWrap, s => !!s.isOneLine),
    ]);
    setAttr(whenEditing, "style", "overflow-y: hidden; padding: 0;");

    // the updateTextContentAndSize triggers a lot of reflows, making it
    // expensive to run every time. We need to memoize it
    let lastText: string | undefined;
    let lastIsEditing: boolean;
    function updateTextContentAndSize() {
        const s = rg.s;
        if (lastText === s.text && lastIsEditing === s.isEditing) {
            return;
        }

        lastText = s.text;
        // for some reason, we need to render this thing again when we start editing - perhaps
        // setting the input value doesn't work if it isn't visible...
        lastIsEditing = s.isEditing;
        setInputValue(whenEditing, s.text);
    }

    let isEditing = false;
    rg.preRenderFn(function renderNoteRowText(s) {
        const wasEditing = isEditing;
        isEditing = s.isEditing;

        if (isEditing) {
            // This is now a facade that gives the text area the illusion of auto-sizing!
            // but it only works if the text doesn't end in whitespace....
            setText(whenNotEditing, s.text + ".");
        } else {
            setText(whenNotEditing, s.text);
        }

        if (setVisible(whenEditing, isEditing)) {
            if (!wasEditing) {
                whenEditing.el.focus({ preventScroll: true });
            }
        }

        // Actually quite important that this runs even when we aren't editing, because when we eventually
        // set the input visible, it needs to auto-size to the correct height, and it won't do so otherwise
        updateTextContentAndSize();
    });

    const root = div({ class: [cn.flex1, cn.row, cn.h100, cn.relative], style: "overflow-y: hidden;" }, [
        whenNotEditing, 
        whenEditing,
    ]);

    whenEditing.el.addEventListener("input", () => {
        const s = rg.s;

        s.onInput(whenEditing.el.value, whenEditing.el);
    });

    whenEditing.el.addEventListener("keydown", (e) => {
        const s = rg.s;
        s.onInputKeyDown(e, whenEditing.el);
    });

    initFn?.(whenEditing);

    return root;
}
