import { cssVarsApp } from "src/app-styling";
import { im, ImCache, imdom } from "src/utils/im-js";
import { BLOCK, DisplayType, imui, NA, PX, ROW, SizeUnits } from "src/utils/im-js/im-ui";


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

// API is a bit strange but I can't put my finger on why...
export function getRowStatus(
    highlighted: boolean,
    selected: boolean,
    focused: boolean,
    isEditing = false
): RowStatus {
    let status: RowStatus = ROW_EXISTS;
    if (highlighted) {
        status = ROW_HIGHLIGHTED;
        if (selected) { 
            status = ROW_SELECTED;
            if (focused) {
                status = ROW_FOCUSED;
                if (isEditing) {
                    status = ROW_EDITING;
                }
            }
        }
    }
    return status;
}

export function imListRowBegin(
    c: ImCache,
    highlighted: boolean,
    selected: boolean,
    focused: boolean,
    isEditing = false
) {
    const status = getRowStatus(highlighted, selected, focused, isEditing);
    const root = imui.Begin(c, ROW); {
        imListCursorBg(c, status);

        imui.Begin(c, BLOCK); imui.Size(c, 10, PX, 0, NA); {
            imListCursorColor(c, status);
        } imui.End(c);

    } // imui.End(c);

    return root;
}

export function imListRowEnd(c: ImCache) {
    {
        imui.Begin(c, BLOCK); imui.Size(c, 10, PX, 0, NA); imui.End(c);
    } imui.End(c);
}


export function imListCursorBg(c: ImCache, status: RowStatus) {
    const statusChanged = im.Memo(c, status);
    if (statusChanged) {
        imdom.setStyle(c, "backgroundColor", getBg(status));
    }
}

function getCursorBgColourForStatus(status: RowStatus) {
    if (status === ROW_FOCUSED) return cssVarsApp.fgColor;
    if (status === ROW_EDITING) return cssVarsApp.bgEditing
    if (status === ROW_SELECTED) return cssVarsApp.bgColorFocus;
    return "";
}

export function imListCursorColor(c: ImCache, status: RowStatus) {
    const statusChanged = im.Memo(c, status);
    if (statusChanged) {
        imdom.setStyle(c, "backgroundColor", getCursorBgColourForStatus(status));
    }
}


export function imEndListRowNoPadding(c: ImCache) {
    {
    } imui.End(c);
}

export function imListRowCellStyle(c: ImCache) {
    if (im.isFirstishRender(c)) {
        imdom.setStyle(c, "minHeight", "1em");
    }
    imui.Padding(c, 3, PX, 8, PX, 3, PX, 3, PX);
}
