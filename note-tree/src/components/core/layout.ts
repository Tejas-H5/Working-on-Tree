import { newCssBuilder } from 'src/utils/cssb.ts';
import {
    imBeginDiv,
    imBeginRoot,
    imEnd,
    imInit,
    imMemo,
    imMemoMany,
    imRef,
    imState,
    isExcessEventRender,
    isFirstRender,
    newDiv,
    pushAttr,
    setAttr,
    setClass,
    setStyle
} from 'src/utils/im-dom-utils.ts';
import { cn, cssVars } from "./stylesheets.ts";

export type SizeUnitInstance = number & { __sizeUnit: void; };

export const PX = 10001 as SizeUnitInstance;
export const EM = 20001 as SizeUnitInstance;
export const PERCENT = 30001 as SizeUnitInstance;
export const REM = 50001 as SizeUnitInstance;
export const CH = 50001 as SizeUnitInstance;
export const NOT_SET = 40001 as SizeUnitInstance;

export type SizeUnits = typeof PX |
    typeof EM |
    typeof PERCENT |
    typeof REM |
    typeof CH |
    typeof NOT_SET;

function getUnits(num: SizeUnits) {
    switch(num) {
        case PX:      return "px";
        case EM:      return "em";
        case PERCENT: return "%";
        case REM:     return "rem";
        case CH:      return "ch";
        default:      return "px";
    }
}

function getSize(num: number, units: SizeUnits) {
    return units === NOT_SET ? "" : num + getUnits(units);
}

function newSizeState(): { width: number; height: number; wType: number; hType: number; } {
    return { width: 0, height: 0, wType: 0, hType: 0 };
}

export function imSize(
    width: number, wType: SizeUnits,
    height: number, hType: SizeUnits, 
) {
    const val = imState(newSizeState);

    if (val.width !== width || val.wType !== wType) {
        val.width = width;
        val.wType = wType;
        setStyle("minWidth", getSize(width, wType));
        setStyle("maxWidth", getSize(width, wType));
    }

    if (val.height !== height || val.hType !== hType) {
        val.height = height;
        val.hType = hType;
        setStyle("minHeight", getSize(height, hType));
        setStyle("maxHeight", getSize(height, hType));
    }
}

export function imOpacity(val: number) {
    if (imMemo(val)) {
        setStyle("opacity", "" + val);
    }
}

function newPaddingState(): {
    left: number, leftType: SizeUnits,
    right: number, rightType: SizeUnits, 
    top: number, topType: SizeUnits,
    bottom: number, bottomType: SizeUnits, 
} {
    return { 
        left: 0, leftType: NOT_SET,
        right: 0, rightType: NOT_SET,
        top: 0, topType: NOT_SET,
        bottom: 0, bottomType: NOT_SET,
    };
}

export function imPadding(
    left: number, leftType: SizeUnits,
    right: number, rightType: SizeUnits, 
    top: number, topType: SizeUnits,
    bottom: number, bottomType: SizeUnits, 
) {
    const val = imState(newPaddingState);

    if (isExcessEventRender()) {
        return;
    }

    if (val.left !== left || val.leftType !== leftType) {
        val.left = left; val.leftType = leftType;
        setStyle("paddingLeft", getSize(left, leftType));
    }

    if (val.right !== right || val.rightType !== rightType) {
        val.right = right; val.rightType = rightType;
        setStyle("paddingRight", getSize(right, rightType));
    }

    if (val.top !== top || val.topType !== topType) {
        val.top = top; val.topType = topType;
        setStyle("paddingTop", getSize(top, topType));
    }

    if (val.bottom !== bottom || val.bottomType !== bottomType) {
        val.bottom = bottom; val.bottomType = bottomType;
        setStyle("paddingBottom", getSize(bottom, bottomType));
    }
}

export function imRelative() {
    if (isFirstRender()) {
        setClass(cn.relative);
    }
}

export function imBg(colour: string) {
    if (imMemo(colour)) {
        setStyle("backgroundColor", colour);
    }
}

export type DisplayTypeInstance = number & { __displayType: void; };

export const BLOCK = 1 as DisplayTypeInstance;
export const INLINE_BLOCK = 2 as DisplayTypeInstance;
export const INLINE = 3 as DisplayTypeInstance;
export const ROW = 4 as DisplayTypeInstance;
export const ROW_REVERSE = 5 as DisplayTypeInstance;
export const COL = 6 as DisplayTypeInstance;
export const COL_REVERSE = 7 as DisplayTypeInstance;
export const TABLE = 8 as DisplayTypeInstance;
export const TABLE_ROW = 9 as DisplayTypeInstance;
export const TABLE_CELL = 10 as DisplayTypeInstance;

type DisplayType = 
    typeof BLOCK |
    typeof INLINE_BLOCK |
    typeof ROW |
    typeof ROW_REVERSE |
    typeof COL |
    typeof COL_REVERSE |
    typeof TABLE |
    typeof TABLE_ROW |
    typeof TABLE_CELL;


export function imBegin(type: DisplayType = BLOCK, supplier = newDiv) {
    const root = imBeginRoot(supplier);
    if (imMemo(type)) {
        setClass(cn.inlineBlock, type === INLINE_BLOCK);
        setClass(cn.inline, type === INLINE);
        setClass(cn.row, type === ROW);
        setClass(cn.rowReverse, type === ROW_REVERSE);
        setClass(cn.col, type === COL);
        setClass(cn.colReverse, type === COL_REVERSE);
        setClass(cn.table, type === TABLE);
        setClass(cn.tableRow, type === TABLE_ROW);
        setClass(cn.tableCell, type === TABLE_CELL);
    }

    return root;
}

export function imFlex(val = 1) {
    if (imMemo(val)) {
        setStyle("flex", "" + val);
    }
}

export function imScrollContainer(vScroll = true, hScroll = false) {
    if (imMemo(vScroll)) {
        setClass(cn.overflowYAuto, vScroll);
    }

    if (imMemo(hScroll)) {
        setClass(cn.overflowXAuto, hScroll);
    }
}

export function imFixed(
    top: number | null,
    left: number | null,
    bottom: number | null,
    right: number | null,
) {
    if (isFirstRender()) {
        setClass(cn.fixed);
    }
    
    if (imMemoMany(top, bottom, left, right)) {
        setStyle("top", top === null ? "" : top + "px");
        setStyle("left", left === null ? "" : left + "px");
        setStyle("bottom", bottom === null ? "" : bottom + "px");
        setStyle("right", right === null ? "" : right + "px");
    } 
}

export function imAbsolute(
    left: number, leftType: SizeUnits,
    right: number, rightType: SizeUnits, 
    top: number, topType: SizeUnits,
    bottom: number, bottomType: SizeUnits, 
) {
    if (isFirstRender()) {
        setClass(cn.absolute);
    }

    const val = imState(newPaddingState);

    if (isExcessEventRender()) {
        return;
    }
    
    if (val.left !== left || val.leftType !== leftType) {
        val.left = left; val.leftType = leftType;
        setStyle("left", getSize(left, leftType));
    }

    if (val.right !== right || val.rightType !== rightType) {
        val.right = right; val.rightType = rightType;
        setStyle("right", getSize(right, rightType));
    }

    if (val.top !== top || val.topType !== topType) {
        val.top = top; val.topType = topType;
        setStyle("top", getSize(top, topType));
    }

    if (val.bottom !== bottom || val.bottomType !== bottomType) {
        val.bottom = bottom; val.bottomType = bottomType;
        setStyle("bottom", getSize(bottom, bottomType));
    }
}

export function imBeginScrollContainer(noScroll: boolean = false) {
    const root = imBeginDiv();

    if (imMemo(noScroll)) {
        if (noScroll) {
            setStyle("overflow", "hidden");
            setClass(cn.overflowYAuto, false);
        } else {
            setClass(cn.overflowYAuto, true);
        }
    }

    return root;
}

export function imBeginAspectRatio(w: number, h: number) {
    const lastAr = imRef();
    const root = imBegin(); {
        if (isFirstRender()) {
            setStyle("width", "auto");
            setStyle("height", "auto");
        }

        const ar = w / h;
        if (lastAr.val !== ar) {
            lastAr.val = ar;
            setStyle("aspectRatio", w + " / " + h);
        }
    };

    return root;
}

export function imVerticalBar() {
    imBeginDiv(); {
        if (isFirstRender()) {
            setAttr("style", `width: 5px; background-color: ${cssVars.fg}; margin: 0px 5px;`);
        }
    } imEnd();
}


export function setInset(amount: string) {
    if (amount) {
        setClass(cn.borderBox);
        setStyle("padding", amount);
    } else {
        setClass(cn.borderBox, false);
        setStyle("padding", "");
    }
}

/** 
 * Try to make sure you aren't allocating memory when you create {@link val};
 */
export function imInitStyles(val: string) {
    if (imInit()) {
        pushAttr("style", val);
        return true;
    }
    return false;
}

/** 
 * Try to make sure you aren't passing in an actual array here.
 * Otherwise, you'll just be creating garbage every frame.
 */
export function imInitClasses(..._val: string[]) {
    if (isFirstRender()) {
        for (let i = 0; i < arguments.length; i++) {
            setClass(arguments[i]);
        }
    }
}

export function imDebug() {
    imInitClasses(cn.debug1pxSolidRed);
}
