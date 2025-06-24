import { cssVars, mainTheme, setTheme, Theme } from "./components/core/stylesheets";
import { newColor, newColorFromHex, CssColor } from "./utils/colour";
import { newCssBuilder, setCssVars } from "./utils/cssb";

const cssb = newCssBuilder();

export const cssVarsApp = {
    bgInProgress: "var(--bgInProgress)",
    fgInProgress: "var(--fgInProgress)",
    bgColor: "var(--bgColor)",
    bgColorFocus: "var(--bgColorFocus)",
    bgColorFocus2: "var(--bgColorFocus2)",
    fgColor: "var(--fgColor)",
    unfocusTextColor: "var(--unfocusTextColor)",
    focusedTreePathWidth: "var(--focusedTreePathWidth)",
    unfocusedTreePathWidth: "var(--unfocusedTreePathWidth)",
} as const;

const normalStyle = ` 
font-family: Source Code Pro, monospace; 
font-size: ${cssVars.normalText}; 
color: ${cssVars.fg}; 
background: ${cssVars.bg}; 
font-size: 18px; `;

export const lightTheme = {
    bgInProgress: newColor(1, 0, 0, 0.1),
    fgInProgress: newColorFromHex("#FFF"),
    bgColor: newColorFromHex("#FFF"),
    bgColorFocus: newColorFromHex("#CCC"),
    bgColorFocus2: newColor(0, 0, 0, 0.4),
    fgColor: newColorFromHex("#000"),
    unfocusTextColor: newColorFromHex("#A0A0A0"),
    focusedTreePathWidth: "4px",
    unfocusedTreePathWidth: "1px",
} as const satisfies Record<keyof typeof cssVarsApp, any>;

type AppTheme = typeof lightTheme;

export const darkTheme: AppTheme = {
    bgInProgress: newColor(1, 0, 0, 0.1),
    fgInProgress: newColorFromHex("#FFF"),
    bgColor: newColorFromHex("#000"),
    bgColorFocus: newColorFromHex("#333"),
    bgColorFocus2: newColor(1, 1, 1, 0.4),
    fgColor: newColorFromHex("#EEE"),
    unfocusTextColor: newColorFromHex("#707070"),
    focusedTreePathWidth: "4px",
    unfocusedTreePathWidth: "1px",
};

let currentAppTheme: AppTheme = lightTheme;

export function setAppTheme(theme: AppTheme) {
    setTheme(mainTheme);

    currentAppTheme = theme;
    setCssVars(currentAppTheme);
}

cssb.s(` 

body { ${normalStyle} }

h4, h3, h2, h1 {
    margin: 0;
}

`);

export const cnApp = {
    b: cssb.cn("b", [` { font-weight: bold; } `]),

    normal: cssb.cn("normal", [` {
${normalStyle}
}`]),

    padded: cssb.cn("padded", [` { padding: 5px }`]),
    gap5: cssb.cn("gap5", [` { gap: 5px; }`]),

    defocusedText: cssb.cn("defocusedText", [` { color: ${cssVars.mg}; }`]),
    bgFocus: cssb.cn("bgFocus", [` { background-color: ${cssVars.bg2}; }`]),

    border1Solid: cssb.cn("border1Solid", [`{ border: 1px solid ${cssVars.fg}; }`]),

    translucent: cssb.cn("translucent", [` { background-color: ${cssVarsApp.translucent}; }`]),

    bold: cssb.cn("bold", [` { font-weight: bold; }`]),
    italic: cssb.cn("italic", [` { font-style: italic; }`]),

    h1: cssb.cn("h1", [` { font-size: 3em; }`]),
    h2: cssb.cn("h2", [` { font-size: 2em; }`]),
    h3: cssb.cn("h3", [` { font-size: 1.25em; }`]),
};

