
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

export function isLetter(c: string) {
    return c.toUpperCase() != c.toLowerCase() || (c.codePointAt(0) ?? 0) > 127 || c === "_";
}

export function isDigit(c: string) {
    const code = c.charCodeAt(0);
    // ASCII codes for '0' and '9'
    return code >= 48 && code <= 57;
}

