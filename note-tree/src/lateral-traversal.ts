import { imLine } from "./app-components/common";
import { COL, imAlign, imBegin, imFlex, imJustify, INLINE, ROW } from "./components/core/layout";
import { newScrollContainer, ScrollContainer, startScrolling } from "./components/scroll-container";
import { addToNavigationList, APP_VIEW_FAST_TRAVEL, APP_VIEW_NOTES, GlobalContext, hasDiscoverableCommand } from "./global-context";
import { imListRowCellStyle } from "./list-row";
import {
    clampedListIdx,
    getNavigableListInput,
    imBeginNavList,
    imBeginNavListRow,
    imEndNavList,
    imEndNavListRow,
    imNavListNextArray,
    ListPosition,
    newListPosition
} from "./navigable-list";
import { getNoteViewRoot } from "./note-tree-view";
import {
    getCurrentNote,
    getNote,
    isHigherLevelTask,
    NoteId,
    setCurrentNote,
    state,
    STATUS_IN_PROGRESS,
    TreeNote
} from "./state";
import { get } from "./utils/array-utils";
import {
    HORIZONTAL,
    imEnd,
    imEndIf,
    imIf,
    imIsFirstishRender,
    imMemo,
    imMemoMany,
    imNextListRoot,
    imState,
    setStyle,
    setText
} from "./utils/im-dom-utils";


export type NoteTraversalViewState = {
    viewRoot: TreeNote | null;
    noteBeforeFocus: TreeNote | null;
    notes: TreeNote[];

    scrollContainer: ScrollContainer;
    listPosition: ListPosition;
};

export function newNoteTraversalViewState(): NoteTraversalViewState {
    return {
        viewRoot: null,
        noteBeforeFocus: null,
        notes: [],

        scrollContainer: newScrollContainer(),
        listPosition: newListPosition(),
    };
}

function setIdx(
    ctx: GlobalContext,
    s: NoteTraversalViewState,
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

function handleKeyboardInput(ctx: GlobalContext, s: NoteTraversalViewState) {
    const current = getCurrentNote(state);

    const listNavigation = getNavigableListInput(ctx, s.listPosition.idx, 0, s.notes.length);
    if (listNavigation) {
        setIdx(ctx, s, listNavigation.newIdx);
    }

    if (s.viewRoot && hasDiscoverableCommand(ctx, ctx.keyboard.leftKey, "Move out")) {
        recomputeTraversal(s, s.viewRoot.id, false);
    }

    if (
        isHigherLevelTask(current) && 
        current.childIds.length > 0 && 
        hasDiscoverableCommand(ctx, ctx.keyboard.rightKey, "Move in")
    ) {
        recomputeTraversal(s, current.childIds[0], false);
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Go to note")) {
        ctx.currentScreen = APP_VIEW_NOTES;
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Back")) {
        if (s.noteBeforeFocus) {
            setCurrentNote(state, s.noteBeforeFocus.id);
        }
        ctx.currentScreen = APP_VIEW_NOTES;
    }


    // TODO: left/right should move up/down high level tasks
}

function recomputeTraversal(s: NoteTraversalViewState, noteId: NoteId, useNotePosition: boolean) {
    s.notes.length = 0;


    // TODO: sort by date last edited

    const note = getNote(state, noteId);
    s.viewRoot = getNoteViewRoot(state, note);

    const dfs = (note: TreeNote, doThing: boolean) => {
        if (doThing) {
            if (note.data._status === STATUS_IN_PROGRESS) {
                const isHlt = isHigherLevelTask(note);
                if (note.childIds.length === 0 || isHlt) {
                    s.notes.push(note);

                    // don't go further into this note
                    return;
                }
            }
        }

        for (const id of note.childIds) {
            const child = getNote(state, id);
            dfs(child, true);
        }
    }

    dfs(s.viewRoot, false);

    s.notes.sort((a, b) => b.data.editedAt.getTime() - a.data.editedAt.getTime());

    const idx = s.notes.indexOf(note);
    if (useNotePosition && idx !== -1) {
        s.listPosition.idx = idx;
    } else if (s.notes.length > 0) {
        s.listPosition.idx = 0;
        noteId = s.notes[0].id;
    }

    if (state.currentNoteId !== noteId) {
        setCurrentNote(state, noteId);
    }
}

export function imNoteTraversal(
    ctx: GlobalContext,
    viewHasFocus: boolean
) {
    addToNavigationList(ctx, APP_VIEW_FAST_TRAVEL);

    const s = imState(newNoteTraversalViewState);

    if (viewHasFocus) handleKeyboardInput(ctx, s);

    const viewHasFocusChanged = imMemo(viewHasFocus);
    if (viewHasFocusChanged) {
        if (viewHasFocus) {
            s.noteBeforeFocus = getCurrentNote(state);
        }
    }

    if (imMemo(state._notesMutationCounter)) recomputeTraversal(s, state.currentNoteId, true);

    if (imMemoMany(s.listPosition.idx, s.viewRoot)) startScrolling(s.scrollContainer, true);

    imBegin(COL); imListRowCellStyle(); imAlign(); {
        if (imIsFirstishRender()) {
            setStyle("fontWeight", "bold");
        }

        imBegin(); setText("Fast travel"); imEnd();

        if (imIf() && s.viewRoot) {
            imBegin(); setText(s.viewRoot.data.text); imEnd();
        } imEndIf();
    } imEnd();

    imLine(HORIZONTAL, 1);

    let renderedAny = false;
    const list = imBeginNavList(s.scrollContainer, s.listPosition.idx, viewHasFocus); {
        while (imNavListNextArray(list, s.notes)) {
            renderedAny = true;
            const { i } = list;
            const note = s.notes[i];

            imBeginNavListRow(list); {
                imBegin(); imListRowCellStyle(); {
                    imBegin(INLINE); {
                        const canGoIn = note.childIds.length > 0;
                        if (imMemo(canGoIn)) {
                            setStyle("fontWeight", canGoIn ? "bold" : "");
                        }
                        
                        const text = note.data.text;
                        setText(text); 
                    } imEnd();
                } imEnd();
            } imEndNavListRow(list);
        }

        imNextListRoot("empty");
        if (imIf() && !renderedAny) {
            imBegin(ROW); imFlex(); imAlign(); imJustify(); {
                setText("This level has been cleared!");
            } imEnd();
        } imEndIf();
    } imEndNavList(list);

}

