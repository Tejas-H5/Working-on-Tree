// import { el, on, RenderGroup, setAttr, setInputValue, setInputValueAndResize } from "src/utils/dom-utils";
//
// export function TextInput(rg: RenderGroup<{
//     value: string;
//     onChange(newValue: string, changed: boolean): void;
//     /** 
//      * Should this component recieve focus? 
//      * It's up to you to make sure only one thing in your app is focused at a time.
//      **/
//     focus?: boolean;
//     focusWithAllSelected?: boolean;
//     autoSize?: boolean;
//     placeholder?: string;
// }>) {
//     const input = el<HTMLInputElement>("INPUT");
//
//     let focused = false;
//
//     rg.preRenderFn((s) => {
//         setAttr(input, "placeholder", s.placeholder);
//
//         if (document.activeElement !== input.el) {
//             if (s.autoSize) {
//                 setInputValueAndResize(input, s.value);
//             } else {
//                 setInputValue(input, s.value);
//             }
//         }
//
//         if (s.focus !== undefined) {
//             const changed = s.focus !== focused;
//
//             if (changed) {
//                 if (s.focus) {
//                     input.el.focus();
//                     if (s.focusWithAllSelected) {
//                         input.el.selectionStart = 0;
//                         input.el.selectionEnd = s.value.length;
//                     }
//                 } else {
//                     input.el.blur();
//                 }
//             } 
//         }
//
//     });
//
//     on(input, "input", () => rg.s.onChange(input.el.value, false));
//     on(input, "change", () => rg.s.onChange(input.el.value, true));
//
//     on(input, "blur", () => {
//         // lots of things can focus/unfocus this input, not just our prop. 
//         // focused must always be up-to-date.
//         focused = false
//
//         rg.s.onChange(input.el.value, true);
//     });
//     on(input, "focus", () => focused = true);
//
//     return input;
// }
