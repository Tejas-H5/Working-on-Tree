export function forEachMatch(text: string, re: RegExp, fn: (captures: RegExpExecArray, start: number, end: number) => void) {
    let match;
    while ((match = re.exec(text))) {
        const start = match.index;
        const end = match.index + match[0].length;

        fn(match, start, end);
    }
}
