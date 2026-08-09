import {
    getMatrixValue,
    getShapeElementCount,
    getSliceValue,
    matixVectorDot,
    Matrix,
    matrixIsRank2,
    matrixMul,
    matrixShapesAreEqual,
    matrixVectorCross,
    matrixZeroes,
    newSlice,
    orthographicMatrix3D,
    perspectiveMatrix3D,
    rotationMatrix2D,
    rotationMatrix3DX,
    rotationMatrix3DY,
    rotationMatrix3DZ,
    rotationMatrixTranslate2D,
    rotationMatrixTranslate3D,
    scaleMatrix2D,
    scaleMatrix3D,
    setSliceValue,
    sliceToArray,
    transposeMatrix
} from "./matrix-math";
import {
    addError,
    getOrAddNewPlot,
    newEmptyProgramOutputs,
    newNumberResult,
    printResult,
    ProgramExecutionStep,
    ProgramImageOutput,
    ProgramInterpretResult,
    ProgramResult,
    programResultTypeString,
    T_RESULT_FN,
    T_RESULT_LIST,
    T_RESULT_MAP,
    T_RESULT_MATRIX,
    T_RESULT_NUMBER,
    T_RESULT_STRING,
    UI_INPUT_SLIDER,
    ZERO_VEC3,
    ZERO_VEC4
} from "./interpreter";
import { CssColor, newColor, newColorFromHexOrUndefined } from "./colour";
import { clamp, inverseLerp, max, min } from "./math-utils";
import { copyMatrix } from "./matrix-math";
import { getNextRng, setRngSeed } from "./random";
import { ProgramExpression, T_FN } from "./parser";

// I've found a significant speedup by writing code like
// if (x === false ) instaed of if (!x). 
// You won't need to do this in 99.9999% of your code, but it 
// would be nice if the library did it.
export function assert(value: boolean): asserts value {
    // Funnily enough - writing it like this ends up being very slow with the dev tools open. 
    // I'm guessing the JIT can't inline methods with early returns when some debug=true setting has been set somewhere.
    // Even putting a breakpoint on this line slows the app to a crawl for persumably similar reasons.
    // if (value === true) return;
    // throw new Error("Assertion failed - " + message);

    if (value === false) {
        throw new Error("Assertion failed");
    }
}

export type BuiltinFunctionArgDesc = {
    name: string;
    expr: ProgramExpression | undefined;
    type: ProgramResult["t"][];
    optional: boolean;
};

export type BuiltinFunction = {
    name: string;
    fn: BuiltinFunctionSignature;
    args: BuiltinFunctionArgDesc[];
    minArgs: number;
};
type BuiltinFunctionSignature = (result: ProgramInterpretResult, step: ProgramExecutionStep, ...results: (ProgramResult | null)[]) => ProgramResult | undefined;

function newArg(name: string, type: ProgramResult["t"][], optional = false, expr?: ProgramExpression): BuiltinFunctionArgDesc {
    return { name, type, optional, expr };
}

const builtinFunctions = new Map<string, BuiltinFunction>();
// Moved this thing here, so that it's easier to search for builtin functions that already exist.
// too many damn builtins

export function getBuiltinFunctionsMap() {
    if (builtinFunctions.size > 0) {
        return builtinFunctions;
    }

    function newBuiltinFunction(
        name: string,
        args: BuiltinFunctionArgDesc[],
        fn: BuiltinFunctionSignature,
    ) {
        if (builtinFunctions.has(name)) {
            throw new Error("We already have a function called " + name);
        }

        let minArgs = 0;
        for (const arg of args) {
            if (!arg.optional) {
                minArgs += 1;
            }
        }

        builtinFunctions.set(name, { name, fn, args, minArgs });
    }

    function validateColor(
        program: ProgramInterpretResult, step: ProgramExecutionStep,
        colorRes: ProgramResult
    ): CssColor | undefined {
        let color: CssColor | undefined;

        assert(colorRes.t === T_RESULT_STRING || colorRes.t === T_RESULT_MATRIX);
        if (colorRes.t === T_RESULT_STRING) {
            color = newColorFromHexOrUndefined(colorRes.val);
            if (!color) {
                addError(program, step, "hex colours are of the from #RRGGBB or #RGB. You can alternatively use a [r, g, b] vector as a color.");
                return;
            }
        } else if (colorRes.t === T_RESULT_MATRIX) {
            if (matrixShapesAreEqual(colorRes.val, ZERO_VEC3)) {
                color = newColor(
                    getSliceValue(colorRes.val.values, 0),
                    getSliceValue(colorRes.val.values, 1),
                    getSliceValue(colorRes.val.values, 2),
                    1
                );
            } else if (matrixShapesAreEqual(colorRes.val, ZERO_VEC4)) {
                color = newColor(
                    getSliceValue(colorRes.val.values, 0),
                    getSliceValue(colorRes.val.values, 1),
                    getSliceValue(colorRes.val.values, 2),
                    getSliceValue(colorRes.val.values, 3),
                );
            } else {
                addError(program, step, "Vector colors must be a Vector3 or Vector4. You can alternatively use a \"#RGB\" string color.");
                return;
            }
        }

        return color;
    }


    function builtinPlotLines(
        program: ProgramInterpretResult, step: ProgramExecutionStep,
        plotIdx: ProgramResult | null,
        lines: ProgramResult | null,
        colorMaybe: ProgramResult | null,
        labelMaybe: ProgramResult | null,
        displayAsPoints: boolean,
    ) {
        let label: string | undefined;
        if (labelMaybe) {
            assert(labelMaybe.t === T_RESULT_STRING);
            label = labelMaybe.val;
        }

        let color: CssColor | undefined;
        if (colorMaybe) {
            color = validateColor(program, step, colorMaybe);
            if (!color) {
                return;
            }
            assert(colorMaybe.t === T_RESULT_STRING || colorMaybe.t === T_RESULT_MATRIX);
            if (colorMaybe.t === T_RESULT_STRING) {
                color = newColorFromHexOrUndefined(colorMaybe.val);
            } else if (colorMaybe.t === T_RESULT_MATRIX) {
                if (matrixShapesAreEqual(colorMaybe.val, ZERO_VEC3)) {
                    color = newColor(
                        getSliceValue(colorMaybe.val.values, 0),
                        getSliceValue(colorMaybe.val.values, 1),
                        getSliceValue(colorMaybe.val.values, 2),
                        1
                    );
                } else if (matrixShapesAreEqual(colorMaybe.val, ZERO_VEC4)) {
                    color = newColor(
                        getSliceValue(colorMaybe.val.values, 0),
                        getSliceValue(colorMaybe.val.values, 1),
                        getSliceValue(colorMaybe.val.values, 2),
                        getSliceValue(colorMaybe.val.values, 3),
                    );
                } else {
                    addError(program, step, "Vector colors must be a Vector3 or Vector4");
                    return;
                }
            }
        }

        assert(plotIdx?.t === T_RESULT_NUMBER);
        const idx = plotIdx.val;


        assert(lines?.t === T_RESULT_LIST || lines?.t === T_RESULT_MATRIX);

        const pointsX: number[] = [];
        const pointsY: number[] = [];

        if (lines.t === T_RESULT_LIST) {
            for (let i = 0; i < lines.values.length; i++) {
                const val = lines.values[i];
                if (val.t !== T_RESULT_MATRIX) {
                    // if only we could get the position of this value's expression.
                    // probably if we made a static type system, it would be easier to report this error in the right place.
                    addError(program, step, "Expected every element in a list to be a vector");
                    return;
                }

                if (val.val.shape[0] < 2) {
                    addError(program, step, "Expected every element in a list to at least be a Vector2");
                    return;
                }

                pointsX.push(getSliceValue(val.val.values, 0));
                pointsY.push(getSliceValue(val.val.values, 1));
            }
        } else if (lines.t === T_RESULT_MATRIX) {
            const mat = lines.val;
            if (!matrixIsRank2(mat)) {
                addError(program, step, "Only matrices of rank 2 may be plotted");
                return;
            }

            const m = mat.shape[0];
            const n = mat.shape[1];

            if (n >= 2) {
                for (let i = 0; i < m; i++) {
                    const x = getMatrixValue(mat, i, 0);
                    const y = getMatrixValue(mat, i, 1);

                    pointsX.push(x);
                    pointsY.push(y);
                }
            }  else {
                addError(program, step, "Can't plot a matrix with fewer than 2 columns");
                return;
            }
        }

        assert(pointsY.length === pointsX.length);

        const plot = getOrAddNewPlot(program, idx);

        plot.lines.push({
            expr: step.expr,
            color,
            label,
            pointsX,
            pointsY,
            displayAsPoints
        });

        return lines;
    }

    newBuiltinFunction("sin", [newArg("t", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.sin(val.val));
    })
    newBuiltinFunction("cos", [newArg("t", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.cos(val.val));
    })
    newBuiltinFunction("tan", [newArg("t", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.tan(val.val));
    })
    newBuiltinFunction("asin", [newArg("t", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.asin(val.val));
    })
    newBuiltinFunction("acos", [newArg("t", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.acos(val.val));
    })
    newBuiltinFunction("atan", [newArg("t", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.atan(val.val));
    })
    newBuiltinFunction("atan2", [newArg("y", [T_RESULT_NUMBER]), newArg("x", [T_RESULT_NUMBER])], (_result, _step, y, x) => {
        assert(x?.t === T_RESULT_NUMBER);
        assert(y?.t === T_RESULT_NUMBER);

        return newNumberResult(Math.atan2(y.val, x.val));
    })
    newBuiltinFunction("abs", [newArg("x", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.abs(val.val));
    })
    newBuiltinFunction("ceil", [newArg("x", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.ceil(val.val));
    })
    newBuiltinFunction("floor", [newArg("x", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.floor(val.val));
    })
    newBuiltinFunction("round", [newArg("x", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.round(val.val));
    })
    newBuiltinFunction("log", [newArg("x", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.log(val.val));
    })
    newBuiltinFunction("log10", [newArg("x", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.log10(val.val));
    })
    newBuiltinFunction("log2", [newArg("x", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.log2(val.val));
    })
    newBuiltinFunction("clamp", [
        newArg("val", [T_RESULT_NUMBER]), newArg("min", [T_RESULT_NUMBER]), newArg("max", [T_RESULT_NUMBER])
    ], (_result, _step, val, a, b) => {
        assert(val?.t === T_RESULT_NUMBER);
        assert(a?.t === T_RESULT_NUMBER);
        assert(b?.t === T_RESULT_NUMBER);
        return newNumberResult(clamp(val.val, a.val, b.val));
    })
    newBuiltinFunction("max", [newArg("a", [T_RESULT_NUMBER]), newArg("b", [T_RESULT_NUMBER])], (_result, _step, a, b) => {
        assert(a?.t === T_RESULT_NUMBER);
        assert(b?.t === T_RESULT_NUMBER);
        return newNumberResult(max(a.val, b.val));
    })
    newBuiltinFunction("min", [newArg("a", [T_RESULT_NUMBER]), newArg("b", [T_RESULT_NUMBER])], (_result, _step, a, b) => {
        assert(a?.t === T_RESULT_NUMBER);
        assert(b?.t === T_RESULT_NUMBER);

        return newNumberResult(min(a.val, b.val));
    })
    newBuiltinFunction("rand", [], (result) => {
        return newNumberResult(getNextRng(result.rng));
    })
    newBuiltinFunction("rand_seed", [
        newArg("new_seed", [T_RESULT_NUMBER])
    ], (result, _step, newSeed) => {
        assert(newSeed?.t === T_RESULT_NUMBER);
        setRngSeed(result.rng, newSeed.val);
        return newSeed;
    })
    newBuiltinFunction("now", [], () => {
        return newNumberResult(performance.now());
    });
    newBuiltinFunction("pow", [newArg("x", [T_RESULT_NUMBER]), newArg("n", [T_RESULT_NUMBER])], (_result, _step, x, n) => {
        assert(x?.t === T_RESULT_NUMBER);
        assert(n?.t === T_RESULT_NUMBER);

        return newNumberResult(Math.pow(x.val, n.val));
    })
    newBuiltinFunction("sqrt", [newArg("x", [T_RESULT_NUMBER])], (_result, _step, x) => {
        assert(x?.t === T_RESULT_NUMBER);

        return newNumberResult(Math.sqrt(x.val));
    })
    newBuiltinFunction("ln", [newArg("x", [T_RESULT_NUMBER])], (_result, _step, val) => {
        assert(val?.t === T_RESULT_NUMBER);
        return newNumberResult(Math.log(val.val));
    })
    newBuiltinFunction("print", [newArg("x", [])], (result, step, val) => {
        if (!val) return;

        assert(!!step.fnBuiltin);
        assert(step.expr.t === T_FN);

        const innerExpr = step.expr.arguments[0];
        printResult(result, step, innerExpr, val);

        // can't be variadic, because print needs to return something...
        // That's ok, just put the args in a list, lol
        return val;
    });
    newBuiltinFunction(
        "set_heatmap_subdiv",
        [
            newArg("resolution", [T_RESULT_NUMBER]),
        ],
        (result, _step, resolution) => {
            assert(resolution?.t === T_RESULT_NUMBER);

            result.outputs.heatmapSubdivisions = max(0, min(200, Math.round(resolution.val)));

            return resolution;
        });
    newBuiltinFunction(
        "heatmap",
        [
            newArg("idx", [T_RESULT_NUMBER]),
            newArg("fn", [T_RESULT_FN]),
            newArg("hexColor", [T_RESULT_STRING, T_RESULT_MATRIX], true),
        ],
        (program, step, idx, fn, colorMaybe) => {
            assert(idx?.t === T_RESULT_NUMBER);
            assert(fn?.t === T_RESULT_FN);

            let color: CssColor | undefined;
            if (colorMaybe) {
                color = validateColor(program, step, colorMaybe);
                if (!color) {
                    return;
                }
            }

            const plot = getOrAddNewPlot(program, idx.val);
            plot.functions.push({ step, fn, color, expr: step.expr });

            // can't be variadic, because print needs to return something...
            // That's ok, just put the args in a list, lol
            return fn;
        });
    newBuiltinFunction(
        "plot_lines",
        [
            newArg("idx", [T_RESULT_NUMBER]),
            newArg("line", [T_RESULT_LIST, T_RESULT_MATRIX]),
            newArg("hexColor", [T_RESULT_STRING, T_RESULT_MATRIX], true),
            newArg("label", [T_RESULT_STRING], true),
        ],
        (result, step, plotIdx, lines, colorMaybe, labelMaybe) => {
            return builtinPlotLines(result, step, plotIdx, lines, colorMaybe, labelMaybe, false);
        }
    );
    newBuiltinFunction(
        "plot_points",
        [
            newArg("idx", [T_RESULT_NUMBER]),
            newArg("line", [T_RESULT_LIST, T_RESULT_MATRIX]),
            newArg("hexColor", [T_RESULT_STRING, T_RESULT_MATRIX], true),
            newArg("label", [T_RESULT_STRING], true),
        ],
        (result, step, plotIdx, lines, colorMaybe, labelMaybe) => {
            return builtinPlotLines(result, step, plotIdx, lines, colorMaybe, labelMaybe, true);
        }
    );
    newBuiltinFunction(
        "image",
        [
            newArg("vec", [T_RESULT_MATRIX]),
        ],
        (program, step, vec) => {
            assert(vec?.t === T_RESULT_MATRIX);

            let result: ProgramImageOutput | undefined = undefined;

            const dim = vec.val.shape.length;
            if (dim !== 1 && dim !== 2 && dim !== 3) {
                addError(program, step, "We can only generate images from matrices that are 1,2 or 3d." + vec.val.shape.length + ")");
                return;
            }

            if (vec.val.values.length === 0) {
                result = {
                    rgb: false,
                    pixels: [],
                    width: 0,
                    height: 0,
                    step, expr: step.expr
                };
            } else if (
                vec.val.shape.length === 1 ||
                vec.val.shape.length === 2
            ) {
                // if 1d: greyscale line
                let width, height;
                if (vec.val.shape.length === 1) {
                    width = vec.val.shape[0];
                    height = 1;
                } else {
                    width = vec.val.shape[1];
                    height = vec.val.shape[0];
                }

                let n = width * height;
                const pixels: number[] = Array(n);

                let minVal = getSliceValue(vec.val.values, 0);
                let maxVal = minVal;
                for (let i = 1; i < n; i++) {
                    const val = getSliceValue(vec.val.values, i);
                    minVal = min(val, minVal);
                    maxVal = max(val, maxVal);
                }

                for (let i = 0; i < n; i++) {
                    const val = getSliceValue(vec.val.values, i);
                    const pixelVal = inverseLerp(val, minVal, maxVal);
                    pixels[i] = pixelVal;
                }

                result = {
                    pixels,
                    rgb: false,
                    width,
                    height,
                    step,
                    expr: step.expr,
                };
            } else if (vec.val.shape.length === 3) {
                // if 3d: use the third channel as an RGB channel
                const width = vec.val.shape[1];
                const height = vec.val.shape[0];

                let n = width * height * 3;
                const pixels: number[] = Array(n);

                let rMinVal = getSliceValue(vec.val.values, 0);
                let rMaxVal = rMinVal;
                let gMinVal = getSliceValue(vec.val.values, 1);
                let gMaxVal = rMinVal;
                let bMinVal = getSliceValue(vec.val.values, 2);
                let bMaxVal = rMinVal;
                for (let i = 3; i < n; i += 3) {
                    const rVal = getSliceValue(vec.val.values, i);
                    rMinVal = min(rVal, rMinVal);
                    rMaxVal = max(rVal, rMaxVal);

                    const gVal = getSliceValue(vec.val.values, i);
                    gMinVal = min(gVal, gMinVal);
                    gMaxVal = max(gVal, gMaxVal);

                    const bVal = getSliceValue(vec.val.values, i);
                    bMinVal = min(bVal, bMinVal);
                    bMaxVal = max(bVal, bMaxVal);
                }

                for (let i = 0; i < n; i += 3) {
                    const rVal = getSliceValue(vec.val.values, i + 0);
                    const rPixelVal = inverseLerp(rVal, rMinVal, rMaxVal);
                    pixels[i + 0] = rPixelVal;

                    const gVal = getSliceValue(vec.val.values, i + 1);
                    const gPixelVal = inverseLerp(gVal, gMinVal, gMaxVal);
                    pixels[i + 1] = gPixelVal;

                    const bVal = getSliceValue(vec.val.values, i + 2);
                    const bPixelVal = inverseLerp(bVal, bMinVal, bMaxVal);
                    pixels[i + 2] = bPixelVal;
                }

                result = {
                    pixels,
                    rgb: true,
                    width,
                    height,
                    step,
                    expr: step.expr,
                };
            }


            assert(!!result);
            program.outputs.images.push(result);

            return vec;
        }
    );
    // TODO: cool operator that does this?
    newBuiltinFunction("push", [newArg("list", [T_RESULT_LIST]), newArg("item", [])], (_result, _step, list, item) => {
        if (!list) return;

        assert(list.t === T_RESULT_LIST);
        assert(!!item);
        list.values.push(item);

        return list;
    });
    newBuiltinFunction(
        "ui_slider", 
        [
            newArg("name", [T_RESULT_STRING]), 
            newArg("start", [T_RESULT_NUMBER]), 
            newArg("end", [T_RESULT_NUMBER]), 
            newArg("step", [T_RESULT_NUMBER], true), 
        ], 
        (result, step, name, start, end, sliderStep) => {
            assert(name?.t === T_RESULT_STRING);
            assert(start?.t === T_RESULT_NUMBER);
            assert(end?.t === T_RESULT_NUMBER);
            if (sliderStep) {
                assert(sliderStep.t === T_RESULT_NUMBER);
            }

            let input = result.outputs.uiInputsCache.get(name.val);
            if (!input || input.t !== UI_INPUT_SLIDER) {
                input = { 
                    t: UI_INPUT_SLIDER, 
                    name: name.val, 
                    fromThisRun: true, 
                    start: start.val, 
                    end: end.val, 
                    value: start.val, 
                    step: null, 
                    expr: step.expr,
                }
                result.outputs.uiInputsCache.set(input.name, input);
            }

            input.start = start.val;
            input.end = end.val;
            input.value = clamp(input.value, start.val, end.val);
            input.step = sliderStep ? sliderStep.val : null;
            input.fromThisRun = true;
            input.expr = step.expr;

            result.outputs.uiInputs.push(input);

            return newNumberResult(input.value);
        }
    );
    newBuiltinFunction("range", [], (result, step) => {
        addError(result, step, "'range' is invalid outside of ranged for-loops. Try range_vec or range_list");
        return undefined;
    });
    newBuiltinFunction("rrange", [], (result, step) => {
        addError(result, step, "'rrange' is invalid outside of ranged for-loops. Try rrange_vec or rrange_list");
        return undefined;
    });

    const RANGE_UPPER_LIMIT = 100000;

    function evaluateRange(
        result: ProgramInterpretResult, execStep: ProgramExecutionStep, 
        start: ProgramResult, end: ProgramResult, step: ProgramResult | null, reverseRange: boolean
    ): number[] | null {
        assert(start?.t === T_RESULT_NUMBER);
        assert(end?.t === T_RESULT_NUMBER);

        const startVal = start.val;
        const endVal = end.val;

        let stepVal = 1;
        if (step) {
            assert(step.t === T_RESULT_NUMBER);
            stepVal = step.val;
        }

        const nums: number[] = [];
        if (reverseRange) {
            for (let i = startVal; i > endVal; i += stepVal) {
                if (nums.length > RANGE_UPPER_LIMIT) {
                    addError(result, execStep, "range function hit the safety counter of " + RANGE_UPPER_LIMIT + " items max");
                    return null
                }
                nums.push(i);
            }
        } else {
            for (let i = startVal; i < endVal; i += stepVal) {
                if (nums.length > RANGE_UPPER_LIMIT) {
                    addError(result, execStep, "range function hit the safety counter of " + RANGE_UPPER_LIMIT + " items max");
                    return null
                }
                nums.push(i);
            }
        }
        return nums;
    }

    newBuiltinFunction(
        "range_vec", 
        [
            newArg("start", [T_RESULT_NUMBER]),
            newArg("end", [T_RESULT_NUMBER]),
            newArg("step", [T_RESULT_NUMBER], true),
        ], 
        (result, step, start, end, rangeStep) => {
            const nums = evaluateRange(result, step, start!, end!, rangeStep, false);
            if (!nums) {
                return;
            }

            return {
                t: T_RESULT_MATRIX,
                val: {
                    values: newSlice(nums),
                    shape: [nums.length],
                }
            };
        }
    );
    newBuiltinFunction(
        "range_list", 
        [
            newArg("start", [T_RESULT_NUMBER]),
            newArg("end", [T_RESULT_NUMBER]),
            newArg("step", [T_RESULT_NUMBER], true),
        ], 
        (result, step, start, end, rangeStep) => {
            const nums = evaluateRange(result, step, start!, end!, rangeStep, false);
            if (!nums) {
                return;
            }

            if (nums === null) {
                addError(result, step, "range function hit the safety counter of " + RANGE_UPPER_LIMIT + " items max");
                return;
            }

            return {
                t: T_RESULT_LIST,
                values: nums.map(newNumberResult),
            };
        }
    );
    newBuiltinFunction(
        "rrange_vec", 
        [
            newArg("start", [T_RESULT_NUMBER]),
            newArg("end", [T_RESULT_NUMBER]),
            newArg("step", [T_RESULT_NUMBER], true),
        ], 
        (result, step, start, end, rangeStep) => {
            const nums = evaluateRange(result, step, start!, end!, rangeStep, true);
            if (!nums) {
                return;
            }

            return {
                t: T_RESULT_MATRIX,
                val: {
                    values: newSlice(nums),
                    shape: [nums.length],
                }
            };
        }
    );
    newBuiltinFunction(
        "rrange_list", 
        [
            newArg("start", [T_RESULT_NUMBER]),
            newArg("end", [T_RESULT_NUMBER]),
            newArg("step", [T_RESULT_NUMBER], true),
        ], 
        (result, step, start, end, rangeStep) => {
            const nums = evaluateRange(result, step, start!, end!, rangeStep, true);
            if (!nums) {
                return;
            }

            if (nums === null) {
                addError(result, step, "range function hit the safety counter of " + RANGE_UPPER_LIMIT + " items max");
                return;
            }

            return {
                t: T_RESULT_LIST,
                values: nums.map(newNumberResult),
            };
        }
    );
    newBuiltinFunction(
        "graph", [
            newArg("idx", [T_RESULT_NUMBER]),
            newArg("graphMap", [T_RESULT_MAP]),
        ], 
        (result, step, idx, graphMap) => {
            assert(idx?.t === T_RESULT_NUMBER);
            assert(graphMap?.t === T_RESULT_MAP);

            let graph = result.outputs.graphs.get(idx.val);

            if (!graph) {
                graph = {
                    expr: step.expr,
                    graph: new Map(),
                };
                result.outputs.graphs.set(idx.val, graph);
            }

            // TODO: support matrix representation for graphs, i.e
            //    A B C
            //  A 0 1 1
            //  B 1 0 1
            //  C 1 1 0 
            //
            // Looks something like:
            //
            //  A <=> B, C 
            //  B <=> A, C
            //  C <=> A, B
            //
            //  There is a 1 when things are connected. It could also be weighs, it could also be directional, i.e non-symetric matrix

            for (const [k, v] of graphMap.map) {
                if (v.t !== T_RESULT_LIST) {
                    addError(result, step, "Map values be lists, but we got " + programResultTypeString(v));
                    return graphMap;
                }

                for (const val of v.values) {
                    if (val.t !== T_RESULT_STRING && val.t !== T_RESULT_NUMBER) {
                        addError(result, step, "Elements inside the edge list must be of type <string/number>. We may add more types in the future.");
                        return graphMap;
                    }

                    const entries = graph.graph.get(k) ?? [];
                    entries.push(val.val);
                    graph.graph.set(k, entries);
                }
            }

            return graphMap;
        }
    );
    newBuiltinFunction(
        "zeroes", [
        newArg("shape", [T_RESULT_MATRIX]),
    ],
        (_result, _step, shape) => {
            assert(shape?.t === T_RESULT_MATRIX);
            const mat = matrixZeroes(sliceToArray(shape.val.values));
            return { t: T_RESULT_MATRIX, val: mat };
        }
    );
    function toMatrixAlias(name: string) {
        newBuiltinFunction(
            name, [
            newArg("list", [T_RESULT_LIST]),
        ],
            (result, step, list) => {
                assert(list?.t === T_RESULT_LIST);

                const mat: Matrix = matrixZeroes([]);

                const values: number[] = [];

                for (let i = 0; i < list.values.length; i++) {
                    const vec = list.values[i];
                    if (vec.t !== T_RESULT_MATRIX) {
                        addError(result, step, "Only lists ");
                        return;
                    }

                    if (i === 0) {
                        mat.shape = [...vec.val.shape];
                    } else {
                        if (!matrixShapesAreEqual(vec.val, mat)) {
                            addError(result, step, "Only lists ");
                            return;
                        }
                    }

                    for (let i = 0; i < vec.val.values.length; i++) {
                        const val = getSliceValue(vec.val.values, i);
                        values.push(val);
                    }
                }

                mat.values = newSlice(values);
                mat.shape.unshift(list.values.length);

                return { t: T_RESULT_MATRIX, val: mat };
            }
        )
    }

    toMatrixAlias("to_vec");
    toMatrixAlias("to_mat");

    newBuiltinFunction(
        "mul", [
        newArg("mat_a", [T_RESULT_MATRIX]),
        newArg("mat_b", [T_RESULT_MATRIX]),
    ],
        (result, step, a, b) => {
            assert(a?.t === T_RESULT_MATRIX);
            assert(b?.t === T_RESULT_MATRIX);
            const [val, err] = matrixMul(a.val, b.val);

            if (err || val === null) {
                addError(result, step, err ?? "Couldn't multiply the matrices for some unkown reason (???)");
                return;
            }

            return { t: T_RESULT_MATRIX, val };
        }
    );
    newBuiltinFunction(
        "dot", [
        newArg("mat_a", [T_RESULT_MATRIX]),
        newArg("mat_b", [T_RESULT_MATRIX]),
    ],
        (result, step, a, b) => {
            assert(a?.t === T_RESULT_MATRIX);
            assert(b?.t === T_RESULT_MATRIX);
            const [val, err] = matixVectorDot(a.val, b.val);

            if (err || val === null) {
                addError(result, step, err ?? "Couldn't multiply the matrices for some unkown reason (???)");
                return;
            }

            return { t: T_RESULT_NUMBER, val };
        }
    )
    newBuiltinFunction(
        "square_magnitude", [
        newArg("mat_a", [T_RESULT_MATRIX]),
    ],
        (result, step, a) => {
            assert(a?.t === T_RESULT_MATRIX);
            const [val, err] = matixVectorDot(a.val, a.val);

            if (err || val === null) {
                addError(result, step, err ?? "Couldn't multiply the matrices for some unkown reason (???)");
                return;
            }

            return { t: T_RESULT_NUMBER, val };
        }
    );
    newBuiltinFunction(
        "magnitude", [
        newArg("mat_a", [T_RESULT_MATRIX]),
    ],
        (result, step, a) => {
            assert(a?.t === T_RESULT_MATRIX);
            let [val, err] = matixVectorDot(a.val, a.val);

            if (err || val === null) {
                addError(result, step, err ?? "Couldn't multiply the matrices for some unkown reason (???)");
                return;
            }

            val = Math.sqrt(val);

            return { t: T_RESULT_NUMBER, val };
        }
    );
    newBuiltinFunction(
        "normalized", [
        newArg("mat_a", [T_RESULT_MATRIX]),
    ],
        (result, step, a) => {
            assert(a?.t === T_RESULT_MATRIX);
            let [val, err] = matixVectorDot(a.val, a.val);

            if (err || val === null) {
                addError(result, step, err ?? "Couldn't multiply the matrices for some unkown reason (???)");
                return;
            }

            const magnitude = Math.sqrt(val);
            if (Math.abs(magnitude) < 0.00000001) {
                return { t: T_RESULT_MATRIX, val: matrixZeroes(a.val.shape) };
            }

            const rCopy = copyMatrix(a.val);
            for (let i = 0; i < rCopy.values.length; i++) {
                const x = getSliceValue(rCopy.values, i);
                setSliceValue(rCopy.values, i, x / magnitude);
            }

            return { t: T_RESULT_MATRIX, val: rCopy };
        }
    );
    newBuiltinFunction(
        "cross", [
        newArg("mat_a", [T_RESULT_MATRIX]),
        newArg("mat_b", [T_RESULT_MATRIX]),
    ],
        (result, step, a, b) => {
            assert(a?.t === T_RESULT_MATRIX);
            assert(b?.t === T_RESULT_MATRIX);
            const [val, err] = matrixVectorCross(a.val, b.val);

            if (err || val === null) {
                addError(result, step, err ?? "Couldn't multiply the matrices for some unkown reason (???)");
                return;
            }

            return { t: T_RESULT_MATRIX, val };
        }
    )
    newBuiltinFunction(
        "translate2d", [
        newArg("x", [T_RESULT_NUMBER]),
        newArg("y", [T_RESULT_NUMBER]),
    ],
        (_result, _step, x, y) => {
            assert(x?.t === T_RESULT_NUMBER);
            assert(y?.t === T_RESULT_NUMBER);
            const val = rotationMatrixTranslate2D(x.val, y.val);
            return { t: T_RESULT_MATRIX, val };
        }
    );
    newBuiltinFunction(
        "translate3d", [
        newArg("x", [T_RESULT_NUMBER]),
        newArg("y", [T_RESULT_NUMBER]),
        newArg("z", [T_RESULT_NUMBER]),
    ],
        (_result, _step, x, y, z) => {
            assert(x?.t === T_RESULT_NUMBER);
            assert(y?.t === T_RESULT_NUMBER);
            assert(z?.t === T_RESULT_NUMBER);
            const val = rotationMatrixTranslate3D(x.val, y.val, z.val);
            return { t: T_RESULT_MATRIX, val };
        }
    );
    newBuiltinFunction(
        "scale2d", [
        newArg("x", [T_RESULT_NUMBER]),
        newArg("y", [T_RESULT_NUMBER]),
    ],
        (_result, _step, x, y) => {
            assert(x?.t === T_RESULT_NUMBER);
            assert(y?.t === T_RESULT_NUMBER);
            const val = scaleMatrix2D(x.val, y.val);
            return { t: T_RESULT_MATRIX, val };
        }
    );
    newBuiltinFunction(
        "scale3d", [
        newArg("x", [T_RESULT_NUMBER]),
        newArg("y", [T_RESULT_NUMBER]),
        newArg("z", [T_RESULT_NUMBER]),
    ],
        (_result, _step, x, y, z) => {
            assert(x?.t === T_RESULT_NUMBER);
            assert(y?.t === T_RESULT_NUMBER);
            assert(z?.t === T_RESULT_NUMBER);
            const val = scaleMatrix3D(x.val, y.val, z.val);
            return { t: T_RESULT_MATRIX, val };
        }
    );
    newBuiltinFunction(
        "perspective3d", [
        newArg("fov", [T_RESULT_NUMBER]),
        newArg("near", [T_RESULT_NUMBER]),
        newArg("far", [T_RESULT_NUMBER]),
    ],
        (_result, _step, fov, near, far) => {
            assert(fov?.t === T_RESULT_NUMBER);
            assert(near?.t === T_RESULT_NUMBER);
            assert(far?.t === T_RESULT_NUMBER);
            const val = perspectiveMatrix3D(fov.val, near.val, far.val);
            return { t: T_RESULT_MATRIX, val };
        }
    );
    newBuiltinFunction(
        "ortho3d", [],
        (_result, _step, fov, near, far) => {
            assert(fov?.t === T_RESULT_NUMBER);
            assert(near?.t === T_RESULT_NUMBER);
            assert(far?.t === T_RESULT_NUMBER);
            const val = orthographicMatrix3D();
            return { t: T_RESULT_MATRIX, val };
        }
    );
    newBuiltinFunction(
        "rot2d", [
        newArg("angle", [T_RESULT_NUMBER]),
    ],
        (_result, _step, angle) => {
            assert(angle?.t === T_RESULT_NUMBER);
            const val = rotationMatrix2D(angle.val);
            return { t: T_RESULT_MATRIX, val };
        }
    );
    newBuiltinFunction(
        "rot3d_x", [
        newArg("angle", [T_RESULT_NUMBER]),
    ],
        (_result, _step, angle) => {
            assert(angle?.t === T_RESULT_NUMBER);
            const val = rotationMatrix3DX(angle.val);
            return { t: T_RESULT_MATRIX, val };
        }
    );
    newBuiltinFunction(
        "rot3d_y", [
        newArg("angle", [T_RESULT_NUMBER]),
    ],
        (_result, _step, angle) => {
            assert(angle?.t === T_RESULT_NUMBER);
            const val = rotationMatrix3DY(angle.val);
            return { t: T_RESULT_MATRIX, val };
        }
    );
    newBuiltinFunction(
        "rot3d_z", [
        newArg("angle", [T_RESULT_NUMBER]),
    ],
        (_result, _step, angle) => {
            assert(angle?.t === T_RESULT_NUMBER);
            const val = rotationMatrix3DZ(angle.val);
            return { t: T_RESULT_MATRIX, val };
        }
    );
    newBuiltinFunction(
        "transpose", [
        newArg("matrix", [T_RESULT_MATRIX]),
    ],
        (result, step, matrix) => {
            assert(matrix?.t === T_RESULT_MATRIX);
            const [val, err] = transposeMatrix(matrix.val);
            if (err || val === null) {
                addError(result, step, err);
                return;
            }
            return { t: T_RESULT_MATRIX, val };
        }
    );
    // Bro uses numpy
    newBuiltinFunction(
        "reshape", 
        [
            newArg("matrix", [T_RESULT_MATRIX]), 
            newArg("shape", [T_RESULT_MATRIX])
        ],
        (result, step, matrix, shape) => {
            assert(matrix?.t === T_RESULT_MATRIX);
            assert(shape?.t === T_RESULT_MATRIX);

            if (shape.val.shape.length !== 1) {
                addError(result, step, "Shape matrix must have a single dimension");
                return;
            }

            const len = shape.val.shape[0];
            const newShape: number[] = [];
            for (let i = 0; i < len; i++) {
                const val = getSliceValue(shape.val.values, i);
                newShape.push(val);
            }

            const originalElCount = getShapeElementCount(matrix.val.shape);
            const newShapeElCount = getShapeElementCount(newShape);
            if (newShapeElCount !== originalElCount) {
                addError(result, step, "Your reshape (" + newShape.join("*") +"=" + newShapeElCount + ") doesn't have the same number of elements as before (" + originalElCount + ")");
                return;
            }

            const copy = copyMatrix(matrix.val);
            copy.shape = newShape;

            return { t: T_RESULT_MATRIX, val: copy };
        }
    );
    // TODO: cool operator === that does this? 
    newBuiltinFunction("output_here", [], (result, step) => {
        // clear out our outputs, make the UI attribute them all to this function call instead of their actual position
        const outputs = result.outputs;
        result.outputs = newEmptyProgramOutputs();
        // Don't want to clear out the ui inputs
        result.outputs.uiInputsCache = outputs.uiInputsCache;  
        result.outputs.heatmapSubdivisions = outputs.heatmapSubdivisions;
        result.flushedOutputs.set(step.expr.start.line, outputs);

        for (const o of outputs.prints) {
            o.expr = step.expr;
        }
        for (const o of outputs.images) {
            o.expr = step.expr;
        }
        for (const o of outputs.graphs.values()) {
            o.expr = step.expr;
        }
        for (const o of outputs.plots.values()) {
            for (const l of o.lines) {
                l.expr = step.expr;
            }
        }

        return newNumberResult(0);
    });
    newBuiltinFunction(
        "len", 
        [newArg("matrix", [])], 
        (result, step, value) => {
            assert(!!value);

            if (value.t === T_RESULT_LIST) {
                return newNumberResult(value.values.length);
            }

            if (value.t === T_RESULT_MAP) {
                return newNumberResult(value.keys.length);
            }

            if (value.t === T_RESULT_MATRIX) {
                return newNumberResult(value.val.shape[0]);
            } 

            addError(result, step, "Can't use 'len' on " + programResultTypeString(value));
            return;
        }
    );
    newBuiltinFunction(
        "len_rows", 
        [newArg("matrix", [T_RESULT_MATRIX])], 
        (result, step, matrix) => {
            assert(matrix?.t === T_RESULT_MATRIX);
            return newNumberResult(matrix.val.shape[0]);
        }
    );
    newBuiltinFunction(
        "len_cols", 
        [newArg("matrix", [T_RESULT_MATRIX])], 
        (result, step, matrix) => {
            assert(matrix?.t === T_RESULT_MATRIX);
            return newNumberResult(matrix.val.shape[1]);
        }
    );
    newBuiltinFunction(
        "len_dim", 
        [newArg("matrix", [T_RESULT_MATRIX]), newArg("dimension", [T_RESULT_NUMBER])], 
        (result, step, matrix, dimension) => {
            assert(matrix?.t === T_RESULT_MATRIX);
            assert(dimension?.t === T_RESULT_NUMBER);

            const dim = dimension.val;

            if (dim < 0 || dim >= matrix.val.shape.length) {
                addError(result, step, "Dimension didn't exist on matrix");
                return;
            }

            return newNumberResult(matrix.val.shape[dim]);
        }
    );

    return builtinFunctions;
}
