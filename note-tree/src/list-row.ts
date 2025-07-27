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
    imIsFirstishRender,
    setStyle
} from "./utils/im-dom-utils";


type RowStatusInstance = number & { __rowStatus: void; };

const ROW_EXISTS      = 0 as RowStatusInstance;
const ROW_HIGHLIGHTED = 1 as RowStatusInstance;
const ROW_SELECTED    = 2 as RowStatusInstance;
const ROW_FOCUSED     = 3 as RowStatusInstance;
const ROW_EDITING     = 4 as RowStatusInstance;

type RowStatus
    = typeof ROW_EXISTS
    | typeof ROW_HIGHLIGHTED
    | typeof ROW_SELECTED
    | typeof ROW_FOCUSED
    | typeof ROW_EDITING;

function getBg(status: RowStatus): string {
    switch(status) {
        case ROW_HIGHLIGHTED: return cssVarsApp.bgColorFocus2;
        case ROW_SELECTED:    return cssVarsApp.bgColorFocus2;
        case ROW_FOCUSED:     return cssVarsApp.bgColorFocus;
        case ROW_EDITING:     return cssVarsApp.bgColorFocus;
    }
    return "";
}

export function imBeginListRow(
    highlighted: boolean,
    focused: boolean,
    isEditing = false
) {
    let status: RowStatus = ROW_EXISTS;
    if (highlighted) {
        status = ROW_SELECTED;
        if (focused) {
            status = ROW_FOCUSED;
            if (isEditing) {
                status = ROW_EDITING;
            }
        }
    }

    const statusChanged = imMemo(status);
    const root = imBegin(ROW); {
        if (statusChanged) {
            setStyle("backgroundColor", getBg(status));
        }

        imBegin(); imSize(10, PX, 0, NOT_SET); {
            if (statusChanged) {
                setStyle("backgroundColor",
                    status === ROW_FOCUSED ? cssVarsApp.fgColor 
                        : status === ROW_EDITING ? cssVarsApp.bgEditing
                        : ""
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
    if (imIsFirstishRender()) {
        setStyle("minHeight", "1em");
    }
    imPadding(8, PX, 3, PX, 3, PX, 3, PX);
}

