import { doExtraTextAreaInputHandling, imTextAreaBegin, imTextAreaEnd } from "components/editable-text-area";
import { imLine, LINE_VERTICAL } from "components/im-line";
import { debouncedSave, GlobalContext } from "global-context";
import { state } from "state";
import { ev, im, ImCache, imdom } from "im-js";
import { COL, imui, ROW } from "im-js/im-ui";

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
    parseResult:     unknown | undefined;
    interpretResult: unknown | undefined;
}

export function newCodeEditorState(): CodeEditorState {
    return {
        version: 0,
        parseResult: undefined,
        interpretResult: undefined,
    };
}

export function imCodeEditor(c: ImCache, ctx: GlobalContext, s: CodeEditorState, page: CodePage) {
    imui.Begin(c, ROW); imui.Flex(c); {
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
                    rerunCode(s, page);
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

        imLine(c, LINE_VERTICAL, 1);

        imui.Begin(c, COL); imui.Flex(c); {
            // TODO: insert :)
        } imui.End(c);
    } imui.End(c);
}

function rerunCode(s: CodeEditorState, page: CodePage) {
    // s.parseResult = parse(page.code);
    // s.interpretResult = interpret(s.parseResult, s.interpretResult);
}
