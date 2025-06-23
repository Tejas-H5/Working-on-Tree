import { cssVars } from "src/legacy-styling";
import { Insertable, RenderGroup, cn, div, el, setAttr, setClass, setInputValue, setStyle, setText, setVisible, on, newCssBuilder, span } from "src/utils/dom-utils";
import { getLineBeforePos } from "src/utils/text-utils";

const CSSVARS_FOCUS = cssVars.bgColorFocus;
const CSSVARS_FG = cssVars.fgColor;

export function newTextArea(
    initFn?: (el: Insertable<HTMLTextAreaElement>) => void,
): Insertable<HTMLTextAreaElement> {
    const textArea = el<HTMLTextAreaElement>("TEXTAREA", {
        class: [cn.preWrap, cn.w100, cn.h100],
        style: `border: 1px ${CSSVARS_FG} solid; padding: 0;`
    });

    initFn?.(textArea);

    return textArea
}

const cssb = newCssBuilder();
const cnEditableTextArea = cssb.newClassName("editableTextArea");
cssb.s(`
textarea.${cnEditableTextArea} { 
    white-space: pre-wrap; padding: 5px; 
    caret-color: ${CSSVARS_FG};
    color: transparent;
}
textarea.${cnEditableTextArea}:focus { 
    color: ${CSSVARS_FG};
}
textarea.${cnEditableTextArea}:focus { background-color: ${CSSVARS_FOCUS}; }
`);

export type EditableTextAreaArgs = {
    text: string;
    isEditing: boolean;
    isOneLine?: boolean;
    onInput(text: string, textArea: HTMLTextAreaElement): void;
    onInputKeyDown?(e: KeyboardEvent, textArea: HTMLTextAreaElement): void;
    config: EditableTextAreaConfig;
};

type EditableTextAreaConfig = {
    useSpacesInsteadOfTabs?: boolean;
    tabStopSize?: number;
};

export function EditableTextArea(
    rg: RenderGroup<EditableTextAreaArgs>, 
    initFn?: (el: Insertable<HTMLTextAreaElement>,
) => void) {
    const whenEditing = newTextArea();
    setClass(whenEditing, cn.allUnset, true);
    setClass(whenEditing, cn.absoluteFill, true);
    setClass(whenEditing, cnEditableTextArea, true);
    setStyle(whenEditing, "backgroundColor", "transparent");
    setStyle(whenEditing, "color", "transparent");

    const whenNotEditingText = span();
    const whenNotEditing = div({ class: [cn.handleLongWords, cn.relative, cn.w100, cn.hFitContent], style: "min-height: 100%" }, [
        rg.class(cn.preWrap, s => !s.isOneLine),
        rg.class(cn.pre, s => !!s.isOneLine),
        rg.class(cn.overflowHidden, s => !!s.isOneLine),
        rg.class(cn.noWrap, s => !!s.isOneLine),
        whenNotEditingText,
        // This full-stop at the end of the text is what prevents the text-area from collapsing in on itself
        span({style: "color: transparent;"}, ["."]),
        whenEditing,
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
            setText(whenNotEditingText, s.text);
        } else {
            setText(whenNotEditingText, s.text);
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

    const root = div({ class: [cn.flex1, cn.row, cn.h100, cn.overflowYAuto] }, [
        whenNotEditing,
    ]);

    whenEditing.el.addEventListener("input", () => {
        const s = rg.s;

        s.onInput(whenEditing.el.value, whenEditing.el);
    });

    whenEditing.el.addEventListener("keydown", (e) => {
        const s = rg.s;
        s.onInputKeyDown?.(e, whenEditing.el);
    });


    {
        const textArea = whenEditing;

        // HTML text area doesn't like tabs, we need this additional code to be able to insert tabs (among other things).
        // Using the execCommand API is currently the only way to do this while perserving undo, 
        // and I won't be replacing it till there is really something better.
        on(textArea, "keydown", (e) => {
            const s = rg.s;
            const spacesInsteadOfTabs = s.config.useSpacesInsteadOfTabs ?? false;
            const tabStopSize = s.config.tabStopSize ?? 4;

            let text = textArea.el.value;
            const start = textArea.el.selectionStart;
            const end = textArea.el.selectionEnd;

            const getSpacesToRemove = (col: string) => {
                if (!s.config.useSpacesInsteadOfTabs) {
                    return 1;
                }

                // if this bit has tabs, we can't do shiet
                if (![...col].every(c => c === " ")) {
                    return 1;
                }


                // seems familiar, because it is - see the tab stop computation below
                let spacesToRemove = (col.length % tabStopSize)
                if (spacesToRemove === 0) {
                    spacesToRemove = tabStopSize;
                }
                if (spacesToRemove > col.length) {
                    spacesToRemove = col.length;
                }

                return spacesToRemove;
            }

            const getIndentation = (col: string): string => {
                if (!spacesInsteadOfTabs) {
                    return "\t";
                }

                const numSpaces = tabStopSize - (col.length % tabStopSize);
                return " ".repeat(numSpaces);
            }

            if (e.key === "Backspace" && !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
                if (start === end) {
                    const col = getLineBeforePos(text, start);

                    const spacesToRemove = getSpacesToRemove(col);
                    if (spacesToRemove) {
                        e.preventDefault();
                        for (let i = 0; i < spacesToRemove; i++) {
                            document.execCommand("delete", false, undefined);
                        }
                    }
                }
            } else if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) {
                if (e.shiftKey) {
                    e.preventDefault();

                    let newStart = start;
                    let newEnd = end;

                    // iterating backwards allows us to delete text while iterating, since indices won't be shifted.
                    let i = end;
                    while (i >= start) {
                        const col = getLineBeforePos(text, i);
                        if (col.length === 0) {
                            i--;
                            continue;
                        }

                        const numNonWhitespaceAtColStart = col.trimStart().length;
                        const pos = i - numNonWhitespaceAtColStart;
                        textArea.el.selectionStart = pos;
                        textArea.el.selectionEnd = pos;

                        // de-indent by the correct amount.
                        {
                            const col2 = col.substring(0, col.length - numNonWhitespaceAtColStart);
                            const spacesToRemove = getSpacesToRemove(col2);
                            for (let i = 0; i < spacesToRemove; i++) {
                                // cursor implicitly moves back 1 for each deletion.
                                document.execCommand("delete", false, undefined);
                                newEnd--;
                            }
                        }

                        i -= col.length;
                    }

                    textArea.el.selectionStart = newStart;
                    textArea.el.selectionEnd = newEnd;
                } else {
                    if (start === end) {
                        const col = getLineBeforePos(text, start);
                        const indentation = getIndentation(col);
                        e.preventDefault();
                        document.execCommand("insertText", false, indentation);
                    } else {
                        e.preventDefault();

                        let newStart = start;
                        let newEnd = end;

                        // iterating backwards allows us to delete text while iterating, since indices won't be shifted.
                        let i = end;
                        while (i >= start) {
                            const col = getLineBeforePos(text, i);
                            if (col.length === 0) {
                                i--;
                                continue;
                            }

                            const numNonWhitespaceAtColStart = col.trimStart().length;
                            const pos = i - numNonWhitespaceAtColStart;

                            // indent by the correct amount.
                            const col2 = col.substring(0, col.length - numNonWhitespaceAtColStart);
                            const indentation = getIndentation(col2);
                            textArea.el.selectionStart = pos;
                            textArea.el.selectionEnd = pos;
                            document.execCommand("insertText", false, indentation);
                            newEnd += indentation.length;

                            i -= col.length;
                        }

                        textArea.el.selectionStart = newStart;
                        textArea.el.selectionEnd = newEnd;

                    }
                }
            } else if (e.key === "Escape" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                if (start !== end) {
                    e.stopImmediatePropagation();
                    textArea.el.selectionEnd = textArea.el.selectionStart;
                }
            }
        });

    }

    initFn?.(whenEditing);

    return root;
}
