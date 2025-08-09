import { imBeginRoot, imInit, imIsFirstishRender, imMemo, imRef, imState, isExcessEventRender } from 'src/utils/im-utils-core.ts';
import { imBeginDiv, newDiv, pushAttr, setClass, setStyle } from 'src/utils/im-utils-dom';
import { cn } from "./stylesheets.ts";

// It occurs to me that I can actually just make my own fully custom layout system that significantly minimizes
// number of DOM nodes required to get things done.

export type SizeUnitInstance = number & { __sizeUnit: void; };

export const PX = 10001 as SizeUnitInstance;
export const EM = 20001 as SizeUnitInstance;
export const PERCENT = 30001 as SizeUnitInstance;
export const REM = 50001 as SizeUnitInstance;
export const CH = 50001 as SizeUnitInstance;
export const NA = 40001 as SizeUnitInstance; // Not applicable. Nahh. 

export type SizeUnits = typeof PX |
    typeof EM |
    typeof PERCENT |
    typeof REM |
    typeof CH |
    typeof NA;

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
    return units === NA ? "" : num + getUnits(units);
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

type PaddingState = {
    left: number, leftType: SizeUnits,
    right: number, rightType: SizeUnits, 
    top: number, topType: SizeUnits,
    bottom: number, bottomType: SizeUnits, 
};
function newPaddingState(): PaddingState {
    return { 
        left: 0, leftType: NA,
        right: 0, rightType: NA,
        top: 0, topType: NA,
        bottom: 0, bottomType: NA,
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
    if (imIsFirstishRender()) {
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
        // required to make flex work the way you would think.
        setStyle("minWidth", "0");
        setStyle("minHeight", "0");
    }
}

export function imGap(val = 0, units: SizeUnits) {
    const valChanged = imMemo(val);
    const unitsChanged = imMemo(units);
    if (valChanged !== 0 || unitsChanged !== 0) {
        setStyle("gap", getSize(val, units));
    }
}

// Add more as needed
export const NONE = 0;
export const CENTER = 1;
export const LEFT = 2;
export const RIGHT = 3;
export const STRETCH = 4;

function getAlignment(alignment: number) {
    switch(alignment) {
        case NONE:    return "";
        case CENTER:  return "center";
        case LEFT:    return "left";
        case RIGHT:   return "right";
        case STRETCH: return "stretch";
    }
    return "";
}

export function imAlign(alignment = CENTER) {
    if (imMemo(alignment)) {
        setStyle("alignItems", getAlignment(alignment));
    }
}

export function imJustify(alignment = CENTER) {
    if (imMemo(alignment)) {
        setStyle("justifyContent", getAlignment(alignment));
    }
}

export function imScrollOverflow(vScroll = true, hScroll = false) {
    if (imMemo(vScroll)) {
        setClass(cn.overflowYAuto, vScroll);
    }

    if (imMemo(hScroll)) {
        setClass(cn.overflowXAuto, hScroll);
    }
}


export function imFixed(
    top: number, topType: SizeUnits,
    left: number, leftType: SizeUnits,
    bottom: number, bottomType: SizeUnits,
    right: number, rightType: SizeUnits,
) {
    if (imIsFirstishRender()) {
        setClass(cn.fixed);
    }

    const val = imState(newPaddingState);
    
    applyOffsets(
        val,
        left, leftType,
        right, rightType, 
        top, topType,
        bottom, bottomType, 
    ); 
}

export function imAbsolute(
    left: number, leftType: SizeUnits,
    right: number, rightType: SizeUnits, 
    top: number, topType: SizeUnits,
    bottom: number, bottomType: SizeUnits, 
) {
    if (imIsFirstishRender()) {
        setClass(cn.absolute);
    }

    const val = imState(newPaddingState);
    
    applyOffsets(
        val,
        left, leftType,
        right, rightType, 
        top, topType,
        bottom, bottomType, 
    );
}

function applyOffsets(
    val: PaddingState,
    left: number, leftType: SizeUnits,
    right: number, rightType: SizeUnits, 
    top: number, topType: SizeUnits,
    bottom: number, bottomType: SizeUnits, 
) {
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

export function imBeginOverflowContainer(noScroll: boolean = false) {
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
        if (imIsFirstishRender()) {
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
    if (imIsFirstishRender()) {
        for (let i = 0; i < arguments.length; i++) {
            setClass(arguments[i]);
        }
    }
}

export function imDebug() {
    imInitClasses(cn.debug1pxSolidRed);
}

