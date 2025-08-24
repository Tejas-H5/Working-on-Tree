import { imLine, LINE_HORIZONTAL } from "./app-components/common";
import { COL, imAlign, imFlex, imJustify, INLINE, ROW, imLayout, imLayoutEnd, BLOCK } from "./components/core/layout";
import { newScrollContainer, ScrollContainer } from "./components/scroll-container";
import { GlobalContext, hasDiscoverableCommand, REPEAT, setCurrentView } from "./global-context";
import { imListRowCellStyle } from "./list-row";
import {
    clampedListIdx,
    getNavigableListInput,
    imNavListBegin,
    imNavListRowBegin as imNavListRowBegin,
    imNavListEnd,
    imNavListRowEnd as imNavListRowEnd,
    imNavListNextItemArray,
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
import { ImCache, imIf, imIfEnd, imKeyedBegin, imKeyedEnd, imMemo, isFirstishRender } from "./utils/im-core";
import { elSetStyle, imStr } from "./utils/im-dom";


export type NoteTraversalViewState = {
    viewRoot: TreeNote | null;
    notes: TreeNote[];

    scrollContainer: ScrollContainer;
    listPosition: ListPosition;
};

export function newNoteTraversalViewState(): NoteTraversalViewState {
    return {
        viewRoot: null,
        notes: [],

        scrollContainer: newScrollContainer(),
        listPosition: newListPosition(),
    };
}

function setIdx(ctx: GlobalContext, s: NoteTraversalViewState, idx: number) {
    s.listPosition.idx = clampedListIdx(idx, s.notes.length);
    const note = get(s.notes, s.listPosition.idx);
    if (note) {
        setCurrentNote(state, note.id, ctx.noteBeforeFocus?.id);
    }
}

function handleKeyboardInput(ctx: GlobalContext, s: NoteTraversalViewState) {
    const current = getCurrentNote(state);

    const listNavigation = getNavigableListInput(ctx, s.listPosition.idx, 0, s.notes.length);
    if (listNavigation) {
        setIdx(ctx, s, listNavigation.newIdx);
    }

    if (s.viewRoot && hasDiscoverableCommand(ctx, ctx.keyboard.leftKey, "Move out", REPEAT)) {
        recomputeTraversal(s, s.viewRoot.id, false);
    }

    if (
        isHigherLevelTask(current) && 
        current.childIds.length > 0 && 
        hasDiscoverableCommand(ctx, ctx.keyboard.rightKey, "Move in", REPEAT)
    ) {
        recomputeTraversal(s, current.childIds[0], false);
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Go to note")) {
        setCurrentView(ctx, ctx.views.noteTree);
    }

    // TODO: left/right should move up/down high level tasks
}

function recomputeTraversal(s: NoteTraversalViewState, noteId: NoteId, useNotePosition: boolean) {
    s.notes.length = 0;


    // TODO: sort by date last edited

    const note = getNote(state.notes, noteId);
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
            const child = getNote(state.notes, id);
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

export function imNoteTraversal(c: ImCache, ctx: GlobalContext, s: NoteTraversalViewState) {
    const viewHasFocus = ctx.currentView === s;
    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);
    }

    if (imMemo(c, state._notesMutationCounter)) recomputeTraversal(s, state.currentNoteId, true);

    imLayout(c, COL); imListRowCellStyle(c); imAlign(c); {
        if (isFirstishRender(c)) {
            elSetStyle(c, "fontWeight", "bold");
        }

        imLayout(c, BLOCK); imStr(c, "Fast travel"); imLayoutEnd(c);

        if (imIf(c) && s.viewRoot) {
            imLayout(c, BLOCK); imStr(c, s.viewRoot.data.text); imLayoutEnd(c);
        } imIfEnd(c);
    } imLayoutEnd(c);

    imLine(c, LINE_HORIZONTAL, 1);

    let renderedAny = false;
    const list = imNavListBegin(c, s.scrollContainer, s.listPosition.idx, viewHasFocus); {
        while (imNavListNextItemArray(list, s.notes)) {
            renderedAny = true;
            const { i } = list;
            const note = s.notes[i];

            imNavListRowBegin(c, list); {
                imLayout(c, BLOCK); imListRowCellStyle(c); {
                    imLayout(c, INLINE); {
                        const canGoIn = note.childIds.length > 0;
                        if (imMemo(c, canGoIn)) {
                            elSetStyle(c, "fontWeight", canGoIn ? "bold" : "");
                        }
                        
                        const text = note.data.text;
                        imStr(c, text); 
                    } imLayoutEnd(c);
                } imLayoutEnd(c);
            } imNavListRowEnd(c);
        }

        imKeyedBegin(c, "empty"); {
            if (imIf(c) && !renderedAny) {
                imLayout(c, ROW); imFlex(c); imAlign(c); imJustify(c); {
                    imStr(c, "This level has been cleared!");
                } imLayoutEnd(c);
            } imIfEnd(c);
        } imKeyedEnd(c);
    } imNavListEnd(c, list);
}

