import { COL, ROW } from "./components/core/layout";
import { imBeginScrollContainer, ScrollContainer, scrollToItem, startScrolling } from "./components/scroll-container";
import { ANY_MODIFIERS, BYPASS_TEXT_AREA, GlobalContext, hasDiscoverableCommand, REPEAT, SHIFT } from "./global-context";
import { imBeginListRow, imEndListRow } from "./list-row";
import { getWrappedIdx } from "./utils/array-utils";
import { assert } from "./utils/assert";
import { imBeginList, imEnd, imEndList, imNextListRoot, imState, isEditingTextSomewhereInDocument, ValidKey } from "./utils/im-dom-utils";


// TODO: maybe there should be a keyboard module instead?


export type ListPosition = {
    idx: number;
};

export function newListPosition() {
    return { idx: 0 };
}

/** clamps the list idx. returns -1 if len is 0 */
export function clampedListIdx(idx: number, len: number): number {
    return clampedListIdxRange(idx, 0, len);
}

export function clampedListIdxRange(idx: number, min: number, maxEx: number): number {
    if (idx < min) idx = min;
    if (idx >= maxEx) idx = maxEx - 1;
    return idx;
}

export const AXIS_VERTICAL   = 0;
export const AXIS_HORIZONTAL = 1;
export const AXIS_TAB        = 2;

export type AxisType
    = typeof AXIS_VERTICAL
    | typeof AXIS_HORIZONTAL;

export const AXIS_FLAG_REPEATING = 1 << 0;

// NOTE: only works if called in the animation loop
export function getNavigableListInput(
    ctx: GlobalContext,
    idx: number,
    lo: number, hi: number,
    axis = AXIS_VERTICAL,
    flags = 0
): ({ newIdx: number } | null) {
    if (hi <= lo) return null;

    const keyboard = ctx.keyboard;

    const oldIdx = idx;
    let newIdx: number | undefined;

    // Arrays are rendered downards most of the time. traversing them by idx means that up goes down and down goes up
    // TODO: make these discoverable in a way that doesn't eat up a lot of space
    if (axis === AXIS_VERTICAL) {
        if (hasDiscoverableCommand(ctx, keyboard.upKey, "Up", REPEAT | ANY_MODIFIERS))     newIdx = oldIdx - 1;
        if (hasDiscoverableCommand(ctx, keyboard.downKey, "Down", REPEAT | ANY_MODIFIERS)) newIdx = oldIdx + 1;
    } else if (axis === AXIS_HORIZONTAL) {
        if (hasDiscoverableCommand(ctx, keyboard.leftKey,  "Left", REPEAT | ANY_MODIFIERS))   newIdx = oldIdx - 1;
        if (hasDiscoverableCommand(ctx, keyboard.rightKey, "Right", REPEAT | ANY_MODIFIERS)) newIdx = oldIdx + 1;
    }

    if (keyboard.pageUpKey.pressed) newIdx = oldIdx - 10;
    if (keyboard.pageDownKey.pressed) newIdx = oldIdx + 10;
    // if I'm editing text, I want to use these for horizontal movements instead of list movements.
    if (!isEditingTextSomewhereInDocument()) {
        if (keyboard.homeKey.pressed) newIdx = lo;
        if (keyboard.endKey.pressed) newIdx = hi - 1;
    }

    if (newIdx === undefined) return null;

    if (flags & AXIS_FLAG_REPEATING) {
        newIdx = lo + getWrappedIdx(newIdx, hi - lo);
    } else {
        newIdx = clampedListIdxRange(newIdx, lo, hi);
    }

    if (newIdx === -1) return null;

    ctx.handled = true;
    return { newIdx };
}

export type NavigableListState = {
    scrollContainer: ScrollContainer | null;
    viewHasFocus: boolean;

    currentListIdx: number;

    i: number;
    numItems: number;
    itemSelected: boolean;
    isEditing: boolean;

    isMassiveAhhList: boolean;
};

// HINT: it doesn't navigate at all. it just autoscrols to whatever is focused
function newNavigabeListState(): NavigableListState {
    return {
        scrollContainer: null,
        viewHasFocus: false,
        isEditing: false,

        currentListIdx: 0,

        i: -1,
        numItems: 0,
        itemSelected: false,

        isMassiveAhhList: false,
    };
}

export function imNavListNextItem(list: NavigableListState) {
    list.i++;
    list.itemSelected = list.i === list.currentListIdx;
    
    imNextListRoot();
}

export function imNavListNextItemArray<T extends ValidKey>(list: NavigableListState, items: T[]): boolean {
    list.i++;
    list.itemSelected = list.i === list.currentListIdx;

    let result = list.i < items.length;
    if (result) {
        imNextListRoot(items[list.i]);
    }

    return result;
}

export function imNavListNextItemSlice<T extends ValidKey>(
    list: NavigableListState,
    items: T[],
    start: number,
    end: number
): boolean {
    if (list.i === -1) {
        list.i = start;
    } else {
        list.i++;
    }

    let result = list.i < end;
    if (result) {
        imNextListRoot(items[list.i]);
        imNextListRoot();
        list.itemSelected = list.i === list.currentListIdx;
    }

    return result;
}
// TODO: virtalize when isMassiveAhhList=true;
export function imBeginNavList(
    scrollContainer: ScrollContainer,
    listPositionIdx: number,
    viewHasFocus: boolean,
    isEditing: boolean = false,
    row = false,
): NavigableListState {
    const s = imState(newNavigabeListState);

    if (s.currentListIdx !== listPositionIdx) {
        s.currentListIdx = listPositionIdx;
        startScrolling(scrollContainer, scrollContainer.smoothScroll);
    }

    s.scrollContainer = scrollContainer;
    s.viewHasFocus = viewHasFocus;
    s.isEditing = isEditing;
    s.i = -1;

    imBeginScrollContainer(s.scrollContainer, row ? ROW : COL); {
        imBeginList();

         /**
          * // user code 
          * while (imNavListNext(list, array)) {
          *     const { i, itemSelected } = list;
          *     const item = array[i];
          *     imBeginNavListItem(list, itemSelected); {
          *         user code; 
          *     } imEndNavListItem();
          * }
          */
         

        // imEndList();
    } // imEnd();

    return s;
}

export function imEndNavList(_list: NavigableListState) {
    _list.numItems = _list.i + 1;

    {
        {
        } imEndList();
    } imEnd();
}

// might need to render a component outside of a list, and inside of a list. hence list | null
export function imBeginNavListRow(
    list: NavigableListState | null,
    highlighted = false
) {
    const itemSelected = list ? list.itemSelected : false;

    const root = imBeginListRow(
        itemSelected || highlighted,
        list ? itemSelected && list.viewHasFocus : false,
        list ? itemSelected && list.isEditing : false,
    );

    if (itemSelected && list !== null) {
        assert(!!list.scrollContainer);
        scrollToItem(list.scrollContainer, root);
    }

    // imEndListRow();
}

// Should never accept the list as input. 
// A list row element may adjust it's behaviour based on the list state, but never do any mutations.
// It needs to be substitutable for a user component.
export function imEndNavListRow() {
    imEndListRow();
}

export type ViewsList = {
    idx: number;
    imLength: number;
    views: {
        focusRef: unknown;
        name: string;
    }[];
}

function newViewsList(): ViewsList {
    return { imLength: 0, views: [], idx: 0 };
}

export type FocusRef = { focused: unknown; };
export function newFocusRef(): FocusRef {
    return { focused: null };
}

export function imViewsList(focusRef: FocusRef): ViewsList {
    const s = imState(newViewsList);
    s.idx = clampedListIdx(s.idx, s.imLength);
    assert(s.imLength <= s.views.length);

    if (s.imLength > 0) {
        if (s.views[s.idx] !== focusRef.focused) {
            let idx = -1;
            for (let i = 0; i < s.views.length; i++) {
                if (s.views[i].focusRef === focusRef.focused) {
                    idx = i;
                    break;
                }
            }
            if (idx === -1) {
                idx = 0;
            }
            s.idx = idx;
            focusRef.focused = s.views[idx].focusRef;
        }
    }

    s.imLength = 0;

    return s;
}

export function addView(list: ViewsList, focusRef: unknown, name: string) {
    assert(list.imLength <= list.views.length);
    if (list.imLength === list.views.length) {
        list.views.push({ focusRef: null, name: "" });
    }

    list.views[list.imLength].focusRef = focusRef;
    list.views[list.imLength].name = name;
    list.imLength++;
}

export function getTabInput(
    ctx: GlobalContext,
    prevCommand: string | null,
    nextCommand: string | null,
) {
    const keyboard = ctx.keyboard;

    if (prevCommand !== null) {
        if (hasDiscoverableCommand(ctx, keyboard.tabKey, prevCommand, REPEAT | SHIFT | BYPASS_TEXT_AREA)) return -1;
    }
    if (nextCommand !== null) {
        if (hasDiscoverableCommand(ctx, keyboard.tabKey, nextCommand, REPEAT | BYPASS_TEXT_AREA)) return 1;
    }

    return 0;
}
