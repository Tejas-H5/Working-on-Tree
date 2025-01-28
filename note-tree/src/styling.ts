import { Color, newCssBuilder } from "src/utils/dom-utils";

export const cssVars = {
    bgInProgress: "var(--bgInProgress)",
    fgInProgress: "var(--fgInProgress)",
    bgColor: "var(--bgColor)",
    bgColorFocus: "var(--bgColorFocus)",
    bgColorFocus2: "var(--bgColorFocus2)",
    fgColor: "var(--fgColor)",
    unfocusTextColor: "var(--unfocusTextColor)",
    pinned: "var(--pinned)",
    focusedTreePathWidth: "var(--focusedTreePathWidth)",
    unfocusedTreePathWidth: "var(--unfocusedTreePathWidth)",
} as const;

export type Theme = Record<keyof typeof cssVars, string | Color>;

const cssb = newCssBuilder();

cssb.s(`

body {
    font-family: monospace;
    font-size: 18px;
    background-color: ${cssVars.bgColor};
    color: ${cssVars.fgColor};
}

/** scrollbars */

body {
    /* Foreground, Background */
    scrollbar-color: ${cssVars.bgColorFocus} ${cssVars.bgColor};
}

body::-webkit-scrollbar-thumb {
    /* Foreground */
    background: ${cssVars.bgColorFocus};
}

body::-webkit-scrollbar-track {
    /* Background */
    background: ${cssVars.bgColor};
}

input {
    all: unset;
    font-family: monospace;
    white-space: pre-wrap;
}

input:focus {
    background-color: ${cssVars.bgColorFocus};
}

textarea {
    all: unset;
    font-family: monospace;
    white-space: pre-wrap;
    padding: 5px;
}

textarea:focus {
    background-color: ${cssVars.bgColorFocus};
}

button {
    all: unset;

    background-color: ${cssVars.bgColor};
    user-select: none;
    cursor: pointer;
}

button:hover {
    background-color: ${cssVars.bgColorFocus};
}

button:active {
    background-color: ${cssVars.bgColorFocus2};
}
`)

export const cnApp = {
    inverted: cssb.cn("inverted", [` { color: ${cssVars.bgColor}; background-color: ${cssVars.fgColor}; }`]),

    unfocusedTextColor: cssb.cn("unfocusedTextColor", [` { color: ${cssVars.unfocusTextColor}; }`]),

    bgColorFocus: cssb.cn("bgColorFocus", [` { background-color: ${cssVars.bgColorFocus}; }`]),
    bgColor: cssb.cn("bgColor", [` { background-color: ${cssVars.bgColor}; }`]),
    transparent: cssb.cn("transparent", [` { background-color: transparent; color: transparent; }`]),

    danger: cssb.cn("danger", [` { background-color: red; color: white; }`]),

    modalShadow: cssb.cn("modalShadow", [` { background-color: rgba(0, 0, 0, 0.5); pointer-events: all; }`]),

    solidBorder: cssb.cn("solidBorder", [` { outline: 2px solid ${cssVars.fgColor}; }`]),

    sb1l: cssb.cn("sb1l", [` { border-left: 1px solid ${cssVars.fgColor}; }`]),
    sb1r: cssb.cn("sb1r", [` { border-right: 1px solid ${cssVars.fgColor}; }`]),
    sb1t: cssb.cn("sb1t", [` { border-top: 1px solid ${cssVars.fgColor}; }`]),
    sb1b: cssb.cn("sb1b", [` { border-bottom: 1px solid ${cssVars.fgColor}; }`]),
    solidBorderSm: cssb.cn("solidBorderSm", [` { border: 1px solid ${cssVars.fgColor}; }`]),
    solidBorderSmRounded: cssb.cn("solidBorderSmRounded", [` { border: 1px solid ${cssVars.fgColor}; border-radius: 3px; }`]),

    gap5: cssb.cn("gap5", [` { gap: 5px; }`]),
    gap10: cssb.cn("gap10", [` { gap: 10px; }`]),
};
