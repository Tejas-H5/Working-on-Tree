import { doExtraTextAreaInputHandling, imTextAreaBegin, imTextAreaEnd } from "src/components/editable-text-area";
import { imLine, LINE_VERTICAL } from "src/components/im-line";
import { debouncedSave, GlobalContext } from "src/global-context";
import { state } from "src/state";
import { el, ev, im, ImCache, imdom } from "src/utils/im-js";
import { BLOCK, COL, EM, imui, INLINE, INLINE_BLOCK, NA, PX, ROW } from "src/utils/im-js/im-ui";
import { imSliderInput } from "src/utils/im-js/im-ui/slider";
import {
    expressionToString,
    interpret,
    parse,
    ProgramExpression,
    ProgramInterpretResult,
    ProgramParseResult,
    ProgramResult,
    ProgramResultFunction,
    ProgramResultList,
    ProgramResultMap,
    ProgramResultMatrix,
    ProgramResultNumber,
    ProgramResultRange,
    ProgramResultString,
    ProgramUiInput,
    T_RESULT_FN,
    T_RESULT_LIST,
    T_RESULT_MAP,
    T_RESULT_MATRIX,
    T_RESULT_NUMBER,
    T_RESULT_RANGE,
    T_RESULT_STRING,
    UI_INPUT_SLIDER
} from "src/utils/program";
import { max, min } from "src/utils/program/math-utils";
import { getSliceValue } from "src/utils/program/matrix-math";

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
    parseResult:     ProgramParseResult | undefined;
    interpretResult: ProgramInterpretResult | undefined;
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
                if (im.isFirstishRender(c)) {
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
            const { parseResult, interpretResult } = s;
            if (im.If(c) && parseResult && interpretResult) {
                let hasErrors = false;
                const errors = interpretResult.errors;
                if (im.If(c) && errors.length > 0) {
                    hasErrors = true;

                    im.For(c); for (const err of errors) {
                        imui.Begin(c, BLOCK); {
                            const context = 10;
                            let start = max(0, err.pos.i - context);
                            let end = min(err.pos.i + context, page.code.length - 1);
                            imdom.Str(c, page.code.substring(start, end))
                            imdom.Str(c, " - ");
                            imdom.Str(c, err.problem);
                        } imui.End(c);
                    } im.ForEnd(c);
                } im.IfEnd(c);

                const outputs = interpretResult.outputs; {
                    const uiInputs = outputs.uiInputs;
                    if (im.If(c) && uiInputs) {
                        if (imCodeInputUIs(c, uiInputs)) {
                            rerunCode(s, page);
                        }
                    } im.IfEnd(c);

                    // [ ] images: ProgramImageOutput[];
                    // // NOTE: graph like node -- edge --> node, not y = f(x), that is plot
                    // [ ] graphs: Map<number, ProgramGraphOutput>;
                    // [ ] plots: Map<number, ProgramPlotOutput>;
                    // [~] printsGroupedByStep: Map<ProgramExecutionStep, ProgramPrintOutput[]>;
                    // [~] plotsInOrder: ProgramPlotOutput[];
                    // [x] uiInputsCache: Map<string, ProgramUiInput>;
                    // // Unlike the cahce, these are actually in the right order
                    // [x] uiInputs: ProgramUiInput[];
                    // [~] uiInputsPerLine: Map<number, ProgramUiInput[]>;
                    // heatmapSubdivisions: number;

                    let hasResults = false;


                    if (im.If(c) && !hasErrors) {
                        if (im.If(c) && outputs.prints.length > 0) {
                            im.For(c); for (const output of outputs.prints) {
                                if (!output.visible) continue;
                                hasResults = true;

                                imProgramResult(c, output.val);
                            } im.ForEnd(c);
                        } im.IfEnd(c);

                        if (im.If(c) && outputs.prints.length > 0) {
                            im.For(c); for (const [k, plot] of outputs.plots) {
                                hasResults = true;

                                imui.Begin(c, COL); imui.Gap(c, 5, PX); {
                                    imui.Begin(c, COL); imui.Gap(c, 5, PX); {
                                        imdom.ElBegin(c, el.H3); imdom.Str(c, "Plot #" + plot.idx); imdom.ElEnd(c, el.H3);
                                    } imui.End(c); 

                                    let exprFrequencies; exprFrequencies = im.GetInline(c, imCodeEditor);
                                    if (!exprFrequencies) exprFrequencies = im.Set(c, new Map<ProgramExpression, number>());

                                    const outputsChanged = im.Memo(c, outputs);
                                    if (outputsChanged) {
                                        exprFrequencies.clear();
                                        for (const line of plot.lines) {
                                            const count = exprFrequencies.get(line.expr) ?? 0;
                                            exprFrequencies.set(line.expr, count + 1);
                                        }
                                    } 

                                    im.For(c); for (const [expr, count] of exprFrequencies) {
                                        imui.Begin(c, ROW); imui.Gap(c, 5, PX); {
                                            imdom.Str(c, count + "x: ");
                                            imui.Begin(c, INLINE); {
                                                const programText = parseResult.text;
                                                imdom.Str(c, expressionToString(programText, expr));
                                            } imui.End(c); 
                                        } imui.End(c); 
                                    } im.ForEnd(c);

                                    im.For(c); for(const [k, plot] of outputs.plots) {
                                        imui.Begin(c, BLOCK); imui.Gap(c, 5, PX); {
                                            imdom.Str(c, "Plot "); imdom.Str(c, k); imdom.Str(c, ":");
                                            imui.Begin(c, INLINE); {
                                            } imui.End(c); 
                                        } imui.End(c); 
                                    } im.ForEnd(c);
                                } imui.End(c); 
                            } im.ForEnd(c);
                        } im.IfEnd(c);
                    } im.IfEnd(c);

                    if (im.If(c) && !hasResults) {
                        imdom.Str(c, "No results");
                    } im.IfEnd(c);
                }
            } im.IfEnd(c);
        } imui.End(c);
    } imui.End(c);
}

function rerunCode(s: CodeEditorState, page: CodePage) {
    s.parseResult = parse(page.code);
    s.interpretResult = interpret(s.parseResult, s.interpretResult);
}

function imProgramResult(c: ImCache, val: ProgramResult) {
    // TODO: seperate type from value
    im.Switch(c, val.t); switch(val.t) {
        case T_RESULT_NUMBER: imProgramResultNumber(c, val); break;
        case T_RESULT_STRING: imProgramResultString(c, val); break;
        case T_RESULT_LIST:   imProgramResultList(c, val);   break;
        case T_RESULT_MATRIX: imProgramResultMatrix(c, val); break;
        case T_RESULT_RANGE:  imProgramResultRange(c, val);  break;
        case T_RESULT_FN:     imProgramResultFn(c, val);     break;
        case T_RESULT_MAP:    imProgramResultMap(c, val);    break;
    } im.SwitchEnd(c);
}

function imProgramResultNumber(c: ImCache, val: ProgramResultNumber) {
    imui.Begin(c, BLOCK); {
        imdom.Str(c, "Number: "); imdom.Str(c, val.val);
    } imui.End(c);
}

function imProgramResultString(c: ImCache, val: ProgramResultString) {
    imui.Begin(c, BLOCK); {
        imdom.Str(c, "String: "); imdom.Str(c, val.val);
    } imui.End(c);
}

function imProgramResultList(c: ImCache, val: ProgramResultList) {
    imui.Begin(c, BLOCK); imui.PaddingRL(c, 0, NA, 20, PX);  {
        imdom.Str(c, "list["); imdom.Str(c, val.values.length); imdom.Str(c, "]");
        im.For(c); for (const value of val.values) {
            imProgramResult(c, value);
        } im.ForEnd(c);
    } imui.End(c);
}

function imProgramResultMatrix(c: ImCache, val: ProgramResultMatrix) {
    const mat = val.val;

    imui.Begin(c, BLOCK); imui.PaddingRL(c, 0, NA, 20, PX);  {
        imui.Begin(c, BLOCK); {
            imdom.Str(c, "matrix["); 
            for (let i = 0; i < mat.shape.length; i++) {
                const dim = mat.shape[i];
                if (i !== 0) {
                    imdom.Str(c, "x");
                }
                imdom.Str(c, dim);
            }
            imdom.Str(c, "]");
        } imui.End(c);

        let idx = 0;
        const dfs = (dim: number, totalDimensions: number, isFinal: boolean) => {
            const isLast = dim === totalDimensions - 1;

            if (dim === mat.shape.length) {
                const val = getSliceValue(mat.values, idx);

                // assuming everything renders in order, this is the only thing we need to do for this to work.
                idx++;

                imdom.Str(c, "" + val);

                if (im.If(c) && !isFinal) {
                    imdom.Str(c, ", ");
                } im.IfEnd(c);

                return;
            }

            imui.Begin(c, BLOCK); {
                imui.Begin(c, isLast ? INLINE_BLOCK : BLOCK); imdom.Str(c, "["); imui.End(c);
                const len = mat.shape[dim];
                im.For(c); for (let i = 0; i < len; i++) {
                    // This is because when the 'level' of the list changes, the depth itself changes,
                    // and the components we're rendering at a particular level will change. 
                    // We need to re-key the list, so that we may render a different kind of component at this position.
                    const key = (mat.shape.length - dim) + "-" + i;
                    im.KeyedBegin(c, key); {
                        dfs(dim + 1, totalDimensions, i === len - 1);
                    } im.KeyedEnd(c);
                } im.ForEnd(c);
                imui.Begin(c, isLast ? INLINE_BLOCK : BLOCK); imdom.Str(c, "]"); imui.End(c);
            } imui.End(c);
        }
        dfs(0, mat.shape.length, false);
    } imui.End(c);
}

function imProgramResultRange(c: ImCache, val: ProgramResultRange) {
    imui.Begin(c, BLOCK); {
        imdom.Str(c, "String: "); imdom.Str(c, val.val);
    } imui.End(c);
}

function imProgramResultFn(c: ImCache, val: ProgramResultFunction) {
    imui.Begin(c, BLOCK); imui.PaddingRL(c, 0, NA, 20, PX);  {
        imdom.Str(c, "function "); imdom.Str(c, val.code.name);
    } imui.End(c);
}

function imProgramResultMap(c: ImCache, val: ProgramResultMap) {
    imui.Begin(c, BLOCK); imui.PaddingRL(c, 0, NA, 20, PX);  {
        imdom.Str(c, "map["); imdom.Str(c, val.map.size); imdom.Str(c, "]");
        im.For(c); for (const [k, v] of val.map) {
            imui.Begin(c, ROW); {
                imui.Begin(c, BLOCK); {
                    imdom.Str(c, k);
                } imui.End(c);
                imui.Begin(c, COL); imui.Flex(c); {
                    imProgramResult(c, v);
                } imui.End(c);
            } imui.End(c);
        } im.ForEnd(c);
    } imui.End(c);
}


type PlotState = {
    autofit: boolean;
    overlay: boolean;
    posX: number;
    posY: number;
    originalExtent: number;
    zoom: number;
    width: number;
    height: number;
    dpi: number;
    maximized: boolean;
    isPanning: boolean;
    canZoom: boolean;
    scrollY: number;
    // bump this whenever you mutate
    version: number;
}

function newPlotState(): PlotState {
    return {
        scrollY: 0,
        overlay: true,
        autofit: true,
        posX: 0,
        posY: 0,
        zoom: 1,
        originalExtent: 0,
        width: 0,
        height: 0,
        dpi: 0,
        maximized: false,
        isPanning: false,
        canZoom: false,
        version: 0,
    };
}

export function imCodeInputUIs(c: ImCache, inputs: ProgramUiInput[]): boolean {
    let shouldRerunProgram = false;

    im.For(c); for (const ui of inputs) {
        imui.Begin(c, COL); imui.Gap(c, 5, PX); imui.Padding(c, 5, PX, 5, PX, 5, PX, 5, PX); {
            im.Switch(c, ui.t); switch (ui.t) {
                case UI_INPUT_SLIDER: {
                    imui.Begin(c, ROW); imui.Gap(c, 5, PX); {
                        imui.Begin(c, BLOCK); imdom.Str(c, ui.name); imui.End(c);
                        imui.Begin(c, BLOCK); imdom.Str(c, ui.value + ""); imui.End(c);
                    } imui.End(c);
                    imui.Begin(c, ROW); imui.Size(c, 0, NA, 1, EM); {
                        ui.value = imSliderInput(c, ui.start, ui.end, ui.step, ui.value);
                        if (im.Memo(c, ui.value)) {
                            shouldRerunProgram = true;
                        }
                    } imui.End(c);
                } break;
                default: {
                    throw new Error("Unhandled UI input type");
                }
            } im.SwitchEnd(c);
        } imui.End(c);
    } im.ForEnd(c);

    return shouldRerunProgram;
}
