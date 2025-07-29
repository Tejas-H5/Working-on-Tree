import { COL, imBegin, imFlex } from "./components/core/layout";
import { newScrollContainer, ScrollContainer } from "./components/scroll-container";
import { addToNavigationList, APP_VIEW_FAST_TRAVEL, GlobalContext } from "./global-context";
import { imListRowCellStyle } from "./list-row";
import { clampedListIdx, getNavigableListInput, imBeginNavList, imBeginNavListRow, imEndNavList, imEndNavListRow, imNavListNextArray, ListPosition, newListPosition } from "./navigable-list";
import { getNote, getRootNote, setCurrentNote, state, TreeNote } from "./state";
import { get } from "./utils/array-utils";
import { imEnd, imEndWhile, imMemo, imState, imWhile, setText } from "./utils/im-dom-utils";

export type FuzzyFinderViewState = {
    scrollContainer: ScrollContainer;
    listPosition: ListPosition;
    query: string;

    notes: TreeNote[];
    noteBeforeFocus: TreeNote | null;
};

export function newFuzzyFinderViewState(): FuzzyFinderViewState {
    return {
        notes: [],
        noteBeforeFocus: null,
        query: "",

        scrollContainer: newScrollContainer(),
        listPosition:    newListPosition(),
    };
}

function setIdx(
    ctx: GlobalContext,
    s: FuzzyFinderViewState,
    idx: number
) {
    s.listPosition.idx = clampedListIdx(idx, s.notes.length);
    const note = get(s.notes, s.listPosition.idx);
    if (note) {
        setCurrentNote(
            state,
            note.id,
            s.noteBeforeFocus?.id
        );
    }
}

function handleKeyboardInput(ctx: GlobalContext, s: FuzzyFinderViewState) {
    const listNavigation = getNavigableListInput(ctx, s.listPosition.idx, 0, s.notes.length);
    if (listNavigation) {
        setIdx(ctx, s, listNavigation.newIdx);
    }
}

function recomputeTraversal(s: FuzzyFinderViewState) {
    s.notes.length = 0;

    const dfs = (note: TreeNote) => {
        if (s.notes.length > 10) return;

        for (const id of note.childIds) {
            const child = getNote(state, id);
            dfs(child);

            s.notes.push(child);
        }
    }

    const root = getRootNote(state);
    dfs(root);

    s.notes.sort((a, b) => b.data.editedAt.getTime() - a.data.editedAt.getTime());

    // TODO: finish

}

export function imFuzzyFinder(
    ctx: GlobalContext,
    viewHasFocus: boolean
) {
    addToNavigationList(ctx, APP_VIEW_FAST_TRAVEL);

    const s = imState(newFuzzyFinderViewState);

    if (viewHasFocus) handleKeyboardInput(ctx, s);

    if (imMemo(s.query)) recomputeTraversal(s);

    imBegin(COL); imFlex(); {
        const list = imBeginNavList(
            s.scrollContainer,
            s.listPosition,
            viewHasFocus
        ); {
            imWhile(); while (imNavListNextArray(list, s.notes)) {
                const { i } = list;
                const item = s.notes[i];

                imBeginNavListRow(list); {
                    imBegin(); imListRowCellStyle(); {
                        setText(item.data.text); 
                    } imEnd();
                } imEndNavListRow(list);

            } imEndWhile();
        } imEndNavList(list);
    } imEnd();
}
