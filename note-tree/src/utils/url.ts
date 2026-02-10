import { forEachMatch } from "./re";

function urlRegex() {
    // urls are one of:
    // - a string of non-whitespace that start with "https:", and contain at least 1 dot in there somewhere
    // - a string of non-whitespace that start wtih "http://localhost"
    //
    return /((https|file):\S+\.\S+)|(http:\/\/localhost:\S+)/g;
}

export function forEachUrlPosition(text: string, fn: (start: number, end: number) => void) {
    forEachMatch(text, urlRegex(), (_, start, end) => fn(start, end));
}

export function openUrlInNewTab(url: string) {
    if (
        !url.startsWith("https") &&
        !url.startsWith("file") &&
        !url.startsWith("http://localhost")
    ) {
        return;
    }

    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
}

