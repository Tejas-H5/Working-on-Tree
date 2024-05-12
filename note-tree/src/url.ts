import { matchAllRanges } from "./re";

function urlRegex() {
    // urls are a string of non-whitespace that start with "https:", and contain at least 1 dot in there somewhere
    return /https:\S+\.\S+/g;
}

export function getUrlPositions(text: string): [number, number][] {
    return matchAllRanges(text, urlRegex());
}

export function openUrlInNewTab(url: string) {
    if (!url.startsWith("https")) {
        return;
    }

    window.open(url, '_blank')?.focus();
}
