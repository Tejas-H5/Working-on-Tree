import { imBeginScrollContainer, ScrollContainer, scrollToItem, startScrolling } from "./components/scroll-container";
import { GlobalContext } from "./global-context";
import { imBeginListRow, imEndListRow } from "./list-row";
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

// NOTE: only works if called in the animation loop
export function getNavigableListInput(
    ctx: GlobalContext,
    idx: number,
    lo: number, hi: number
): ({ newIdx: number } | null) {
    if (hi <= lo) return null;

    const keyboard = ctx.keyboard;

    const oldIdx = idx;
    let newIdx = -1;

    // Arrays are rendered downards most of the time. traversing them by idx means that up goes down and down goes up
    if (keyboard.upKey.pressed)       newIdx = oldIdx - 1;
    if (keyboard.downKey.pressed)     newIdx = oldIdx + 1;
    if (keyboard.pageUpKey.pressed)   newIdx = oldIdx - 10;
    if (keyboard.pageDownKey.pressed) newIdx = oldIdx + 10;
    // if I'm editing text, I want to use these for horizontal movements instead of list movements.
    if (!isEditingTextSomewhereInDocument()) {
        if (keyboard.homeKey.pressed) newIdx = lo;
        if (keyboard.endKey.pressed) newIdx = hi - 1;
    }

    // TODO: make this discoverable in a way that doesn't eat up a lot of space
    // TODO: modifiers
    // if (hasDiscoverableCommand(ctx, keyboard.upKey, "1 up", REPEAT | HIDDEN))           newIdx = oldIdx - 1;
    // if (hasDiscoverableCommand(ctx, keyboard.downKey, "1 down", REPEAT | HIDDEN))       newIdx = oldIdx + 1;
    // if (hasDiscoverableCommand(ctx, keyboard.pageUpKey, "10 up", REPEAT | HIDDEN))      newIdx = oldIdx - 10;
    // if (hasDiscoverableCommand(ctx, keyboard.pageDownKey, "10 down", REPEAT | HIDDEN))  newIdx = oldIdx + 10;
    // if (hasDiscoverableCommand(ctx, keyboard.homeKey, "Start", REPEAT | HIDDEN))        newIdx = lo;
    // if (hasDiscoverableCommand(ctx, keyboard.endKey, "End", REPEAT | HIDDEN))           newIdx = hi - 1;

    if (newIdx === -1) return null;

    newIdx = clampedListIdxRange(newIdx, lo, hi);
    ctx.handled = true;
    return { newIdx };
}

export type NavigableListState = {
    scrollContainer: ScrollContainer | null;
    viewHasFocus: boolean;

    listIdx: number;

    i: number;
    itemSelected: boolean;
    isEditing: boolean;

    isMassiveAhhList: boolean;
};

function newNavigabeListState(): NavigableListState {
    return {
        scrollContainer: null,
        viewHasFocus: false,
        isEditing: false,

        listIdx: 0,

        i: -1,
        itemSelected: false,

        isMassiveAhhList: false,
    };
}

export function imNavListNextArray<T extends ValidKey>(list: NavigableListState, items: T[]): boolean {
    list.i++;

    let result = list.i < items.length;
    if (result) {
        imNextListRoot(items[list.i]);
        imNextListRoot();
        list.itemSelected = list.i === list.listIdx;
    }

    return result;
}

export function imNavListNextSlice<T extends ValidKey>(
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
        list.itemSelected = list.i === list.listIdx;
    }

    return result;
}


// TODO: virtalize when isMassiveAhhList=true;
export function imBeginNavList(
    scrollContainer: ScrollContainer,
    listPositionIdx: number,
    viewHasFocus: boolean,
    isEditing: boolean = false,
): NavigableListState {
    const s = imState(newNavigabeListState);

    if (s.listIdx !== listPositionIdx) {
        s.listIdx = listPositionIdx;
        startScrolling(scrollContainer, scrollContainer.smoothScroll);
    }

    s.scrollContainer = scrollContainer;
    s.viewHasFocus = viewHasFocus;
    s.isEditing = isEditing;
    s.i = -1;

    imBeginScrollContainer(scrollContainer); {
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

export function imEndNavList(list: NavigableListState) {
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

export function imEndNavListRow(list: NavigableListState | null) {
    imEndListRow();
}

