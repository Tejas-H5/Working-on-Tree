/**
 * returns a substring from the current line start up to the pos, excluding the previous line's newline characters.
 * This method' existence assumes that a langauge with immutable strings such as JavaScript
 * would have implemented strings using slices, i.e as just a value type like { realData, start, len } that can be 
 * easily substringed in O(1).
 */
export function getLineBeforePos(text: string, pos: number): string {
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
        return "";
    }

    return text.substring(i, pos);
}

