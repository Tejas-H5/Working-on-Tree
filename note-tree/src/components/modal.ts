import { cssVars } from "src/styling";
import { newCssBuilder } from "src/utils/cssb";
import { elementHasMousePress, imBeginDiv, imEnd, imInit, imOn, setAttr, setClass } from "src/utils/im-dom-utils";

const BG_COLOR = cssVars.bgColor;
const UNDERLAY_COLOR = "rgba(0, 0, 0, 0.5)";

const cssb = newCssBuilder();
const cnModal = cssb.cn("cnModal", [` { 
    top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; 
    background-color: ${UNDERLAY_COLOR}; pointer-events: all; 
    position: fixed;
    display: flex; flex-direction: row; align-items: center; justify-content: center;
}`]);

export function imBeginModal() {
    const root = imBeginDiv(); {
        if (imInit()) {
            setClass(cnModal);
        }

        imBeginDiv(); {
            if (imInit()) {
                setAttr("style", `background-color: ${BG_COLOR}`);
            }

        } // imEnd();
    } // imEnd();

    return root;
}

export function imEndModal(): boolean {
    let remainOpen = true;

    // outer div
    {
        let clickedInsideModal = false;

        // inner div
        {

            clickedInsideModal = elementHasMousePress();
        } imEnd();

        if (!clickedInsideModal && elementHasMousePress()) {
            remainOpen = false;
        }
    } imEnd();

    return remainOpen;
}
