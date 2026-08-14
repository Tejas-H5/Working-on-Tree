import { assert, assertNever } from "./assert";
import * as ast from "./ast";
import * as matrix from "./matrix";
import * as vector from "./vector";
import { newParser } from "./parser";
import { newTextPosition, TextPosition } from "./text-pos";
import { getNextRng, newRandomNumberGenerator, RandomNumberGenerator, setRngSeed } from "./random";
import { filterInPlace } from "./array-utils";

////////////////////////////////////////////////////
// Types

export const Result_Nothing  = 0; // Also represented with 'undefined'
// Maybe we want to think about the different types of numbers at some point. i32, i64, f32, f64. Right now we just inherit Javascript's numbers.
// If this was done in web assembly, we could do something better. Also if there was a way for everything to have value semantics, and explicit pointers, also great.
export const Result_Number   = 1;
export const Result_String   = 2;
export const Result_Boolean  = 3; // kinda pointless if you think about it. 0/nonzero also encodes this.
export const Result_Function = 4;
export const Result_List     = 5;
export const Result_Map      = 6;
// It's tempting to represent Vectors and Matrices with the same type underneath, 
// and even to use Tensors instead of limiting oneself to 2D matrices. 
// However, I have experienced in my previous attempt at writing this language, that 
// the code just gets super complicated, and the actual intent of the programmer gets lost 
// too, which makes it harder to visualise the results in a useful way.
export const Result_Vector   = 7; 
export const Result_Matrix   = 8;
// TODO: export const Result_Quaternion = 9;
export const Result_BuiltinFunction = 10;

export function resultTypeToString(type: ResultType) {
	switch(type) {
		case Result_Nothing:  return "Nothing";
		case Result_Number:   return "Number";
		case Result_String:   return "String";
		case Result_Boolean:  return "Boolean";
		case Result_Function: return "Function";
		case Result_BuiltinFunction:   return "Function (builtin)";
		case Result_List:     return "List";
		case Result_Map:      return "Map";
		case Result_Vector:   return "Vector";
		case Result_Matrix:   return "Matrix";
		default: assertNever(type);
	}
}

export type ResultType = Result["type"];

type ResultBase = { type: number; val: unknown; }

export type ResultNumber = ResultBase & {
	type: typeof Result_Number;
	val: number;
}

export type ResultString = ResultBase & {
	type: typeof Result_String;
	val: string;
}

export type ResultBoolean = ResultBase & {
	type: typeof Result_Boolean;
	val: boolean;
}

export type ResultFunction = ResultBase & {
	type: typeof Result_Function;
	val: ast.FunctionDefinition;
}

// Although I didn't realize it at the time, an implication of this decision, is that
// functions can lazily evaluate their expressions, or even evaluate them in a different order
// than what was passed in. This makes the language significantly different from other languages actually.
// There are probably ways to make use of this other than introspection that we should be thinking about.
export type BuiltinFn = (fn: ast.FunctionCall, iter: ProgramIterator) => ExprReturn;

export type ResultBuiltinFunction = ResultBase & {
	type: typeof Result_BuiltinFunction;
	val:  BuiltinFn;
}

export type ResultList = ResultBase & {
	type: typeof Result_List;
	val: Result[];
}


export type ValidMapKey = number | string | object | boolean;

export type ResultMap = ResultBase & {
	type: typeof Result_Map;
	val: Map<ValidMapKey, { key: Result, val: Result }>;
}

export type ResultNothing = ResultBase & {
	type: typeof Result_Nothing;
	val: undefined,
}

export type ResultVector = ResultBase & {
	type: typeof Result_Vector;
	val:  number[];
};

export type ResultMatrix = ResultBase & {
	type: typeof Result_Matrix;
	val: matrix.Matrix;
};

export type Result =
 | ResultNumber
 | ResultString
 | ResultBoolean
 | ResultFunction
 | ResultBuiltinFunction
 | ResultNothing
 | ResultList
 | ResultMap
 | ResultVector
 | ResultMatrix
 ;

// NOTE: a real clone will need to handle cyclic references.
// (not hard to code actually, but it's not as simple as you thought - the performance may or may not be crap)
export function cloneResultIfValueSemantics(src: Result): Result {
	switch(src.type) {
		case Result_Nothing:           return { type: src.type, val: src.val };
		case Result_Number:            return { type: src.type, val: src.val };
		case Result_String:            return { type: src.type, val: src.val };
		case Result_Boolean:           return { type: src.type, val: src.val };
		case Result_Function:          return { type: src.type, val: src.val };
		case Result_BuiltinFunction:   return { type: src.type, val: src.val };
		// These container types will actually have value semantics
		case Result_Vector:            return { type: src.type, val: src.val.map(x => x) };
		case Result_Matrix:            return { type: src.type, val: matrix.clone(src.val) };
		// Typical by-reference semantics
		case Result_List:              return { type: src.type, val: src.val };
		case Result_Map:			   return { type: src.type, val: src.val };
		default: assertNever(src);
	}
}

type ProgramError = {
	expr: ast.Expression | undefined;
	pos:  TextPosition;
	message: string;
};

export type ProgramIterator = {
	program: ast.Program;
	errors:  ProgramError[];

	nextStatementIdx: number;

	stack:  ast.Expression[];

	environmentVariables: Map<string, Result> | undefined;
	scopes: Scope[];

	lastResult: {
		result: Result;
		error: {
			message: string;
			expr:    ast.Expression;
		} | undefined;
	};

	rng: RandomNumberGenerator;

	// Outputs
	printOutputs: string[];
	dataOutputs:  DataOutput[];

	drawParams: {
		viewWidth:  number;
		viewHeight: number;
	};
	drawCalls: DrawCall[];
	mvpMatrix: matrix.Matrix;
	tempMatrix: matrix.Matrix;
	tempMatrix2: matrix.Matrix;
}

export type RelationOutput = {
	fn: ResultFunction;
	viewStart: vector.Vec3;
	viewSize: number;
};

export type LogOutput = {
	expr:   ast.Expression;
	text:   string;
	result: Result;
}

export type Color = {
	r: number;
	g: number;
	b: number;
	a: number;
}

function cloneColor(c: Color): Color {
	return {
		r: c.r,
		g: c.g,
		b: c.b,
		a: c.a,
	};
}

export const DrawCall_Line       = 0;
export const DrawCall_Circle     = 1;
export const DrawCall_Square     = 2;
export const DrawCall_Rectangle  = 3;
export const DrawCall_Background = 4;
export const DrawCall_Label      = 5;
export const DrawCall_SetColor    = 6;
export const DrawCall_SetFontSize = 7;

export type DrawCallBase = {
	type:  number;
}

export type DrawLine = DrawCallBase & {
	type: typeof DrawCall_Line;
	p0:   vector.Vec3;
	p1:   vector.Vec3;
	thickness: number;
};

export type DrawCircle = DrawCallBase & {
	type: typeof DrawCall_Circle;
	p0:     vector.Vec3;
	radius: number;
};

export type DrawSquare = DrawCallBase & {
	type: typeof DrawCall_Square;
	p0:     vector.Vec3;
	radius: number;
};

export type DrawRectangle = DrawCallBase & {
	type: typeof DrawCall_Rectangle;
	p0: vector.Vec3;
	p1: vector.Vec3;
};

export type DrawLabel = DrawCallBase & {
	type: typeof DrawCall_Label;
	p0:        vector.Vec3;
	text:      string;
	size:      number;
	rotation:  number;
	direction: vector.Vec3;
};

export type DrawSetColor = DrawCallBase & {
	type: typeof DrawCall_SetColor;
	color: Color;
}

export type DrawSetFontSize = DrawCallBase & {
	type: typeof DrawCall_SetFontSize;
	size: number;
};

export type DrawBackground = DrawCallBase & {
	type: typeof DrawCall_Background;
};

export type DrawCall = 
 | DrawLine
 | DrawCircle
 | DrawSquare
 | DrawRectangle
 | DrawLabel
 | DrawBackground
 | DrawSetColor
 | DrawSetFontSize
 ;

// Our best attempt at modeling data itself.
// Trying my best to not complect the visualisation of the data with the data - hence, no 
// mention of histograms, time series, point clouds, etc.
export type DataOutput = {
	title: string;
	axes: DataOutputAxis[];
	type: DataVisualiserType;
}

export const DataVisualiserType_Table       = 0;
export const DataVisualiserType_Point       = 1;
export const DataVisualiserType_Line        = 2;
export const DataVisualiserType_Histogram   = 3;
export const DataVisualiserType_Point3d     = 4;
export const DataVisualiserType_Line3d      = 5;
export const DataVisualiserType_Histogram3d = 6;

export type DataVisualiserType =
 | typeof DataVisualiserType_Table
 | typeof DataVisualiserType_Point
 | typeof DataVisualiserType_Line
 | typeof DataVisualiserType_Point3d
 | typeof DataVisualiserType_Line3d
 | typeof DataVisualiserType_Histogram
 | typeof DataVisualiserType_Histogram3d
 ;

export type DataOutputAxis = {
	name:     string;
	init:     boolean;
	numbers:  number[]; 
	// if present, numbers will be integers into the labels array. 
	// There's a compression opportunity here but we're not taking advantage of it yet.
	labels?:  string[]; 
}

export type Scope = {
	vars: Map<string, Result>;
	flags: number;
}

export const SCOPE_ALLOW_CONTINUE_BREAK = 1 << 0;
export const SCOPE_ISOLATED             = 1 << 1;
export const SCOPE_HIDDEN               = 1 << 2; 
export const SCOPE_NON_ISOLATED_FLAGS = SCOPE_ALLOW_CONTINUE_BREAK;

export function newProgramIterator(program: ast.Program, environment?: Map<string, Result>): ProgramIterator {
	const iter: ProgramIterator = {
		program: program,
		errors:  [],

		nextStatementIdx: 0,

		stack:  [],

		environmentVariables: environment,
		scopes: [],

		lastResult: {
			result: NOTHING,
			error:  undefined,
		},

		rng: newRandomNumberGenerator(),

		printOutputs:      [],
		dataOutputs: [],

		drawParams: {
			viewWidth:  0,
			viewHeight: 0,
		},
		drawCalls: [],

		mvpMatrix:  matrix.create(4, 4),
		tempMatrix: matrix.create(4, 4),
		tempMatrix2: matrix.create(4, 4),
	};
	// The root scope will never get popped.
	pushScope(iter, 0); 
	return iter;

}

export function pushScope(iter: ProgramIterator, flags: number): Scope {
	const scope: Scope = {
		vars: new Map(),
		flags: flags,
	};
	iter.scopes.push(scope);
	return scope;
}

export function currentScopeNonIsolatedFlags(iter: ProgramIterator): number {
	if (iter.scopes.length === 0) return 0;
	return iter.scopes[iter.scopes.length - 1].flags & SCOPE_NON_ISOLATED_FLAGS;
}

export function getCurrentScope(iter: ProgramIterator): Scope {
	assert(iter.scopes.length > 0);
	return iter.scopes[iter.scopes.length - 1];
}

export function popScope(iter: ProgramIterator) {
	return iter.scopes.pop();
}

export function getVar(iter: ProgramIterator, name: string): Result | undefined {
	const builtin = getBuiltin(name);
	if (builtin) {
		return builtin;
	}

	if (iter.environmentVariables !== undefined) {
		const dynamicBuiltin = iter.environmentVariables.get(name);
		if (dynamicBuiltin !== undefined) {
			return dynamicBuiltin;
		}
	}

	if (iter.scopes.length === 0) return undefined;

	for (let i = iter.scopes.length - 1; i > 0; i--) {
		const scope = iter.scopes[i];
		if (scope.flags & SCOPE_HIDDEN) {
			continue;
		}

		const value = scope.vars.get(name)
		if (value) {
			return value;
		}

		if (scope.flags & SCOPE_ISOLATED) {
			break;
		}
	}

	// Also search the global scope - it's available to every other scope
	{
		const value = iter.scopes[0].vars.get(name);
		if (value) {
			return value;
		}
	}

	return undefined;
}

export function forEachReachableScope(iter: ProgramIterator, fn: (scope: Scope) => void): void {
	if (iter.scopes.length === 0) return;

	for (let i = iter.scopes.length - 1; i > 0; i--) {
		const scope = iter.scopes[i];
		if (scope.flags & SCOPE_HIDDEN) {
			continue;
		}

		fn(scope);

		if (scope.flags & SCOPE_ISOLATED) {
			break;
		}
	}

	fn(iter.scopes[0])
}

export function setOrCreateVar(iter: ProgramIterator, name: string, val: Result) {
	if (iter.scopes.length === 0) return;

	let scopeToUse: Scope | undefined;
	for (let i = iter.scopes.length - 1; i >= 0; i--) {
		const scope = iter.scopes[i];
		if (scope.flags & SCOPE_HIDDEN) {
			continue;
		}

		if (scope.vars.has(name)) {
			scopeToUse = scope;
			break;
		}

		if (scope.flags & SCOPE_ISOLATED) {
			break;
		}
	}

	if (!scopeToUse) {
		scopeToUse = iter.scopes[iter.scopes.length - 1];
	}

	scopeToUse.vars.set(name, val);
}

export function createVar(
	iter: ProgramIterator,
	name: string,
	val: Result,
	conflictMessage: string,
	conflictExpr: ast.Expression,
): ExprReturn {
	const scope = getCurrentScope(iter);

	if (scope.vars.has(name)) {
		return setError(iter, conflictExpr, conflictMessage);
	}

	scope.vars.set(name, val);
	return RETURN_NONE;
}


// NOTE: compared by reference. You can't just construct the same object and expect it to work
export const NOTHING:  ResultNothing = { type: Result_Nothing, val: undefined }
export const BREAK:    ResultNothing = { type: Result_Nothing, val: undefined }
export const CONTINUE: ResultNothing = { type: Result_Nothing, val: undefined }

export const RETURN_NONE   = 0;
export const RETURN_RESULT = 1;
export const RETURN_ERROR  = 2;

export type ExprReturn = 
 | typeof RETURN_NONE
 | typeof RETURN_RESULT
 | typeof RETURN_ERROR
 ;

////////////////////////////////////////////////////
// Main functionality

export function interpretProgram(program: ast.Program, iter: ProgramIterator) {
	setRngSeed(iter.rng, 0);

	try {
		evaluateExpressionBlock(program.statements, iter);
	} catch(e) {
		iter.errors.push({
			message: "Unhandled error while interpreting the code: " + e,
			pos: newTextPosition(0, 0, 0 ,0),
			expr: undefined,
		});
	}

	assert(iter.scopes.length === 1);

	// Don't send down plots with 0 axes ever.
	filterInPlace(iter.dataOutputs, d => d.axes.length > 0);

	if (iter.lastResult.error) {
		iter.errors.push({
			expr:    iter.lastResult.error.expr,
			pos:     iter.lastResult.error.expr.start,
			message: iter.lastResult.error.message,
		});
	}
}

export function interpretCode(code: string, environment?: Map<string, Result>): ProgramIterator {
	const parser = newParser(code);
	const program = ast.parseProgram(parser);

	const result = newProgramIterator(program, environment);

	if (parser.errors.length > 0) {
		for (const err of parser.errors) {
			result.errors.push({
				pos:     err.pos,
				message: err.message,
				expr:    undefined,
			});
		}
		return result;
	} 

	interpretProgram(program, result);

	return result;
}

export function interpretCodeLines(lines: string[]): ProgramIterator {
	return interpretCode(lines.join("\n"))
}

export function setError(iter: ProgramIterator, expr: ast.Expression, reason: string): typeof RETURN_ERROR {
	iter.lastResult.error = {
		message: reason,
		expr: expr,
	};
	return RETURN_ERROR;
}

export function setResultNumber(iter: ProgramIterator, val: number): typeof RETURN_NONE {
	iter.lastResult.result = newNumber(val);
	return RETURN_NONE;
}

export function setResultBoolean(iter: ProgramIterator, val: boolean): typeof RETURN_NONE {
	iter.lastResult.result = newBoolean(val);
	return RETURN_NONE;
}

export function setResultString(iter: ProgramIterator, val: string): typeof RETURN_NONE {
	iter.lastResult.result = newString(val);
	return RETURN_NONE;
}

export function setResult(iter: ProgramIterator, val: Result): typeof RETURN_NONE {
	iter.lastResult.result = val;
	return RETURN_NONE;
}

export function setReturnResult(iter: ProgramIterator, val: Result): typeof RETURN_RESULT {
	iter.lastResult.result = val;
	return RETURN_RESULT;
}

export function newNumber(val: number): ResultNumber {
	return {type: Result_Number, val: val,};
}

export function newBoolean(val: boolean): ResultBoolean {
	return {type: Result_Boolean, val:  val,};
}

export function newString(val: string): ResultString {
	return {type: Result_String, val:  val,};
}

export function invalidOperatorError(opType: ast.BinaryOperatorType, lhs: Result, rhs: Result): string {
	return `${ast.operatorToString(opType)} is not valid for ${resultTypeToString(lhs.type)} with ${resultTypeToString(rhs.type)}`;
}

// TODO: Don't end up with this - we need an alternative formulation that lets us step through the program.
// It doesn't need to be an elaborate VM like last time - a simple control-flow graph is fine.
export function evaluateExpression(expr: ast.Expression, iter: ProgramIterator, canAssign = false): ExprReturn {
	switch (expr.type) {
		case ast.Expression_Identifier:         return evaluateIdentifier(expr, iter);
		case ast.Expression_Indexer:            return evaluateIndexer(expr, iter);
		case ast.Expression_BinaryExpression:   return evaluateBinaryOperation(expr, iter, canAssign);
		case ast.Expression_UnaryExpression:    return evaluateUnaryOperation(expr, iter);
		case ast.Expression_FunctionCall:       return evaluateFunctionCall(expr, iter);
		case ast.Expression_IfChain:            return evaluateIfChain(expr, iter); 
		case ast.Expression_ForLoop:            return evaluateForLoop(expr, iter);
		case ast.Expression_TypeInitializer:    return evaluateTypeInitializer(expr, iter);
		case ast.Expression_NumberLiteral:      return setResultNumber(iter, expr.val);
		case ast.Expression_StringLiteral:      return setResultString(iter, expr.val);
		case ast.Expression_BooleanLiteral:     return setResultBoolean(iter, expr.val);
		case ast.Expression_FunctionDefinition: {
			const fn: ResultFunction = { type: Result_Function, val: expr };
			if (expr.name) {
				if (createVar(iter, expr.name.name, fn, "A value with this name already exists", expr.name) === RETURN_ERROR) {
					return RETURN_ERROR;
				}
			}

			return setResult(iter, fn);
		} break;
		case ast.Expression_Return: {
			if (!expr.expr)                                           return setResult(iter, NOTHING);
			if (evaluateExpression(expr.expr, iter) === RETURN_ERROR) return RETURN_ERROR;
			return RETURN_RESULT;
		}
		case ast.Expression_ReturnBlock: {
			let result;
			pushScope(iter, 0); {
				result = evaluateExpressionBlock(expr.block, iter);
			} popScope(iter);
			return result;
		}
		case ast.Expression_ForLoopRange: return setError(iter, expr, "Can't use a for-loop range outside of a for-loop.");
		case ast.Expression_Continue:     return setError(iter, expr, "continue can only be evaluated as a block-level statement");
		case ast.Expression_Break:        return setError(iter, expr, "break can only be evaluated as a block-level statement");
		default: {
			assertNever(expr);
		} break;
	}
}

export function evaluateExpressionValue(expr: ast.Expression, iter: ProgramIterator): Result | undefined {
	const rt = evaluateExpression(expr, iter);
	if (rt === RETURN_ERROR) return undefined;
	return iter.lastResult.result;
}

export function evaluateCode(code: string, iter: ProgramIterator): [Result, string | undefined] {
	const expr = ast.parseExpressionFromText(code);
	if (!expr) return [NOTHING, "Couldn't parse the expression"];
	
	evaluateExpression(expr, iter, true);
	return [iter.lastResult.result, iter.lastResult.error?.message];
}

export function evaluateFunctionCall(fn: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	let rt: ExprReturn = RETURN_NONE;

	// Needs to be hidden. When we create new variables in this scope
	pushScope(iter, SCOPE_HIDDEN); {
		rt = evaluateFunctionCallInternal(fn, iter);
	} popScope(iter);

	return rt;
}

function evaluateFunctionCallInternal(fn: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	const functionName = fn.name.name;
	const userFn = getVar(iter, functionName);
	if (!userFn) {
		let error = `Couldn't find function ${functionName} in this scope`;
		error += getSuggestedSymbolsMessage(iter, functionName, false);

		return setError(iter, fn, error);
	}

	if (userFn.type === Result_BuiltinFunction) {
		return userFn.val(fn, iter);
	} 

	if (userFn.type === Result_Function) {
		const wantedNumArgs = userFn.val.args.length;
		const gotNumArgs    = fn.arguments.length;
		if (wantedNumArgs !== gotNumArgs) {
			return setError(iter, fn, `Wanted ${wantedNumArgs} arguments for function ${fn.name.name}, got ${gotNumArgs} arguments instead`);
		}

		for (let i = 0; i < userFn.val.args.length; i++) {
			const argName = userFn.val.args[i].name.name;

			// TODO: argument types, type validation

			const argExpr = fn.arguments[i];
			const argResult = evaluateExpressionValue(argExpr, iter); // We allow passing "nothing" into functions. Might change my mind later idk
			if (!argResult) return RETURN_ERROR;
			if (createVar(iter, argName, argResult, "An argument with this name already exists", argExpr) === RETURN_ERROR) {
				return RETURN_ERROR;
			}
		}

		// We only set the isolation flag on the current scope _now_ - we needed to read from the parent scope in order to 
		// populate the current scope. But the function call itself should have an isolated scope. 
		const scope = getCurrentScope(iter);
		scope.flags = scope.flags | SCOPE_ISOLATED;
		scope.flags = scope.flags & ~SCOPE_HIDDEN;

		if (evaluateExpressionBlock(userFn.val.body, iter) === RETURN_ERROR) return RETURN_ERROR;
		return RETURN_NONE;
	}

	
	return setError(iter, fn.name, "Value was not a function - it was a " + resultTypeToString(userFn.type));
}

function evaluateExpressionBlock(block: ast.Expression[], iter: ProgramIterator): ExprReturn {
	const scope = getCurrentScope(iter);

	for (const expr of block) {
		if (expr.type === ast.Expression_Break) {
			if ((scope.flags & SCOPE_ALLOW_CONTINUE_BREAK) === 0) {
				return setError(iter, expr, "break not allowed outside of a loop");
			}
			setResult(iter, BREAK);
			return RETURN_RESULT;
		}
		if (expr.type === ast.Expression_Continue) {
			if ((scope.flags & SCOPE_ALLOW_CONTINUE_BREAK) === 0) {
				return setError(iter, expr, "continue not allowed outside of a loop");
			}
			setResult(iter, CONTINUE);
			return RETURN_RESULT;
		}

		const rt = evaluateExpression(expr, iter, true);
		if (rt !== RETURN_NONE) return rt;
	}

	return setResult(iter, NOTHING);
}


function evaluateIfChain(expr: ast.IfChain, iter: ProgramIterator): ExprReturn {
	if (expr.blocks.length === 0) return setError(iter, expr, "If chain was empty");

	let rt: ExprReturn = RETURN_NONE;

	pushScope(iter, currentScopeNonIsolatedFlags(iter)); {
		rt = evaluateIfChainInternal(expr, iter);
	} popScope(iter);

	return rt;
}

function evaluateIfChainInternal(expr: ast.IfChain, iter: ProgramIterator): ExprReturn {
	for (const branch of expr.blocks) {
		const val = evaluateExpressionValue(branch.check, iter);
		if (!val)                        return RETURN_ERROR;
		if (val.type !== Result_Boolean) {
			// This is good actually.
			return setError(iter, branch.check, "If check needs to be a boolean");
		}
		if (val.val === true) {
			return evaluateExpressionBlock(branch.block, iter); 
		}
	}

	if (expr.else) {
		return evaluateExpressionBlock(expr.else, iter);
	}

	return RETURN_NONE;
}

export function evaluateBinaryOperation(expr: ast.BinaryExpression, iter: ProgramIterator, canAssign = false): ExprReturn {
	let result; 

	if (expr.op.type !== ast.OP_NONE) {
		// TODO: test - evaluation must be left -> right
		const lhsVal = evaluateExpressionValue(expr.lhs, iter);
		if (!lhsVal) return RETURN_ERROR;

		let rhsVal = evaluateExpressionValue(expr.rhs, iter);
		if (!rhsVal) return RETURN_ERROR;

		if (evaluateBinaryOperationOnResults(expr, lhsVal, expr.op.type, rhsVal, iter) === RETURN_ERROR) return RETURN_ERROR;
		result = iter.lastResult.result;
		if (!result) return RETURN_ERROR;
	} else {
		result = evaluateExpressionValue(expr.rhs, iter);
		if (!result) return RETURN_ERROR;
	}

	if (expr.op.assignment) {
		if (canAssign === false) {
			return setError(iter, expr, "Can't assign to things in this context");
		}

		return evaluateAssignment(expr, iter, result);
	} 

	return RETURN_NONE;
}

export function evaluateUnaryOperation(expr: ast.UnaryExpression, iter: ProgramIterator): ExprReturn { 
	const exprResult = evaluateExpressionValue(expr.expr, iter);
	if (!exprResult) return RETURN_ERROR;

	if (exprResult.type === Result_Boolean) {
		switch (expr.op) {
			case ast.UNARY_OP_NOT: return setResultBoolean(iter, !exprResult.val);
			default: return unaryOperatorCantBeAppliedError(iter, expr, exprResult);
		}
	} 

	if (exprResult.type === Result_Number) {
		switch (expr.op) {
			case ast.UNARY_OP_NOT:         return setResultNumber(iter, exprResult.val ? 0 : 1);
			case ast.UNARY_OP_BITWISE_NOT: return setResultNumber(iter, ~exprResult.val);
			default: return unaryOperatorCantBeAppliedError(iter, expr, exprResult);
		}
	}

	if (exprResult.type === Result_Vector) {
		const result: ResultVector = {
			type: Result_Vector,
			val: exprResult.val.map(x => x),
		};

		switch (expr.op) {
			case ast.UNARY_OP_NOT:         { for (let i = 0; i < result.val.length; i++) { result.val[i] = result.val[i] ? 0 : 1; } } break;
			case ast.UNARY_OP_BITWISE_NOT: { for (let i = 0; i < result.val.length; i++) { result.val[i] = ~result.val[i]; } } break;
			default: return unaryOperatorCantBeAppliedError(iter, expr, result);
		}

		return setResult(iter, result);
	}

	if (exprResult.type === Result_Matrix) {
		const result: ResultMatrix = {
			type: Result_Matrix,
			val:  matrix.clone(exprResult.val),
		};

		switch (expr.op) {
			case ast.UNARY_OP_NOT:         { for (let i = 0; i < result.val.data.length; i++) { result.val.data[i] = result.val.data[i] ? 0 : 1; } } break;
			case ast.UNARY_OP_BITWISE_NOT: { for (let i = 0; i < result.val.data.length; i++) { result.val.data[i] = ~result.val.data[i]; } } break;
			default: return unaryOperatorCantBeAppliedError(iter, expr, result);
		}

		return setResult(iter, result);
	}

	return unaryOperatorCantBeAppliedError(iter, expr, exprResult);
}

function unaryOperatorCantBeAppliedError(iter: ProgramIterator, expr: ast.UnaryExpression, result: Result): ExprReturn {
	return setError(
		iter,
		expr,
		`Couldn't apply unary operator ${ast.unaryOperatorToString(expr.op)} to type ${resultTypeToString(result.type)}`
	);
}

export type IndexableResult =
 | ResultString
 | ResultList
 | ResultMap
 | ResultVector
 | ResultMatrix
 ; 

function asIndexableResult(result: Result): IndexableResult | undefined {
	switch (result.type) {
		case Result_String: return result;
		case Result_List:   return result;
		case Result_Map:    return result;
		case Result_Vector: return result;
		case Result_Matrix: return result;
	}
	return undefined;
}

export function evaluateAssignment(expr: ast.BinaryExpression, iter: ProgramIterator, value: Result): ExprReturn {
	value = cloneResultIfValueSemantics(value);

	if (expr.lhs.type === ast.Expression_Identifier) {
		setOrCreateVar(iter, expr.lhs.name, value);
		// Setting a variable means that it won't get returned. 
		// This is actually one of the main semantics of the language.
		// But I dont really want rust style naked returns though.
		return RETURN_NONE;
	}

	if (expr.lhs.type === ast.Expression_Indexer) {
		const targetResult = evaluateExpressionValue(expr.lhs.target, iter);
		if (!targetResult) return RETURN_ERROR;

		const target = asIndexableResult(targetResult);
		if (!target) {
			return setError(iter, expr.lhs.target, "Expression can't be indexed: " + ast.expressionToString(iter.program.code, expr.lhs.target));
		}

		switch(target.type) {
			case Result_String: return setError(iter, expr.lhs.target, "Strings are immutable, and individual characters can't be assigned to.");
			case Result_List: {
				const index = evaluateExpressionValue(expr.lhs.indexes[0], iter);
				if (!index) return RETURN_ERROR;
		
				if (index.type !== Result_Number)                    return setError(iter, expr.lhs.indexes[0], "List index should be a number");
				if (index.val < 0 || index.val >= target.val.length) return setError(iter, expr.lhs.indexes[0], `Index [${index.val}] out-of-bounds (${target.val.length})`);
				target.val[index.val] = target;
			} break;
			case Result_Map: {
				const index = evaluateExpressionValue(expr.lhs.indexes[0], iter);
				if (!index) return RETURN_ERROR;

				setMapKey(iter, target, index, expr.lhs.indexes[0], value);
			} break;
			case Result_Vector: {
				const index = evaluateExpressionValue(expr.lhs.indexes[0], iter);
				if (!index) return RETURN_ERROR;

				if (index.type !== Result_Number)                    return setError(iter, expr.lhs.indexes[0], "Vector index should be a number");
				if (value.type !== Result_Number)                    return setError(iter, expr.lhs.indexes[0], "Vector values should be numbers");
				if (index.val < 0 || index.val >= target.val.length) return setError(iter, expr.lhs.indexes[0], `Index [${index.val}] out-of-bounds (${target.val.length})`);
				target.val[index.val] = value.val;
			} break;
			case Result_Matrix: {
				if (expr.lhs.indexes.length === 1) {
					if (value.type !== Result_Vector)         return setError(iter, expr.rhs, "Only vectors can be asigned to a column in a matrix");
					if (value.val.length !== target.val.rows) return setError(iter, expr.lhs.indexes[0], `Vector length ${value.val.length} was not equal to the height (${target.val.rows}) of the matrix`);

					const index = evaluateExpressionValue(expr.lhs.indexes[0], iter);
					if (!index)                                        return RETURN_ERROR;
					if (index.type !== Result_Number)                  return setError(iter, expr.lhs.indexes[0], "Matrix index should be a number");
					if (index.val < 0 || index.val >= target.val.cols) return setError(iter, expr.lhs.indexes[0], `Index [${index.val}] out-of-bounds (${target.val.cols} cols)`);

					matrix.setAxis(target.val, index.val, value.val);
				} else if (expr.lhs.indexes.length === 2) {
					if (value.type !== Result_Number) return setError(iter, expr.rhs, "Matrix values should be numbers");

					const row = evaluateExpressionValue(expr.lhs.indexes[0], iter);
					if (!row) return RETURN_ERROR;
					if (row.type !== Result_Number) return setError(iter, expr.lhs.indexes[0], "Matrix row should be a number");
					if (row.val < 0 || row.val >= target.val.rows) return setError(iter, expr.lhs.indexes[0], `Index [${row.val}] out-of-bounds (${target.val.rows} rows)`);

					const col = evaluateExpressionValue(expr.lhs.indexes[1], iter);
					if (!col) return RETURN_ERROR;
					if (col.type !== Result_Number) return setError(iter, expr.lhs.indexes[1], "Matrix column should be a number");
					if (col.val < 0 || col.val >= target.val.cols) return setError(iter, expr.lhs.indexes[0], `Index [${col.val}] out-of-bounds (${target.val.cols} rows)`);

					const idx = matrix.getIndex(target.val, row.val, col.val);
					target.val.data[idx] = value.val;
				} else {
					return setError(iter, expr.lhs, "Too many index expressions for this matrix, just do [columnIdx] or [rowIdx, colIdx]");
				}
			} break;

			default: assertNever(target);
		}

		return RETURN_NONE;
	}

	return setError(iter, expr.rhs, `Can't assign to ${ast.expressionToString(iter.program.code, expr.lhs)}`);
}

export function evaluateBinaryOperationOnResults(expr: ast.BinaryExpression, lhs: Result, exprOp: ast.BinaryOperatorType, rhs: Result, iter: ProgramIterator): ExprReturn{
	if (lhs.type === Result_Number && rhs.type === Result_Number) {
		switch (exprOp) {
			case ast.OP_ADD:             return setResultNumber(iter, lhs.val + rhs.val);
			case ast.OP_SUBTRACT:        return setResultNumber(iter, lhs.val - rhs.val);
			case ast.OP_MULTIPLY:        return setResultNumber(iter, lhs.val * rhs.val);
			case ast.OP_DIVIDE:          return setResultNumber(iter, lhs.val / rhs.val);
			case ast.OP_MODULO:          return setResultNumber(iter, lhs.val % rhs.val);
			case ast.OP_BITWISE_AND:     return setResultNumber(iter, lhs.val & rhs.val);
			case ast.OP_BITWISE_OR:      return setResultNumber(iter, lhs.val | rhs.val);
			case ast.OP_BITWISE_XOR:     return setResultNumber(iter, lhs.val ^ rhs.val);
			case ast.OP_LESS_THAN:       return setResultBoolean(iter, lhs.val < rhs.val);
			case ast.OP_LESS_THAN_EQ:    return setResultBoolean(iter, lhs.val <= rhs.val);
			case ast.OP_GREATER_THAN:    return setResultBoolean(iter, lhs.val > rhs.val);
			case ast.OP_GREATER_THAN_EQ: return setResultBoolean(iter, lhs.val >= rhs.val);
			case ast.OP_EQ:              return setResultBoolean(iter, lhs.val === rhs.val);
			case ast.OP_NOT_EQ:          return setResultBoolean(iter, lhs.val !== rhs.val);
			default:                     return setError(iter, expr, invalidOperatorError(exprOp, lhs, rhs));
		}
	}

	if (lhs.type === Result_Boolean && rhs.type === Result_Boolean) {
		switch (exprOp) {
			case ast.OP_LOGICAL_AND: return setResultBoolean(iter, lhs.val && rhs.val);
			case ast.OP_LOGICAL_OR:  return setResultBoolean(iter, lhs.val || rhs.val);
			case ast.OP_LOGICAL_XOR: return setResultBoolean(iter, lhs.val != rhs.val);
			case ast.OP_EQ:          return setResultBoolean(iter, lhs.val === rhs.val);
			case ast.OP_NOT_EQ:      return setResultBoolean(iter, lhs.val !== rhs.val);
			default:                 return setError(iter, expr, invalidOperatorError(exprOp, lhs, rhs));
		}
	}

	if (lhs.type === Result_String && rhs.type === Result_String) {
		switch (exprOp) {
			case ast.OP_ADD:     return setResultString(iter, lhs.val + rhs.val);
			case ast.OP_EQ:      return setResultBoolean(iter, lhs.val === rhs.val);
			case ast.OP_NOT_EQ:  return setResultBoolean(iter, lhs.val !== rhs.val);
			default:             return setError(iter, expr, invalidOperatorError(exprOp, lhs, rhs));
		}
	}

	// IMO: number * vector - allowed. vector * number - less readable/intuitive, so not allowed. Same for matrices.
	{
		if (lhs.type === Result_Number && rhs.type === Result_Vector) {
			const result: Result = { type: Result_Vector, val: Array(rhs.val.length).fill(0) };

			switch (exprOp) {
				case ast.OP_MULTIPLY:        { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val * rhs.val[i]; } } break;
				default: return setError(iter, expr, invalidOperatorError(exprOp, lhs, rhs));
			}

			return setResult(iter, result);
		}

		if (lhs.type === Result_Number && rhs.type === Result_Matrix) {
			const result: Result = { type: Result_Matrix, val: matrix.create(rhs.val.rows, rhs.val.cols), };

			switch (exprOp) {
				case ast.OP_MULTIPLY:        { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val * rhs.val.data[i]; } } break;
				default: return setError(iter, expr, invalidOperatorError(exprOp, lhs, rhs));
			}

			return setResult(iter, result);
		}
	}

	// Similarly, vector / number - allowed. number / vector - less readable/intuitive, so not allowed. Same for matrices.
	{
		if (lhs.type === Result_Vector && rhs.type === Result_Number) {
			const result: Result = { type: Result_Vector, val: Array(lhs.val.length).fill(0) };

			switch (exprOp) {
				case ast.OP_DIVIDE:        { for (let i = 0; i < lhs.val.length; i++) { result.val[i] = lhs.val[i] / rhs.val; } } break;
				default: return setError(iter, expr, invalidOperatorError(exprOp, lhs, rhs));
			}

			return setResult(iter, result);
		}

		if (lhs.type === Result_Matrix && rhs.type === Result_Number) {
			const result: Result = { type: Result_Matrix, val: matrix.create(lhs.val.rows, lhs.val.cols), };

			switch (exprOp) {
				case ast.OP_DIVIDE:        { for (let i = 0; i < lhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] / rhs.val; } } break;
				default: return setError(iter, expr, invalidOperatorError(exprOp, lhs, rhs));
			}

			return setResult(iter, result);
		}
	}

	if (lhs.type === Result_Vector && rhs.type === Result_Vector) {
		if (rhs.val.length !== lhs.val.length) {
			return setError(iter, expr, `Vectors did not have the same sizes (${rhs.val.length} and ${lhs.val.length})`);
		}

		const result: Result = {
			type: Result_Vector,
			val: Array(rhs.val.length).fill(0)
		};

		switch (exprOp) {
			case ast.OP_ADD:             { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] +   rhs.val[i]; } } break;
			case ast.OP_SUBTRACT:        { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] -   rhs.val[i]; } } break;
			case ast.OP_MODULO:          { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] %   rhs.val[i]; } } break;
			case ast.OP_MULTIPLY:        { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] *   rhs.val[i]; } } break;
			case ast.OP_DIVIDE:          { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] /   rhs.val[i]; } } break;
			case ast.OP_LOGICAL_AND:     { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = (!!(lhs.val[i]) &&  (!!rhs.val[i])) ? 1 : 0} } break;
			case ast.OP_LOGICAL_OR:      { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = (!!(lhs.val[i]) &&  (!!rhs.val[i])) ? 1 : 0} } break;
			case ast.OP_LOGICAL_XOR:     { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = (!!(lhs.val[i]) !== (!!rhs.val[i])) ? 1 : 0} } break;
			case ast.OP_BITWISE_AND:     { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] & rhs.val[i] } } break;
			case ast.OP_BITWISE_OR:      { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] | rhs.val[i] } } break;
			case ast.OP_BITWISE_XOR:     { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] ^ rhs.val[i] } } break;
			case ast.OP_LESS_THAN:       { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] <   rhs.val[i] ? 1 : 0; } } break;
			case ast.OP_LESS_THAN_EQ:    { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] <=  rhs.val[i] ? 1 : 0; } } break;
			case ast.OP_GREATER_THAN:    { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] >   rhs.val[i] ? 1 : 0; } } break;
			case ast.OP_GREATER_THAN_EQ: { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] >=  rhs.val[i] ? 1 : 0; } } break;
			case ast.OP_EQ:              { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] === rhs.val[i] ? 1 : 0; } } break;
			case ast.OP_NOT_EQ:          { for (let i = 0; i < rhs.val.length; i++) { result.val[i] = lhs.val[i] !== rhs.val[i] ? 1 : 0; } } break;
			default: return setError(iter, expr, invalidOperatorError(exprOp, lhs, rhs));
		}

		return setResult(iter, result);
	}

	if (lhs.type === Result_Matrix && rhs.type === Result_Matrix) {
		if (rhs.val.rows !== lhs.val.rows) return setError(iter, expr, `Matrices did not have the same row count`);
		if (rhs.val.cols !== lhs.val.cols) return setError(iter, expr, `Matrices did not have the same column count`);

		const result: Result = {
			type: Result_Matrix,
			val: {
				rows: rhs.val.rows,
				cols: rhs.val.cols,
				data: Array(rhs.val.data.length).fill(0)
			}
		};

		switch (exprOp) {
			case ast.OP_ADD:             { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] +   rhs.val.data[i]; } } break;
			case ast.OP_SUBTRACT:        { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] -   rhs.val.data[i]; } } break;
			case ast.OP_MODULO:          { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] %   rhs.val.data[i]; } } break;
			case ast.OP_MULTIPLY:        { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] *   rhs.val.data[i]; } } break;
			case ast.OP_DIVIDE:          { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] /   rhs.val.data[i]; } } break;
			case ast.OP_LOGICAL_AND:     { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = (!!(lhs.val.data[i]) &&  (!!rhs.val.data[i])) ? 1 : 0} } break;
			case ast.OP_LOGICAL_OR:      { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = (!!(lhs.val.data[i]) &&  (!!rhs.val.data[i])) ? 1 : 0} } break;
			case ast.OP_LOGICAL_XOR:     { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = (!!(lhs.val.data[i]) !== (!!rhs.val.data[i])) ? 1 : 0} } break;
			case ast.OP_BITWISE_AND:     { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] & rhs.val.data[i] } } break;
			case ast.OP_BITWISE_OR:      { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] | rhs.val.data[i] } } break;
			case ast.OP_BITWISE_XOR:     { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] ^ rhs.val.data[i] } } break;
			case ast.OP_LESS_THAN:       { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] <   rhs.val.data[i] ? 1 : 0; } } break;
			case ast.OP_LESS_THAN_EQ:    { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] <=  rhs.val.data[i] ? 1 : 0; } } break;
			case ast.OP_GREATER_THAN:    { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] >   rhs.val.data[i] ? 1 : 0; } } break;
			case ast.OP_GREATER_THAN_EQ: { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] >=  rhs.val.data[i] ? 1 : 0; } } break;
			case ast.OP_EQ:              { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] === rhs.val.data[i] ? 1 : 0; } } break;
			case ast.OP_NOT_EQ:          { for (let i = 0; i < rhs.val.data.length; i++) { result.val.data[i] = lhs.val.data[i] !== rhs.val.data[i] ? 1 : 0; } } break;
			default: return setError(iter, expr, invalidOperatorError(exprOp, lhs, rhs));
		}

		return setResult(iter, result);
	}

	return setError(iter, expr, `Can't apply ${ast.operatorToString(exprOp)} between ${resultTypeToString(lhs.type)} and ${resultTypeToString(rhs.type)}`);
}

type SuggestedSymbols = {
	builtins:    string[],
	inScope:     string[],
	environment: string[],
	datatypes:   string[],
}

function isFunctionType(type: ResultType): boolean {
	return type === Result_Function || type === Result_BuiltinFunction;
}

function getSuggestedSymbols(iter: ProgramIterator, startsWith: string, onlyFunctions: boolean): SuggestedSymbols {
	const result: SuggestedSymbols = {
		builtins:    [],
		inScope:     [],
		environment: [],
		datatypes:   [],
	}

	// Let's try to find a builtin that a user might want. 
	for (const k in builtins) {
		if (k.startsWith(startsWith)) {
			const val = builtins[k];

			if (onlyFunctions && !isFunctionType(val.type)) {
				continue;
			}

			result.builtins.push(k + " | " + resultTypeToString(val.type));
		}
	}

	forEachReachableScope(iter, scope => {
		for (const [k, res] of scope.vars) {
			if (onlyFunctions && !isFunctionType(res.type)) {
				continue;
			}

			if (k.startsWith(startsWith)) {
				result.inScope.push(k + " | " + resultTypeToString(res.type));
			}
		}
	});

	if (iter.environmentVariables) {
		for (const [k, res] of iter.environmentVariables) {
			if (onlyFunctions && !isFunctionType(res.type)) {
				continue;
			}

			if (k.startsWith(startsWith)) {
				result.environment.push(k + " | " + resultTypeToString(res.type));
			}
		}
	}

	if (!onlyFunctions) {
		for (const k in dataTypes) {
			const res= dataTypes[k];

			if (k.startsWith(startsWith)) {
				result.datatypes.push(k + "{...} | initializes a " + resultTypeToString(res.returnType));
			}
		}
	}

	return result;
}

function getSuggestedSymbolsMessage(iter: ProgramIterator, startsWith: string, onlyFunctions: boolean): string {
	const suggestions = getSuggestedSymbols(iter, startsWith, onlyFunctions);

	if (
		suggestions.inScope.length === 0 &&
		suggestions.builtins.length === 0 &&
		suggestions.environment.length === 0 &&
		suggestions.datatypes.length === 0
	) {
		return "";
	}

	let error = "\nYou may have been looking for:\n";

	if (suggestions.inScope.length > 0) {
		error += "in-scope:\n\t" 
			  + suggestions.inScope.join("\n\t")
			  + "\n";
	}

	if (suggestions.builtins.length > 0) {
		error += "builtins:\n\t" 
			  + suggestions.builtins.join("\n\t")
			  + "\n";
	}

	if (suggestions.environment.length > 0) {
		error += "environment:\n\t" 
			  + suggestions.environment.join("\n\t")
			  + "\n";
	}

	if (suggestions.datatypes.length > 0) {
		error += "datatypes:\n\t" 
			  + suggestions.datatypes.join("\n\t")
			  + "\n";
	}

	return error;
}

function evaluateIdentifier(expr: ast.Identifier, iter: ProgramIterator): ExprReturn {
	const val = getVar(iter, expr.name);
	if (!val) {
		let error = "Variable not found: " + expr.name;

		const suggestion = getSuggestedSymbolsMessage(iter, expr.name, false);
		if (suggestion) {
			error += suggestion;
		} else {
			error += "\n\tYou can make a new one with = "
		}

		return setError(iter, expr, error);
	}

	return setResult(iter, val);
}

function evaluateForLoop(expr: ast.ForLoop, iter: ProgramIterator): ExprReturn {
	let rt: ExprReturn = RETURN_NONE;

	pushScope(iter, SCOPE_ALLOW_CONTINUE_BREAK); {
		rt = evaluateForLoopInternal(expr, iter);
	} popScope(iter);

	return rt;
}

const LOOP_NOTHING  = 0;
const LOOP_BREAK    = 1;
const LOOP_CONTINUE = 2;
const LOOP_RETURN   = 3;

function evaluateLoopStatementReturn(iter: ProgramIterator, rt: ExprReturn): number {
	if (rt === RETURN_RESULT) {
		if (iter.lastResult.result === BREAK) {
			setResult(iter, NOTHING);
			return LOOP_BREAK;
		}

		if (iter.lastResult.result === CONTINUE) {
			setResult(iter, NOTHING);
			return LOOP_CONTINUE;
		}

		return LOOP_RETURN;
	}

	return LOOP_NOTHING;
}

function evaluateForLoopInternal(expr: ast.ForLoop, iter: ProgramIterator): ExprReturn {
	if (expr.toIterate.type === ast.Expression_ForLoopRange) {
		if (expr.varNames.length !== 1) return setError(iter, expr.toIterate, "Range for-loop can only assign to 1 variable");

		const range    = expr.toIterate;
		const rangeVar = expr.varNames[0];

		const startResult = evaluateExpressionValue(range.lo, iter);
		if (!startResult)                       return RETURN_ERROR;
		if (startResult.type !== Result_Number) return setError(iter, range.lo, "For loop range start needs to be a number");
	
		setOrCreateVar(iter, rangeVar.name, startResult);

		outer: while (true) {
			const endResult = evaluateExpressionValue(range.hi, iter);
			if (!endResult)                       return RETURN_ERROR;
			if (endResult.type !== Result_Number) return setError(iter, range.hi, "For loop range end needs to be a number");

			const endVal    = endResult.val;
			let nextLoopVal = startResult.val;

			switch (range.rangeType) {
				case ast.RANGE_LT: {
					if (nextLoopVal >= endVal) break outer;
					nextLoopVal += 1;
				} break;
				case ast.RANGE_LTE: {
					if (nextLoopVal > endVal)  break outer;
					nextLoopVal += 1;
				} break;
				case ast.RANGE_GT: {
					if (nextLoopVal <= endVal) break outer;
					nextLoopVal -= 1;
				} break;
				case ast.RANGE_GTE: {
					if (nextLoopVal < endVal)  break outer;
					nextLoopVal -= 1;
				} break;
				default: {
					assertNever(range.rangeType);
				}
			}

			const rt = evaluateExpressionBlock(expr.statements, iter);
			if (rt === RETURN_ERROR) return RETURN_ERROR;

			startResult.val = nextLoopVal;

			const ls = evaluateLoopStatementReturn(iter, rt);
			if (ls === LOOP_BREAK) {
				break;
			}
			if (ls === LOOP_CONTINUE) {
				continue;
			}
			if (ls === LOOP_RETURN) {
				return RETURN_ERROR;
			}
		}

		return setResult(iter, NOTHING);
	}

	const toIterate = evaluateExpressionValue(expr.toIterate, iter);
	if (!toIterate) return RETURN_ERROR;
	if (toIterate.type === Result_List) {
		if (expr.varNames.length !== 1 && expr.varNames.length !== 2) {
			return setError(iter, expr, "List iterator needs 1 or 2 loop vars (val, idx)");
		}

		const list = toIterate.val;
		for (let i = 0; i < list.length; i++) {
			const val = list[i];

			setOrCreateVar(iter, expr.varNames[0].name, val);
			if (expr.varNames.length === 2) {
				setOrCreateVar(iter, expr.varNames[1].name, newNumber(i));
			}

			const rt = evaluateExpressionBlock(expr.statements, iter);
			if (rt === RETURN_ERROR) return RETURN_ERROR;
			const ls = evaluateLoopStatementReturn(iter, rt);
			if (ls === LOOP_BREAK)    break;
			if (ls === LOOP_CONTINUE) continue;
			if (ls === LOOP_RETURN)   return RETURN_ERROR;
		}

		return RETURN_NONE;
	}

	if (toIterate.type === Result_Map) {
		if (expr.varNames.length !== 2) {
			return setError(iter, expr, "List iterator needs 2 loop vars (k, v)");
		}

		const map = toIterate.val;
		for (const [, v] of map) {
			setOrCreateVar(iter, expr.varNames[0].name, v.key);
			setOrCreateVar(iter, expr.varNames[1].name, v.val);
			
			const rt = evaluateExpressionBlock(expr.statements, iter);
			if (rt === RETURN_ERROR) return RETURN_ERROR;
			const ls = evaluateLoopStatementReturn(iter, rt);
			if (ls === LOOP_BREAK)    break;
			if (ls === LOOP_CONTINUE) continue;
			if (ls === LOOP_RETURN)   return RETURN_ERROR;
		}

		return RETURN_NONE;
	}

	return setError(iter, expr.toIterate, "Can't iterate an expression of type " + resultTypeToString(toIterate.type));
}

function evaluateIndexer(expr: ast.Indexer, iter: ProgramIterator): ExprReturn {
	const targetResult = evaluateExpressionValue(expr.target, iter);
	if (!targetResult) return RETURN_ERROR;

	const target = asIndexableResult(targetResult);
	if (!target) {
		return setError(iter, expr.target, "Expression can't be indexed: " + ast.expressionToString(iter.program.code, expr.target));
	}

	switch (target.type) {
		case Result_String: {
			const index = evaluateExpressionValue(expr.indexes[0], iter);
			if (!index)                                          return RETURN_ERROR;
			if (index.type !== Result_Number)                    return setError(iter, expr.indexes[0], "String index should be a number");
			if (index.val < 0 || index.val >= target.val.length) return setError(iter, expr.indexes[0], `Index [${index.val}] out-of-bounds (${target.val.length})`);

			return setResultString(iter, target.val[index.val]);
		} break;
		case Result_List: {
			const indexResult = evaluateExpressionValue(expr.indexes[0], iter);
			if (!indexResult) return RETURN_ERROR;
			if (indexResult.type !== Result_Number) {
				return setError(iter, expr.indexes[0], "List indexer needs to be a number");
			}

			const index = Math.floor(indexResult.val);
			if (index < 0 || index >= target.val.length) {
				return setError(iter, expr.indexes[0], "Index was out of bounds: " + index + "/" + target.val.length);
			}

			const value = target.val[index];
			return setResult(iter, value);
		} break;
		case Result_Map: {
			const indexResult = evaluateExpressionValue(expr.indexes[0], iter);
			if (!indexResult) return RETURN_ERROR;

			const key = getMapKey(indexResult);
			if (key === undefined) {
				return setError(iter, expr.indexes[0], "Invalid map key");
			}

			const val = target.val.get(key);
			if (val === undefined) return setResult(iter, NOTHING);
			return setResult(iter, val.val);
		} break;
		case Result_Vector: {
			const index = evaluateExpressionValue(expr.indexes[0], iter);
			if (!index)                                          return RETURN_ERROR;
			if (index.type !== Result_Number)                    return setError(iter, expr.indexes[0], "Vector index should be a number");
			if (index.val < 0 || index.val >= target.val.length) return setError(iter, expr.indexes[0], `Index [${index.val}] out-of-bounds (${target.val.length})`);

			return setResultNumber(iter, target.val[index.val]);
		} break;
		case Result_Matrix: {
			if (expr.indexes.length === 1) {
				const index = evaluateExpressionValue(expr.indexes[0], iter);
				if (!index)                                        return RETURN_ERROR;
				if (index.type !== Result_Number)                  return setError(iter, expr.indexes[0], "Matrix index should be a number");
				if (index.val < 0 || index.val >= target.val.cols) return setError(iter, expr.indexes[0], `Index [${index.val}] out-of-bounds (${target.val.cols} cols)`);

				const result: ResultVector = {
					type: Result_Vector,
					val: Array(target.val.rows).fill(0),
				};
				for (let i = 0; i < result.val.length; i++) {
					const idx = matrix.getIndex(target.val, i, index.val);
					result.val[i] = target.val.data[idx];
				}

				return setResult(iter, result);
			} 

			if (expr.indexes.length === 2) {
				const row = evaluateExpressionValue(expr.indexes[0], iter);
				if (!row) return RETURN_ERROR;
				if (row.type !== Result_Number) return setError(iter, expr.indexes[0], "Matrix row should be a number");
				if (row.val < 0 || row.val >= target.val.rows) return setError(iter, expr.indexes[0], `Index [${row.val}] out-of-bounds (${target.val.rows} rows)`);

				const col = evaluateExpressionValue(expr.indexes[1], iter);
				if (!col) return RETURN_ERROR;
				if (col.type !== Result_Number) return setError(iter, expr.indexes[1], "Matrix column should be a number");
				if (col.val < 0 || col.val >= target.val.cols) return setError(iter, expr.indexes[0], `Index [${col.val}] out-of-bounds (${target.val.cols} rows)`);

				const idx = matrix.getIndex(target.val, row.val, col.val);
				return setResultNumber(iter, target.val.data[idx]);
			}

			return setError(iter, expr, "Too many index expressions for this matrix, just do [columnIdx] or [rowIdx, colIdx]");
		} break;
		default: assertNever(target);
	}
}

export const dataTypes: Record<string, {
	returnType: ResultType;
	initializer: (expr: ast.TypeInitializer, iter: ProgramIterator) => ExprReturn;
}> = {
	"list": { returnType: Result_List, initializer: initializeList },
	"map":  { returnType: Result_Map,  initializer: initializeMap },
	"vec":  { returnType: Result_Vector,  initializer: initializeVector },
	"mat":  { returnType: Result_Matrix, initializer: initializeMatrix },
};

function initializeList(expr: ast.TypeInitializer, iter: ProgramIterator): ExprReturn {
	const result: Result = { type: Result_List, val: [] };

	for (const arg of expr.args) {
		const argEvaluated = evaluateExpressionValue(arg, iter);
		if (!argEvaluated) return RETURN_ERROR;
		result.val.push(argEvaluated);
	}

	return setResult(iter, result);
}

function initializeMap(expr: ast.TypeInitializer, iter: ProgramIterator): ExprReturn {
	const result: Result = { type: Result_Map, val: new Map() };

	// for now, we'll just ignore type args. xd
	for (const arg of expr.args) {
		if (
			arg.type !== ast.Expression_BinaryExpression ||
			!arg.op.assignment || 
			arg.op.type !== ast.OP_NONE
		) {
			return setError(iter, expr, "Maps should be initialized like { key=value, key=value, etc. }");
		} 

		const key = evaluateExpressionValue(arg.lhs, iter);
		if (!key) return RETURN_ERROR;

		const val = evaluateExpressionValue(arg.rhs, iter);
		if (!val) return RETURN_ERROR;

		if (setMapKey(iter, result, key, arg.lhs, val, true) === RETURN_ERROR) return RETURN_ERROR;
	}

	return setResult(iter, result);
}

function initializeVector(expr: ast.TypeInitializer, iter: ProgramIterator): ExprReturn {
	const result: Result = { type: Result_Vector, val: [] };

	for (const arg of expr.args) {
		const val = evaluateExpressionValue(arg, iter);
		if (!val)                       return RETURN_ERROR;
		if (val.type !== Result_Number) return setError(iter, arg, "Vectors can only be initialized with numbers");
		result.val.push(val.val);
	}

	return setResult(iter, result);
}

function initializeMatrix(expr: ast.TypeInitializer, iter: ProgramIterator): ExprReturn {
	if (!expr.typeArgs)                                         return setError(iter, expr, "Need type args, e.g mat<3, 4>");
	if (expr.typeArgs.length !== 2)                             return setError(iter, expr, "Need 2 type args, e.g mat<3, 4>");
	if (expr.typeArgs[0].type !== ast.Expression_NumberLiteral) return setError(iter, expr.typeArgs[0], "Need 2 numeric type args, e.g mat<3, 4>");
	if (expr.typeArgs[1].type !== ast.Expression_NumberLiteral) return setError(iter, expr.typeArgs[1], "Need 2 numeric type args, e.g mat<3, 4>");

	const rows = expr.typeArgs[0].val;
	const cols = expr.typeArgs[1].val;

	if (expr.args.length !== rows * cols && expr.args.length !== 1) {
		return setError(iter, expr, `Need to initialize the matrix with exactly 1 or ${rows * cols} values`);
	}
	
	const result: Result = {
		type: Result_Matrix,
		val: {
			rows: rows,
			cols: cols,
			data: Array(rows * cols).fill(0),
		},
	};

	if (expr.args.length === 1) {
		const diagonalValue = evaluateExpressionValue(expr.args[0], iter);
		if (!diagonalValue)                       return RETURN_ERROR;
		if (diagonalValue.type !== Result_Number) return setError(iter, expr.args[0], "Matrix diagonal can only be initialized with numbers");
		
		const minSize = Math.min(rows, cols);
		for (let i = 0; i < minSize; i++) {
			const idx = matrix.getIndex(result.val, i, i);
			result.val.data[idx] = diagonalValue.val;
		}
	} else {
		for (let i = 0; i < expr.args.length; i++) {
			const arg = expr.args[i];
			const val = evaluateExpressionValue(arg, iter);
			if (!val)                       return RETURN_ERROR;
			if (val.type !== Result_Number) return setError(iter, arg, "Matrix element can only be initialized with numbers");
			result.val.data[i] = val.val;
		}
	}

	return setResult(iter, result);
}

function evaluateTypeInitializer(expr: ast.TypeInitializer, iter: ProgramIterator): ExprReturn {
	const val = dataTypes[expr.typename.name];
	if (!val) {
		return setError(iter, expr, `Don't know how to initialize this type: ${expr.typename.name}`);
	}

	return val.initializer(expr, iter);
}

export function getMapKey(result: Result): ValidMapKey | undefined {
	switch (result.type) {
		case Result_Nothing:  return NOTHING;
		case Result_Number:   return result.val;
		case Result_String:   return result.val;
		case Result_Boolean:  return result.val;
	}
	return undefined;
}

export function setMapKey(
	iter: ProgramIterator,
	map: ResultMap,
	key: Result, keyExpr: ast.Expression,
	val: Result, 
	avoidDuplicates=false
): ExprReturn {
	const validMapKey = getMapKey(key)
	if (validMapKey === undefined) {
		return setError(iter, keyExpr, `type ${resultTypeToString(key.type)} can't be used as a map key`);
	}

	if (avoidDuplicates && map.val.has(validMapKey)) {
		return setError(iter, keyExpr, "Map initializer cannot contain duplicate keys");
	}

	map.val.set(validMapKey, { key: key, val: val });
	return RETURN_NONE;
}

export function resultToString(result: Result): string {
	switch (result.type) {
		case Result_Nothing:  return "<nothing>";
		case Result_Number:   return "" + result.val;
		case Result_String:   return result.val;
		case Result_Boolean:  return "" + result.val;
		// TODO: consider making it possible to know the name of the function when we do <ident> = fn() {...}
		case Result_Function: return "fn (" + result.val.args.map(a => a.name).join(", ") + ")"; 
		case Result_BuiltinFunction: return "builtin fn " + result.val.name + ""; 
		case Result_List:     return "list[" + result.val.map(resultToString).join(", ") + "]";
		case Result_Map:      return "map[" + [...result.val.values()].map((e) => resultToString(e.key) + " -> " + resultToString(e.val)).join(", ") + "]";
		case Result_Vector:   return "vec[" + result.val.map(v => "" + v).join(", ") + "]";
		case Result_Matrix:   return "mat[" + matrix.toString(result.val) + "\n]";
		default: assertNever(result);
	}
	return "unknown string representation";
}

////////////////////////////////////////////////////
// Builtins

export const builtins: Record<string, Result> = {
	// Constants
	"nothing":    NOTHING, 

	// Output
	"print":   { type: Result_BuiltinFunction, val: print },
	"println": { type: Result_BuiltinFunction, val: println },

	// Matrices/Vectors
	"matrix_transform_cartesian":                     { type: Result_BuiltinFunction, val: matrix_transform_cartesian },
	"matrix_transform_3d_pos_target_up_fov":          { type: Result_BuiltinFunction, val: matrix_transform_3d_pos_target_up_fov },
	"matrix_transform_3d_pos_target_up_width_height": { type: Result_BuiltinFunction, val: matrix_transform_3d_pos_target_up_width_height },
	"matrix_transpose":                               { type: Result_BuiltinFunction, val: transpose },
	"matrix_inverse":                                 { type: Result_BuiltinFunction, val: inverse },
	"vector_len":                                     { type: Result_BuiltinFunction, val: vector_len },
	"vector_dot":                                     { type: Result_BuiltinFunction, val: vector_dot },
	"vector_cross":                                   { type: Result_BuiltinFunction, val: vector_cross },
	"mul":                                            { type: Result_BuiltinFunction, val: mul },
	"matrix_mul":                                     { type: Result_BuiltinFunction, val: mul },

	"draw_set_transform": { type: Result_BuiltinFunction, val: draw_set_transform },
	"draw_set_color":     { type: Result_BuiltinFunction, val: draw_set_color },
	"draw_line":          { type: Result_BuiltinFunction, val: draw_line_wrapper },
	"draw_set_font_size": { type: Result_BuiltinFunction, val: draw_set_font_size },
	"draw_circle":        { type: Result_BuiltinFunction, val: draw_circle },
	"draw_square":        { type: Result_BuiltinFunction, val: draw_square },
	"draw_rect":          { type: Result_BuiltinFunction, val: draw_rect },
	"draw_label":         { type: Result_BuiltinFunction, val: draw_label },
	"draw_label_rotated": { type: Result_BuiltinFunction, val: draw_label_rotated },
	"draw_background":    { type: Result_BuiltinFunction, val: draw_background },

	// Animations
	// TODO: this function tells the interpreter to stop rendering stuff, present a frame, clear the stuff we drew, then continue interpreting.
	// But we need an iterative version of the program runner instead of the for-loop version!
	// "draw_frame":           { type: Result_BuiltinFunction, val: draw_frame },

	"plot_new_auto":         { type: Result_BuiltinFunction, val: plot_new_auto },
	"plot_new_table":        { type: Result_BuiltinFunction, val: plot_new_table },
	"plot_new_lines":        { type: Result_BuiltinFunction, val: plot_new_lines },
	"plot_new_points":       { type: Result_BuiltinFunction, val: plot_new_points },
	"plot_new_histogram":    { type: Result_BuiltinFunction, val: plot_new_histogram },
	"plot_new_lines_3d":     { type: Result_BuiltinFunction, val: plot_new_lines_3d },
	"plot_new_points_3d":    { type: Result_BuiltinFunction, val: plot_new_points_3d },
	"plot_new_histogram_3d": { type: Result_BuiltinFunction, val: plot_new_histogram_3d },
	"plot_value":            { type: Result_BuiltinFunction, val: plot_value },
	"plot_values":           { type: Result_BuiltinFunction, val: plot_values },

	// Debug/introspection
	"expr_to_string":      { type: Result_BuiltinFunction, val: expr_to_string },
	"expr_type_to_string": { type: Result_BuiltinFunction, val: expr_type_to_string },
	"to_string":           { type: Result_BuiltinFunction, val: to_string },
	"type_to_string":      { type: Result_BuiltinFunction, val: type_to_string },

	// Datastructures
	"len":   { type: Result_BuiltinFunction, val: len },
	"push":  { type: Result_BuiltinFunction, val: push },
	"join":  { type: Result_BuiltinFunction, val: join },

	// Maths
	"max":   { type: Result_BuiltinFunction, val: math_max },
	"min":   { type: Result_BuiltinFunction, val: math_min },
	"clamp": { type: Result_BuiltinFunction, val: math_clamp },
	"sin":   { type: Result_BuiltinFunction, val: math_sin },
	"cos":   { type: Result_BuiltinFunction, val: math_cos },
	"tan":   { type: Result_BuiltinFunction, val: math_tan },
	"asin":  { type: Result_BuiltinFunction, val: math_asin },
	"acos":  { type: Result_BuiltinFunction, val: math_acos },
	"atan":  { type: Result_BuiltinFunction, val: math_atan },
	"atan2": { type: Result_BuiltinFunction, val: math_atan2 },
	"log2":  { type: Result_BuiltinFunction, val: math_log2 },
	"ln":    { type: Result_BuiltinFunction, val: math_ln },
	"pow":   { type: Result_BuiltinFunction, val: math_pow },
	"sqrt":  { type: Result_BuiltinFunction, val: math_sqrt },
	"ceil":   { type: Result_BuiltinFunction, val: math_ceil },
	"floor":  { type: Result_BuiltinFunction, val: math_floor },
	"round":  { type: Result_BuiltinFunction, val: math_round },
	"math_max":   { type: Result_BuiltinFunction, val: math_max },
	"math_min":   { type: Result_BuiltinFunction, val: math_min },
	"math_clamp": { type: Result_BuiltinFunction, val: math_clamp },
	"math_sin":   { type: Result_BuiltinFunction, val: math_sin },
	"math_cos":   { type: Result_BuiltinFunction, val: math_cos },
	"math_tan":   { type: Result_BuiltinFunction, val: math_tan },
	"math_asin":  { type: Result_BuiltinFunction, val: math_asin },
	"math_acos":  { type: Result_BuiltinFunction, val: math_acos },
	"math_atan":  { type: Result_BuiltinFunction, val: math_atan },
	"math_atan2": { type: Result_BuiltinFunction, val: math_atan2 },
	"math_log2":  { type: Result_BuiltinFunction, val: math_log2 },
	"math_ln":    { type: Result_BuiltinFunction, val: math_ln },
	"math_pow":   { type: Result_BuiltinFunction, val: math_pow },
	"math_sqrt":  { type: Result_BuiltinFunction, val: math_sqrt },
	"math_ceil":  { type: Result_BuiltinFunction, val: math_ceil },
	"math_floor": { type: Result_BuiltinFunction, val: math_floor },
	"math_round": { type: Result_BuiltinFunction, val: math_round },

	"PI": newNumber(Math.PI),
	"E":  newNumber(Math.E),

	"random":           { type: Result_BuiltinFunction, val: random },
	"random_set_seed":  { type: Result_BuiltinFunction, val: random_set_seed },
}

export function println(fn: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	print(fn, iter);
	iter.printOutputs.push("\n");
	return RETURN_NONE;
}
export function print(fn: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	for (let i = 0; i < fn.arguments.length; i++) {
		const expr = fn.arguments[i];

		evaluateExpression(expr, iter);

		let message;
		if (iter.lastResult.error) {
			message = iter.lastResult.error.message;
		} else {
			message = resultToString(iter.lastResult.result);
		}

		iter.printOutputs.push(message);
	}

	return RETURN_NONE;
}

function evaluateNumber(expr: ast.Expression, iter: ProgramIterator): ResultNumber | undefined {
	const result = evaluateExpressionValue(expr, iter);
	if (!result) return undefined;
	if (result.type !== Result_Number) {
		setExpectedValueTypeError(iter, expr, Result_Number, result.type);
		return undefined;
	}

	// Not result.val - I want to be able to write code like if (!a) return and it doesn't work for 0
	return result;
}

function evaluateVec(expr: ast.Expression, iter: ProgramIterator): ResultVector | undefined {
	const vec = evaluateExpressionValue(expr, iter);
	if (!vec) return undefined;
	if (vec.type !== Result_Vector) {
		setExpectedValueTypeError(iter, expr, Result_Vector, vec.type);
		return undefined;
	}
	return vec;
}

function evaluateVec3(expr: ast.Expression, iter: ProgramIterator): vector.Vec3 | undefined {
	const vec = evaluateVec(expr, iter);
	if (!vec) return undefined;

	if (vec.val.length !== 2 && vec.val.length !== 3) {
		setError(iter, expr, "Expected a vector with 2 or 3 numbers here");
		return undefined;
	}

	return [
		vec.val[0] ?? 0,
		vec.val[1] ?? 0,
		vec.val[2] ?? 0,
	];
}

function evaluateList(expr: ast.Expression, iter: ProgramIterator): ResultList | undefined {
	const list = evaluateExpressionValue(expr, iter);
	if (!list) return undefined;
	if (list.type !== Result_List) {
		setExpectedValueTypeError(iter, expr, Result_List, list.type);
		return undefined;
	}

	return list;
}

function evaluateString(expr: ast.Expression, iter: ProgramIterator): string | undefined {
	const str = evaluateExpressionValue(expr, iter);
	if (!str) return undefined;
	if (str.type !== Result_String) {
		setExpectedValueTypeError(iter, expr, Result_String, str.type);
		return undefined;
	}

	return str.val;
}

export function math_max(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	let max = -Infinity;
	for (let i = 0; i < call.arguments.length; i++) {
		const iArg = evaluateNumber(call.arguments[i], iter);
		if (!iArg) return RETURN_ERROR;
		if (iArg.val > max) max = iArg.val;
	}
	return setResultNumber(iter, max);
}


export function math_min(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	let min = Infinity;
	for (let i = 0; i < call.arguments.length; i++) {
		const iArg = evaluateNumber(call.arguments[i], iter);
		if (!iArg) return RETURN_ERROR;
		if (iArg.val < min) min = iArg.val;
	}
	return setResultNumber(iter, min);
}

function checkNumArgs(call: ast.FunctionCall, numArgs: number, iter: ProgramIterator): boolean {
	if (call.arguments.length !== numArgs) {
		setError(iter, call, call.name.name + ` requires ${numArgs} arguments`);
		return false;
	}
	return true;
}

export function math_clamp(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 3, iter)) return RETURN_ERROR;

	const val = evaluateNumber(call.arguments[0], iter);
	if (!val) return RETURN_ERROR;

	const min = evaluateNumber(call.arguments[1], iter);
	if (!min) return RETURN_ERROR;

	const max = evaluateNumber(call.arguments[2], iter);
	if (!max) return RETURN_ERROR;

	let clamped = val.val;
	if (clamped < min.val) clamped = min.val;
	if (clamped > max.val) clamped = max.val;

	return setResultNumber(iter, clamped);
}

export function math_sin(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter))                      return RETURN_ERROR;
	const rad = evaluateNumber(call.arguments[0], iter);
	if (!rad) return RETURN_ERROR;
	return setResultNumber(iter, Math.sin(rad.val))
}

export function math_cos(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter))                      return RETURN_ERROR;
	const rad = evaluateNumber(call.arguments[0], iter);
	if (!rad) return RETURN_ERROR;
	return setResultNumber(iter, Math.cos(rad.val))
}

export function math_tan(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter))                      return RETURN_ERROR;
	const rad = evaluateNumber(call.arguments[0], iter);
	if (!rad) return RETURN_ERROR;
	return setResultNumber(iter, Math.tan(rad.val))
}

export function math_asin(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter))                     return RETURN_ERROR;
	const rad = evaluateNumber(call.arguments[0], iter);
	if (!rad) return RETURN_ERROR;
	return setResultNumber(iter, Math.asin(rad.val))
}

export function math_acos(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter))                     return RETURN_ERROR;
	const rad = evaluateNumber(call.arguments[0], iter);
	if (!rad) return RETURN_ERROR;
	return setResultNumber(iter, Math.acos(rad.val))
}

export function math_atan(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter))                    return RETURN_ERROR;
	const rad = evaluateNumber(call.arguments[0], iter);
	if (!rad) return RETURN_ERROR;
	return setResultNumber(iter, Math.atan(rad.val))
}

export function math_atan2(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 2, iter))                    return RETURN_ERROR;

	const y = evaluateNumber(call.arguments[0], iter);
	if (!y) return RETURN_ERROR;

	const x = evaluateNumber(call.arguments[1], iter);
	if (!x) return RETURN_ERROR;

	return setResultNumber(iter, Math.atan2(y.val, x.val))
}

export function math_log2(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter))                    return RETURN_ERROR;
	const x = evaluateNumber(call.arguments[0], iter);
	if (!x) return RETURN_ERROR;
	return setResultNumber(iter, Math.log2(x.val));
}

export function math_ln(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter))                    return RETURN_ERROR;
	const x = evaluateNumber(call.arguments[0], iter);
	if (!x) return RETURN_ERROR;
	return setResultNumber(iter, Math.log(x.val));
}

export function math_pow(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 2, iter)) return RETURN_ERROR;
	const val = evaluateNumber(call.arguments[0], iter)
	if (!val) return RETURN_ERROR;

	const power = evaluateNumber(call.arguments[1], iter)
	if (!power) return RETURN_ERROR;

	return setResultNumber(iter, Math.pow(val.val, power.val));
}

export function math_sqrt(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter))                   return RETURN_ERROR;
	const val = evaluateNumber(call.arguments[0], iter)
	if (!val) return RETURN_ERROR;
	return setResultNumber(iter, Math.sqrt(val.val));
}


export function math_ceil(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter))                   return RETURN_ERROR;
	const val = evaluateNumber(call.arguments[0], iter)
	if (!val) return RETURN_ERROR;
	return setResultNumber(iter, Math.ceil(val.val));
}

export function math_floor(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter))                   return RETURN_ERROR;
	const val = evaluateNumber(call.arguments[0], iter)
	if (!val) return RETURN_ERROR;
	return setResultNumber(iter, Math.floor(val.val));
}

export function math_round(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter))                   return RETURN_ERROR;
	const val = evaluateNumber(call.arguments[0], iter)
	if (!val) return RETURN_ERROR;
	return setResultNumber(iter, Math.round(val.val));
}

export function random(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 0, iter)) return RETURN_ERROR;
	const val = getNextRng(iter.rng);
	return setResultNumber(iter, val);
}

export function random_set_seed(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;

	const val = evaluateNumber(call.arguments[0], iter)
	if (!val) return RETURN_ERROR;

	setRngSeed(iter.rng, val.val);
	return RETURN_NONE;
}

export function mul(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 2, iter)) return RETURN_ERROR;

	const a0 = evaluateExpressionValue(call.arguments[0], iter);
	if (!a0) return RETURN_ERROR;

	const a1 = evaluateExpressionValue(call.arguments[1], iter);
	if (!a1) return RETURN_ERROR;

	if (a0.type === Result_Matrix && a1.type === Result_Vector) {
		const result: Result = {
			type: Result_Vector,
			val:  Array(a0.val.cols).fill(0),
		};

		const err = matrix.mulVec(a0.val, a1.val, result.val);
		if (err) return setError(iter, call, err);

		return setResult(iter, result);
	}

	if (a0.type === Result_Matrix && a1.type === Result_Matrix) {
		const result: Result = {
			type: Result_Matrix,
			val: matrix.mulMatrixAllocate(a0.val, a1.val),
		};

		const err = matrix.mulMatrix(a0.val, a1.val, result.val);
		if (err) return setError(iter, call, err);

		return setResult(iter, result);
	}

	return setError(iter, call, "mul only handles Matrix x Matrix or Matrix x Vector");
}

export function vector_len(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (checkNumArgs(call, 1, iter)) {
		const vec = evaluateVec(call.arguments[0], iter);
		if (vec) {
			return setResultNumber(iter, vector.len(vec.val));
		}
	}
	return RETURN_ERROR;
}

export function vector_dot(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (checkNumArgs(call, 2, iter)) return RETURN_ERROR;

	const a = evaluateVec(call.arguments[0], iter);
	if (!a) return RETURN_ERROR;

	const b = evaluateVec(call.arguments[1], iter);
	if (!b) return RETURN_ERROR;

	return setResultNumber(iter, vector.dot(a.val, b.val));
}

export function vector_cross(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (checkNumArgs(call, 2, iter)) return RETURN_ERROR;

	const a = evaluateVec(call.arguments[0], iter);
	if (!a) return RETURN_ERROR;

	const b = evaluateVec(call.arguments[1], iter);
	if (!b) return RETURN_ERROR;

	const vec = vector.vec3();
	vector.cross(vec, a.val, b.val)
	return setResult(iter, { type: Result_Vector, val: vec });
}

export function transpose(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn  {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;
	const m = evaluateExpressionValue(call.arguments[0], iter);
	if (!m)                       return RETURN_ERROR;
	if (m.type !== Result_Matrix) return RETURN_ERROR;

	const result: Result = {
		type: Result_Matrix,
		val: matrix.transposed(m.val),
	};

	return setResult(iter, result);
}

export function inverse(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn  {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;

	const mR = evaluateExpressionValue(call.arguments[0], iter);
	if (!mR)                         return RETURN_ERROR;
	if (mR.type !== Result_Matrix)   return setError(iter, call, "Need a matrix");

	const result: Result = {
		type: Result_Matrix,
		val: matrix.clone(mR.val),
	};

	const err = matrix.invert(mR.val);
	if (err) return setError(iter, call, err);
	return setResult(iter, result);
}

export function len(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;

	const val = evaluateExpressionValue(call.arguments[0], iter);
	if (!val) return RETURN_ERROR;

	if (val.type === Result_String) return setResultNumber(iter, val.val.length);
	if (val.type === Result_List)   return setResultNumber(iter, val.val.length);
	if (val.type === Result_Map)    return setResultNumber(iter, val.val.size);

	return setError(iter, call, "Can't get the length of a " + resultTypeToString(val.type));
}


export function push(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (call.arguments.length < 2) return setError(iter, call, "Need a list, and then items to push to it. push(list, val1, val2, val3, ....)");

	const list = evaluateList(call.arguments[0], iter);
	if (!list) return RETURN_ERROR;

	for (let i = 1; i < call.arguments.length; i++) {
		const arg = call.arguments[i];

		const val = evaluateExpressionValue(arg, iter);
		if (!val) return RETURN_ERROR;

		list.val.push(val);
	}

	return RETURN_NONE;
}

export function join(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 2, iter)) return RETURN_ERROR;

	const list = evaluateList(call.arguments[0], iter);
	if (!list) return RETURN_ERROR;

	const sep = evaluateExpressionValue(call.arguments[1], iter);
	if (!sep)                       return RETURN_ERROR;
	if (sep.type !== Result_String) return setExpectedValueTypeError(iter, call.arguments[1], Result_String, sep.type);
	
	return setResultString(
		iter,
		list.val.map(resultToString).join(sep.val)
	);
}

export function pop(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;

	const list = evaluateList(call.arguments[0], iter);
	if (!list) return RETURN_ERROR;

	let val = list.val.pop();
	if (!val) {
		val = NOTHING;
	}

	return setResult(iter, val);
}


export function expr_to_string(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;
	return setResultString(iter, ast.expressionToString(iter.program.code, call.arguments[0]));
}

export function expr_type_to_string(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;
	return setResultString(iter, ast.expressionTypeToString(call.arguments[0].type));
}

export function to_string(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;
	const val = evaluateExpressionValue(call.arguments[0], iter);
	if (!val) return RETURN_ERROR;
	return setResultString(iter, resultToString(val));
}

export function type_to_string(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;
	const val = evaluateExpressionValue(call.arguments[0], iter);
	if (!val) return RETURN_ERROR;
	return setResultString(iter, resultTypeToString(val.type));
}

export function draw_set_color(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 4, iter)) return RETURN_ERROR;
	
	const r = evaluateNumber(call.arguments[0], iter);
	if (!r) return RETURN_ERROR;

	const g = evaluateNumber(call.arguments[1], iter);
	if (!g) return RETURN_ERROR;

	const b = evaluateNumber(call.arguments[2], iter);
	if (!b) return RETURN_ERROR;

	const a = evaluateNumber(call.arguments[3], iter);
	if (!a) return RETURN_ERROR;

	iter.drawCalls.push({
		type: DrawCall_SetColor,
		color: {
			r: r.val,
			g: g.val,
			b: b.val,
			a: a.val,
		},
	})
	return RETURN_NONE;
}

export function draw_set_transform(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;

	const mat = evaluateExpressionValue(call.arguments[0], iter);
	if (!mat)                       return RETURN_ERROR;
	if (mat.type !== Result_Matrix) return RETURN_ERROR;

	matrix.clear(iter.mvpMatrix);
	matrix.copy(mat.val, iter.mvpMatrix);

	return RETURN_ERROR;
}

export function matrix_transform_cartesian(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 2, iter)) return RETURN_ERROR;

	const width = evaluateNumber(call.arguments[0], iter);
	if (!width) return RETURN_ERROR;

	const height = evaluateNumber(call.arguments[1], iter);
	if (!height) return RETURN_ERROR;

	const xScale = iter.drawParams.viewWidth  / width.val;
	const yScale = iter.drawParams.viewHeight / height.val;

	const mat = matrix.create(4, 4);
	matrix.setIdentity(mat);
	matrix.set(mat, 0, 0, xScale);
	matrix.set(mat, 1, 1, yScale);

	return setResult(iter, { type: Result_Matrix, val: mat });
}

export function matrix_transform_3d_pos_target_up_fov(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 4, iter)) return RETURN_ERROR;

	const pos = evaluateVec3(call.arguments[0], iter);
	if (!pos)    return RETURN_ERROR;

	const target = evaluateVec3(call.arguments[1], iter);
	if (!target) return RETURN_ERROR;

	const up = evaluateVec3(call.arguments[2], iter);
	if (!up)     return RETURN_ERROR;

	const fov = evaluateNumber(call.arguments[3], iter);
	if (!fov)    return RETURN_ERROR;

	matrix.setIdentity(iter.tempMatrix);
	matrix.setPosTargetUp(iter.tempMatrix, pos, target, up);
	matrix.invert(iter.tempMatrix);

	// TODO: actually read through this explanation
	// https://www.scratchapixel.com/lessons/3d-basic-rendering/perspective-and-orthographic-projection-matrix/building-basic-perspective-projection-matrix.html
	matrix.setIdentity(iter.tempMatrix2);
	const s = 1 / (Math.tan(fov.val * Math.PI / 360));
	const f = 1000;
	const n = 0.01;
	matrix.set(iter.tempMatrix2, 0, 0, s);
	matrix.set(iter.tempMatrix2, 1, 1, s);
	matrix.set(iter.tempMatrix2, 2, 2, -f / (f - n));
	matrix.set(iter.tempMatrix2, 2, 3, -1);
	matrix.set(iter.tempMatrix2, 3, 2, -f * n / (f - n));

	const mat = matrix.create(4, 4);
	matrix.mulMatrix(iter.tempMatrix2, iter.tempMatrix, mat);

	return setResult(iter, { type: Result_Matrix, val: mat });
}

// Orthographic projection
export function matrix_transform_3d_pos_target_up_width_height(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 5, iter)) return RETURN_ERROR;

	const pos = evaluateVec3(call.arguments[0], iter);
	if (!pos)    return RETURN_ERROR;

	const target = evaluateVec3(call.arguments[1], iter);
	if (!target) return RETURN_ERROR;

	const up = evaluateVec3(call.arguments[2], iter);
	if (!up)     return RETURN_ERROR;

	const width = evaluateNumber(call.arguments[3], iter);
	if (!width)  return RETURN_ERROR;

	const height = evaluateNumber(call.arguments[4], iter);
	if (!height) return RETURN_ERROR;

	matrix.setIdentity(iter.tempMatrix);
	matrix.setPosTargetUp(iter.tempMatrix, pos, target, up);
	matrix.invert(iter.tempMatrix);

	matrix.setIdentity(iter.tempMatrix2);
	matrix.set(iter.tempMatrix2, 0, 0, 1 / width.val);
	matrix.set(iter.tempMatrix2, 1, 1, 1 / height.val);
	matrix.set(iter.tempMatrix2, 1, 1, 1);

	const mat = matrix.create(4, 4);
	matrix.mulMatrix(iter.tempMatrix2, iter.tempMatrix, mat);
	return setResult(iter, { type: Result_Matrix, val: mat });
}

export function draw_set_font_size(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;

	const size = evaluateNumber(call.arguments[0], iter);
	if (!size)     return RETURN_ERROR;

	iter.drawCalls.push({
		type: DrawCall_SetFontSize,
		size: size.val,
	});

	return RETURN_NONE;
}

export function draw_line_wrapper(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 3, iter)) return RETURN_ERROR;

	const p0 = evaluateVec3(call.arguments[0], iter);
	if (!p0)     return RETURN_ERROR;

	const p1 = evaluateVec3(call.arguments[1], iter);
	if (!p1)     return RETURN_ERROR;

	const radius = evaluateNumber(call.arguments[2], iter);
	if (!radius) return RETURN_ERROR;

	draw_line(iter, p0, p1, radius.val);
	return RETURN_NONE;
}

export function draw_line(iter: ProgramIterator, p0: vector.Vec3, p1: vector.Vec3, thickness: number): ExprReturn {
	iter.drawCalls.push({
		type:  DrawCall_Line,
		p0:    p0,
		p1:    p1,
		thickness: thickness,
	})
	return RETURN_NONE;
}

export function draw_circle(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 2, iter)) return RETURN_ERROR;

	const p0 = evaluateVec3(call.arguments[0], iter);
	if (!p0)     return RETURN_ERROR;

	const radius = evaluateNumber(call.arguments[1], iter);
	if (!radius) return RETURN_ERROR;

	iter.drawCalls.push({
		type: DrawCall_Circle,
		p0: p0,
		radius: radius.val,
	})
	return RETURN_NONE;
}

export function draw_square(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 2, iter)) return RETURN_ERROR;

	const p0 = evaluateVec3(call.arguments[0], iter);
	if (!p0)     return RETURN_ERROR;

	const radius = evaluateNumber(call.arguments[1], iter);
	if (!radius) return RETURN_ERROR;

	iter.drawCalls.push({
		type: DrawCall_Square,
		p0: p0,
		radius: radius.val,
	})
	return RETURN_NONE;
}

export function draw_rect(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 2, iter)) return RETURN_ERROR;

	const p0 = evaluateVec3(call.arguments[0], iter);
	if (!p0)     return RETURN_ERROR;

	const p1 = evaluateVec3(call.arguments[1], iter);
	if (!p1)     return RETURN_ERROR;

	iter.drawCalls.push({
		type: DrawCall_Rectangle,
		p0: p0,
		p1: p1,
	})
	return RETURN_NONE;
}

export function draw_label(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 4, iter)) return RETURN_ERROR;

	const p0 = evaluateVec3(call.arguments[0], iter);
	if (!p0)         return RETURN_ERROR;

	const label = evaluateString(call.arguments[1], iter);
	if (!label)      return RETURN_ERROR;

	const size = evaluateNumber(call.arguments[2], iter);
	if (!size)       return RETURN_ERROR;

	const direction = evaluateVec3(call.arguments[3], iter);
	if (!direction)  return RETURN_ERROR;

	iter.drawCalls.push({
		type:      DrawCall_Label,
		size:      size.val,
		direction: direction,
		p0:        p0,
		rotation:  0,
		text:      label,
	})
	return RETURN_NONE;
}

export function draw_label_rotated(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 5, iter)) return RETURN_ERROR;

	const p0 = evaluateVec3(call.arguments[0], iter);
	if (!p0)         return RETURN_ERROR;

	const label = evaluateString(call.arguments[1], iter);
	if (!label)      return RETURN_ERROR;

	const size = evaluateNumber(call.arguments[2], iter);
	if (!size)       return RETURN_ERROR;

	const direction = evaluateVec3(call.arguments[3], iter);
	if (!direction)  return RETURN_ERROR;

	const angle = evaluateNumber(call.arguments[4], iter);
	if (!angle)      return RETURN_ERROR;

	iter.drawCalls.push({
		type:      DrawCall_Label,
		size:      size.val,
		direction: direction,
		p0:        p0,
		rotation:  angle.val,
		text:      label,
	})
	return RETURN_NONE;
}

export function draw_background(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 0, iter)) return RETURN_ERROR;
	
	iter.drawCalls.push({
		type: DrawCall_Background,
	});
	return RETURN_NONE;
}

export function plot_new_auto(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	// TODO: infer a good way to visualise the data.
	return plot_new_internal(call, iter, DataVisualiserType_Table);
}

export function plot_new_table(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	return plot_new_internal(call, iter, DataVisualiserType_Table);
}

export function plot_new_lines(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	return plot_new_internal(call, iter, DataVisualiserType_Line);
}

export function plot_new_points(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	return plot_new_internal(call, iter, DataVisualiserType_Point);
}

export function plot_new_histogram(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	return plot_new_internal(call, iter, DataVisualiserType_Histogram);
}

export function plot_new_internal(call: ast.FunctionCall, iter: ProgramIterator, suggestedVisualiser: DataVisualiserType): ExprReturn {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;

	const title = evaluateString(call.arguments[0], iter);
	if (!title) return RETURN_ERROR;

	newPlotInternal(iter, title, suggestedVisualiser);
	return RETURN_NONE;
}

export function plot_new_lines_3d(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	return plot_new_3d_internal(call, iter, DataVisualiserType_Line3d);
}

export function plot_new_points_3d(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	return plot_new_3d_internal(call, iter, DataVisualiserType_Point3d);
}

export function plot_new_histogram_3d(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	return plot_new_3d_internal(call, iter, DataVisualiserType_Histogram3d);
}

export function plot_new_3d_internal(call: ast.FunctionCall, iter: ProgramIterator, suggestedVisualiser: DataVisualiserType): ExprReturn {
	if (!checkNumArgs(call, 1, iter)) return RETURN_ERROR;

	const title = evaluateString(call.arguments[0], iter);
	if (!title) return RETURN_ERROR;

	newPlotInternal(iter, title, suggestedVisualiser);
	return RETURN_NONE;
}


function newPlotInternal(iter: ProgramIterator, title: string, type: DataVisualiserType): DataOutput {
	const plot: DataOutput = {
		title: title,
		axes: [],
		type: type,
	};

	iter.dataOutputs.push(plot);
	return plot;
}

export function plot_value(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	if (!checkNumArgs(call, 2, iter)) return RETURN_ERROR;

	const output = ensureDataOutput(iter, call);
	if (!output) return RETURN_ERROR;

	const name = evaluateString(call.arguments[0], iter);
	if (!name) return RETURN_ERROR;

	const value = evaluateExpressionValue(call.arguments[1], iter);
	if (!value) return RETURN_ERROR;

	return plotValueInternal(iter, output, name, value, call.arguments[1]);
}

function plotValueInternal(iter: ProgramIterator, output: DataOutput, axisName: string, value: Result, valueExpr: ast.Expression): ExprReturn {
	const axis = getDataAxis(output, axisName);

	switch(value.type) {
		case Result_Number: {
			if (axis.init && !axis.numbers) {
				return setError(iter, valueExpr, "Can't push a number to a non-number axis");
			}
			pushNumberToAxis(axis, value.val); 
		} break;
		case Result_String: {
			if (axis.init && !axis.labels) {
				return setError(iter, valueExpr, "Can't push a label to a non-label axis");
			}
			pushStringToAxis(axis, value.val);
		} break;
		default: return setError(iter, valueExpr, "Invalid type: " + resultTypeToString(value.type));
	}

	return RETURN_NONE;
}

export function plot_values(call: ast.FunctionCall, iter: ProgramIterator): ExprReturn {
	const output = ensureDataOutput(iter, call);
	if (!output) return RETURN_ERROR;

	for (const expr of call.arguments) {
		const val = evaluateExpressionValue(expr, iter);
		if (!val) return RETURN_ERROR;

		const exprString = ast.expressionToString(iter.program.code, expr);
		const rt = plotValueInternal(iter, output, exprString, val, expr);
		if (rt) return rt;
	}

	return RETURN_NONE;
}

function ensureDataOutput(iter: ProgramIterator, iterExpr: ast.Expression): DataOutput | undefined {
	const output = iter.dataOutputs[iter.dataOutputs.length - 1];
	if (!output) {
		setError(iter, iterExpr, "Need at least one plot to start plotting. Call plot_new before calling this");
		return undefined
	}

	return output;
}

function pushNumberToAxis(axis: DataOutputAxis, val: number) {
	if (!axis.numbers) axis.numbers = [];
	axis.init = true;
	axis.numbers.push(val);
}

function pushStringToAxis(axis: DataOutputAxis, val: string) {
	if (!axis.labels) axis.labels = [];
	axis.init = true;

	const idx = axis.labels.length;
	axis.labels.push(val);
	pushNumberToAxis(axis, idx);
}

function getDataAxis(output: DataOutput, axisName: string): DataOutputAxis {
	for (const axis of output.axes) {
		if (axis.name === axisName) return axis;
	}

	const axis: DataOutputAxis = {
		name:    axisName,
		init:    false,
		numbers: [],
	};
	output.axes.push(axis);

	return axis;
}

function setExpectedValueTypeError(iter: ProgramIterator, expr: ast.Expression, wanted: ResultType, got: ResultType): ExprReturn {
	console.log(expr)
	return setError(
		iter,
		expr,
		"Expected a " + resultTypeToString(wanted) + 
		" but got a " + resultTypeToString(got) + " instead"
	);
}


export function getBuiltin(name: string): Result | undefined {
	return builtins[name];
}

////////////////////////////////////////////////////
// End of file
