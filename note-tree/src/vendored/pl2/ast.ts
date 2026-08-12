import { assert, assertNever } from "./assert";
import {
	advance,
	advanceBy,
	advanceToNextNewLine,
	compareCurrent,
	compareCurrentWithWordBoundary,
	currentChar,
	newParser,
	getNumErrors,
	Parser,
	parserPos,
	reachedEnd,
    reportParserError,
    reset,
    hasNewErrors
} from "./parser";
import { isDigit, isLetter, isWhitespace } from "./string-utils";
import { TextPosition } from "./text-pos";

export type Program = {
	code: string;
	statements: Expression[];
}

export const OP_NONE        = 0;
export const OP_ADD         = 1;
export const OP_SUBTRACT    = 2;
export const OP_MULTIPLY    = 3;
export const OP_MODULO      = 4;
export const OP_DIVIDE      = 5;
export const OP_LOGICAL_AND = 6;
export const OP_BITWISE_AND = 7;
export const OP_LOGICAL_OR  = 8;
export const OP_BITWISE_OR  = 9;
export const OP_LOGICAL_XOR = 10;
export const OP_BITWISE_XOR = 11;
export const OP_LESS_THAN       = 12;
export const OP_LESS_THAN_EQ    = 13;
export const OP_GREATER_THAN    = 14;
export const OP_GREATER_THAN_EQ = 15;
export const OP_EQ              = 16;
export const OP_NOT_EQ          = 17;

export type BinaryOperatorType =
 | typeof OP_NONE
 | typeof OP_ADD
 | typeof OP_SUBTRACT
 | typeof OP_MULTIPLY
 | typeof OP_DIVIDE
 | typeof OP_MODULO
 | typeof OP_LOGICAL_AND
 | typeof OP_BITWISE_AND
 | typeof OP_LOGICAL_OR
 | typeof OP_BITWISE_OR
 | typeof OP_LOGICAL_XOR
 | typeof OP_BITWISE_XOR
 | typeof OP_LESS_THAN
 | typeof OP_LESS_THAN_EQ
 | typeof OP_GREATER_THAN
 | typeof OP_GREATER_THAN_EQ
 | typeof OP_EQ
 | typeof OP_NOT_EQ
 ;

export const UNARY_OP_NOT         = 1;
export const UNARY_OP_BITWISE_NOT = 2;

export type UnaryOperator = 
 | typeof UNARY_OP_NOT
 | typeof UNARY_OP_BITWISE_NOT
 ; 

export function unaryOperatorToString(op: UnaryOperator): string {
	switch (op) {
		case UNARY_OP_NOT:         return "!";
		case UNARY_OP_BITWISE_NOT: return "~";
		default: assertNever(op);
	}
}

export function operatorToString(op: BinaryOperatorType): string {
	switch(op) {
		case OP_NONE:            return "<no operator>";
		case OP_ADD:             return "+";
		case OP_SUBTRACT:        return "-";
		case OP_MULTIPLY:        return "*";
		case OP_DIVIDE:          return "/";
		case OP_MODULO:          return "%";
		case OP_LOGICAL_AND:     return "&&";
		case OP_BITWISE_AND:     return "&";
		case OP_LOGICAL_OR:      return "||";
		case OP_BITWISE_OR:      return "|";
		case OP_LOGICAL_XOR:     return "^^";
		case OP_BITWISE_XOR:     return "|";
		case OP_LESS_THAN:       return "<";
		case OP_LESS_THAN_EQ:    return "<=";
		case OP_GREATER_THAN:    return ">";
		case OP_GREATER_THAN_EQ: return ">=";
		case OP_EQ:              return "==";  // Look out for conflicts with the = operator !
		case OP_NOT_EQ:          return "!=";  // Look out for conflicts with the ! operator !
		default: assertNever(op);
	}
	return "?";
}

export type BinaryOperator = {
	type: BinaryOperatorType;
	assignment: boolean;
}

export const Expression_Invalid            = 0;
export const Expression_Identifier         = 1;
export const Expression_BinaryExpression   = 2;
export const Expression_FunctionCall       = 3;
export const Expression_IfChain            = 4;
export const Expression_ForLoop            = 5;
export const Expression_TypeInitializer    = 6;
export const Expression_NumberLiteral      = 7;
export const Expression_StringLiteral      = 8;
export const Expression_FunctionDefinition = 9;
export const Expression_Return             = 10;
export const Expression_Continue           = 11;
export const Expression_Break              = 12;
export const Expression_ReturnBlock        = 13; // I have wanted this construct in every language I have ever used, but I've never seen it. :)
export const Expression_BooleanLiteral     = 14;
export const Expression_Indexer            = 15;
export const Expression_ForLoopRange       = 16;
export const Expression_UnaryExpression    = 17;

export function expressionTypeToString(type: ExpressionType): string {
	switch (type) {
	case Expression_Identifier:         return "Identifier";
	case Expression_BinaryExpression:   return "BinaryExpression";
	case Expression_FunctionCall:       return "FunctionCall";
	case Expression_IfChain:            return "IfChain";
	case Expression_ForLoop:            return "ForLoop";
	case Expression_TypeInitializer:    return "TypeInitializer";
	case Expression_NumberLiteral:      return "NumberLiteral";
	case Expression_StringLiteral:      return "StringLiteral";
	case Expression_FunctionDefinition: return "FunctionDefinition";
	case Expression_Return:             return "Return";
	case Expression_Continue:           return "Continue";
	case Expression_Break:              return "Break";
	}
	return "Invalid"
}

export type ExpressionType = Expression["type"];

export type ExpressionBase = {
	type:   number;
	start:  TextPosition;
	end:    TextPosition;
}

export type UnaryExpression = ExpressionBase & {
	type: typeof Expression_UnaryExpression;
	op:   UnaryOperator;
	expr: Expression;
}

export type BinaryExpression = ExpressionBase & {
	type: typeof Expression_BinaryExpression;
	lhs: Expression;
	op:  BinaryOperator;
	rhs: Expression;
}

export type Identifier = ExpressionBase & {
	type: typeof Expression_Identifier;
	name: string;
}

export type FunctionCall = ExpressionBase & {
	type:      typeof Expression_FunctionCall;
	name:      Identifier;
	arguments: Expression[];
}

export type IfChain = ExpressionBase & {
	type: typeof Expression_IfChain;
	blocks: {
		check: Expression;
		block: Expression[];
	}[];
	else: Expression[] | undefined;
};

export type ForLoop = ExpressionBase & {
	type: typeof Expression_ForLoop;
	varNames: Identifier[];
	toIterate: Expression;
	statements: Expression[];
}

export type ForLoopRange = ExpressionBase & {
	type: typeof Expression_ForLoopRange;
	lo: Expression;
	hi: Expression;
	rangeType: ForLoopRangeType;
};

export type TypeInitializer = ExpressionBase & {
	type: typeof Expression_TypeInitializer;
	typename: Identifier;
	typeArgs: Expression[] | undefined; 
	args: Expression[];
}


export type NumberLiteral = ExpressionBase & {
    type: typeof Expression_NumberLiteral;
    integerPart: string;
    decimalPart: string | undefined;
    exponentPart: string | undefined;
    isNegative: boolean;
    val: number;
}

export type BooleanLiteral = ExpressionBase & {
    type: typeof Expression_BooleanLiteral;
	val: boolean;
};

export type Indexer = ExpressionBase & {
	type: typeof Expression_Indexer;
	target: Expression;
	indexes: Expression[];
};

export type FunctionArgument = {
	name: Identifier;
	// TODO: type: TypeExpression. I was originally thinking of just leaving everything untyped.
	// The interesting thing here, is that I wanted to just have x = map<string, number>{}
	// and omit the ability to do x: map<string, number> = {}. Right? 
	// But function arguments need to be done like x: map<string, number>, so in order
	// to be truly consistent, I'll need to do x: map<string, number> = {} and x: map<string, number>, etc. everywhere.
}

export type FunctionDefinition = ExpressionBase & {
	type: typeof Expression_FunctionDefinition;
	args: FunctionArgument[];
	body: Expression[];
	name: Identifier | undefined;
}

export type ReturnStatement = ExpressionBase & {
	type: typeof Expression_Return;
	expr: Expression;
}

export type ReturnStatementBlock = ExpressionBase & {
	type:  typeof Expression_ReturnBlock;
	block: Expression[];
}

export type LoopControlFlowLabel = ExpressionBase &  {
	type: 
		| typeof Expression_Continue
		| typeof Expression_Break;
}

export type StringLiteral = ExpressionBase & {
    type: typeof Expression_StringLiteral;
    val: string;
}

export const RANGE_LT  = 1;
export const RANGE_LTE = 2;
export const RANGE_GT  = 3;
export const RANGE_GTE = 4;

export type ForLoopRangeType = 
 | typeof RANGE_LT
 | typeof RANGE_LTE
 | typeof RANGE_GT
 | typeof RANGE_GTE
 ;

export type DataType = {
}

export type Expression = 
 | UnaryExpression
 | BinaryExpression
 | Identifier
 | FunctionCall
 | IfChain
 | ForLoop
 | TypeInitializer
 | NumberLiteral
 | BooleanLiteral
 | StringLiteral
 | FunctionDefinition
 | ReturnStatement
 | ReturnStatementBlock
 | LoopControlFlowLabel
 | Indexer
 | ForLoopRange
 ;

export function expressionToString(code: string, expr: Expression): string {
    return code.slice(expr.start.i, expr.end.i)
}

export function isAllowedIdentifierSymbol(char: string) {
    return isLetter(char) || isDigit(char) || char === "_";
}

export function canParseNumberLiteral(r: Parser): boolean {
    const c = currentChar(r);
    return c === "+" || c === "-" || isDigit(c);
}

export function isValidNumberPart(c: string) {
    return isDigit(c) || c === "_";
}

export function parseWhitespace(parser: Parser) {
    while (!reachedEnd(parser)) {
        const c = currentChar(parser);
        if (isWhitespace(c)) {
            advance(parser);
            continue;
        }

        // Comments can be considered whitespace.
        if (compareCurrent(parser, "//")) {
            advanceToNextNewLine(parser);
            advance(parser);
            continue;
        }

		// Old habits die hard
		if (compareAndAdvance(parser, ";")) {
			continue;
		}

        break;
    }
}

export function parseIdentifier(parser: Parser): Identifier | undefined {
	parseWhitespace(parser);

	if (!isLetter(currentChar(parser))) return;

	const start = parserPos(parser);

    while (isAllowedIdentifierSymbol(currentChar(parser)) && advance(parser)) {}

	if (start.i === parser.pos.i) {
		return undefined;
	}

    const name = parser.text.slice(start.i, parser.pos.i);

    return {
		type: Expression_Identifier,
		start: start,
		end:   parserPos(parser),
		name,
    };
}

export function parseOperatorInternal(parser: Parser): BinaryOperatorType {
	if (compareAndAdvance(parser, "+"))  return OP_ADD;
	if (compareAndAdvance(parser, "-"))  return OP_SUBTRACT;
	if (compareAndAdvance(parser, "*"))  return OP_MULTIPLY;
	if (compareAndAdvance(parser, "/"))  return OP_DIVIDE;
	if (compareAndAdvance(parser, "%"))  return OP_MODULO;
	if (compareAndAdvance(parser, "&&")) return OP_LOGICAL_AND;
	if (compareAndAdvance(parser, "&"))  return OP_BITWISE_AND;
	if (compareAndAdvance(parser, "||")) return OP_LOGICAL_OR;
	if (compareAndAdvance(parser, "|"))  return OP_BITWISE_OR;
	if (compareAndAdvance(parser, "^^")) return OP_LOGICAL_XOR;
	if (compareAndAdvance(parser, "^"))  return OP_BITWISE_XOR;
	if (compareAndAdvance(parser, "<=")) return OP_LESS_THAN_EQ;
	if (compareAndAdvance(parser, "<"))  return OP_LESS_THAN;
	if (compareAndAdvance(parser, ">=")) return OP_GREATER_THAN_EQ;
	if (compareAndAdvance(parser, ">"))  return OP_GREATER_THAN;
	if (compareAndAdvance(parser, "===")) {
		reportParserError(parser, "Webdev detected, code rejected.");
		return OP_EQ;
	}
	if (compareAndAdvance(parser, "==")) return OP_EQ;
	if (compareAndAdvance(parser, "!=")) return OP_NOT_EQ;
	return OP_NONE;
}

function operatorCanBeCombinedWithAssignment(op: BinaryOperatorType): boolean {
	switch (op) {
		case OP_LESS_THAN_EQ:    return false; 
		case OP_LESS_THAN:       return false; 
		case OP_GREATER_THAN_EQ: return false; 
		case OP_GREATER_THAN:    return false; 
		case OP_EQ:              return false; 
		case OP_NOT_EQ:          return false; 
	}
	return true;
}

export function parseBinaryOperator(parser: Parser): BinaryOperator | undefined {
	parseWhitespace(parser);

	const op = parseOperatorInternal(parser);

	let assignment = false;
	if (operatorCanBeCombinedWithAssignment(op)) {
		if (currentChar(parser) === "=") {
			assignment = true;
			if (!advance(parser)) return;
		}
	}

	if (op === 0 && !assignment) return undefined;

	return {
		type: op,
		assignment: assignment,
	};
}

export function parseUnaryOperator(parser: Parser): UnaryOperator | undefined {
	if (compareAndAdvance(parser, "!")) return UNARY_OP_NOT;
	if (compareAndAdvance(parser, "~")) return UNARY_OP_BITWISE_NOT;
	return undefined;
}

export function parseGroup(parser: Parser): Expression | undefined {
	const numErrors = getNumErrors(parser);

	if (currentChar(parser) !== "(") return;

	if (!advance(parser)) return;

	const expr = parseExpression(parser);
	if (!expr) {
		if (!hasNewErrors(parser, numErrors)) {
			reportParserError(parser, "Expected an expression here");
		}
		return undefined;
	}

	parseWhitespace(parser);
	if (!compareAndAdvance(parser, ")")) {
		if (!hasNewErrors(parser, numErrors)) {
			reportParserError(parser, "Expected closing brace here");
		}
		// return what we have anyway
	}

	return expr;
}

function compareAndAdvance(parser: Parser, keyword: string): boolean {
	if (!compareCurrent(parser, keyword)) return false;
	advanceBy(parser, keyword.length);
	return true;
}

function parseCodeBlock(parser: Parser, pastFirstCurlyBrace = false): Expression[] | undefined {
	const numErrors = getNumErrors(parser);

	if (!pastFirstCurlyBrace) {
		if (currentChar(parser) !== "{") {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "Expected a { here");
			}
			return undefined;
		}
		advance(parser);
	}

	const statements: Expression[] = [];
	let foundBlockEnd = false;
	while (true) {
		parseWhitespace(parser);
		if (currentChar(parser) === "}") {
			foundBlockEnd = true;
			break;
		}

		const expr = parseExpression(parser);
		if (!expr) break;

		statements.push(expr);
	}

	if (!foundBlockEnd) {
		if (!hasNewErrors(parser, numErrors)) {
			reportParserError(parser, "Expected a } to close this block");
		}
		return;
	}

	advance(parser);

	return statements;
}

export function parseIfChain(parser: Parser): IfChain | undefined {
	if (!compareAndAdvance(parser, "if")) return;
	parseWhitespace(parser);

	const numErrors = getNumErrors(parser);

	const start = parserPos(parser);
	const blocks: { check: Expression; block: Expression[]; }[] = [];
	let elseItems: Expression[] | undefined;

	while (true) {
		const check = parseExpression(parser);
		if (!check) {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "Expected an if-check boolean expression here");
			}
			return undefined;
		}

		parseWhitespace(parser);

		const block = parseCodeBlock(parser);
		if (!block) {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "Expected an if { ... } block here");
			}
			return undefined;
		}
		blocks.push({ check, block });

		parseWhitespace(parser);
		if (!compareAndAdvance(parser, "else ")) {
			break;
		}

		// Parse the if of the next statement.
		parseWhitespace(parser);
		if (!compareAndAdvance(parser, "if ")) {
			// Final block doesn't have an if, but it does have an else.
			
			const elseBlock = parseCodeBlock(parser);
			if (!elseBlock) {
				if (!hasNewErrors(parser, numErrors)) {
					reportParserError(parser, "Expected an } else { ... } block here");
				}
				break;
			}

			elseItems = elseBlock;

			break;
		}
	}

	return {
		type: Expression_IfChain,
		start: start,
		end:   parserPos(parser),
		blocks,
		else: elseItems,
	};
}

export function parseForLoop(parser: Parser): ForLoop | undefined {
	const pos = parserPos(parser);

	if (!compareAndAdvance(parser, "for")) return;

	const numErrors = getNumErrors(parser);

	const varNames: Identifier[] = [];

	while (true) {
		parseWhitespace(parser)
		const varName = parseIdentifier(parser);
		if (!varName) {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "Expected an identifier here for a for-loop variable");
			}
			return undefined;
		}

		varNames.push(varName);

		parseWhitespace(parser)
		if (compareCurrentWithWordBoundary(parser, "in")) {
			advanceBy(parser, 2);
			break;
		}

		parseWhitespace(parser)
		if (!compareAndAdvance(parser, ",")) {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "Expected 'in', or a , here");
			}
			return undefined;
		}
	}

	parseWhitespace(parser);
	let lowOrIterator = parseExpression(parser);
	if (!lowOrIterator) {
		if (!hasNewErrors(parser, numErrors)) {
			reportParserError(parser, "Expected an expression for an iterable object or a range like a..<b here");
		}
		return undefined;
	}

	parseWhitespace(parser);
	const rangeExprStart = parserPos(parser);
	let rangeExprOrIterator = parseForLoopRange(parser, lowOrIterator);
	if (rangeExprOrIterator) {
		lowOrIterator = rangeExprOrIterator;
	} else {
		reset(parser, rangeExprStart);
	}

	parseWhitespace(parser);

	const block = parseCodeBlock(parser);
	if (!block) {
		if (!hasNewErrors(parser, numErrors)) {
			reportParserError(parser, "Expected a body code block for this for-loop");
		}
		return undefined;
	}

	return {
		type: Expression_ForLoop,
		start: pos,
		end:   parserPos(parser),
		varNames:   varNames,
		toIterate:  lowOrIterator,
		statements: block,
	};
}

function parseForLoopRange(parser: Parser, lo: Expression): ForLoopRange | undefined {
	const numErrors = getNumErrors(parser);

	let rangeType: ForLoopRangeType;
	if (compareAndAdvance(parser, "..<=")) {
		rangeType = RANGE_LTE;
	} else if (compareAndAdvance(parser, "..<")) {
		rangeType = RANGE_LT;
	} else if (compareAndAdvance(parser, "..>=")) {
		rangeType = RANGE_GTE;
	} else if (compareAndAdvance(parser, "..>")) {
		rangeType = RANGE_GT;
	} else if (compareAndAdvance(parser, "..=")) {
		reportParserError(parser, "Not a valid range. Did you mean ..<= ?\nYou may also like ..> and ..>=");
		return undefined;
	} else {
		// ERROR
		return undefined;
	}

	parseWhitespace(parser);

	const hi = parseExpression(parser);
	if (!hi) {
		if (!hasNewErrors(parser, numErrors)) {
			reportParserError(parser, "Expected an expression for the upper bound of this range");
		}
		return undefined;
	}

	return {
		type: Expression_ForLoopRange,
		start: lo.start,
		end:   parserPos(parser),
		lo:    lo,
		hi:    hi,
		rangeType: rangeType,
	};
}

export function parseSingularExpressionInternal(parser: Parser): Expression | undefined {
	parseWhitespace(parser);

	const pos = parserPos(parser);

	// Most keywords here will be followed by a symbol or space.
	// We need to do this to disambiguate them from a similarly named identifier, like returnPos or ifFound.
	// Probably a bit scuffed of an approach but I also don't see anything wrong with it.
	//
	// E.g - you can't write code like
	// return
	// {
	//		x = 1
	// }
	// but I don't really care

	if (compareCurrent(parser, "("))                      { return parseGroup(parser); }
	if (compareCurrentWithWordBoundary(parser, "fn"))     { return parseFunctionDefinition(parser) }
	if (compareCurrentWithWordBoundary(parser, "if"))     { return parseIfChain(parser); }
	if (compareCurrentWithWordBoundary(parser, "for"))    { return parseForLoop(parser) }
	if (compareCurrentWithWordBoundary(parser, "return")) { return parseAnyReturnStatement(parser); }
	if (compareCurrentWithWordBoundary(parser, "continue")) { 
		advanceBy(parser, "continue".length);
		return { type: Expression_Continue, start: pos, end: parserPos(parser), };
	}
	if (compareCurrentWithWordBoundary(parser, "break")) { 
		advanceBy(parser, "break".length);
		return { type: Expression_Break, start: pos, end: parserPos(parser), };
	}

	if (compareCurrentWithWordBoundary(parser, "true"))   { return parseBooleanLiteral(parser, true); }
	if (compareCurrentWithWordBoundary(parser, "false"))  { return parseBooleanLiteral(parser, false); }
	if (canParseNumberLiteral(parser))                    { return parseNumberLiteral(parser); }
	if (currentChar(parser) === "\"")                     { return parseStringLiteral(parser); }

	// Identifier, or function, or data initializer. Do this _after_ keywords.
	if (isLetter(currentChar(parser))) {
		const identifier = parseIdentifier(parser);
		assert(!!identifier);

		// No whitespace parsing here. fn(x) to work, fn (x) to not work.
		// This allows us to omit () for if-checks. 
		// Otherwise, stuff like if something { ... } can't be parsed correctly - 
		// We would expect something like
		// if             something                    { ... }
		// ^ if keyword   ^ condition ( 1 identifier)  ^ code block
		// But the parser would do this instead:
		// if             something { ... }
		// ^ if keyword   ^ condition ( 1 type initializer )    ^ Error - where is the code block ??
		// This does mean that map { } won't work but map{} will. I think that is ok

		let typeArgs: Expression[] | undefined;
		if (currentChar(parser) === "<") {
			typeArgs = parseTypeArgs(parser);
		}

		// TODO: template functions?
		if (currentChar(parser) === "(") {
			const functionCall = parseFunctionCall(parser, identifier);
			if (functionCall) {
				return functionCall;
			}

			return undefined;
		} else if (currentChar(parser) === "{") {
			const dataInitializer = parseTypeInitializer(parser, identifier, typeArgs);
			if (dataInitializer) {
				return dataInitializer;
			}

			return undefined;
		}

		return identifier;
	}

	return undefined;
}

export function parseSingularExpression(parser: Parser): Expression | undefined {
	const pos = parserPos(parser);

	const numErrors = getNumErrors(parser);

	const unaryOp = parseUnaryOperator(parser);
	if (unaryOp !== undefined) {
		const expr = parseSingularExpression(parser);
		if (!expr) {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "Expected an expression for the upper bound of this range");
			}
			return undefined;
		}

		return {
			type:  Expression_UnaryExpression,
			start: pos,
			end:   parserPos(parser),
			op:    unaryOp,
			expr:  expr,
		};
	}

	let expr = parseSingularExpressionInternal(parser);
	if (!expr) {
		// The actual expression is mandatory
		return undefined;
	}

	parseWhitespace(parser);
	const indexer = parseIndexerExpression(parser, expr);
	if (indexer) {
		expr = indexer;
	}

	return expr;
}

export function parseReturnStatementInternal(parser: Parser): ReturnStatement | undefined {
	const numErrors = getNumErrors(parser);

	parseWhitespace(parser);

	const pos = parserPos(parser);

	const expr = parseExpression(parser);
	if (!expr) {
		if (!hasNewErrors(parser, numErrors)) {
			reportParserError(parser, "Expected an expression to return here");
		}

		return undefined;
	}

	parseWhitespace(parser);

	return {
		type: Expression_Return,
		expr: expr,
		start: pos,
		end: parserPos(parser),
	};
}

export function parseReturnStatementBlockInternal(parser: Parser): ReturnStatementBlock | undefined {
	const pos = parserPos(parser);

	const block = parseCodeBlock(parser, true);
	if (!block) return undefined;

	return {
		type: Expression_ReturnBlock,
		block: block,
		start: pos,
		end: parserPos(parser),
	};
}

export function parseAnyReturnStatement(parser: Parser): ReturnStatement | ReturnStatementBlock | undefined {
	if (!compareAndAdvance(parser, "return")) return undefined;

	parseWhitespace(parser);
	if (compareAndAdvance(parser, "{")) {
		return parseReturnStatementBlockInternal(parser);
	}

	return parseReturnStatementInternal(parser);
}

export function parseBinaryExpression(parser: Parser, lhs: Expression, level: number, op: BinaryOperator | undefined): BinaryExpression | undefined {
	let expr: BinaryExpression | undefined;

	const numErrors = getNumErrors(parser);

	while (true) {
		parseWhitespace(parser);

		if (!op) {
			op = parseBinaryOperator(parser);
			if (!op) {
				// No binary operator. Not a big deal.
				break;
			}
		}

		parseWhitespace(parser);

		if (!expr) {
			const rhs = parseSingularExpression(parser);
			if (!rhs) {
				if (!hasNewErrors(parser, numErrors)) {
					reportParserError(parser, "Expected the right-hand-side of a binary expression here");
				}
				break;
			}

			expr = {
				type: Expression_BinaryExpression,
				start: lhs.start,
				end: rhs.end,
				lhs: lhs,
				op: op,
				rhs: rhs,
			}
			level = getOpLevel(op.type);
			op = undefined;
			continue;
		}

		const opLevel = getOpLevel(op.type);
		if (opLevel > level) {
			// lhs <op> (rhs recursive thing)
			const newRhs = parseBinaryExpression(parser, expr.rhs, opLevel, op);
			if (!newRhs) break;

			expr.rhs = newRhs;
			op = undefined;
			continue;
		}

		const rhs = parseSingularExpression(parser);
		if (!rhs) {
			if (!hasNewErrors(parser, numErrors)) {
				// Different log message, so we can tell the two apart, xD
				reportParserError(parser, "Expected a binary expression's right-hand-side here");
			}
			break;
		}

		// We may have moved from a higher level to a lower level, which is ok for this codepath.
		level = opLevel;

		// (lhs recursive thing) <op> rhs
		expr = {
			type: Expression_BinaryExpression,
			start: expr.start,
			end: rhs.end,
			lhs: expr,
			op: op,
			rhs: rhs,
		}
		op = undefined;
	}

	return expr;
}

export function parseExpression(parser: Parser): Expression | undefined {
	let expr = parseSingularExpression(parser);
	if (!expr) return undefined;

	const binExpr = parseBinaryExpression(parser, expr, 0, undefined);
	if (binExpr) return binExpr;

	return expr;
}

export function parseIndexerExpression(parser: Parser, expr: Expression): Expression | undefined {
	const numErrors = getNumErrors(parser);

	// Parses the full chain of indexers. x[0, 0][0][2][2][1]
	while (true) {
		if (!compareAndAdvance(parser, "[")) {
			break;
		}

		const indexExprs: Expression[] = [];
		let foundEnd = false;

		// Only matrices need multiple indexers at once - and they only need 2 max
		for (let i = 0; i < 2; i++) {
			parseWhitespace(parser);
			const indexExpr = parseExpression(parser);
			if (!indexExpr) {
				if (!hasNewErrors(parser, numErrors)) {
					reportParserError(parser, "Expected an expression for an index here");
				}
				return undefined;
			}

			indexExprs.push(indexExpr);

			parseWhitespace(parser);
			if (compareAndAdvance(parser, ",")) {
				continue;
			}

			if (!compareAndAdvance(parser, "]")) {
				if (!hasNewErrors(parser, numErrors)) {
					reportParserError(parser, "Expected a closing ] here");
				}
				return undefined;
			}

			foundEnd = true;
			break
		}

		if (!foundEnd) {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "Expected to eventually find a closing ] ...");
			}
			return undefined;
		}

		parseWhitespace(parser);

		expr = {
			type:    Expression_Indexer,
			start:   expr.start,
			end:     parserPos(parser),
			indexes: indexExprs,
			target:  expr
		};
	}

	return expr;
}

export function getOpLevel(op: BinaryOperatorType): number {
	// The binary-expression tree has levels defined by operators.
	//
	// e.g: a + b + c * d * e + f
	//
	// The actuall tree is more like:
	//
	// a + b +           + f
	//         c * d * e
	//
	// Things at lower levels must be concatinated before things at higher levels.
	// The concept is the same as precedence, but it's easier to think about imo.

    switch (op) {
		case OP_NONE:            return 0; // Sole assignment

		case OP_LOGICAL_AND:     return 1;
		case OP_BITWISE_AND:     return 1;

		case OP_LOGICAL_OR:      return 2;
		case OP_BITWISE_OR:      return 2;
		case OP_LOGICAL_XOR:     return 2;
		case OP_BITWISE_XOR:     return 2;

		case OP_LESS_THAN:       return 3;
		case OP_LESS_THAN_EQ:    return 3;
		case OP_GREATER_THAN:    return 3;
		case OP_GREATER_THAN_EQ: return 3;
		case OP_EQ:              return 3;
		case OP_NOT_EQ:          return 3;

		case OP_ADD:             return 4;
		case OP_SUBTRACT:        return 4;

		case OP_MULTIPLY:        return 5;
		case OP_DIVIDE:          return 5;
		case OP_MODULO:          return 5;
    }

	return assertNever(op);
}

export function parseFunctionCall(parser: Parser, functionName: Identifier): FunctionCall | undefined {
	if (!compareAndAdvance(parser, "(")) return;

	const numErrors = getNumErrors(parser);

	const args: Expression[] = [];

	let foundClosingParen = false;
	while(true) {
		parseWhitespace(parser);
		if (currentChar(parser) === ")") {
			advance(parser);
			foundClosingParen = true;
			break;
		}

		const expr = parseExpression(parser);
		if (!expr) {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "expected an expression for this function argument");
			}
			return undefined;
		}

		args.push(expr);

		parseWhitespace(parser);
		if (currentChar(parser) !== "," && currentChar(parser) !== ")") {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "expected a , or a closing ) here");
			}
			return undefined;
		}

		if (currentChar(parser) === ",") {
			advance(parser);
			parseWhitespace(parser);
		}
	}

	if (!foundClosingParen) {
		if (!hasNewErrors(parser, numErrors)) {
			reportParserError(parser, "expected to find a closing ) eventually ...");
		}
		return undefined;
	}

	return {
		type: Expression_FunctionCall,
		start: functionName.start,
		end:  parserPos(parser),
		name: functionName,
		arguments: args,
	};
}

export function parseTypeInitializer(
	parser: Parser,
	identifier: Identifier,
	typeArgs: Expression[] | undefined
): TypeInitializer | undefined {
	if (currentChar(parser) !== "{") return;

	advance(parser);

	const numErrors = getNumErrors(parser);

	const args: Expression[] = [];

	while(true) {
		const expr = parseExpression(parser);
		if (expr) {
			args.push(expr);
			parseWhitespace(parser);
			if (currentChar(parser) === ",") {
				advance(parser);
			}
			continue;
		} 

		parseWhitespace(parser);
		if (currentChar(parser) !== "}") {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "expected to find a closing } here");
			}
			return undefined;
		}

		advance(parser);
		break;
	}

	return {
		type: Expression_TypeInitializer,
		start: identifier.start,
		end:   parserPos(parser),
		typename: identifier,
		args: args,
		typeArgs: typeArgs,
	};
}

export function parseTypeArgs(parser: Parser): Expression[] | undefined {
	if (currentChar(parser) !== "<") return;
	advance(parser);

	const numErrors = getNumErrors(parser);

	const args: Expression[] = [];

	while(true) {
		let typeExpr: Expression | undefined = parseIdentifier(parser);
		if (!typeExpr) {
			typeExpr = parseNumberLiteral(parser);
		}

		if (typeExpr) {
			args.push(typeExpr);
			parseWhitespace(parser);
			if (currentChar(parser) === ",") {
				advance(parser);
			}
			continue;
		}

		parseWhitespace(parser);
		if (currentChar(parser) !== ">") {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "expected to find a closing > here");
			}
			return undefined;
		}

		advance(parser);
		break;
	}

	return args;
}

export function parseNumberLiteral(parser: Parser): NumberLiteral | undefined {
    const pos = parserPos(parser);

    let isNegative = false;
    if (currentChar(parser) === "+") {
        advance(parser);
    } else if (currentChar(parser) === "-") {
        isNegative = true;
        advance(parser);
    }

    const intStart = parser.pos.i;
    while (isValidNumberPart(currentChar(parser)) && advance(parser)) {}

    const integerPart = parser.text.slice(intStart, parser.pos.i);

    const result: NumberLiteral = {
        type: Expression_NumberLiteral,
		start: pos,
		end:   parserPos(parser),
        integerPart,
        decimalPart: undefined,
        exponentPart: undefined,
        isNegative,
        val: 0,
    };

    if (
        currentChar(parser) === "."
        // Here specifically because we need to make sure numbers don't collide with ..< and ..<= operators
        && currentChar(parser, 1) !== "."
        && advance(parser)
    ) {
        const decimalPartStart = parser.pos.i;
        while (isValidNumberPart(currentChar(parser)) && advance(parser)) { }
        result.decimalPart = parser.text.slice(decimalPartStart, parser.pos.i);
        result.end = parserPos(parser);
    }

	if (result.integerPart === "" && result.decimalPart === undefined) {
		return undefined;
	}

    if (currentChar(parser) === "e" && advance(parser)) {
        const c = currentChar(parser);

		let exponentPartStart = parser.pos.i;
        if (c === "+" || c === "-") {
			if (c === "-") {
				exponentPartStart = parser.pos.i;
			} else {
				exponentPartStart = parser.pos.i + 1;
			}

            if (!advance(parser)) {
                return result;
            }
        }

        while (isValidNumberPart(currentChar(parser)) && advance(parser)) { }
        result.exponentPart = parser.text.slice(exponentPartStart, parser.pos.i);
        result.end = parserPos(parser);
    }

    result.val = computeNumberForNumberExpression(result);

    return result;
}

export function parseBooleanLiteral(parser: Parser, val: boolean): BooleanLiteral {
	const pos = parserPos(parser);
	
	if (val) {
		advanceBy(parser, "true".length);
	} else {
		advanceBy(parser, "false".length);
	}

    return {
        type: Expression_BooleanLiteral,
		start: pos,
		end:   parserPos(parser),
		val: val,
    };
}

export function computeNumberForNumberExpression(expr: NumberLiteral): number {
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

// TODO: This is a very basic string literal that could be vastly improved. current problems include:
// - opening a " connects directly to the start of another string. JavaScript ` has this problem as well, lmao.
// - I want the indentation in a string to be relative to the current indentation of the code, not to the
//      start of the line. Something like the Java """ strings would be good here
// - need some form of interpolation, since that is always nice to have.
export function parseStringLiteral(parser: Parser): StringLiteral | undefined {
	if (currentChar(parser) !== "\"") return;

    const startPos = parserPos(parser);

    let closed = false;
    while (!reachedEnd(parser)) {
        advance(parser);

        const c = currentChar(parser);
        if (c === "\\") {
            advance(parser);
        } else if (c === "\"") {
            closed = true;
            advance(parser);
            break;
        }
    }

    // There's a good chance we'll go off the edge of the document when 
    // we've opened up a string literal. It's best we just reset to the end of the
    // line we started on, so we can still parse the rest of the stuff correctly (hopefully);

    if (!closed) {
        parser.pos = startPos;
        advanceToNextNewLine(parser);
        return;
    }

    const result: StringLiteral = {
		type: Expression_StringLiteral,
        start: startPos,
        end: parserPos(parser),
        val: "",
    };

    const [val, error] = computeStringForStringLiteral(expressionToString(parser.text, result));
    if (val === undefined) {
		reportParserError(parser, error);
        return;
    }

    result.val = val;
    return result;
}

export function computeStringForStringLiteral(fullText: string): [string | undefined, string] {
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
                case "\"":
                    sb.push("\"");
                    break;
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

export function parseFunctionDefinition(parser: Parser): FunctionDefinition | undefined {
	const numErrors = getNumErrors(parser);

	parseWhitespace(parser);
	const pos = parserPos(parser);

	if (!compareAndAdvance(parser, "fn")) return;
	parseWhitespace(parser);

	const nameIdent = parseIdentifier(parser);

	if (!compareAndAdvance(parser, "(")) return;
	parseWhitespace(parser);

	const args: FunctionArgument[] = [];

	let foundClosingParen = false;
	while (true) {
		parseWhitespace(parser);
		if (currentChar(parser) === ")") {
			advance(parser);
			foundClosingParen = true;
			break;
		}

		const ident = parseIdentifier(parser);
		if (!ident) {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "All function arguments should be identifiers");
			}
			return undefined;
		}

		args.push({ name: ident });

		parseWhitespace(parser);
		if (currentChar(parser) !== "," && currentChar(parser) !== ")") {
			if (!hasNewErrors(parser, numErrors)) {
				reportParserError(parser, "Expected a , or ) here");
			}
			return undefined;
		}

		if (currentChar(parser) === ",") {
			advance(parser);
			parseWhitespace(parser);
		}
	}

	if (!foundClosingParen) {
		if (!hasNewErrors(parser, numErrors)) {
			reportParserError(parser, "Expected a ) here");
		}
		return undefined;
	}

	parseWhitespace(parser);
	const body = parseCodeBlock(parser);
	if (!body) {
		if (!hasNewErrors(parser, numErrors)) {
			reportParserError(parser, "Expected a { ... } code block here for this function definition");
		}
		return undefined;
	}

	return {
		type:  Expression_FunctionDefinition,
		start: pos,
		end:   parserPos(parser),
		name:  nameIdent,
		args:  args,
		body:  body,
	};
}

export function parseProgram(parser: Parser): Program {
	const program: Program = {
		code: parser.text,
		statements: [],
	};

	while (true) {
		const expr = parseExpression(parser);
		if (!expr) break;

		program.statements.push(expr);
	}

	return program;
}

export function parseProgramFromText(code: string) {
	const parser = newParser(code);
	return parseProgram(parser);
}

export function parseExpressionFromText(text: string) {
	const parser = newParser(text);
	return parseExpression(parser);
}

