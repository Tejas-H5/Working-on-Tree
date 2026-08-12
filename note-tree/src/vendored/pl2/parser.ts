import { isLetter } from "./string-utils";
import { advanceTextPosition, assignTextPosition, cloneTextPosition, TextPosition } from "./text-pos";

export type Parser = {
	text: string;
	pos:  TextPosition;
	errors: ParseError[];
}

type ParseError = {
	message: string;
	pos:     TextPosition;
};

export function reportParserError(parser: Parser, error: string) {
	parser.errors.push({
		message: error,
		pos:     parserPos(parser),
	});
}

export function getNumErrors(parser: Parser): number {
	return parser.errors.length;
}

export function hasNewErrors(parser: Parser, prevNumErrors: number): boolean {
	return getNumErrors(parser) > prevNumErrors;
}

export function newParser(code: string): Parser {
	return {
		text: code,
		pos: {
			i:  0,
			line: 0,
			col:  0,
			tabs: 0,
		},
		errors: [],
	};
}

export function currentChar(r: Parser, offset = 0) {
    return r.text[r.pos.i + offset] ?? "";
}

export function reachedEnd(r: Parser) {
    return r.pos.i >= r.text.length;
}


export function advanceToNextNewLine(r: Parser) {
    while (advance(r) && currentChar(r) !== "\n") { }
}

export function compareCurrent(r: Parser, str: string): boolean {
    for (let i = 0; i < str.length; i++) {
        const pos = r.pos.i + i;
        if (pos >= r.text.length)   return false;
        if (r.text[pos] !== str[i]) return false;
    }

    return true;
}

export function compareCurrentWithWordBoundary(r: Parser, str: string): boolean {
	if (compareCurrent(r, str)) {
		const next = r.text[r.pos.i + str.length];
		if (next && isLetter(next)) {
			return false;
		}

		return true;
	}

	return false;
}

// TODO: WE NEED TO HANDLE THE RETURN VALUE !!!
// The parser can randomly run out of text to parse at any point. xD. We need odin's @require_results in typescript.
export function advance(r: Parser): boolean {
	return advanceTextPosition(r.pos, r.text);
}

export function advanceBy(r: Parser, count: number) {
	for (let i = 0; i < count; i++) {
		advance(r);
	}
}

export function reset(r: Parser, pos: TextPosition) {
	assignTextPosition(r.pos, pos);
}

export function parserPos(r: Parser): TextPosition {
	return cloneTextPosition(r.pos);
}
