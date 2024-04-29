export function getUrls(text: string): string[] {
    // urls are a string of non-whitespace that start with "https:", and contain at least 1 dot in there somewhere
    const urlRegex = /https:\S+\.\S+/g;
    
    // returns an array of regex match arrays, which contain [overall match, ...capture groups]
    const matches = text.matchAll(urlRegex);

    return [...matches].map(res => res[0]);
}

export function openUrlInNewTab(url: string) {
    if (!url.startsWith("https")) {
        return;
    }

    window.open(url, '_blank')?.focus();
}
