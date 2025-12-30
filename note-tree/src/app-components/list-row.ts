import { cssVarsApp } from "src/app-styling";
import { BLOCK, DisplayType, imLayoutBegin, imLayoutEnd, imPadding, imSize, NA, PX, ROW, SizeUnits, TABLE_CELL, TABLE_ROW } from "src/components/core/layout";
import { ImCache, imMemo, isFirstishRender } from "src/utils/im-core";
import { elSetStyle } from "src/utils/im-dom";

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

export function imListTableRowBegin(
    c: ImCache,
    highlighted: boolean,
    focused: boolean,
    isEditing = false
) {
    const status = getRowStatus(highlighted, focused, isEditing);
    const root = imLayoutBegin(c, TABLE_ROW); {
        imListCursorBg(c, status);

        if (isFirstishRender(c)) {
            elSetStyle(c, "borderLeft", "10px solid " + getCursorBgColourForStatus(status));
            elSetStyle(c, "paddingRight", "10px");
        }

    } // imLayoutEnd(c);

    return root;
} 
export function imListTableRowEnd(c: ImCache) {
    {
    } imLayoutEnd(c);
}

/** 
 * Contains a flex container immediately afterwards.
 * The amount of hacks I have had to do to get even css table working is insane.
 * TODO: learn css grid asap. Table sucks
 */
export function imTableCellFlexBegin(
    c: ImCache,
    type: DisplayType,
    colWidth: number = 0, units: SizeUnits = NA,
) {
    imLayoutBegin(c, TABLE_CELL); imSize(c, colWidth, units, 0, NA); {
        if (isFirstishRender(c)) {
            elSetStyle(c, "verticalAlign", "middle");
        }

        imLayoutBegin(c, type); {
            if (isFirstishRender(c)) {
                elSetStyle(c, "height", "100%");
            }
        } // imLayoutEnd(c);
    } // imLayoutEnd(c);
}

export function imTableCellFlexEnd(c: ImCache) {
    {
        {
        } imLayoutEnd(c);
    } imLayoutEnd(c);
}


export function imListRowBegin(
    c: ImCache,
    highlighted: boolean,
    focused: boolean,
    isEditing = false
) {
    const status = getRowStatus(highlighted, focused, isEditing);
    const root = imLayoutBegin(c, ROW); {
        imListCursorBg(c, status);

        imLayoutBegin(c, BLOCK); imSize(c, 10, PX, 0, NA); {
            imListCursorColor(c, status);
        } imLayoutEnd(c);

    } // imLayoutEnd(c);

    return root;
}

export function imListRowEnd(c: ImCache) {
    {
        imLayoutBegin(c, BLOCK); imSize(c, 10, PX, 0, NA); imLayoutEnd(c);
    } imLayoutEnd(c);
}


export function imListCursorBg(c: ImCache, status: RowStatus) {
    const statusChanged = imMemo(c, status);
    if (statusChanged) {
        elSetStyle(c, "backgroundColor", getBg(status));
    }
}

function getCursorBgColourForStatus(status: RowStatus) {
    if (status === ROW_FOCUSED) return cssVarsApp.fgColor;
    if (status === ROW_EDITING) return cssVarsApp.bgEditing
    return "";
}

export function imListCursorColor(c: ImCache, status: RowStatus) {
    const statusChanged = imMemo(c, status);
    if (statusChanged) {
        elSetStyle(c, "backgroundColor", getCursorBgColourForStatus(status));
    }
}


export function imEndListRowNoPadding(c: ImCache) {
    {
    } imLayoutEnd(c);
}

export function imListRowCellStyle(c: ImCache) {
    if (isFirstishRender(c)) {
        elSetStyle(c, "minHeight", "1em");
    }
    imPadding(c, 3, PX, 8, PX, 3, PX, 3, PX);
}
