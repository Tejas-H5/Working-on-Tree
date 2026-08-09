import { assert, assertUnreachable } from "./assert";
import {
    copyMatrix,
    getMatrixRow,
    getMatrixRowLength,
    getSliceValue,
    isIndexInSliceBounds,
    Matrix,
    matrixAddElements,
    matrixDivideElements,
    matrixElementsEqual,
    matrixElementsGreaterThan,
    matrixElementsGreaterThanOrEqual,
    matrixElementsLessThan,
    matrixElementsLessThanOrEqual,
    matrixLogicalAndElements,
    matrixLogicalOrElements,
    matrixMultiplyElements,
    matrixShapesAreEqual,
    matrixSubtractElements,
    matrixZeroes,
    newSlice,
    setSliceValue,
    subMatrixShapeEqualsRowShape
} from "./matrix-math";
import {
    BIN_OP_ADD,
    BIN_OP_AND_AND,
    BIN_OP_DIVIDE,
    BIN_OP_GREATER_THAN,
    BIN_OP_GREATER_THAN_EQ,
    BIN_OP_INVALID,
    BIN_OP_IS_EQUAL_TO,
    BIN_OP_LESS_THAN,
    BIN_OP_LESS_THAN_EQ,
    BIN_OP_MODULO,
    BIN_OP_MULTIPLY,
    BIN_OP_OR_OR,
    BIN_OP_SUBTRACT,
    BinaryOperatorType,
    binOpToOpString,
    binOpToString,
    DiagnosticInfo,
    expressionTypeToString,
    ProgramExpression,
    ProgramExpressionFn,
    ProgramExpressionIdentifier,
    ProgramParseResult,
    T_ASSIGNMENT,
    T_BINARY_OP,
    T_BLOCK,
    T_DATA_INDEX_OP,
    T_FN,
    T_IDENTIFIER,
    T_IDENTIFIER_THE_RESULT_FROM_ABOVE,
    T_LIST_LITERAL,
    T_MAP_LITERAL,
    T_NUMBER_LITERAL,
    T_RANGE_FOR,
    T_STRING_LITERAL,
    T_TERNARY_IF,
    T_UNARY_OP,
    T_VECTOR_LITERAL,
    TextPosition,
    UNARY_OP_NOT,
    UNARY_OP_PRINT,
    UnaryOperatorType,
    unaryOpToOpString,
    unaryOpToString
} from "./parser";
import { groupBy } from "./array-utils";
import { CssColor } from "./colour";
import { newRandomNumberGenerator, RandomNumberGenerator, setRngSeed } from "./random";
import { BuiltinFunction, getBuiltinFunctionsMap } from "./builtins";

export const T_RESULT_NUMBER = 1;
export const T_RESULT_STRING = 2;
export const T_RESULT_LIST = 3;
export const T_RESULT_MATRIX = 4;
export const T_RESULT_RANGE = 5;
export const T_RESULT_FN = 6;
export const T_RESULT_MAP = 7;

export type ProgramResultNumber = {
    t: typeof T_RESULT_NUMBER;
    val: number;
}

export type ProgramResultRange = {
    t: typeof T_RESULT_RANGE;
    val: NumberRange;
}

export type ProgramResultString = {
    t: typeof T_RESULT_STRING;
    val: string;
}

export type ProgramResultMatrix = {
    t: typeof T_RESULT_MATRIX;
    val: Matrix;
}

export type ProgramResultFunction = {
    t: typeof T_RESULT_FN;
    expr: ProgramExpressionFn;
    code: ExecutionSteps;
    args: ProgramExpressionIdentifier[];
};


export type ProgramResultList = {
    t: typeof T_RESULT_LIST;
    values: ProgramResult[];
}

export type ProgramResultMap = {
    t: typeof T_RESULT_MAP;
    map: Map<string | number, ProgramResult>;
    keys: (string | number)[];
}

export type ProgramResult = ProgramResultNumber
    | ProgramResultRange
    | ProgramResultString
    | ProgramResultList
    | ProgramResultMap
    | ProgramResultMatrix
    | ProgramResultFunction;

export function programResultTypeString(output: ProgramResult): string {
    switch (output.t) {
        case T_RESULT_MATRIX: {
            return getMatrixTypeFromShape(output.val.shape);
        }
    }

    return programResultTypeStringFromType(output.t);
}

export function getMatrixTypeFromShape(shape: number[]): string {
    return shape.length === 1 ? `Vector${shape[0]}` : (
        `Matrix${shape.map(s => "" + s).join("x")}`
    );
}

export function programResultTypeStringFromType(t: ProgramResult["t"]): string {
    switch (t) {
        case T_RESULT_NUMBER:
            return "Number";
        case T_RESULT_RANGE:
            return "Range";
        case T_RESULT_STRING:
            return "String";
        case T_RESULT_LIST:
            return "List";
        case T_RESULT_MAP:
            return "Map";
        case T_RESULT_MATRIX: {
            return "Matrix";
        }
        case T_RESULT_FN:
            return `Function`;
    }
}

// NOTE: this range needs to be exclusive, because lo is not necessarily < hi, 
// so we can't represent a zero-length range otherwise
type NumberRange = {
    lo: number;
    hi: number;
};

function evaluateBinaryOpNumberXNumber(
    l: ProgramResultNumber,
    r: ProgramResultNumber,
    op: BinaryOperatorType,
): ProgramResultNumber | ProgramResultRange | null {
    let num: number | undefined;
    let range: NumberRange | undefined;

    switch (op) {
        case BIN_OP_MULTIPLY:        num = l.val * r.val;             break;
        case BIN_OP_DIVIDE:          num = r.val / l.val;             break;
        case BIN_OP_ADD:             num = r.val + l.val;             break;
        case BIN_OP_SUBTRACT:        num = r.val - l.val;             break;
        case BIN_OP_IS_EQUAL_TO:     num = (r.val === l.val) ? 1 : 0; break;
        case BIN_OP_LESS_THAN:       num = (r.val < l.val) ? 1 : 0;   break;
        case BIN_OP_LESS_THAN_EQ:    num = (r.val <= l.val) ? 1 : 0;  break;
        case BIN_OP_GREATER_THAN:    num = (r.val > l.val) ? 1 : 0;   break;
        case BIN_OP_GREATER_THAN_EQ: num = (r.val >= l.val) ? 1 : 0;  break;
        case BIN_OP_AND_AND:         num = (r.val && l.val) ? 1 : 0;  break;
        case BIN_OP_OR_OR:           num = (r.val || l.val) ? 1 : 0;  break;
        case BIN_OP_MODULO:          num = r.val % l.val;             break;
        case BIN_OP_INVALID:         assert(false) // An invalid binary op was parsed, and added to the result tree somehow
    }

    let result: ProgramResultNumber | ProgramResultRange | null = null;

    if (num !== undefined) {
        result = { t: T_RESULT_NUMBER, val: num };
    } else if (range) {
        result = { t: T_RESULT_RANGE, val: range };
    }

    return result;
}

function evaluateBinaryOpMatrixXMatrix(
    l: ProgramResultMatrix,
    r: ProgramResultMatrix,
    op: BinaryOperatorType,
): [ProgramResultNumber | ProgramResultMatrix | null, string] {

    let isBool = false;
    let bool = false;
    let val: Matrix | null = null;
    let err: string;

    switch (op) {
        case BIN_OP_MULTIPLY:
            [val, err] = matrixMultiplyElements(l.val, r.val);
            break;
        case BIN_OP_DIVIDE:
            [val, err] = matrixDivideElements(l.val, r.val);
            break;
        case BIN_OP_ADD:
            [val, err] = matrixAddElements(l.val, r.val);
            break;
        case BIN_OP_SUBTRACT:
            [val, err] = matrixSubtractElements(l.val, r.val);
            break;
        case BIN_OP_IS_EQUAL_TO:
            isBool = true;
            [bool, err] = matrixElementsEqual(l.val, r.val);
            break;
        case BIN_OP_LESS_THAN:
            isBool = true;
            [bool, err] = matrixElementsLessThan(l.val, r.val);
            break;
        case BIN_OP_LESS_THAN_EQ:
            isBool = true;
            [bool, err] = matrixElementsLessThanOrEqual(l.val, r.val);
            break;
        case BIN_OP_GREATER_THAN:
            isBool = true;
            [bool, err] = matrixElementsGreaterThan(l.val, r.val);
            break;
        case BIN_OP_GREATER_THAN_EQ:
            isBool = true;
            [bool, err] = matrixElementsGreaterThanOrEqual(l.val, r.val);
            break;
        case BIN_OP_AND_AND:
            [val, err] = matrixLogicalAndElements(l.val, r.val);
            break;
        case BIN_OP_OR_OR:
            [val, err] = matrixLogicalOrElements(l.val, r.val);
            break;
        case BIN_OP_MODULO:
            [val, err] = matrixLogicalOrElements(l.val, r.val);
            break;
        case BIN_OP_INVALID:
            // An invalid binary op was parsed, and added to the result tree somehow
            assert(false)
    }

    if (isBool) {
        return [newNumberResult(bool ? 1 : 0), ""];
    }

    if (val) {
        return [{ t: T_RESULT_MATRIX, val }, ""];
    }

    if (err) {
        return [null, err];
    }

    return [null, ""];
}

function evaluateBinaryOpNumberXMatrix(
    l: ProgramResultNumber,
    r: ProgramResultMatrix,
    numWasLhs: boolean,
    op: BinaryOperatorType,
): ProgramResultMatrix | null {

    const num = l.val;
    const rCopy = copyMatrix(r.val);

    switch (op) {
        case BIN_OP_MULTIPLY: {
            for (let i = 0; i < rCopy.values.length; i++) {
                const x = getSliceValue(rCopy.values, i);
                setSliceValue(rCopy.values, i, x * num);
            }
        } break;
        case BIN_OP_DIVIDE: {
            // NOTE: this case is just copy-paste
            for (let i = 0; i < rCopy.values.length; i++) {
                const x = getSliceValue(rCopy.values, i);
                setSliceValue(rCopy.values, i, x / num);
            }
        } break;
        case BIN_OP_ADD: {
            // NOTE: this case is just copy-paste
            for (let i = 0; i < rCopy.values.length; i++) {
                const x = getSliceValue(rCopy.values, i);
                setSliceValue(rCopy.values, i, x + num);
            }
        } break;
        case BIN_OP_SUBTRACT:
            if (numWasLhs) {
                // NOTE: this case is just copy-paste
                for (let i = 0; i < rCopy.values.length; i++) {
                    const x = getSliceValue(rCopy.values, i);
                    setSliceValue(rCopy.values, i, num - x);
                }
            } else {
                // NOTE: this case is just copy-paste
                for (let i = 0; i < rCopy.values.length; i++) {
                    const x = getSliceValue(rCopy.values, i);
                    setSliceValue(rCopy.values, i, x - num);
                }
            }
            break;
        case BIN_OP_IS_EQUAL_TO:
            // NOTE: this case is just copy-paste
            for (let i = 0; i < rCopy.values.length; i++) {
                const x = getSliceValue(rCopy.values, i);
                setSliceValue(rCopy.values, i, x === num ? 1 : 0);
            }
            break;
        case BIN_OP_LESS_THAN: {
            // NOTE: this case is just copy-paste
            for (let i = 0; i < rCopy.values.length; i++) {
                const x = getSliceValue(rCopy.values, i);
                setSliceValue(rCopy.values, i, x < num ? 1 : 0);
            }
        } break;
        case BIN_OP_LESS_THAN_EQ: {
            // NOTE: this case is just copy-paste
            for (let i = 0; i < rCopy.values.length; i++) {
                const x = getSliceValue(rCopy.values, i);
                setSliceValue(rCopy.values, i, x <= num ? 1 : 0);
            }
        } break;
        case BIN_OP_GREATER_THAN:
            // NOTE: this case is just copy-paste
            for (let i = 0; i < rCopy.values.length; i++) {
                const x = getSliceValue(rCopy.values, i);
                setSliceValue(rCopy.values, i, x > num ? 1 : 0);
            }
            break;
        case BIN_OP_GREATER_THAN_EQ:
            // NOTE: this case is just copy-paste
            for (let i = 0; i < rCopy.values.length; i++) {
                const x = getSliceValue(rCopy.values, i);
                setSliceValue(rCopy.values, i, x >= num ? 1 : 0);
            }
            break;
        case BIN_OP_AND_AND: {
            // NOTE: this case is just copy-paste
            for (let i = 0; i < rCopy.values.length; i++) {
                const x = getSliceValue(rCopy.values, i);
                setSliceValue(rCopy.values, i, x && num ? 1 : 0);
            }
        } break;
        case BIN_OP_OR_OR: {
            // NOTE: this case is just copy-paste
            for (let i = 0; i < rCopy.values.length; i++) {
                const x = getSliceValue(rCopy.values, i);
                setSliceValue(rCopy.values, i, x || num ? 1 : 0);
            }
        } break;
        case BIN_OP_INVALID:
            // An invalid binary op was parsed, and added to the result tree somehow
            assert(false)
    }

    return { t: T_RESULT_MATRIX, val: rCopy };
}

function evaluateBinaryOpNumberXList(
    l: ProgramResultNumber,
    r: ProgramResultList,
    numWasLhs: boolean,
    program: ProgramInterpretResult,
    step: ProgramExecutionStep,
): ProgramResultList | null {

    const result = Array(r.values.length);
    if (numWasLhs) {
        for (let i = 0; i < r.values.length; i++) {
            const ithResult = evaluateBinaryOperatorNumber(l, r.values[i], program, step);
            if (!ithResult) {
                return null;
            }

            result[i] = ithResult;
        }
    } else {
        for (let i = 0; i < r.values.length; i++) {
            const ithResult = evaluateBinaryOperatorNumber(r.values[i], l, program, step);
            if (!ithResult) {
                return null;
            }

            result[i] = ithResult;
        }
    }

    return { t: T_RESULT_LIST, values: result }
}

function evaluateUnaryOp(result: ProgramInterpretResult, step: ProgramExecutionStep, val: ProgramResult, op: UnaryOperatorType): [ProgramResult | null, string] {
    switch (op) {
        case UNARY_OP_NOT: {
            if (val.t === T_RESULT_NUMBER) {
                return [newNumberResult(val.val === 0 ? 1 : 0), ""];
            }
        } break;
        case UNARY_OP_PRINT: {
            printResult(result, step, step.expr, val);
            return [val, ""];
        }
    }

    return [null, ""];
}


const EX_STEP_INVALID = 0;
// Loads a variable onto the stack specified by str
// TODO: compute variable indices at instruction gen time?
const EX_STEP_LOAD = 1;
// loads the last block result onto the stack. complains if it doesn't exist.
const EX_STEP_LOAD_LAST_BLOCK_RESULT = 2;
// did this top level statement just end? (not top-level)
const EX_STEP_BLOCK_STATEMENT_END = 3;
// did this top level statement just end? (top-level)
const EX_STEP_BLOCK_STATEMENT_END_TOP_LEVEL = 4;
// Should we clear the current block statement?
// (prevents leaking implementation details of for-loops)
const EX_STEP_CLEAR_LAST_BLOCK_RESULT = 5;
// Pops the last stack value into the stack, assigns it to a variable, or indexing operation
const EX_STEP_SET = 6;
// Pops the last two stack values, applies a binary operator to them specified by n
const EX_STEP_BINARY_OPERATOR = 7;
// pops the last value, applies a unary operator
const EX_STEP_UNARY_OPERATOR = 8;
// Pops the last n things off the stack and into a list
const EX_STEP_LIST = 9;
// Pops the last 2n kv pairs off the stack and into a map
const EX_STEP_MAP = 10;
// Pops the last n things off the stack and into a vector
const EX_STEP_VECTOR = 11;
// Pushes n to the stack
const EX_STEP_NUMBER = 12;
// Pushes str to the stack
const EX_STEP_STRING = 13;
// Pushes fn to the stack
const EX_STEP_FN = 14;
// pushes a builtin function to the stack
const EX_STEP_FN_BUILTIN = 15;
// jumps the current instruction index to n
const EX_STEP_JUMP = 16;
// pops a value, jumps the current instruction index to the step specified if it was zero
const EX_STEP_JUMP_IF_FALSE = 17;
// increments variable referred to by str by tha last thing on the stack.
const EX_STEP_INCR = 18;
// pops several indexes, uses them to index into a datastructure
const EX_STEP_INDEX = 19;
// pops the last three (matrx, index, value) and assigns matrix[index] = value;
// the behaviour depends on the type of `value`. The op might fail if the matricies are the wrong size.
// [1, 2, 3][0] = [2] -> [2, 2, 3]
// [[1, 2, 3]][0] = [2, 2, 2] -> [[2, 2, 2]]
const EX_STEP_INDEX_ASSIGNMENT = 20;
// calls fn with n args
const EX_STEP_FN_CALL = 21;
// calls a builtin function with n args.
const EX_STEP_FN_BUILTIN_CALL = 22;


type ExecutionStepType = typeof EX_STEP_INVALID
    | typeof EX_STEP_LOAD
    | typeof EX_STEP_LOAD_LAST_BLOCK_RESULT
    | typeof EX_STEP_BLOCK_STATEMENT_END
    | typeof EX_STEP_BLOCK_STATEMENT_END_TOP_LEVEL
    | typeof EX_STEP_CLEAR_LAST_BLOCK_RESULT
    | typeof EX_STEP_SET
    | typeof EX_STEP_BINARY_OPERATOR
    | typeof EX_STEP_UNARY_OPERATOR
    | typeof EX_STEP_LIST
    | typeof EX_STEP_MAP
    | typeof EX_STEP_VECTOR
    | typeof EX_STEP_NUMBER
    | typeof EX_STEP_STRING
    | typeof EX_STEP_FN
    | typeof EX_STEP_FN_BUILTIN
    | typeof EX_STEP_JUMP
    | typeof EX_STEP_JUMP_IF_FALSE
    | typeof EX_STEP_INCR
    | typeof EX_STEP_INDEX
    | typeof EX_STEP_INDEX_ASSIGNMENT
    | typeof EX_STEP_FN_CALL
    | typeof EX_STEP_FN_BUILTIN_CALL
;

// Trying a product type isntead of a sum-type, will let u know how I go.
// TODO: compress this type using the encoding pattern instead of booleans. It could be a LOT smaller.
export type ProgramExecutionStep = {
    // which code did we type to generate this thing?
    expr: ProgramExpression;

    type: ExecutionStepType;
    n: number;
    str: string;
    _fn: ProgramResultFunction | undefined;
    fnBuiltin: BuiltinFunction | undefined;
};

export type ExecutionSteps = {
    name: string;
    steps: ProgramExecutionStep[];
}

export function executionStepToString(step: ProgramExecutionStep): string {
    switch(step.type) {
        case EX_STEP_LOAD: return ("Load " + step.str);
        case EX_STEP_LOAD_LAST_BLOCK_RESULT: return "Load last block result";
        case EX_STEP_BLOCK_STATEMENT_END: return "end block";
        case EX_STEP_BLOCK_STATEMENT_END_TOP_LEVEL: return "end block <top level>";
        case EX_STEP_CLEAR_LAST_BLOCK_RESULT: return "Clear last block result";
        case EX_STEP_SET: return ("Set " + step.str);
        case EX_STEP_BINARY_OPERATOR: return ("Binary op: " + binOpToOpString(step.n as BinaryOperatorType) + " (" + binOpToString(step.n as BinaryOperatorType) + ")");
        case EX_STEP_UNARY_OPERATOR: return ("Unary op: " + unaryOpToOpString(step.n as UnaryOperatorType) + " (" + unaryOpToString(step.n as UnaryOperatorType) + ")");
        case EX_STEP_LIST: return ("List " + step.n);
        case EX_STEP_MAP: return ("Map " + step.n);
        case EX_STEP_VECTOR: return ("Vector " + step.n);
        case EX_STEP_NUMBER: return ("Number " + step.n);
        case EX_STEP_STRING: return ("String " + step.str);
        case EX_STEP_JUMP: return ("jump to idx=" + step.n);
        case EX_STEP_JUMP_IF_FALSE: return ("jump (if false) to idx=" + step.n);
        case EX_STEP_INCR: return "increment " + step.str;
        // NOTE: somehow this ended up not being a binary operator....
        // Most likely because the syntax is a[b] and not a <op> b, I didn't think of it at the time xD
        case EX_STEP_INDEX: return "index op"; 
        case EX_STEP_FN:
        case EX_STEP_FN_CALL: {
            const fn = step._fn;
            assert(!!fn);
            const name = fn.expr.fnName.name;
            if (step.type === EX_STEP_FN) {
                return ("Fn " + name + "(" + step.n + " args) ");
            } 
            return ("Call Fn" + name + "(" + step.n + " args) ");
        }
        case EX_STEP_FN_BUILTIN:
        case EX_STEP_FN_BUILTIN_CALL: {
            const fn = step.fnBuiltin;
            assert(!!fn);
            const name = fn.name
            if (step.type === EX_STEP_FN_BUILTIN) {
                return ("[builtin] Fn " + name + "(" + step.n + " args) ");
            }
            return ("Call [builtin] Fn" + name + "(" + step.n + " args) ");
        }
        case EX_STEP_INDEX_ASSIGNMENT: {
            return "Index assignment tri-op";
        }
        case EX_STEP_INVALID: {
            return "Invalid step! there is a bug in the instruction generator.";
        }
        default: assertUnreachable(step.type);
    }

}

function newExecutionStep(expr: ProgramExpression): ProgramExecutionStep {
    return { 
        expr,
        type: EX_STEP_INVALID,
        n: 0,
        str: "",
        _fn: undefined,
        fnBuiltin: undefined,
    };
}


type ExecutionState = {
    code: ExecutionSteps;
    i: number;
    argsCount: number;
    fn: ProgramResultFunction | null;

    // TODO: replace with an array
    variables: Map<string, number>;
    returnAddress: number;
    nextVarAddress: number;
};

export type ProgramInterpretResult = {
    parseResult: ProgramParseResult;
    rng: RandomNumberGenerator;

    isDebugging: boolean;
    ended: boolean;

    errors: DiagnosticInfo[];

    // Writing it like this instead should allow us to step through the program one step at a time,
    // so that we can see what's going on and fix bugs easier. 
    entryPoint: ExecutionSteps;

    // TODO: replace with array
    functions: Map<string, ProgramResultFunction>;

    // Not how a real program does it. But I dont care (but everythign else is 100% accurate, right?)
    stack: (ProgramResult | null)[];
    stackIdx: number;
    callStack: ExecutionState[];

    outputs: ProgramOutputs;
    // line_number -> ProgramOutputs.
    flushedOutputs: Map<number, ProgramOutputs>;
}

export type ProgramPrintOutput = {
    step: ProgramExecutionStep;
    expr: ProgramExpression;
    val: ProgramResult;
    visible: boolean;
}

export type ProgramPlotOutputLine = {
    expr: ProgramExpression;
    pointsX: number[];
    pointsY: number[];
    color: CssColor | undefined;
    label: string | undefined;
    displayAsPoints: boolean;
}

export type ProgramImageOutput = {
    pixels: number[];
    // true -> pixels are [rgbrgbrgbrgb]
    // false -> pixels are [vvvvvvvv] (grayscale);
    rgb: boolean;
    width: number;
    height: number;
    step: ProgramExecutionStep;
    expr: ProgramExpression;
}

export type ProgramPlotOutput = {
    idx: number;
    lines: ProgramPlotOutputLine[];
    functions: ProgramPlotOutputHeatmapFunction[];
}

export type ProgramGraphOutput = {
    expr: ProgramExpression;
    graph: Map<string | number, (string | number)[]>;
};

export type ProgramPlotOutputHeatmapFunction = {
    step: ProgramExecutionStep;
    fn: ProgramResultFunction;
    color: CssColor | undefined;
    expr: ProgramExpression;
}

type ProgramUiInputBase = {
    name: string;
    expr: ProgramExpression;
    fromThisRun: boolean;
};

export const UI_INPUT_SLIDER = 1;

export type ProgramUiInputSlider = ProgramUiInputBase & {
    t: typeof UI_INPUT_SLIDER;
    start: number;
    end: number;
    value: number;
    step: number | null;
}

export type ProgramUiInput = ProgramUiInputSlider;

export type ProgramOutputs = {
    prints: ProgramPrintOutput[];
    printsGroupedByStep: Map<ProgramExecutionStep, ProgramPrintOutput[]>;

    images: ProgramImageOutput[];
    // NOTE: graph like node -- edge --> node, not y = f(x), that is plot
    graphs: Map<number, ProgramGraphOutput>;
    plots: Map<number, ProgramPlotOutput>;
    plotsInOrder: ProgramPlotOutput[];
    uiInputsCache: Map<string, ProgramUiInput>;
    // Unlike the cahce, these are actually in the right order
    uiInputs: ProgramUiInput[];
    uiInputsPerLine: Map<number, ProgramUiInput[]>;
    heatmapSubdivisions: number;
};


const builtinNumberConstants = new Map<string, ProgramResultNumber>();
builtinNumberConstants.set("PI", newNumberResult(Math.PI))
builtinNumberConstants.set("E", newNumberResult(Math.E))

function getExecutionSteps(
    result: ProgramInterpretResult,
    statements: ProgramExpression[],
    steps: ProgramExecutionStep[],
    topLevel: boolean,
) {

    const addError = (expr: ProgramExpression, problem: string) => {
        result.errors.push({ pos: expr.start, problem });
    }

    const incompleteExpressionError = (expr: ProgramExpression) => {
        addError(expr, "Found an incomplete expression");
    }

    // This method should never 'error', since only valid parse-trees should be generated.
    // it's return value indicates whether this was a no-op or not.
    const dfs = (expr: ProgramExpression): boolean => {
        if (result.errors.length > 0) {
            return false;
        }

        const step = newExecutionStep(expr);
        let alreadyPushed = false;
        let noOp = false;

        switch (expr.t) {
            case T_IDENTIFIER: {
                const numberConstant = builtinNumberConstants.get(expr.name);
                if (numberConstant) {
                    step.type = EX_STEP_NUMBER
                    step.n = numberConstant.val;
                } else {
                    step.type = EX_STEP_LOAD
                    step.str = expr.name;
                }
            } break;
            case T_IDENTIFIER_THE_RESULT_FROM_ABOVE: {
                step.type = EX_STEP_LOAD_LAST_BLOCK_RESULT;
            } break;
            case T_ASSIGNMENT: {
                if (!expr.rhs) {
                    incompleteExpressionError(expr);
                    return !noOp;
                }

                if (expr.lhs.t !== T_IDENTIFIER && expr.lhs.t !== T_DATA_INDEX_OP) {
                    addError(expr, "This expression currently cannot be assigned to");
                    return !noOp;
                }

                if (expr.lhs.t === T_DATA_INDEX_OP) {
                    noOp = true;

                    dfs(expr.lhs.lhs);

                    // Should have been checked at parse-time
                    assert(expr.lhs.indexes.length > 0);

                    // index into the matrix, except for the very last index. we'll need to actually assign to that one.
                    for (let i = 0 ; i < expr.lhs.indexes.length; i++) { 
                        const idxExpr = expr.lhs.indexes[i];
                        dfs(idxExpr);

                        if (i === expr.lhs.indexes.length - 1) {
                            dfs(expr.rhs);
                            const s = newExecutionStep(expr);
                            s.type = EX_STEP_INDEX_ASSIGNMENT;
                            steps.push(s);
                        } else {
                            const s = newExecutionStep(expr);
                            s.type = EX_STEP_INDEX;
                            steps.push(s);
                        }
                    }
                } else if (expr.lhs.t === T_IDENTIFIER) {
                    dfs(expr.rhs);
                    step.type = EX_STEP_SET;
                    step.str = expr.lhs.name;
                }
            } break;
            case T_BINARY_OP: {
                if (!expr.rhs) {
                    incompleteExpressionError(expr);
                    return !noOp;
                }

                dfs(expr.lhs);
                dfs(expr.rhs);
                step.type = EX_STEP_BINARY_OPERATOR;
                step.n = expr.op;
            } break;
            case T_UNARY_OP: {
                dfs(expr.expr);
                step.type = EX_STEP_UNARY_OPERATOR;
                step.n = expr.op;
            } break;
            case T_VECTOR_LITERAL:
            case T_LIST_LITERAL: {
                for (const item of expr.items) {
                    dfs(item);
                }
                if (expr.t === T_VECTOR_LITERAL) {
                    step.type = EX_STEP_VECTOR;
                    step.n = expr.items.length;
                } else {
                    step.type = EX_STEP_LIST;
                    step.n = expr.items.length;
                }
            } break;
            case T_NUMBER_LITERAL: {
                step.type = EX_STEP_NUMBER;
                step.n = expr.val;
            } break;
            case T_STRING_LITERAL: {
                step.type = EX_STEP_STRING;
                step.str = expr.val;
            } break;
            case T_TERNARY_IF: {
                if (!expr.falseBranch) {
                    incompleteExpressionError(expr);
                    return !noOp;
                }

                alreadyPushed = true;
                noOp = true;

                dfs(expr.query);

                const stepJumpIfFalse = newExecutionStep(expr);
                steps.push(stepJumpIfFalse);

                dfs(expr.trueBranch);

                const jumpToEnd = newExecutionStep(expr);
                steps.push(jumpToEnd);

                const falseStartIdx = steps.length;
                stepJumpIfFalse.type = EX_STEP_JUMP_IF_FALSE;
                stepJumpIfFalse.n = falseStartIdx;

                dfs(expr.falseBranch);

                const endIdx = steps.length;
                jumpToEnd.type = EX_STEP_JUMP;
                jumpToEnd.n = endIdx;
            } break;
            case T_BLOCK: {
                if (expr.statements.length === 0) {
                    addError(expr, "All blocks must contain at least 1 statement");
                    return false;
                }

                noOp = true;
                for (const s of expr.statements) {
                    if (dfs(s)) {
                        const s = newExecutionStep(expr);
                        s.type = EX_STEP_BLOCK_STATEMENT_END;
                        steps.push(s);
                    }
                }
            } break;
            case T_RANGE_FOR: {
                alreadyPushed = true;
                noOp = true;

                // NOTE: we actually can't generate the correct instructions (in a simple manner)
                // if we don't know whether the range expression is looping upwards or downards, so 
                // I'll have to introduce two new operators that range upwards and downards...

                const rangeExpr = expr.rangeExpr;
                if (
                    rangeExpr.t !== T_FN
                    || (rangeExpr.fnName.name !== "range" && rangeExpr.fnName.name !== "rrange")
                ) {
                    addError(expr, "Currently, only range or rrange (reverse range) can be used as arguments to a ranged for-loop");
                    return false;
                }

                if (rangeExpr.arguments.length !== 2 && rangeExpr.arguments.length !== 3) {
                    addError(expr, "range or rrange expect 2 (start, end) or 3 (start, end, step) arguments");
                    return false;
                }

                const ascending = rangeExpr.fnName.name === "range";
                const loExpr = rangeExpr.arguments[0];
                const hiExpr = rangeExpr.arguments[1];

                const stepExpr: ProgramExpression | undefined = rangeExpr.arguments[2];

                dfs(loExpr);
                {
                    const s = newExecutionStep(expr);
                    s.type = EX_STEP_SET;
                    s.str = expr.loopVar.name;
                    steps.push(s);
                }

                const loopStartIdx = steps.length;

                {
                    const s = newExecutionStep(expr);
                    s.type = EX_STEP_LOAD;
                    s.str = expr.loopVar.name;
                    steps.push(s);
                }

                dfs(hiExpr);
                if (ascending) {
                    {
                        const s = newExecutionStep(expr);
                        s.type = EX_STEP_BINARY_OPERATOR;
                        s.n = BIN_OP_LESS_THAN;
                        steps.push(s);
                    }
                } else {
                    {
                        const s = newExecutionStep(expr);
                        s.type = EX_STEP_BINARY_OPERATOR;
                        s.n = BIN_OP_GREATER_THAN;
                        steps.push(s);
                    }
                }

                const jumpToLoopEndIfFalse = newExecutionStep(expr);
                steps.push(jumpToLoopEndIfFalse);

                {
                    const s = newExecutionStep(expr);
                    s.type = EX_STEP_CLEAR_LAST_BLOCK_RESULT;
                    steps.push(s);
                }

                dfs(expr.body);


                if (stepExpr) {
                    dfs(stepExpr);
                } else {
                    if (ascending) {
                        {
                            const s = newExecutionStep(expr);
                            s.type = EX_STEP_NUMBER;
                            s.n = 1;
                            steps.push(s);
                        }
                    } else {
                        {
                            const s = newExecutionStep(expr);
                            s.type = EX_STEP_NUMBER;
                            s.n = -1;
                            steps.push(s);
                        }
                    }
                }

                {
                    const s = newExecutionStep(expr);
                    s.type = EX_STEP_INCR;
                    s.str = expr.loopVar.name;
                    steps.push(s);
                }

                {
                    const s = newExecutionStep(expr);
                    s.type = EX_STEP_BLOCK_STATEMENT_END;
                    steps.push(s);
                }

                {
                    const s = newExecutionStep(expr);
                    s.type = EX_STEP_JUMP;
                    s.n = loopStartIdx;
                    steps.push(s);
                }

                const loopEndIdx = steps.length;
                jumpToLoopEndIfFalse.type = EX_STEP_JUMP_IF_FALSE;
                jumpToLoopEndIfFalse.n = loopEndIdx;
            } break;
            case T_FN: {
                if (expr.body) {
                    // TODO: push builtins here
                    
                    const fn = result.functions.get(expr.fnName.name);

                    // We've already pre-extracted and linearlized every function declaration,
                    // so it's got to exist.
                    assert(!!fn);

                    step.type = EX_STEP_FN;
                    step._fn = fn;
                } else {
                    for (const arg of expr.arguments) {
                        dfs(arg);
                    }

                    const fn = result.functions.get(expr.fnName.name);
                    let isValid = false;
                    if (fn) {
                        // The errors are worse if we report 'too few arguments'. I'd rather see which type I was supposed to input, even though I
                        // haven't input all the args.
                        // We might want to bring it back if we add static types.
                        // We must at least assert we don't have too many though.
                        if (expr.arguments.length > fn.expr.arguments.length) {
                            addError(expr, "Too many arguments for your function.");
                            return false;
                        }

                        step.type = EX_STEP_FN_CALL;
                        step._fn = fn;
                        step.n = expr.arguments.length;

                        isValid = true;
                    } else {
                        const fn = getBuiltinFunction(expr.fnName.name);
                        if (fn) {
                            // The errors are worse if we report 'too few arguments'. I'd rather see which type I was supposed to input, even though I
                            // haven't input all the args.
                            // We might want to bring it back if we add static types.
                            // We must at least assert we don't have too many though.
                            if (
                                // expr.arguments.length < fn.minArgs || 
                                expr.arguments.length > fn.args.length
                            ) {
                                if (fn.minArgs !== fn.args.length) {
                                    addError(expr, "Expected between " + fn.minArgs + " to " + fn.args.length + " arguments, got " + expr.arguments.length);
                                } else {
                                    addError(expr, "Expected " + fn.args.length + " arguments, got " + expr.arguments.length);
                                }
                                return false;
                            }

                            step.type = EX_STEP_FN_BUILTIN_CALL;
                            step.fnBuiltin = fn;
                            step.n = expr.arguments.length;
                            isValid = true;
                        }
                    }

                    if (!isValid) {
                        addError(expr, "Couldn't resolve this function");
                        return !noOp;
                    }
                }
            } break;
            case T_DATA_INDEX_OP: {
                dfs(expr.lhs);

                noOp = true;
                for (const indexExpr of expr.indexes) {
                    dfs(indexExpr);
                    const s = newExecutionStep(indexExpr);
                    s.type = EX_STEP_INDEX;;
                    steps.push(s);
                }
            } break;
            case T_MAP_LITERAL:{
                for (const [k, v] of expr.kvPairs) {
                    dfs(k);
                    dfs(v);
                }
                step.type = EX_STEP_MAP;
                step.n = expr.kvPairs.length;
            } break;
            default: {
                throw new Error("Unhandled type: " + expressionTypeToString(expr));
            }
        }

        if (!alreadyPushed && !noOp) {
            steps.push(step);
        }

        return !noOp;
    }

    for (const s of statements) {
        if (dfs(s)) {
            const step = newExecutionStep(s);
            step.type = EX_STEP_BLOCK_STATEMENT_END_TOP_LEVEL;
            steps.push(step);
        }
    }

    return true;
}

function getLengthHpMatrix(val: Matrix): number {
    return val.shape[0];
}

function gtLength(result: ProgramResult): number | undefined {
    switch (result.t) {
        case T_RESULT_LIST: return result.values.length;
        case T_RESULT_STRING: return result.val.length;
        case T_RESULT_RANGE: return Math.abs(result.val.lo - result.val.hi);
        case T_RESULT_MATRIX: return getLengthHpMatrix(result.val);
    }
}

function get(result: ProgramInterpretResult, offset = 0): ProgramResult | null {
    return result.stack[result.stackIdx + offset] ?? null;
}

function pop(result: ProgramInterpretResult): ProgramResult {
    // At this stage, we shouldn't even generate the instruction if we thought it was going to fail.
    const val = get(result);
    assert(!!val);
    result.stackIdx--;
    return val;
}


export function addError(result: ProgramInterpretResult, step: ProgramExecutionStep, problem: string, betterPos: TextPosition | null = null) {
    result.errors.push({ pos: betterPos ?? step.expr.start, problem });
}

function getVarExecutionState(result: ProgramInterpretResult, name: string): ExecutionState | null {
    const current = result.callStack[result.callStack.length - 1];
    if (current.variables.has(name)) {
        return current;
    }

    const global = result.callStack[0];
    if (global.variables.has(name)) {
        return global;
    }

    return null;
}

function push(result: ProgramInterpretResult, val: ProgramResult, step: ProgramExecutionStep) {
    result.stackIdx++;
    if (result.stackIdx >= result.stack.length) {
        addError(result, step, "Stack overflow!!!");
        return false;
    }

    // TODO: rewrite in a language with struct value types
    result.stack[result.stackIdx] = { ...val };
}


export function newEmptyProgramOutputs(): ProgramOutputs {
    return {
        prints: [],
        printsGroupedByStep: new Map(),
        images: [],
        graphs: new Map(),
        plots: new Map(),
        plotsInOrder: [],
        uiInputsCache: new Map(),
        uiInputs: [],
        uiInputsPerLine: new Map(),
        heatmapSubdivisions: 20,
    };
}

export function startInterpreting(
    parseResult: ProgramParseResult, 
    isDebugging: boolean,
    previousProgramResult: ProgramInterpretResult | undefined
): ProgramInterpretResult {
    const outputs = newEmptyProgramOutputs();
    if (previousProgramResult) {
        for (const input of previousProgramResult.outputs.uiInputsCache.values()) {
            outputs.uiInputsCache.set(input.name, { ...input, fromThisRun: false });
        }
    }

    const rng = newRandomNumberGenerator();
    setRngSeed(rng, 0);

    const result: ProgramInterpretResult = {
        rng,
        parseResult,
        isDebugging,
        ended: false,
        entryPoint: {
            name: "Entry point",
            steps: [],
        },
        errors: [],
        functions: new Map(),

        stack: Array(1024).fill(null),
        stackIdx: 0,
        callStack: [],

        outputs,
        flushedOutputs: new Map(),
    };

    if (parseResult.errors.length > 0) {
        result.errors.push(...parseResult.errors);
    }

    // linearlize the tree, so we can actually step through things one at a time
    {
        // we need to lineralize functions ahead of time, so that recursion will work.
        for (const [name, fn] of parseResult.functions) {
            // Otherwise, there was no reason for the parse-result to give us this
            assert(!!fn.body);
            assert(!!fn.argumentNames);

            const code: ExecutionSteps = {
                name: fn.fnName.name,
                steps: [],
            };
            if (!getExecutionSteps(result, fn.body.statements, code.steps, false)) {
            return result;
            }

            result.functions.set(name, {
                t: T_RESULT_FN,
                code,
                args: fn.argumentNames,
                expr: fn,
            });
        }

        if (!getExecutionSteps(result, parseResult.statements, result.entryPoint.steps, true)) {
            return result;
        }
    }

    result.callStack.push({
        fn: null,
        code: result.entryPoint,
        argsCount: 0,
        i: 0, variables: new Map(),
        returnAddress: 0,
        nextVarAddress: 1,
    });

    return result;
};

export function getCurrentCallstack(result: ProgramInterpretResult): ExecutionState | undefined {
    return result.callStack[result.callStack.length - 1];
}

export const ZERO_VEC2 = matrixZeroes([2]);
export const ZERO_VEC3 = matrixZeroes([3]);
export const ZERO_VEC4 = matrixZeroes([4]);

const builtinFunctions = getBuiltinFunctionsMap();

export function getOrAddNewPlot(result: ProgramInterpretResult, idx: number): ProgramPlotOutput {
    let plot = result.outputs.plots.get(idx);
    if (!plot) {
        plot = {
            lines: [],
            functions: [],
            idx,
        };
        result.outputs.plots.set(idx, plot);
    }
    return plot;
}


export function printResult(
    result: ProgramInterpretResult,
    step: ProgramExecutionStep,
    expr: ProgramExpression,
    val: ProgramResult
) {
    result.outputs.prints.push({
        step,
        expr,
        val: { ...val },
        visible: true,
    });
}

function getBuiltinFunction(name: string): BuiltinFunction | undefined {
    return builtinFunctions.get(name);
}

function evaluateBuiltinFunctionCall(
    program: ProgramInterpretResult,
    step: ProgramExecutionStep,
): ProgramResult | undefined {
    assert(!!step.fnBuiltin);
    const fn = step.fnBuiltin;
    const numArgsInputted = step.n;
    const expr = step.expr;

    assert(!!fn);
    assert(expr.t === T_FN);

    let numArgsToPull = numArgsInputted;
    if (numArgsToPull < fn.minArgs) {
        numArgsToPull = fn.minArgs;
    }

    const getArg = (program: ProgramInterpretResult, step: ProgramExecutionStep, i: number): ProgramResult | null =>  {
        assert(!!step.fnBuiltin);
        const argExpr: ProgramExpression | undefined = expr.arguments[i];

        if (program.errors.length > 0) {
            return null;
        }

        let res;
        if (i >= numArgsInputted) {
            res = null;
        } else {
            res = get(program, -numArgsInputted + 1 + i);
        }
        const typeInfo = fn.args[i];

        if (
            (!res && !typeInfo.optional) ||
            (res && (typeInfo.type.length > 0 && !typeInfo.type.includes(res.t)))
        ) {
            let expectedType;
            if (typeInfo.type.length === 0) {
                expectedType = "anything";
            } else if (typeInfo.type.length === 1) {
                expectedType = programResultTypeStringFromType(typeInfo.type[0]);
            } else {
                expectedType = "one of " + typeInfo.type.map(programResultTypeStringFromType).join(" or ");
            }

            if (typeInfo.optional) {
                expectedType += " or nothing";
            }

            const gotType = (res ? programResultTypeStringFromType(res.t) : "nothing");

            addError(program, step, "Expected " + expectedType + " for " + typeInfo.name + ", got " + gotType, argExpr?.start);
            return null;
        }

        return res;
    }

    switch (numArgsToPull) {
        case 0: return fn.fn(program, step);
        case 1: {
            const arg1 = getArg(program, step, 0);
            if (program.errors.length === 0) {
                return fn.fn(program, step, arg1);
            }
        } break;
        case 2: {
            const arg1 = getArg(program, step, 0);
            const arg2 = getArg(program, step, 1);
            if (program.errors.length === 0) {
                return fn.fn(program, step, arg1, arg2);
            }
        } break;
        case 3: {
            const arg1 = getArg(program, step, 0);
            const arg2 = getArg(program, step, 1);
            const arg3 = getArg(program, step, 2);
            if (program.errors.length === 0) {
                return fn.fn(program, step, arg1, arg2, arg3);
            }
        } break;
        case 4: {
            const arg1 = getArg(program, step, 0);
            const arg2 = getArg(program, step, 1);
            const arg3 = getArg(program, step, 2);
            const arg4 = getArg(program, step, 3);
            if (program.errors.length === 0) {
                return fn.fn(program, step, arg1, arg2, arg3, arg4);
            }
        } break;
        case 5: {
            const arg1 = getArg(program, step, 0);
            const arg2 = getArg(program, step, 1);
            const arg3 = getArg(program, step, 2);
            const arg4 = getArg(program, step, 3);
            const arg5 = getArg(program, step, 4);
            if (program.errors.length === 0) {
                return fn.fn(program, step, arg1, arg2, arg3, arg4, arg5);
            }
        } break;
    }

    if (program.errors.length === 0) {
        addError(program, step, "Too many arguments...");
    }
}

function pushFunctionCallFrame(
    program: ProgramInterpretResult,
    fn: ProgramResultFunction,
    numArgs: number
) {
    assert(numArgs <= fn.args.length);
    const variables = new Map<string, number>();
    for (let i = 0; i < numArgs; i++) {
        const argIdx = program.stackIdx - numArgs + i + 1;
        variables.set(fn.args[i].name, argIdx);
    }

    program.stackIdx += 1;

    let returnAddress = program.stackIdx;
    let nextVarAddress = returnAddress + 1;

    program.callStack.push({
        fn,
        code: fn.code,
        argsCount: fn.args.length,
        i: 0, variables,
        returnAddress,
        nextVarAddress,
    });
}

export function startEvaluatingFunctionWithingProgramWithArgs(
    program: ProgramInterpretResult,
    step: ProgramExecutionStep,    // the step to report the error against
    fn: ProgramResultFunction,
    args: ProgramResult[],
): boolean {
    if (program.isDebugging) {
        // Don't attempt to 'interpret rest of program' if we're currently stepping through that program. lmao.
        return false;
    }


    for (const arg of args) {
        push(program, arg, step);
    }


    pushFunctionCallFrame(program, fn, args.length);

    return true;
}

export function evaluateFunctionWithinProgramWithArgs(
    program: ProgramInterpretResult,
    step: ProgramExecutionStep,    // the step to report the error against
    fn: ProgramResultFunction,
    args: ProgramResult[],
): ProgramResult | null {
    if (!startEvaluatingFunctionWithingProgramWithArgs(program, step, fn, args)) {
        return null
    }

    interpretRestOfProgram(program);

    blockStatementEnd(program, step);

    return program.stack[0];
}

function evaluateBinaryOperatorNumber(lhs: ProgramResult, rhs: ProgramResult, program: ProgramInterpretResult, step: ProgramExecutionStep): ProgramResult | null {
    const op = step.n as BinaryOperatorType;
    assert(op !== undefined);

    let result: ProgramResult | null = null;

    if (lhs.t === T_RESULT_NUMBER && rhs.t == T_RESULT_NUMBER) {
        result = evaluateBinaryOpNumberXNumber(lhs, rhs, op);
    } else if (lhs.t === T_RESULT_NUMBER && rhs.t === T_RESULT_MATRIX) {
        result = evaluateBinaryOpNumberXMatrix(lhs, rhs, true, op);
    } else if (rhs.t === T_RESULT_NUMBER && lhs.t === T_RESULT_MATRIX) {
        result = evaluateBinaryOpNumberXMatrix(rhs, lhs, false, op);
    } else if (lhs.t === T_RESULT_NUMBER && rhs.t === T_RESULT_LIST) {
        result = evaluateBinaryOpNumberXList(lhs, rhs, true, program, step);
    } else if (rhs.t === T_RESULT_NUMBER && lhs.t === T_RESULT_LIST) {
        result = evaluateBinaryOpNumberXList(rhs, lhs, false, program, step);
    } else if (lhs.t === T_RESULT_MATRIX) {
        if (rhs.t === T_RESULT_MATRIX) {
            const [res, err] = evaluateBinaryOpMatrixXMatrix(lhs, rhs, op);
            if (err) {
                addError(program, step, err);
            } else {
                result = res;
            }
        }
    }

    return result;
}

function blockStatementEnd(program: ProgramInterpretResult, step: ProgramExecutionStep) {
    const call = getCurrentCallstack(program);
    if (!call) {
        return;
    }

    const val = get(program)
    if (!val) {
        addError(program, step, "This block-level statement didn't return a result");
        return false;
    }

    program.stack[call.returnAddress] = val;
    program.stackIdx = call.nextVarAddress - 1;
}

function validateMapKey(
    program: ProgramInterpretResult,
    step: ProgramExecutionStep,
    idxResult: ProgramResult,
): number | string | null {
    if (idxResult.t !== T_RESULT_NUMBER && idxResult.t !== T_RESULT_STRING) {
        addError(program, step, "Map keys must be numbers or strings for now");
        return null;
    }

    return idxResult.val;
}

function validateIndex(
    program: ProgramInterpretResult,
    step: ProgramExecutionStep,
    idxResult: ProgramResult,
): number | null {
    if (idxResult.t !== T_RESULT_NUMBER) {
        addError(program, step, "Indexers must be numbers");
        return null;
    }

    const idx = idxResult.val;
    if ((idx % 1) !== 0) {
        addError(program, step, "Indexers can't have a decimal component");
        return null;
    }

    if (idx < 0) {
        addError(program, step, "Indexers can't be negative");
        return null;
    }

    return idx;
}

export function stepProgram(program: ProgramInterpretResult): boolean {
    if (program.ended) {
        return false;
    }

    const call = getCurrentCallstack(program);
    if (!call) {
        program.ended = true;
        return false;
    }

    const steps = call.code.steps;
    if (call.i >= steps.length) {
        call.i = steps.length;
        program.ended = true;
        return false;
    }

    const step = steps[call.i];

    let nextCallI = call.i + 1;


    switch(step.type) {
        case EX_STEP_LOAD: {
            const varName = step.str;

            const userFn = program.functions.get(varName);
            let resultToPush: ProgramResult | undefined;

            if (userFn) {
                resultToPush = userFn;
            } else {
                const s = getVarExecutionState(program, varName);
                if (s) {
                    const addr = s.variables.get(varName);
                    assert(addr !== undefined);
                    const val = program.stack[addr];
                    assert(!!val);

                    resultToPush = val;
                } else {
                    const fn = getBuiltinFunction(varName);
                    if (fn) {
                        // TODO: implement this
                        addError(program, step, "We don't have a way to load a builtin function as a variable yet");
                        return false;
                    }

                    addError(program, step, "This variable hasn't been set yet");
                    return false;
                }
            }

            push(program, resultToPush, step);
        } break;
        case EX_STEP_LOAD_LAST_BLOCK_RESULT: {
            const val = program.stack[call.returnAddress];
            if (!val) {
                addError(program, step, "This block doesn't have any results in it yet");
                return false;
            }
            push(program, val, step);
        } break;
        case EX_STEP_BLOCK_STATEMENT_END: {
            // need this to clean up after the last 'statement'.
            blockStatementEnd(program, step);
        } break;
        case EX_STEP_BLOCK_STATEMENT_END_TOP_LEVEL: {
            // need this to clean up after the last 'statement'.
            blockStatementEnd(program, step);
        } break;
        case EX_STEP_CLEAR_LAST_BLOCK_RESULT: {
            program.stack[call.returnAddress] = null;
        } break; 
        case EX_STEP_SET: {
            const varName = step.str;

            // NOTE: setting a variable doesn't remove it from the stack, because assignment will return the value that was assigned.
            const val = get(program);
            if (!val) {
                addError(program, step, "Last wn pstep didn't generate any results")
                return false;
            }

            const s = getVarExecutionState(program, varName);
            if (!s) {
                if (program.stackIdx !== call.nextVarAddress) {
                    addError(program, step, "Nothing was computed to assign");
                    return false;
                }
                call.variables.set(varName, program.stackIdx);
                call.nextVarAddress++;
            } else {
                const addr = s.variables.get(varName)!;
                program.stack[addr] = val;
            }
        } break;
        case EX_STEP_BINARY_OPERATOR: {
            const lhs = pop(program);
            const rhs = pop(program);
            const op = step.n as BinaryOperatorType;

            let calcResult: ProgramResult | null = null;

            calcResult = evaluateBinaryOperatorNumber(lhs, rhs, program, step);

            if (!calcResult) {
                if (program.errors.length === 0) {
                    addError(program, step, `We don't have a way to compute ${programResultTypeString(lhs)} ${binOpToOpString(op)} ${programResultTypeString(rhs)} yet.`);
                }
                return false;
            }

            push(program, calcResult, step);
        } break; 
        case EX_STEP_UNARY_OPERATOR: {
            const val = pop(program);
            const op = step.n as UnaryOperatorType;
            const [res, err] = evaluateUnaryOp(program, step, val, op);
            if (err) {
                addError(program, step, err);
                return false;
            }

            if (!res) {
                addError(program, step, `We don't have a way to compute ${unaryOpToOpString(op)}${programResultTypeString(val)} yet.`);
                return false;
            }

            push(program, res, step);
        } break; 
        case EX_STEP_LIST: {
            program.stackIdx -= step.n;

            const list: ProgramResult = { t: T_RESULT_LIST, values: [] };
            for (let i = 0; i < step.n; i++) {
                const val = program.stack[program.stackIdx + i + 1];
                assert(!!val);
                list.values.push(val);
            }

            push(program, list, step);
        } break;
        case EX_STEP_MAP: {
            program.stackIdx -= step.n * 2;

            const map: ProgramResult = { t: T_RESULT_MAP, map: new Map(), keys: [] };
            for (let i = 0; i < step.n; i++) {
                const mapKey = program.stack[program.stackIdx + 2 * i + 1];
                const mapVal = program.stack[program.stackIdx + 2 * i + 2];

                assert(!!mapKey);
                assert(!!mapVal);

                const key = validateMapKey(program, step, mapKey);
                if (key === null) {
                    return false;
                }

                if (!map.map.has(key)) {
                    map.map.set(key, mapVal);
                    map.keys.push(key);
                } else {
                    addError(program, step, `Duplicate key: ${key}`);
                    return false;
                }
            }

            push(program, map, step);
        } break; 
        case EX_STEP_VECTOR: {
            program.stackIdx -= step.n;

            let innerLen = 0;
            let innerT = 0;
            let innerShape: number[] | undefined;
            const values: number[] = [];

            const len = step.n;
            for (let i = 0; i < len; i++) {
                const val = program.stack[program.stackIdx + i + 1];
                assert(!!val);

                if (val.t !== T_RESULT_NUMBER && val.t !== T_RESULT_MATRIX) {
                    addError(program, step, "Vectors/Matrices can only contain other vectors/matrices/numbers. You can create a List instead, by prepending 'list', like list[1,2,\"3\"]");
                    return false;
                }

                let rowLen;
                if (val.t === T_RESULT_MATRIX) {
                    rowLen = getLengthHpMatrix(val.val);

                    // TODO: reserve the correct size based on matrix shape. flatmap...
                    for (let i = 0; i < val.val.values.length; i++) {
                        values.push(getSliceValue(val.val.values, i));
                    }
                } else {
                    values.push(val.val);
                    rowLen = 1;
                }

                if (i === 0) {
                    innerLen = rowLen;
                    innerT = val.t;
                    if (val.t === T_RESULT_MATRIX) {
                        innerShape = val.val.shape;
                    }
                } else {
                    if (innerT !== val.t) {
                        addError(program, step, "The items inside this vector/matrix have inconsistent types");
                        return false;
                    }

                    if (innerLen !== rowLen) {
                        addError(program, step, "The items inside this vector/matrix have inconsistent lengths");
                        return false;
                    }
                }
            }

            const newShape = innerShape ? [len, ...innerShape] : [len];

            push(program, {
                t: T_RESULT_MATRIX,
                val: { values: newSlice(values), shape: newShape }
            }, step);
        } break; 
        case EX_STEP_NUMBER: {
            push(program, newNumberResult(step.n), step);
        } break;
        case EX_STEP_STRING: {
            push(program, { t: T_RESULT_STRING, val: step.str }, step);
        } break;
        case EX_STEP_JUMP: {
            assert(step.n >= 0);
            assert(step.n <= steps.length);
            nextCallI = step.n;
        } break; 
        case EX_STEP_JUMP_IF_FALSE: {
            assert(step.n >= 0);
            assert(step.n <= steps.length);

            const val = pop(program,);
            if (val.t !== T_RESULT_NUMBER) {
                // -0 is fine to be `true` imo.
                // (Won't be a problem if we implement this in a real language with integer types);
                addError(program, step, "True/false queries must be numbers. You can get a 0/1 number by using logical ops like ==, <=, etc, but that is not the only way to do so.");
                return false;
            }

            if (val.val === 0) {
                nextCallI = step.n;
                call.i = step.n;
            }
        } break;
        case EX_STEP_INCR: {
            const stepVal = pop(program);
            if (stepVal.t !== T_RESULT_NUMBER) {
                addError(program, step, "Can't increment by non-numerical values");
                return false;
            }

            const addr = call.variables.get(step.str);
            assert(addr !== undefined);
            const val = program.stack[addr];
            assert(!!val);
            assert(val.t === T_RESULT_NUMBER);
            val.val += stepVal.val;
        } break; 
        case EX_STEP_INDEX: {
            const idxResult = pop(program);
            const data = pop(program);

            let isValid = false;

            if (data.t === T_RESULT_LIST || data.t === T_RESULT_MATRIX) {
                const idx = validateIndex(program, step, idxResult);
                if (idx === null) {
                    return false;
                }

                if (data.t === T_RESULT_LIST) {
                    if (idx >= data.values.length) {
                        addError(program, step, "Index was out of bounds");
                        return false;
                    }

                    push(program, data.values[idx], step);
                    isValid = true;
                } else if (data.t === T_RESULT_MATRIX) {
                    if (data.val.shape.length === 1) {
                        if (!isIndexInSliceBounds(data.val.values, idx)) {
                            addError(program, step, "Index was out of bounds");
                            return false;
                        }

                        const value = getSliceValue(data.val.values, idx);
                        push(program, newNumberResult(value), step);
                        isValid = true;
                    } else {
                        const subMatrix = getMatrixRow(data.val, idx);
                        if (!subMatrix) {
                            addError(program, step, "Index was out of bounds");
                            return false;
                        }

                        push(program, { t: T_RESULT_MATRIX, val: subMatrix }, step);
                        isValid = true;
                    }
                }
            } else if (data.t === T_RESULT_MAP) {
                const key = validateMapKey(program, step, idxResult);
                if (key === null) {
                    return false;
                }

                const val = data.map.get(key);
                if (val === undefined) {
                    addError(program, step, `Key ${val} wasn't present in the map`);
                    return false;
                }

                push(program, val, step);
                isValid = true;
            }

            if (!isValid) {
                addError(program, step, "Can't index this datatype");
                return false;
            }
        } break;
        case EX_STEP_FN: {
            assert(!!step._fn);
            push(program, step._fn, step);
        } break;
        case EX_STEP_FN_CALL: {
            assert(!!step._fn);
            const numArgs = step.n;
            pushFunctionCallFrame(program, step._fn, numArgs);
            call.i++;
        } return true;
        case EX_STEP_FN_BUILTIN:
        case EX_STEP_FN_BUILTIN_CALL: {
            const res = evaluateBuiltinFunctionCall(program, step);
            if (program.errors.length > 0) {
                return false;
            }
            // Should always push an error if we're returning undefined
            assert(!!res);

            program.stackIdx -= step.n;
            push(program, res, step);
        } break;
        case EX_STEP_INDEX_ASSIGNMENT: {
            const rhsResult = pop(program);
            const idxResult = pop(program);
            const lhsToAssign = pop(program);

            let isValid = false;

            if (lhsToAssign.t === T_RESULT_LIST || lhsToAssign.t === T_RESULT_MATRIX) {
                const idx = validateIndex(program, step, idxResult);
                if (idx === null) {
                    return false;
                }

                if (lhsToAssign.t === T_RESULT_LIST) {
                    if (idx < 0 || idx >= lhsToAssign.values.length) {
                        addError(program, step, "Index was out of bounds: " + "list(" + lhsToAssign.values.length + ")[" + idx + "]")
                        return false;
                    }
                    lhsToAssign.values[idx] = rhsResult;
                    isValid = true;
                } else if (lhsToAssign.t === T_RESULT_MATRIX) {
                    if (lhsToAssign.val.shape.length === 1) {
                        if (rhsResult.t !== T_RESULT_NUMBER) {
                            addError(program, step, "Can only assign numbers into " + programResultTypeString(lhsToAssign));
                            return false;
                        }
                        setSliceValue(lhsToAssign.val.values, idx, rhsResult.val);
                        isValid = true;
                    } else {
                        if (rhsResult.t !== T_RESULT_MATRIX) {
                            addError(program, step, "Can only assign vectors into " + programResultTypeString(lhsToAssign));
                            return false;
                        }

                        if (!subMatrixShapeEqualsRowShape(lhsToAssign.val, rhsResult.val)) {
                            addError(program, step,
                                "Can only assign " +
                                getMatrixTypeFromShape(lhsToAssign.val.shape.slice(1)) +
                                " into " + programResultTypeString(lhsToAssign)
                            );
                            return false;
                        }

                        const rowLen = getMatrixRowLength(lhsToAssign.val);
                        for (let i = 0; i < rowLen; i++) {
                            const val = getSliceValue(rhsResult.val.values, i);
                            setSliceValue(lhsToAssign.val.values, i, val);
                        }
                        isValid = true;
                    }
                }
            } else if (lhsToAssign.t === T_RESULT_MAP) {
                const key = validateMapKey(program, step, idxResult);
                if (key === null) {
                    return false;
                }

                lhsToAssign.map.set(key, rhsResult);
                isValid = true;
            }

            if (!isValid) {
                addError(program, step, "Can't assign to a value of type " + programResultTypeString(lhsToAssign))
                return false;
            }

            push(program, rhsResult, step);
        } break;
        case EX_STEP_INVALID: {
            addError(program, step, "Can't run this dud instruction! theres a bug in the instruction generator");
            return false;
        }
        default:
            assertUnreachable(step.type);
    }

    call.i = nextCallI;
    if (call.code.steps.length === call.i && program.callStack.length > 1) {
        // this was the thing we last computed
        const returnAddress = call.returnAddress;
        const val = program.stack[returnAddress];

        program.callStack.pop();
        const current = getCurrentCallstack(program);

        // this is the current call frame's return address
        program.stackIdx = current ? (returnAddress - 1) : 0;
        program.stack[program.stackIdx] = val;
    }

    if (program.callStack.length === 0) {
        program.ended = true;
        return false;
    }

    return true;
}

export function newNumberResult(val: number): ProgramResultNumber {
    return { t: T_RESULT_NUMBER, val };
}

function interpretRestOfProgram(result: ProgramInterpretResult) {
    // I've kept it low, because matrix ops and array programming can result in singular iterations
    // actually doing quite a lot of computations.
    let safetyCounter = 0;
    const MAX_ITERATIONS = 5 * 1000 * 1000;
    while (result.callStack.length > 0) {
        safetyCounter++;
        if (safetyCounter >= MAX_ITERATIONS) {
            // prevent infinite loops
            break;
        }
        let res = stepProgram(result);
        if (!res) {
            break;
        }
    }

    if (safetyCounter === MAX_ITERATIONS) {
        const call = getCurrentCallstack(result);
        assert(!!call);
        const step = call.code.steps[call.i];

        // Could do the funniest thing here - "Log in and purchase a premium account to unlock more iterations"

        // TODO: allow user to override or disable this.
        addError(result, step, "The program terminated here, because it reached the maximum number of iterations (" + MAX_ITERATIONS + ")");
    }
}

export function interpret(
    parseResult: ProgramParseResult, 
    previousProgramResult: ProgramInterpretResult | undefined
): ProgramInterpretResult {
    const result = startInterpreting(parseResult, false, previousProgramResult);
    if (result.errors.length > 0) {
        return result;
    }

    interpretRestOfProgram(result);

    // Delete inputs from previous run that we retained, and 
    {
        for (const input of result.outputs.uiInputsCache.values()) {
            if (!input.fromThisRun) {
                result.outputs.uiInputsCache.delete(input.name);
            }
        }

    }

    // Coalesce multiple inputs that are on the same line
    {
        const uiInputsPerLine = result.outputs.uiInputsPerLine;
        for (const input of result.outputs.uiInputs.values()) {
            const line = input.expr.start.line;

            let existingInputs = uiInputsPerLine.get(line - 1);
            if (existingInputs) {
                uiInputsPerLine.delete(line - 1);
                uiInputsPerLine.set(line, existingInputs);
            } else {
                existingInputs = uiInputsPerLine.get(line);
                if (!existingInputs) {
                    existingInputs = [];
                    uiInputsPerLine.set(line, existingInputs);
                }
            }

            existingInputs.push(input);
        }
    }


    // Convert multiple debug logs from the same number into graphs, or other outputs if possible.
    {
        const printsGroupedByStep = result.outputs.printsGroupedByStep;
        printsGroupedByStep.clear();
        groupBy(printsGroupedByStep, result.outputs.prints, p => p.step);

        // Some of these can become other kinds of outputs, like plots.
        for (const [step, outputs] of printsGroupedByStep) {
            if (outputs.length <= 1) continue;

            let pointsX: number[] | undefined;
            let pointsY: number[] | undefined;

            let allNumbers = true;
            let allPoints = false;

            for (let i = 0; i < outputs.length; i++) {
                if (outputs[i].val.t !== T_RESULT_NUMBER) {
                    allNumbers = false;
                    break;
                }
            }

            if (!allNumbers) {
                allPoints = true;
                for (let i = 0; i < outputs.length; i++) {
                    const o = outputs[i];
                    if (o.val.t === T_RESULT_MATRIX && matrixShapesAreEqual(o.val.val, ZERO_VEC2)) {
                        continue;
                    }

                    allPoints = false;
                    break;
                }
            }

            if (allNumbers) {
                pointsX = Array(outputs.length).fill(0);
                pointsY = Array(outputs.length).fill(0);
                for (let i = 0; i < outputs.length; i++) {
                    const o = outputs[i];
                    o.visible = false;

                    assert(o.val.t === T_RESULT_NUMBER);
                    pointsX[i] = i;
                    pointsY[i] = o.val.val;
                }
            }

            if (allPoints) {
                pointsX = Array(outputs.length).fill(0);
                pointsY = Array(outputs.length).fill(0);

                for (let i = 0; i < outputs.length; i++) {
                    const o = outputs[i];
                    o.visible = false;

                    assert(o.val.t === T_RESULT_MATRIX);
                    pointsX[i] = getSliceValue(o.val.val.values, 0);
                    pointsY[i] = getSliceValue(o.val.val.values, 1);
                }
            }

            if (pointsX && pointsY) {
                let i = 0;
                while (result.outputs.plots.has(i)) {
                    i++;
                }

                result.outputs.plots.set(i, {
                    idx: i,
                    lines: [{
                        expr: step.expr,
                        pointsX,
                        pointsY,
                        color: undefined,
                        label: undefined,
                        displayAsPoints: false,
                    }],
                    functions: []
                });
            }
        }
    }

    // order the plots
    {
        result.outputs.plotsInOrder.length = 0;
        for (const plot of result.outputs.plots.values()) {
            result.outputs.plotsInOrder.push(plot);
        }

        result.outputs.plotsInOrder.sort((a, b) => a.idx - b.idx);
    }

    return result;
}
