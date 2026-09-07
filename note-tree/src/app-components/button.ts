import { im, ImCache, imdom } from "imcf";
import { BLOCK, cssVars, DisplayType, imui } from "imcf/im-ui";

const cssb = imui.newCssBuilder();

const cnButton = (() => {
    const transiton = `0.05s linear`;
    return cssb.cn(`button`, [
        ` { cursor: pointer; user-select: none; background-color: ${cssVars.bg}; color: ${cssVars.fg}; transition: background-color ${transiton}, color ${transiton}; padding: 1px 10px; border-radius: 5px; overflow: hidden; }`,
        `.toggled { background-color: ${cssVars.fg}; color: ${cssVars.bg}; }`,
        `:hover { background-color: ${cssVars.bg2}; color: ${cssVars.fg}; }`,
        `.toggled:hover { background-color: ${cssVars.fg2}; color: ${cssVars.bg}; }`,
        `:active { background-color: ${cssVars.mg}; color: ${cssVars.fg}; }`,
        `.toggled:active { background-color: ${cssVars.mg}; color: ${cssVars.fg}; }`,
    ]);
})();

export function imButton(c: ImCache, toggled = false) {
    if (im.IsFirstRender(c)) imdom.setClass(c, cnButton);
    if (im.Memo(c, toggled))    imdom.setClass(c, "toggled", toggled);
}

export function imButtonIsClicked(
    c: ImCache, 
    text: string,
    toggled: boolean = false,
    type: DisplayType = BLOCK
): boolean {
    let result = false;

    imui.Begin(c, type); imButton(c, toggled); {
        imdom.Str(c, text);
        result = imdom.hasMousePress(c);
    } imui.End(c);

    return result;
}
