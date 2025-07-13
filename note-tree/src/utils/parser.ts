// Every parse method should either parse out a thing, or revert the parser to where it was when the method was first called.

export type Parser = {
    text: string; 
    i: number; 
    errorPos: number;
}

export function newParser(text: string): Parser {
    return { text, i: 0, errorPos: 0 };
}

export function resetParser(p: Parser, text: string) {
    p.text = text;
    p.i = 0;
}

export function parserGet(p: Parser) {
    return (p.i >= p.text.length) ? "" : p.text[p.i];;
}

export function revertParser(p: Parser, oldPos: number) {
    p.errorPos = p.i;
    p.i = oldPos;
}

export function parserAdvance(p: Parser) {
    if (p.i < p.text.length) p.i++;
}

export function isWhiteSpace(c: string) {
    if (c.length === 0) return false;

    return c.trim().length === 0;
}

export function isDigit(c: string) {
    if (c.length === 0) return false;

    const code = c.charCodeAt(0);
    // ASCII codes for '0' and '9'
    return code >= 48 && code <= 57;
}

export function parserAdvanceWhitespace(p: Parser) {
    while (isWhiteSpace(parserGet(p))) parserAdvance(p);
}

// NOTE: massive numbers were not handled
export function parserParseInt(p: Parser): number | null {
    let last = p.i;

    let start = p.i;


    while (isDigit(parserGet(p))) parserAdvance(p);

    if (start === p.i) {
        revertParser(p, last);
        return null
    }

    const substr = p.text.substring(start, p.i);

    // TODO: string of numbers was too long?
    
    return parseInt(substr);
}

export function parserParseDelimter(p: Parser, delimiters: string): boolean {
    if (delimiters.includes(parserGet(p))) {
        parserAdvance(p);
        return true;
    }

    return false;
}

export function parserParseWord(p: Parser, word: string): boolean {
    let last = p.i;

    let i = 0;
    for (; i < word.length; i++) {
        if (parserGet(p) !== word[i]) break;
        parserAdvance(p);
    }

    if (i !== word.length) {
        revertParser(p, last);
        return false;
    }

    return true;
}
