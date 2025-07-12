import { cssVarsApp } from "./app-styling";
import {
    imBegin,
    imPadding,
    imSize,
    NOT_SET,
    PX,
    ROW
} from "./components/core/layout";
import {
    imEnd,
    imMemo,
    isFirstishRender,
    setStyle
} from "./utils/im-dom-utils";


export function imBeginListRow(focused: boolean, editing = false) {
    const focusChanged = imMemo(focused);
    const editingChanged = imMemo(editing);

    const root = imBegin(ROW); {
        if (focusChanged) {
            setStyle("backgroundColor", focused ? cssVarsApp.bgColorFocus : "");
        }

        imBegin(); imSize(10, PX, 0, NOT_SET); {
            if (focusChanged || editingChanged) {
                setStyle("backgroundColor", 
                    focused ? ( editing ? cssVarsApp.bgEditing : cssVarsApp.fgColor) : ""
                );
            }
        } imEnd();

    } // imEnd();

    return root;
}

export function imEndListRow() {
    imEnd();
}

export function imListRowCellStyle() {
    if (isFirstishRender()) {
        setStyle("minHeight", "1em");
    }
    imPadding(8, PX, 3, PX, 3, PX, 3, PX);
}

