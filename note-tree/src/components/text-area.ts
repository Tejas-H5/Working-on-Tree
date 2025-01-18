import { cssVars } from "src/styling";
import { Insertable, RenderGroup, cn, div, el, setAttr, setInputValue, setText, setVisible } from "src/utils/dom-utils";

export function newTextArea(): Insertable<HTMLTextAreaElement> {
    const textArea = el<HTMLTextAreaElement>("TEXTAREA", {
        class: [cn.preWrap, cn.w100, cn.h100],
        style: `border: 1px ${cssVars.fgColor} solid; padding: 0;`
    });

    textArea.el.addEventListener("keydown", (e) => {
        if (e.key === "Tab") {
            e.preventDefault();

            // HTML text area doesn't like tabs, we need this additional code to be able to insert tabs.
            // inserting a tab like this should also preserve undo, unlike value setting approaches
            // TODO: stop using deprecated API 
            //      (I doubt it will be a problem though - I bet most browsers will support this for a long while, else risk breaking a LOT of websites)
            // @ts-ignore
            document.execCommand("insertText", false, "\t");
        }
    })

    return textArea
}

export type EditableTextAreaArgs = {
    text: string;
    isEditing: boolean;
    onInput(text: string): void;
    onInputKeyDown(e: KeyboardEvent): void;
};

export function EditableTextArea(rg: RenderGroup<EditableTextAreaArgs>) {
    const whenNotEditing = div({ class: [cn.handleLongWords], style: "" });
    const whenEditing = newTextArea();
    setAttr(whenEditing, "rows", "1");
    setAttr(whenEditing, "class", cn.flex1);
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

        // We need our root's height to temporarily be the same as whenEditing, 
        // so that the document's size doesn't reduce drastically, causing scrolling to reset
        // with long text areas.
        const currentHeight = Math.max(
            // only one is visible at a time. as mentioned, this is ran when editing AND not editing.
            whenEditing.el.clientHeight,
            whenNotEditing.el.clientHeight,
        );
        root.el.style.height = currentHeight + "px";

        whenEditing.el.style.height = "0";
        whenEditing.el.style.height = whenEditing.el.scrollHeight + "px";

        root.el.style.height = "";
    }

    let isEditing = false;
    rg.preRenderFn(function renderNoteRowText(s) {
        const wasEditing = isEditing;
        isEditing = s.isEditing;

        if (setVisible(whenEditing, isEditing)) {
            if (!wasEditing) {
                whenEditing.el.focus({ preventScroll: true });
            }
        }

        if (setVisible(whenNotEditing, !isEditing)) {
            setText(whenNotEditing, s.text);
        }

        // Actually quite important that this runs even when we aren't editing, because when we eventually
        // set the input visible, it needs to auto-size to the correct height, and it won't do so otherwise
        updateTextContentAndSize();
    });

    const root = div({ class: [cn.flex1, cn.row, cn.h100], style: "overflow-y: hidden;" }, [
        whenNotEditing, 
        whenEditing
    ]);

    whenEditing.el.addEventListener("input", () => {
        const s = rg.s;

        s.onInput(whenEditing.el.value);
    });

    whenEditing.el.addEventListener("keydown", (e) => {
        const s = rg.s;
        s.onInputKeyDown(e);
    });

    return root;
}
