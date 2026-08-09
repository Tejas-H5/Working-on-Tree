import { assert, assertUnreachable } from "./assert";
import { isWhitespace } from "./text-utils";

////////////////////////
// Parser


export type TextPosition = {
    i: number;
    line: number;
    col: number;
    tabs: number;     // we need this to correctly get a screen position, since tabs might have a different size.
};

function newTextPosition(i: number, line: number, col: number, tabs: number): TextPosition {
    return { i, line, col, tabs: tabs };
}

export const T_IDENTIFIER = 1;
export const T_IDENTIFIER_THE_RESULT_FROM_ABOVE = 2;

export const T_BINARY_OP = 3;

export const T_NUMBER_LITERAL = 4;
export const T_LIST_LITERAL = 5;
export const T_VECTOR_LITERAL = 6;
export const T_STRING_LITERAL = 7;
export const T_TERNARY_IF = 8;
export const T_BLOCK = 9;
export const T_DATA_INDEX_OP = 10;
export const T_FN = 11;
export const T_RANGE_FOR = 12;
export const T_ASSIGNMENT = 13;
export const T_UNARY_OP = 14;
export const T_MAP_LITERAL = 15;

export function expressionTypeToString(expr: ProgramExpression): string {
    switch (expr.t) {
        case T_IDENTIFIER:
            return "Identifier";
        case T_IDENTIFIER_THE_RESULT_FROM_ABOVE:
            return "(result from above)";
        case T_BINARY_OP:
            return "Binary operator";
        case T_UNARY_OP:
            return "Unary operator";
        case T_NUMBER_LITERAL:
            return "Number literal";
        case T_LIST_LITERAL:
            return "List literal";
        case T_VECTOR_LITERAL:
            return "Matrix literal";
        case T_STRING_LITERAL:
            return "String literal";
        case T_TERNARY_IF:
            return "Ternary if";
        case T_BLOCK:
            return "Block";
        case T_FN:
            return expr.body ? "Function declaration" : "Function call";
        case T_DATA_INDEX_OP:
            return "Indexing op";
        case T_RANGE_FOR:
            return "Range-for loop";
        case T_ASSIGNMENT:
            return "Assignment";
        case T_MAP_LITERAL:
            return "Map literal";
    }
}

export const BIN_OP_MULTIPLY = 2;
export const BIN_OP_DIVIDE = 3;
export const BIN_OP_ADD = 4;
export const BIN_OP_SUBTRACT = 5;
export const BIN_OP_IS_EQUAL_TO = 6;
export const BIN_OP_LESS_THAN = 7;
export const BIN_OP_LESS_THAN_EQ = 8;
export const BIN_OP_GREATER_THAN = 9;
export const BIN_OP_GREATER_THAN_EQ = 10;
export const BIN_OP_AND_AND = 11;
export const BIN_OP_OR_OR = 12;
export const BIN_OP_MODULO = 13;
export const BIN_OP_INVALID = -1;

export type BinaryOperatorType = typeof BIN_OP_MULTIPLY
    | typeof BIN_OP_DIVIDE
    | typeof BIN_OP_ADD
    | typeof BIN_OP_SUBTRACT
    | typeof BIN_OP_IS_EQUAL_TO
    | typeof BIN_OP_LESS_THAN
    | typeof BIN_OP_LESS_THAN_EQ
    | typeof BIN_OP_GREATER_THAN
    | typeof BIN_OP_GREATER_THAN_EQ
    | typeof BIN_OP_AND_AND
    | typeof BIN_OP_OR_OR
    | typeof BIN_OP_MODULO
    | typeof BIN_OP_INVALID;

export const UNARY_OP_INVALID = -1;
export const UNARY_OP_NOT = 1;
export const UNARY_OP_PRINT = 2;

export type UnaryOperatorType = typeof UNARY_OP_NOT
    | typeof UNARY_OP_PRINT
    | typeof UNARY_OP_INVALID;

export function unaryOpToOpString(op: UnaryOperatorType): string {
    switch (op) {
        case UNARY_OP_NOT: return "!";
        case UNARY_OP_PRINT: return ">>>";
        case UNARY_OP_INVALID: return "???";
    }
}

export function unaryOpToString(op: UnaryOperatorType): string {
    switch (op) {
        case UNARY_OP_NOT: return "Not";
        case UNARY_OP_PRINT: return "Print";
        case UNARY_OP_INVALID: return "Invalid";
    }
}

export function binOpToOpString(op: BinaryOperatorType): string {
    switch (op) {
        case BIN_OP_MULTIPLY: return "*";
        case BIN_OP_DIVIDE: return "/";
        case BIN_OP_ADD: return "+";
        case BIN_OP_SUBTRACT: return "-";
        case BIN_OP_IS_EQUAL_TO: return "==";
        case BIN_OP_GREATER_THAN: return ">";
        case BIN_OP_GREATER_THAN_EQ: return ">=";
        case BIN_OP_LESS_THAN: return "<";
        case BIN_OP_LESS_THAN_EQ: return "<=";

        case BIN_OP_AND_AND: return "&&";
        case BIN_OP_OR_OR: return "||";
        case BIN_OP_MODULO: return "%";
        case BIN_OP_INVALID: return "???";
    }
}

export function isUnreachable(): never {
    throw new Error("This code is unreachable!");
}

// This precedence table is the gift that keeps giving. thank you j blow, very cool.
function getBinOpPrecedence(op: BinaryOperatorType): number {
    switch (op) {
        case BIN_OP_IS_EQUAL_TO:
        case BIN_OP_GREATER_THAN:
        case BIN_OP_GREATER_THAN_EQ:
        case BIN_OP_LESS_THAN:
        case BIN_OP_LESS_THAN_EQ:
            return 2;
        case BIN_OP_AND_AND:
            return 3;
        case BIN_OP_OR_OR:
            return 4;
        case BIN_OP_MULTIPLY:
        case BIN_OP_DIVIDE:
        case BIN_OP_MODULO:
            return 7;
        case BIN_OP_ADD:
        case BIN_OP_SUBTRACT:
            return 8;
        case BIN_OP_INVALID:
            return -1;
    }
}
const TERNARY_PRECEDENCE = 20;

const MIN_PRECEDENCE = 1;
const MAX_PRECEDENCE = 100;

export function binOpToString(op: BinaryOperatorType): string {
    switch (op) {
        case BIN_OP_MULTIPLY: return "Multiply";
        case BIN_OP_DIVIDE: return "Divide";
        case BIN_OP_ADD: return "Add";
        case BIN_OP_SUBTRACT: return "Subtract";
        case BIN_OP_IS_EQUAL_TO: return "Is equal to";
        case BIN_OP_LESS_THAN: return "Is less than";
        case BIN_OP_LESS_THAN_EQ: return "Is less than or equal to";
        case BIN_OP_GREATER_THAN: return "Is greater than";
        case BIN_OP_GREATER_THAN_EQ: return "Is greater than or equal to";
        case BIN_OP_AND_AND: return "And";
        case BIN_OP_OR_OR: return "Or";
        case BIN_OP_MODULO: return "Modulo";
        case BIN_OP_INVALID: return "???";
    }
}


export type ProgramExpressionBase = {
    start: TextPosition;
    end: TextPosition;

    // These are computed after everything has been parsed, so that each function 
    // doesn't have to correctly set the parent and child nodes every time.
    // C-style struct unions would have helped a lot here.
    parent: ProgramExpression | null;
    children: ProgramExpression[];
};

export function expressionToString(text: string, expr: ProgramExpression): string {
    return text.slice(expr.start.i, expr.end.i)
}

// An identifier is just something that refers to a thing in the program.
// It could be a variable name, or varName[i]. It is any lvalue.
export type ProgramExpressionIdentifier = ProgramExpressionBase & {
    t: typeof T_IDENTIFIER;
    name: string;
}

export type ProgramExpressionPreviousResult = ProgramExpressionBase & {
    t: typeof T_IDENTIFIER_THE_RESULT_FROM_ABOVE;
};

export type ProgramExpressionNumberLiteral = ProgramExpressionBase & {
    t: typeof T_NUMBER_LITERAL;
    integerPart: string;
    decimalPart: string | null;
    exponentPart: string | null;
    isNegative: boolean;
    val: number;
}

export type ProgramExpressionListLiteral = ProgramExpressionBase & {
    t: typeof T_LIST_LITERAL | typeof T_VECTOR_LITERAL;
    items: ProgramExpression[];
}

export type ProgramExpressionMapLiteral = ProgramExpressionBase & {
    t: typeof T_MAP_LITERAL;
    kvPairs: [ProgramExpression, ProgramExpression][];
}

export type ProgramExpressionStringLiteral = ProgramExpressionBase & {
    t: typeof T_STRING_LITERAL;
    val: string;
}

export type ProgramExpressionTernaryIf = ProgramExpressionBase & {
    t: typeof T_TERNARY_IF;
    query: ProgramExpression;
    trueBranch: ProgramExpression;
    falseBranch: ProgramExpression | undefined;
}

export type ProgramExpressionBinaryOperator = ProgramExpressionBase & {
    t: typeof T_BINARY_OP;
    op: BinaryOperatorType;
    lhs: ProgramExpression;
    rhs?: ProgramExpression;
}

export type ProgramExpressionUnaryOperator = ProgramExpressionBase & {
    t: typeof T_UNARY_OP;
    op: UnaryOperatorType;
    expr: ProgramExpression;
}

export type ProgramExpressionBlock = ProgramExpressionBase & {
    t: typeof T_BLOCK;
    statements: ProgramExpression[];
}

export type ProgramExpressionDataIndex = ProgramExpressionBase & {
    t: typeof T_DATA_INDEX_OP;
    lhs: ProgramExpression;
    indexes: ProgramExpression[];
}

export type ProgramExpressionFn = ProgramExpressionBase & {
    t: typeof T_FN;
    fnName: ProgramExpressionIdentifier;
    arguments: ProgramExpression[];
    // If these are present, it's a declaration. else, it's a call.
    body: ProgramExpressionBlock | null;
    argumentNames: ProgramExpressionIdentifier[] | null;
}

export type ProgramExpressionRangedFor = ProgramExpressionBase & {
    t: typeof T_RANGE_FOR;
    loopVar: ProgramExpressionIdentifier;
    rangeExpr: ProgramExpression;
    body: ProgramExpression;
};

export type ProgramExpressionAssignment = ProgramExpressionBase & {
    t: typeof T_ASSIGNMENT;
    lhs: ProgramExpression;
    rhs?: ProgramExpression;
};

export type ProgramExpression = ProgramExpressionIdentifier
    | ProgramExpressionPreviousResult
    | ProgramExpressionBinaryOperator
    | ProgramExpressionUnaryOperator
    | ProgramExpressionNumberLiteral
    | ProgramExpressionListLiteral
    | ProgramExpressionMapLiteral
    | ProgramExpressionStringLiteral
    | ProgramExpressionTernaryIf
    | ProgramExpressionBlock
    | ProgramExpressionDataIndex
    | ProgramExpressionFn
    | ProgramExpressionRangedFor
    | ProgramExpressionAssignment;

export type ProgramParseResult = {
    text: string;
    statements: ProgramExpression[];
    functions: Map<string, ProgramExpressionFn>;
    errors: DiagnosticInfo[];
    warnings: DiagnosticInfo[];
};

export type DiagnosticInfo = {
    pos: TextPosition;
    problem: string;
};

// Not sure why I called it parser context and not just 'Parser'. 
// Must be a residual in my mind of my last implementation.
type ParserContext = {
    isInForLoopRangeExpr: boolean;
    text: string;
    parseResult: ProgramParseResult;
    pos: TextPosition;
}

function isDigit(c: string) {
    const code = c.charCodeAt(0);
    // ASCII codes for '0' and '9'
    return code >= 48 && code <= 57;
}

function isLetter(c: string) {
    return c.toUpperCase() != c.toLowerCase() || (c.codePointAt(0) ?? 0) > 127 || c === "_";
}

function currentChar(ctx: ParserContext, offset = 0) {
    return ctx.text[ctx.pos.i + offset] ?? "";
}

function compareCurrent(ctx: ParserContext, str: string): boolean {
    for (let i = 0; i < str.length; i++) {
        const pos = ctx.pos.i + i;
        if (pos >= ctx.text.length) {
            return false;
        }

        if (ctx.text[pos] !== str[i]) {
            return false;
        }
    }

    return true;
}

function reachedEnd(ctx: ParserContext) {
    return ctx.pos.i >= ctx.text.length;
}

function advance(ctx: ParserContext) {
    const c = currentChar(ctx);
    if (c === "\n") {
        ctx.pos.line++;
        ctx.pos.col = 0;
        ctx.pos.tabs = 0;
    } else if (c === "\t") {
        ctx.pos.tabs++;
    } else {
        ctx.pos.col++;
    }

    ctx.pos.i++;

    return !reachedEnd(ctx);
}

function parseWhitespace(ctx: ParserContext) {
    while (!reachedEnd(ctx)) {
        const c = currentChar(ctx);
        if (isWhitespace(c)) {
            advance(ctx);
            continue;
        }

        // Comments can be considered whitespace.
        if (compareCurrent(ctx, "//")) {
            advanceToNextNewLine(ctx);
            advance(ctx);
            continue;
        }

        break;
    }
}

function isAllowedIdentifierSymbol(char: string) {
    return isLetter(char) || isDigit(char) || (
        char === "_"
    );
}

function canParseNumberLiteral(ctx: ParserContext) {
    const c = currentChar(ctx);
    return c === "+" || isDigit(c);
}

function isValidNumberPart(c: string) {
    return isDigit(c) || c === "_";
}

function parseTernaryIf(ctx: ParserContext, query: ProgramExpression): ProgramExpressionTernaryIf | undefined {
    assert(currentChar(ctx) === "?");

    advance(ctx);
    parseWhitespace(ctx);

    const start = query.start;

    const trueBranch = parseExpression(ctx);
    if (!trueBranch) {
        return undefined;
    }

    const res: ProgramExpressionTernaryIf = {
        parent: null,
        children: [],
        t: T_TERNARY_IF,
        start,
        end: getParserPosition(ctx),
        query,
        trueBranch,
        falseBranch: undefined,
    };

    parseWhitespace(ctx);
    if (currentChar(ctx) !== ":") {
        addErrorAtCurrentPosition(ctx, "Expected a colon : here to start the false path of the ternary");
    } else {
        advance(ctx);
    }

    parseWhitespace(ctx);

    const falseBranch = parseExpression(ctx);
    if (falseBranch) {
        res.falseBranch = falseBranch;
        res.end = getParserPosition(ctx);
    }

    return res;
}


// TODO: This is a very basic string literal that could be vastly improved. current problems include:
// - opening a " connects directly to the start of another string. JavaScript ` has this problem as well, lmao.
// - I want the indentation in a string to be relative to the current indentation of the code, not to the
//      start of the line. Something like the Java """ strings would be good here
// - need some form of interpolation, since that is always nice to have.
function parseStringLiteral(ctx: ParserContext): ProgramExpressionStringLiteral | undefined {
    assert(currentChar(ctx) === "\"");

    const startPos = getParserPosition(ctx);

    let closed = false;
    while (!reachedEnd(ctx)) {
        advance(ctx);

        const c = currentChar(ctx);
        if (c === "\\") {
            advance(ctx);
        } else if (c === "\"") {
            closed = true;
            advance(ctx);
            break;
        }
    }

    // There's a good chance we'll go off the edge of the document when 
    // we've opened up a string literal. It's best we just reset to the end of the
    // line we started on, so we can still parse the rest of the stuff correctly (hopefully);

    if (!closed) {
        ctx.pos = startPos;
        advanceToNextNewLine(ctx);
        return;
    }

    const result: ProgramExpressionStringLiteral = {
        parent: null,
        children: [],
        t: T_STRING_LITERAL,
        start: startPos,
        end: getParserPosition(ctx),
        val: "",
    };

    const [val, error] = computeStringForStringLiteral(
        expressionToString(ctx.text, result)
    );
    if (val === undefined) {
        addErrorAtCurrentPosition(ctx, error);
        return;
    }

    result.val = val;
    return result;
}

function computeStringForStringLiteral(fullText: string): [string | undefined, string] {
    const text = fullText.slice(1, fullText.length - 1);
    const sb = [];

    let isEscape = false;
    let errorMessage = "";
    for (const c of text) {
        if (!isEscape) {
            if (c === "\\") {
                isEscape = true;
                continue;
            }

            sb.push(c);
        } else {
            isEscape = false;
            switch (c) {
                case "n":
                    sb.push("\n");
                    break;
                case "r":
                    sb.push("\r");
                    break;
                case "b":
                    sb.push("\b");
                    break;
                case "t":
                    sb.push("\t");
                    break;
                case "\\":
                    sb.push("\\");
                    break;
                default:
                    errorMessage = "Invalid escape sequence \\" + c;
                    break;
            }
        }
    }

    if (errorMessage) {
        return [undefined, errorMessage]
    }

    const result = sb.join("");
    return [result, ""];
}


function parseBlock(ctx: ParserContext): ProgramExpressionBlock | undefined {
    const start = getParserPosition(ctx);

    assert(currentChar(ctx) === "{");
    advance(ctx);

    const statements: ProgramExpression[] = [];
    parseStatements(ctx, statements, "}");

    if (currentChar(ctx) !== "}") {
        addErrorAtCurrentPosition(ctx, "Expected a closing curly brace } here");
        return;
    }

    advance(ctx);

    return {
        parent: null,
        children: [],
        t: T_BLOCK,
        start,
        end: getParserPosition(ctx),
        statements
    };
}

function parseRangedFor(ctx: ParserContext): ProgramExpressionRangedFor | undefined {
    assert(compareCurrent(ctx, "for"));
    const start = getParserPosition(ctx);

    for (let i = 0; i < 3; i++) {
        advance(ctx);
    }

    parseWhitespace(ctx);

    if (!isLetter(currentChar(ctx))) {
        addErrorAtCurrentPosition(ctx, "Loops are only like `for i in range(0, 100) { ...` or `for i in rrange(0, 100) { ... `");
        return undefined;
    }
    const loopVar = parseIdentifier(ctx);

    parseWhitespace(ctx);

    if (!compareCurrent(ctx, "in")) {
        addErrorAtCurrentPosition(ctx, "Loops are only like `for i in range(0, 100) { ...` or `for i in rrange(0, 100) { ... `");
        return undefined;
    }
    for (let i = 0; i < 2; i++) {
        advance(ctx);
    }

    parseWhitespace(ctx);

    ctx.isInForLoopRangeExpr = true;

    const rangeExpr = parseExpression(ctx);
    if (!rangeExpr) {
        addErrorAtCurrentPosition(ctx, "Loops are only like `for i in range(0, 100) { ...` or `for i in rrange(0, 100) { ... `");
        return undefined;
    }

    ctx.isInForLoopRangeExpr = false;

    parseWhitespace(ctx);
    if (currentChar(ctx) !== "{") {
        addErrorAtCurrentPosition(ctx, "Loops are only like `for i in range(0, 100) { ...` or `for i in rrange(0, 100) { ... `");
        return undefined;
    }

    const loopExpr = parseBlock(ctx);
    if (!loopExpr) {
        return undefined;
    }

    const result: ProgramExpressionRangedFor = {
        parent: null,
        children: [],
        t: T_RANGE_FOR,
        start,
        end: getParserPosition(ctx),
        loopVar,
        rangeExpr,
        body: loopExpr,
    };

    return result;
}

function parseExpressionsDelimiterSeparated(
    ctx: ParserContext,
    expressions: ProgramExpression[],
    delimiter: string,
    closingDelimiterChar: string,
) {
    assert(delimiter.length === 1);
    assert(closingDelimiterChar.length === 1);

    let foundClosingDelimiter = false;

    while (!reachedEnd(ctx)) {
        parseWhitespace(ctx);

        const expr = parseExpression(ctx);
        if (expr) {
            expressions.push(expr);

            parseWhitespace(ctx);
        }

        let foundDelimiter = false;
        if (compareCurrent(ctx, delimiter)) {
            if (!expr) {
                addErrorAtCurrentPosition(ctx, `Found a delimiter ${delimiter} before an actual expression`);
                return undefined;
            }

            foundDelimiter = true;

            advance(ctx);

            parseWhitespace(ctx);
        }

        if (currentChar(ctx) === closingDelimiterChar) {
            foundClosingDelimiter = true;
            advance(ctx);
            break;
        }

        if (!expr) {
            addErrorAtCurrentPosition(ctx, `Expected a closing delmiter ${closingDelimiterChar} here.`);
            return undefined;
        }

        if (!foundDelimiter) {
            addErrorAtCurrentPosition(ctx, `Expected a delimiter ${delimiter} here.`);
            return undefined;
        }
    }
}

function parseMapLiteral(ctx: ParserContext, pos: TextPosition): ProgramExpressionMapLiteral | undefined {
    assert(currentChar(ctx) === "{");
    advance(ctx);

    const kvPairs: [ProgramExpression, ProgramExpression][] = [];

    let foundClosingBrace = false;

    while (!reachedEnd(ctx)) {
        parseWhitespace(ctx);

        const keyExpr = parseExpression(ctx);
        if (keyExpr) {
            parseWhitespace(ctx);

            if (currentChar(ctx) !== ":") {
                addErrorAtCurrentPosition(ctx, `Expected ':' key-value separator here`);
                return undefined;
            }

            advance(ctx);
            parseWhitespace(ctx);

            const valueExpr = parseExpression(ctx);
            if (!valueExpr) {
                if (ctx.parseResult.errors.length === 0) {
                    addErrorAtPosition(ctx, getParserPosition(ctx), "Expected value expression after this");
                }
                return undefined;
            }

            parseWhitespace(ctx);

            kvPairs.push([keyExpr, valueExpr]);
        }

        const foundDelimiter = currentChar(ctx) === ",";
        if (foundDelimiter) {
            advance(ctx);
            parseWhitespace(ctx);
        }

        if (currentChar(ctx) === "}") {
            advance(ctx);
            foundClosingBrace = true;
            break;
        }

        if (!foundDelimiter) {
            addErrorAtCurrentPosition(ctx, `Expected a delimiter , here`);
            return undefined;
        }
    }

    if (!foundClosingBrace) {
        addErrorAtPosition(ctx, pos, `Never found a closing brance for this`);
        return undefined;
    }

    return {
        parent: null,
        children: [],
        t: T_MAP_LITERAL,
        start: pos,
        end: getParserPosition(ctx),
        kvPairs,
    };
}

function parseListLiteral(
    ctx: ParserContext,
    type: (typeof T_VECTOR_LITERAL | typeof T_LIST_LITERAL),
    pos?: TextPosition
): ProgramExpressionListLiteral | undefined {
    assert(currentChar(ctx) === "[");
    if (!pos) {
        pos = getParserPosition(ctx);
    }

    advance(ctx);

    const items: ProgramExpression[] = [];

    parseExpressionsDelimiterSeparated(ctx, items, ",", "]");

    return {
        parent: null,
        children: [],
        t: type,
        start: pos,
        end: getParserPosition(ctx),
        items,
    };
}

function parseNumberLiteral(ctx: ParserContext): ProgramExpressionNumberLiteral {
    const start = getParserPosition(ctx);

    assert(canParseNumberLiteral(ctx));
    let isNegative = false;
    if (currentChar(ctx) === "+") {
        advance(ctx);
    } else if (currentChar(ctx) === "-") {
        isNegative = true;
        advance(ctx);
    }

    const intStart = ctx.pos.i;
    while (advance(ctx) && isValidNumberPart(currentChar(ctx))) { }

    const integerPart = ctx.text.slice(intStart, ctx.pos.i);

    const result: ProgramExpressionNumberLiteral = {
        parent: null,
        children: [],
        t: T_NUMBER_LITERAL,
        integerPart,
        start,
        end: getParserPosition(ctx),
        decimalPart: null,
        exponentPart: null,
        isNegative,
        val: 0,
    };

    if (
        currentChar(ctx) === "."
        // Here specifically because we need to make sure numbers don't collide with ..< and ..= operators
        && currentChar(ctx, 1) !== "."
        && advance(ctx)
    ) {
        const decimalPartStart = ctx.pos.i;
        while (isValidNumberPart(currentChar(ctx)) && advance(ctx)) { }
        result.decimalPart = ctx.text.slice(decimalPartStart, ctx.pos.i);
        result.end = getParserPosition(ctx);
    }

    if (currentChar(ctx) === "e" && advance(ctx)) {
        const exponentPartStart = ctx.pos.i;
        const c = currentChar(ctx);
        if (c === "+" || c === "-") {
            if (!advance(ctx)) {
                return result;
            }
        }

        while (isValidNumberPart(currentChar(ctx)) && advance(ctx)) { }
        result.decimalPart = ctx.text.slice(exponentPartStart, ctx.pos.i);
        result.end = getParserPosition(ctx);
    }

    result.val = computeNumberForNumberExpression(result);

    return result;
}

function computeNumberForNumberExpression(expr: ProgramExpressionNumberLiteral): number {
    let result = 0;

    if (expr.decimalPart) {
        const text = expr.decimalPart.replace(/_/g, "");
        const decimalVal = parseInt(text) / Math.pow(10, text.length)
        result += decimalVal;
    }

    if (expr.integerPart) {
        const text = expr.integerPart.replace(/_/g, "");
        const intVal = parseInt(text);
        result += intVal;
    }

    if (expr.exponentPart) {
        const text = expr.exponentPart.replace(/_/g, "");
        const expVal = parseInt(text);
        result *= Math.pow(10, expVal);
    }

    if (expr.isNegative) {
        result = -result;
    }

    // TODO: return undefined if the literal is impossible to generate properly

    return result;
}

// Parses quite a lot of stuff, actually.
// - function declarations/calls
// - indexaction ops (we gotta move this actually)
// - assignment (used to be done with precedence, but then I had a whole
// bunch of code everywhere checking that it was only happening as a 'block level' statement. also makes the
// stack frame stuff easier to implement when we make it it's own thing like this
function parseIdentifierAndFollowOns(ctx: ParserContext, canParseAssignment: boolean): ProgramExpression | undefined {
    const start = getParserPosition(ctx);

    let result: ProgramExpression = parseIdentifierOrPreviousResultOp(ctx);

    parseWhitespace(ctx);

    if (currentChar(ctx) === "[") {
        // TODO: move this to be for any expression
        result = {
            parent: null,
            children: [],
            t: T_DATA_INDEX_OP,
            start,
            end: getParserPosition(ctx),
            lhs: result,
            indexes: [],
        };

        while (currentChar(ctx) === "[" && advance(ctx)) {
            const expr = parseExpressionOrMoveToNextLine(ctx, canParseAssignment);
            if (expr) {
                result.indexes.push(expr);
            } else {
                return result;
            }

            parseWhitespace(ctx);

            if (currentChar(ctx) !== "]") {
                addErrorAtCurrentPosition(ctx, "Expected a closing square brace ] here");
                break;
            }

            advance(ctx);

            parseWhitespace(ctx);
        }

        result.end = getParserPosition(ctx);
    }

    if (result.t === T_IDENTIFIER && currentChar(ctx) === "(") {
        result = {
            parent: null,
            children: [],
            t: T_FN,
            start,
            end: getParserPosition(ctx),
            fnName: result,
            arguments: [],
            body: null,
            argumentNames: null,
        };

        advance(ctx);

        parseExpressionsDelimiterSeparated(ctx, result.arguments, ",", ")");

        result.end = getParserPosition(ctx);

        parseWhitespace(ctx);

        if (currentChar(ctx) === "{" && !ctx.isInForLoopRangeExpr) {
            const argNames: ProgramExpressionIdentifier[] = [];
            for (let i = 0; i < result.arguments.length; i++) {
                const arg = result.arguments[i];

                if (arg.t !== T_IDENTIFIER) {
                    addErrorAtPosition(ctx, arg.start, "A function declaration's arguments list can only be identifiers");
                    return;
                }

                const name = arg.name;
                for (const otherName of argNames) {
                    if (otherName.name === name) {
                        addErrorAtPosition(ctx, arg.start, "This argument name matches the name of a previous argument");
                        return;
                    }
                }

                argNames.push(arg);
            }

            result.argumentNames = argNames;

            const block = parseBlock(ctx);

            if (!block) {
                return undefined;
            }

            result.body = block;
            if (ctx.parseResult.functions.has(result.fnName.name)) {
                addErrorAtPosition(ctx, result.fnName.start, "A function with this name already exists");
                return;
            }
            ctx.parseResult.functions.set(result.fnName.name, result);
            result.end = getParserPosition(ctx);
        }

    } else if (currentChar(ctx) === "=" && currentChar(ctx, 1) !== "=") {
        if (!canParseAssignment) {
            addErrorAtPosition(ctx, result.start, "Assignments may only be done at the root of an expression");
            return;
        }

        advance(ctx);
        parseWhitespace(ctx);

        // TODO: move this to be for any expression
        result = {
            parent: null,
            children: [],
            t: T_ASSIGNMENT,
            start: start,
            end: getParserPosition(ctx),
            lhs: result,
            rhs: undefined,
        };

        const rhs = parseExpression(ctx);
        if (!rhs) {
            if (ctx.parseResult.errors.length === 0) {
                addErrorAtPosition(ctx, getParserPosition(ctx), "Assignment expression is incomplete");
            }
            return result;
        }

        result.rhs = rhs;
        result.end = getParserPosition(ctx);
    }

    return result;
}

function parseIdentifierOrPreviousResultOp(ctx: ParserContext): ProgramExpressionIdentifier | ProgramExpressionPreviousResult {
    const c = currentChar(ctx);
    const start = getParserPosition(ctx);

    // Sometimes, someone might message something into the chat, and then rather than typing
    // "I agree" or something, I'll type "^" - shorthand for (this right here :upwards finger:). 
    // We can actually just add this to the programming language.
    // I actually can't think of real usecases - this is just an idea that follows on nicely from the two properties
    // we have in this language:
    //  - we don't have any 'early returns'
    //  - the result of a 'block' is just the last thing in that block
    if (c === "^") {
        advance(ctx);
        return {
            parent: null,
            children: [],
            t: T_IDENTIFIER_THE_RESULT_FROM_ABOVE,
            start,
            end: getParserPosition(ctx),
        };
    }

    return parseIdentifier(ctx);
}

function parseIdentifier(ctx: ParserContext): ProgramExpressionIdentifier {
    assert(isLetter(currentChar(ctx)));
    const start = getParserPosition(ctx);

    while (
        isAllowedIdentifierSymbol(currentChar(ctx)) &&
        advance(ctx)
    ) { }

    const name = ctx.text.slice(start.i, ctx.pos.i);

    return {
        parent: null,
        children: [],
        t: T_IDENTIFIER,
        start,
        end: getParserPosition(ctx),
        name,
    };
}

export function parseIdentifierBackwardsFromPoint(
    text: string,
    pos: number
): string {
    const start = pos;
    while (pos >= 0 && pos < text.length) {
        const c = text[pos]
        if (!isAllowedIdentifierSymbol(c)) {
            break;
        }

        pos--;
    }

    return text.substring(pos + 1, start + 1).trim();
}

function parseBinaryOperator(ctx: ParserContext): BinaryOperatorType {
    let op: BinaryOperatorType = BIN_OP_INVALID;

    const c = currentChar(ctx);
    const c2 = currentChar(ctx, 1);
    const c3 = currentChar(ctx, 2);
    switch (c) {
        case "=": {
            if (c2 === "=") {
                op = BIN_OP_IS_EQUAL_TO;
            }
        } break;
        case "*": op = BIN_OP_MULTIPLY; break;
        case "/": op = BIN_OP_DIVIDE; break;
        case "+": op = BIN_OP_ADD; break;
        case "-": {
            // Avoid conflicting with "->"
            if (c2 !== ">" && c2 !== "<") {
                op = BIN_OP_SUBTRACT;
            }
        } break;
        case "<": {
            // Avoid conflicting with "<-"
            if (c2 !== "-") {
                if (c2 === "=") {
                    op = BIN_OP_LESS_THAN_EQ;
                } else {
                    op = BIN_OP_LESS_THAN;
                }
            }
        } break;
        case ">": {
            if (c2 !== ">" && c3 !== ">") {
                if (c2 === "=") {
                    op = BIN_OP_GREATER_THAN_EQ;
                } else {
                    op = BIN_OP_GREATER_THAN;
                }
            }
        } break;
        case "&": {
            if (c2 === "&") {
                op = BIN_OP_AND_AND;
            }
        } break;
        case "|": {
            if (c2 === "|") {
                op = BIN_OP_OR_OR;
            }
        } break;
        case "%": {
            op = BIN_OP_MODULO;
        } break;
    }

    return op;
}

// https://www.youtube.com/watch?v=fIPO4G42wYE&t=3750s
// Damn, it works! Funny how I had basically the same design up to the point I referred to this though.
// NOTE: My precedence is the other way around to what they had.
function parseBinaryOperatorIncreasingPrecedence(ctx: ParserContext, lhs: ProgramExpression, maxPrecedence: number): ProgramExpression | undefined {
    assert(!isWhitespace(currentChar(ctx)));

    const op = parseBinaryOperator(ctx);
    const prec = getBinOpPrecedence(op);
    if (prec === -1) {
        return;
    }

    if (prec >= maxPrecedence) {
        return;
    }

    for (let i = 0; i < binOpToOpString(op).length; i++) {
        advance(ctx);
    }

    const start = lhs.start;

    parseWhitespace(ctx);
    const rhs = parseExpression(ctx, false, prec);

    return {
        parent: null,
        children: [],
        t: T_BINARY_OP,
        op,
        lhs: lhs,
        rhs,
        start: start,
        end: getParserPosition(ctx),
    };
}

function parseExpression(ctx: ParserContext, canParseAssignment: boolean = false, maxPrec: number = MAX_PRECEDENCE): ProgramExpression | undefined {
    if (reachedEnd(ctx)) return undefined;

    assert(!isWhitespace(currentChar(ctx)));

    let res: ProgramExpression | undefined;

    let c = currentChar(ctx);
    if (isLetter(c) || c === "^") {
        if (compareCurrent(ctx, "for")) {
            res = parseRangedFor(ctx);
        } else if (compareCurrent(ctx, "list")) {
            const start = getParserPosition(ctx);
            for (let i = 0; i < "list".length; i++) {
                advance(ctx);
            }
            parseWhitespace(ctx);
            if (currentChar(ctx) !== "[") {
                addErrorAtPosition(ctx, ctx.pos, "Expected a [ here");
                return;
            }
            res = parseListLiteral(ctx, T_LIST_LITERAL, start);
        } else if (compareCurrent(ctx, "map")) {
            const start = getParserPosition(ctx);
            for (let i = 0; i < "map".length; i++) {
                advance(ctx);
            }
            parseWhitespace(ctx);
            if (currentChar(ctx) !== "{") {
                addErrorAtPosition(ctx, ctx.pos, "Expected a { here");
                return;
            }

            res = parseMapLiteral(ctx, start);
        } else {
            res = parseIdentifierAndFollowOns(ctx, canParseAssignment);
        }
    } else if (canParseNumberLiteral(ctx)) {
        res = parseNumberLiteral(ctx);
    } else if (c === "[") {
        res = parseListLiteral(ctx, T_VECTOR_LITERAL);
    } else if (c === "{") {
        res = parseBlock(ctx);
    } else if (c === "(") {
        advance(ctx);
        parseWhitespace(ctx);
        res = parseExpressionOrMoveToNextLine(ctx, false);
        if (res) {
            parseWhitespace(ctx);

            if (currentChar(ctx) !== ")") {
                // TODO: figure out why col is 1 higher than it should be
                addErrorAtCurrentPosition(ctx, "Expected a closing paren ) here");
            } else {
                advance(ctx);
            }
        }
    } else if (c === "\"") {
        res = parseStringLiteral(ctx);
    } else if (c === "!" || c === ">" || c === "-") {
        // TODO: fix -x not working

        const start = getParserPosition(ctx);

        let op: UnaryOperatorType = UNARY_OP_INVALID;
        if (c === "!") {
            advance(ctx);
            op = UNARY_OP_NOT;
        } else if (c === ">") {
            if (currentChar(ctx, 1) === ">") {
                if (currentChar(ctx, 2) === ">") {
                    advance(ctx);
                    advance(ctx);
                    advance(ctx);
                    op = UNARY_OP_PRINT;
                }
            }
        } else if (c === "-") {
            advance(ctx);
            parseWhitespace(ctx);

            const expr = parseExpression(ctx, false, MIN_PRECEDENCE);
            if (!expr) {
                return;
            }

            // Rewrite negatives to be like 0 - blah.

            res = {
                parent: null,
                children: [],
                start,
                end: getParserPosition(ctx),
                t: T_BINARY_OP,
                // virtual expression. Source? where the text live? I made it tf up
                lhs: {
                    parent: null,
                    children: [],
                    t: T_NUMBER_LITERAL,
                    start: start,
                    end: start,
                    integerPart: "",
                    decimalPart: null,
                    exponentPart: null,
                    isNegative: false,
                    val: 0
                },
                op: BIN_OP_SUBTRACT,
                rhs: expr
            }
        }

        if (op !== UNARY_OP_INVALID) {
            parseWhitespace(ctx);

            const expr = parseExpression(ctx, false, MIN_PRECEDENCE);
            if (!expr) {
                return;
            }

            res = {
                parent: null,
                children: [],
                start: start,
                end: getParserPosition(ctx),
                t: T_UNARY_OP,
                op,
                expr
            };
        }
    }

    if (res) {
        parseWhitespace(ctx);

        while (true) {
            const nextRes = parseBinaryOperatorIncreasingPrecedence(ctx, res, maxPrec);
            if (!nextRes) {
                break;
            }

            parseWhitespace(ctx);

            res = nextRes;
        }
    }

    if (res) {
        parseWhitespace(ctx);
        const c = currentChar(ctx);
        if (c === "?" && TERNARY_PRECEDENCE < maxPrec) {
            const ternary = parseTernaryIf(ctx, res);
            if (ternary) {
                res = ternary;
            }
        }
    }

    return res;
}

function addErrorAtCurrentPosition(ctx: ParserContext, error: string) {
    ctx.parseResult.errors.push({
        pos: getParserPosition(ctx),
        problem: error
    });
}

function addErrorAtPosition(ctx: ParserContext, pos: TextPosition, error: string) {
    ctx.parseResult.errors.push({
        pos,
        problem: error
    });
}

function getParserPosition(ctx: ParserContext): TextPosition {
    return { ...ctx.pos };
}

function parseExpressionOrMoveToNextLine(ctx: ParserContext, canParseAssignments: boolean): ProgramExpression | undefined {
    parseWhitespace(ctx);
    if (reachedEnd(ctx)) {
        return;
    }

    const startPos = getParserPosition(ctx);

    const statement = parseExpression(ctx, canParseAssignments);
    if (statement) {
        return statement;
    }

    if (ctx.parseResult.errors.length === 0) {
        if (currentChar(ctx) === "=") {
            addErrorAtPosition(ctx, startPos, "Only identifiers can be assigned to");
        } else {
            addErrorAtCurrentPosition(ctx, "Couldn't figure out how to parse this expression.");
        }
    }

    // Let's just get to the next line, and continue from there.
    advanceToNextNewLine(ctx);
    advance(ctx);


    return;
}

function advanceToNextNewLine(ctx: ParserContext) {
    while (advance(ctx) && currentChar(ctx) !== "\n") { }
}

function parseStatements(ctx: ParserContext, statements: ProgramExpression[], closingCurlyBrace = "") {
    let lastLine = -1;
    while (true) {
        if (reachedEnd(ctx)) {
            break;
        }

        parseWhitespace(ctx);
        if (closingCurlyBrace && currentChar(ctx) === closingCurlyBrace) {
            break;
        }

        const thisLine = ctx.pos.line;

        const lineStartPos = getParserPosition(ctx);

        const expr = parseExpressionOrMoveToNextLine(ctx, true);
        if (expr) {

            if (thisLine === lastLine) {
                ctx.parseResult.errors.push({
                    pos: lineStartPos,
                    // This is so likely to be a mistake that I've promoted this message to be an error. 
                    // Might be worth adding a semicolon for this stuff?
                    problem: "You've put multiple statements on the same line, which is no-longer allowed"
                });
            }
            lastLine = thisLine;

            statements.push(expr);
        }
    }
}

export function parse(text: string): ProgramParseResult {
    const program: ProgramParseResult = {
        text,
        statements: [],
        functions: new Map(),
        errors: [],
        warnings: [],
    };

    const ctx: ParserContext = {
        isInForLoopRangeExpr: false,
        text,
        parseResult: program,
        pos: newTextPosition(0, 0, 0, 0),
    };

    parseStatements(ctx, program.statements);

    const computeParentAndChildren = (parent: ProgramExpression | null, expr: ProgramExpression) => {
        expr.parent = parent;
        if (parent) {
            parent.children.push(expr);
        }

        switch (expr.t) {
            case T_IDENTIFIER: 
            case T_IDENTIFIER_THE_RESULT_FROM_ABOVE: 
            case T_STRING_LITERAL:
            case T_NUMBER_LITERAL: 
                break;
            case T_BINARY_OP: {
                computeParentAndChildren(expr, expr.lhs);
                if (expr.rhs) {
                    computeParentAndChildren(expr, expr.rhs);
                }
            } break;
            case T_UNARY_OP: {
                computeParentAndChildren(expr, expr.expr);
            } break;
            case T_LIST_LITERAL: {
                for (const itemExpr of expr.items) {
                    computeParentAndChildren(expr, itemExpr);
                }
            } break;
            case T_VECTOR_LITERAL: {
                for (const itemExpr of expr.items) {
                    computeParentAndChildren(expr, itemExpr);
                }
            }; break;
            case T_TERNARY_IF: {
                computeParentAndChildren(expr, expr.query);
                computeParentAndChildren(expr, expr.trueBranch);
                if (expr.falseBranch) {
                    computeParentAndChildren(expr, expr.falseBranch);
                }
            } break;
            case T_BLOCK: {
                for (const statement of expr.statements) {
                    computeParentAndChildren(expr, statement);
                }
            } break;
            case T_FN: {
                computeParentAndChildren(expr, expr.fnName);

                for (const argExpr of expr.arguments) {
                    computeParentAndChildren(expr, argExpr);
                }

                if (expr.body) {
                    computeParentAndChildren(expr, expr.body);
                }
            } break;
            case T_DATA_INDEX_OP: {
                for (const idxExpr of expr.indexes) {
                    computeParentAndChildren(expr, idxExpr);
                }
            } break;
            case T_RANGE_FOR: {
                computeParentAndChildren(expr, expr.loopVar);
                computeParentAndChildren(expr, expr.rangeExpr);
                computeParentAndChildren(expr, expr.body);
            } break;
            case T_ASSIGNMENT: {
                computeParentAndChildren(expr, expr.lhs);
                if (expr.rhs) {
                    computeParentAndChildren(expr, expr.rhs);
                }
            } break;
            case T_MAP_LITERAL: {
                for (const [k, v] of expr.kvPairs) {
                    computeParentAndChildren(expr, k);
                    computeParentAndChildren(expr, v);
                }
            } break;
            default:
                assertUnreachable(expr);
        }

        if (expr.children.length > 0) {
            // The children in an AST must always start at or after the parent.
            // If this is hit, then there is a bug in the parser somewhere.
            assert(expr.start.i <= expr.children[0].start.i);
        }
    }

    for (const expr of program.statements) {
        computeParentAndChildren(null, expr);
    }

    // dont bother popping the global stack frame

    if (program.errors) {
        return program;
    }

    return program;
}

export function getAstNodeForTextPos(
    parseResult: ProgramParseResult,
    textPos: number
): ProgramExpression | undefined {
    for (let i = 0; i < parseResult.statements.length; i++) {
        const statement = parseResult.statements[i];
        if (statement.start.i <= textPos && textPos < statement.end.i) {
            return getAstNodeForTextPosRecursive(statement, textPos);
        }
        if (statement.start.i > textPos) break;
    }

    return undefined;
}

function getAstNodeForTextPosRecursive(expr: ProgramExpression, textPos: number) {
    for (let i = 0; i < expr.children.length; i++) {
        const child = expr.children[i];
        if (child.start.i <= textPos && textPos < child.end.i) {
            return getAstNodeForTextPosRecursive(child, textPos);
        }
        if (child.start.i > textPos) break;
    }

    return expr;
}



