
export function matchAllRanges(text: string, re: RegExp) {
    const indices: [number, number][] = [];
    let match;
    while ((match = re.exec(text))) {
        indices.push([match.index, match.index + match[0].length]);
    }

    return indices;
}

