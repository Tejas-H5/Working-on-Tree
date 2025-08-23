import { cssVarsApp } from "./app-styling";
import {
    BLOCK,
    imLayout,
    imLayoutEnd,
    imPadding,
    imSize,
    NA,
    PX,
    ROW
} from "./components/core/layout";
import { isSelected } from "./legacy-app-components/canvas-state";
import { ImCache, imMemo, isFirstishRender } from "./utils/im-core";
import { elSetStyle } from "./utils/im-dom";

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

// API is a bit strange but I can't put my finger on it...
export function getRowStatus(
    highlighted: boolean,
    focused: boolean,
    isEditing = false
): RowStatus {
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
    return status;
}

export function imBeginListRow(
    c: ImCache,
    highlighted: boolean,
    focused: boolean,
    isEditing = false
) {
    const status = getRowStatus(highlighted, focused, isEditing);
    const root = imLayout(c, ROW); {
        imListCursorBg(c, status);

        imLayout(c, BLOCK); imSize(c, 10, PX, 0, NA); {
            imListCursorColor(c, status);
        } imLayoutEnd(c);

    } // imLayoutEnd(c);

    return root;
}

export function imListCursorBg(c: ImCache, status: RowStatus) {
    const statusChanged = imMemo(c, status);
    if (statusChanged) {
        elSetStyle(c, "backgroundColor", getBg(status));
    }
}

export function imListCursorColor(c: ImCache, status: RowStatus) {
    const statusChanged = imMemo(c, status);
    if (statusChanged) {
        elSetStyle(c, "backgroundColor",
            status === ROW_FOCUSED ? cssVarsApp.fgColor
                : status === ROW_EDITING ? cssVarsApp.bgEditing
                    : ""
        );
    }
}

export function imEndListRow(c: ImCache) {
    {
        imLayout(c, BLOCK); imSize(c, 10, PX, 0, NA); imLayoutEnd(c);
    } imLayoutEnd(c);
}

export function imEndListRowNoPadding(c: ImCache) {
    {
    } imLayoutEnd(c);
}

export function imListRowCellStyle(c: ImCache) {
    if (isFirstishRender(c)) {
        elSetStyle(c, "minHeight", "1em");
    }
    imPadding(c, 8, PX, 3, PX, 3, PX, 3, PX);
}

