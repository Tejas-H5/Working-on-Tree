

export function copyToClipboard(s: string) {
    navigator.clipboard.writeText(s);
}

export async function readFromClipboard(): Promise<string> {
    return await navigator.clipboard.readText();
}
