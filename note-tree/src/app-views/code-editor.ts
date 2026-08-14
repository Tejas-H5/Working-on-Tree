import { doExtraTextAreaInputHandling, imTextAreaBegin, imTextAreaEnd } from "components/editable-text-area";
import { imLine, LINE_VERTICAL } from "components/im-line";
import { debouncedSave, GlobalContext } from "global-context";
import { state } from "state";
import { ev, im, ImCache, imdom } from "im-js";
import { COL, imui, ROW } from "im-js/im-ui";
import { Pl2CodeCellOutput, imPl2CodeCellOutput, newCodeCellOutput, updateCodeCellOutput } from "vendored/pl2-visualiser";

export type CodePage = {
    code: string;
};

export function newCodePage(): CodePage {
    return {
        code: "",
    }
}

export type CodeEditorState = {
    version: 0,
    output: Pl2CodeCellOutput;
}

export function newCodeEditorState(): CodeEditorState {
    return {
        version: 0,
        output: newCodeCellOutput(),
    };
}

export function imCodeEditor(c: ImCache, ctx: GlobalContext, s: CodeEditorState, page: CodePage) {
    let shouldRerunCode = false;

    if (im.Memo(c, s.version)) {
        shouldRerunCode = true;
    }

    imui.Begin(c, ROW); imui.Flex(c); {
        const { size } = imdom.TrackSize(c);
        const sizeChanging = im.Memo(c, size.width);
        const sizeChangingStatus = im.Memo(c, sizeChanging);
        if (!sizeChanging && sizeChangingStatus) {
            // Rerun the code when we've finished resizing.
            shouldRerunCode = true;
        }

        imui.Begin(c, COL); imui.Flex(c); {
            // TODO: use syntax highlighting
            const [root, textArea] = imTextAreaBegin(c, {
                value: page.code,
                version: s.version
            }); {
                if (im.IsFirstRender(c)) {
                    imdom.setStyleProperty(c, "--focusColor", "", root);
                }

                const input = imdom.On(c, ev.INPUT);
                const change = imdom.On(c, ev.CHANGE);

                if (input || change) {
                    page.code = textArea.value;
                    s.version++;
                    debouncedSave(ctx, state, "imPageEditor - journal edit");
                }

                const keyDown = imdom.On(c, ev.KEYDOWN);
                if (keyDown) {
                    ctx.handled = doExtraTextAreaInputHandling(keyDown, textArea, {
                        tabStopSize: state.settings.tabStopSize,
                        useSpacesInsteadOfTabs: state.settings.spacesInsteadOfTabs,
                    })
                }

                ctx.textAreaToFocus = textArea;
            } imTextAreaEnd(c);
        } imui.End(c);

        imLine(c, LINE_VERTICAL, 4, false);
        imLine(c, LINE_VERTICAL, 2);
        imLine(c, LINE_VERTICAL, 4, false);

        imui.Begin(c, COL); imui.Flex(c); imui.ScrollOverflow(c); {
            imPl2CodeCellOutput(c, s.output);
        } imui.End(c);
    } imui.End(c);

    if (shouldRerunCode) {
        rerunCode(s, page);
    }
}

function rerunCode(s: CodeEditorState, page: CodePage) {
    console.log("reran code");
    updateCodeCellOutput(s.output, page.code);
}
