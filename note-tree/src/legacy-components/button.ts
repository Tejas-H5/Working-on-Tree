// import { cnApp } from "src/legacy-app-components/legacy-styling";
// import { RenderGroup, cn, el } from "src/utils/dom-utils";
//
// const BUTTON_CLASSES = [
//     cnApp.solidBorder, 
//
//     cn.row,
//     cn.alignItemsCenter,
//     cn.justifyContentCenter,
// ].join(" ");
//
// // NOTE: don't use this button in future projects. It's shite
// export function Button(c: RenderGroup<{ 
//     label: string; 
//     toggled?: boolean;
//     inline?: boolean;
//     disabled?: boolean;
//     className?: string; 
//     style?: string;
//     onClick: (e: MouseEvent) => void;
// }>) {
//     const buttonClass = BUTTON_CLASSES;
//     const buttonStyle = `border-radius: 6px; min-width: 1.4em; min-height: 1.4em; padding: 3px; margin: 5px;`
//     return el<HTMLButtonElement>("BUTTON", { 
//         type: "button",
//         class: []
//     }, [
//         c.attr("class", (s) => buttonClass + " " + (s.className || "") + " "),
//         c.attr("style", (s) => buttonStyle + (s.style || "")),
//         c.attr("disabled", s => s.disabled ? "" : undefined),
//         c.class("inline-block", (s) => !!s.inline),
//         c.class("inverted", (s) => !!s.toggled),
//         c.on("click", (s, e) => s.onClick(e)),
//         c.text((s) => s.label),
//     ]);
// }
//
