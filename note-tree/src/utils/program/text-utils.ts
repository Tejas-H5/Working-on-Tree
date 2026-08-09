/**
 * returns a substring from the current line start up to the pos, excluding the previous line's newline characters.
 * This method' existence assumes that a langauge with immutable strings such as JavaScript
 * would have implemented strings using slices, i.e as just a value type like { realData, start, len } that can be 
 * easily substringed in O(1).
 */
export function getLineBeforePos(text: string, pos: number): string {
    const i = getLineStartPos(text, pos);
    return text.substring(i, pos);
}

export function getLineStartPos(text: string, pos: number): number {
    let i = pos;
    if (text[i] === "\r" || text[i] === "\n") {
        i--;
    }

    for (; i > 0; i--) {
        if (text[i] === "\r" || text[i] === "\n") {
            i++
            break;
        }
    }

    if (pos < i) {
        return 0;
    }

    return i;
}

export function getLineEndPos(text: string, pos: number): number {
    let i = pos;
    if (text[i] === "\r" || text[i] === "\n") {
        i++;
    }

    for (; i < text.length; i++) {
        if (text[i] === "\r" || text[i] === "\n") {
            i++
            break;
        }
    }

    if (i < pos) {
        return text.length;
    }

    return i;
}

// Thankyou Trevor https://stackoverflow.com/questions/1496826/check-if-a-single-character-is-a-whitespace
export function isWhitespace(c: string | undefined): boolean {
    return (
        c === " " ||
        c === "\n" ||
        c === "\t" ||
        c === "\r" ||
        c === "\f" ||
        c === "\v" ||
        c === "\u00a0" ||
        c === "\u1680" ||
        c === "\u2000" ||
        c === "\u200a" ||
        c === "\u2028" ||
        c === "\u2029" ||
        c === "\u202f" ||
        c === "\u205f" ||
        c === "\u3000" ||
        c === "\ufeff"
    );
}
