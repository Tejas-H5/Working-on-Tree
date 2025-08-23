// import { cssVars } from "src/legacy-app-components/legacy-styling";
// import { formatDateTime, parseYMDTDateTime } from "src/utils/datetime";
// import { cn, div, el, isEditingInput, newComponent, RenderGroup, setInputValueAndResize, setStyle, setText, setVisible } from "src/utils/dom-utils";
// import { Checkbox } from "./checkbox";
//
// export function DateTimeInput(rg: RenderGroup<{
//     readOnly: boolean;
//     nullable: boolean;
//     value: Date | null;
//     label: string;
//     onChange(val: Date | null): void;
// }>) {
//     const show = div();
//     const edit = el<HTMLInputElement>("INPUT", { class: [cn.preWrap] });
//     const checkbox = newComponent(Checkbox);
//     const root = div({ class: [cn.row], style: "" }, [
//         checkbox,
//         div(
//             { class: [cn.row, cn.alignItemsCenter], style: "width: 100%; height: 100%; padding-left: 5px; padding-right: 5px" },
//             [
//                 show, 
//                 edit,
//             ]
//         )
//     ]);
//
//     let lastDate: Date | null = null;
//
//     rg.preRenderFn(function renderDateTimeInput(s) {
//         const { value, label, readOnly, nullable } = s;
//
//         const canEdit = readOnly && !!value;
//
//         if (setVisible(checkbox, !readOnly && nullable)) {
//             checkbox.render({
//                 label,
//                 value: !!value,
//                 onChange: onCheckOrUncheck,
//             });
//         }
//
//         const dateText = formatDateTime(value, undefined, true);
//
//         if (setVisible(show, canEdit)) {
//             setText(show, label + " " + dateText);
//         }
//
//         if (setVisible(edit, !canEdit)) {
//             if (!isEditingInput(edit)) {
//                 setInputValueAndResize(edit, dateText);
//             }
//         }
//
//         if (value) {
//             lastDate = value;
//         }
//
//         setStyle(root, `color`, !!value ? `` : `${cssVars.unfocusTextColor}`);
//     });
//     
//     function onCheckOrUncheck(b: boolean) {
//         const s = rg.s;
//         const { onChange } = s;
//
//         if (b) {
//             onChange(lastDate || new Date());
//         } else {
//             onChange(null);
//         }
//     }
//
//     function handleTextfieldEdit() {
//         const s = rg.s;
//         const { onChange } = s;
//         const value = edit.el.value;
//
//         const [date, err] = parseYMDTDateTime(value);
//
//         if (date === null) {
//             console.error("Error parsing date", value, err);
//             onChange(lastDate);
//             return;
//         }
//
//         onChange(date);
//         edit.el.blur();
//         // no render call here, onChange is responsible for rendering this component
//     }
//
//     edit.el.addEventListener("keypress", (e) => {
//         if (e.key === "Enter") {
//             handleTextfieldEdit();
//         }
//     });
//
//     edit.el.addEventListener("blur", () => {
//         handleTextfieldEdit();
//     });
//
//     return root;
// }
