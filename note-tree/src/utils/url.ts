import { forEachMatch } from "./re";

function urlRegex() {
    // urls are a string of non-whitespace that start with "https:", and contain at least 1 dot in there somewhere
    return /(https|file):\S+\.\S+/g;
}

export function forEachUrlPosition(text: string, fn: (start: number, end: number) => void) {
    forEachMatch(text, urlRegex(), (_, start, end) => fn(start, end));
}

export function openUrlInNewTab(url: string) {
    if (
        !url.startsWith("https") &&
        !url.startsWith("file")
    ) {
        return;
    }

    window.open(url, '_blank')?.focus();
}

