import { im, ImCache, imdom } from "src/utils/im-js";
import { cssVars, imui } from "src/utils/im-js/im-ui";

const cnButton = (() => {
    const transiton = `0.1s linear`;
    return imui.newCssBuilder().cn(`button`, [
        ` { cursor: pointer; user-select: none; background-color: ${cssVars.bg}; color: ${cssVars.fg}; transition: background-color ${transiton}, color ${transiton}; }`,
        `:hover { background-color: ${cssVars.fg}; color: ${cssVars.bg}; }`,
        `:active { background-color: ${cssVars.mg}; color: ${cssVars.fg}; }`,
    ]);
})();

export function imButton(c: ImCache) {
    if (im.isFirstishRender(c)) imdom.setClass(c, cnButton);
}
