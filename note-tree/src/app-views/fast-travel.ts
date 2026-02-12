import { imListRowCellStyle } from "src/app-components/list-row";
import {
    clampedListIdx,
    getNavigableListInput,
    imNavListBegin,
    imNavListEnd,
    imNavListNextItemArray,
    imNavListRowBegin,
    imNavListRowEnd,
    ListPosition,
    newListPosition
} from "src/app-components/navigable-list";
import { BLOCK, COL, imAlign, imFlex, imJustify, imLayoutBegin, imLayoutEnd, imPadding, INLINE, INLINE_BLOCK, NA, PX, ROW } from "src/components/core/layout";
import { imLine, LINE_HORIZONTAL } from "src/components/im-line";
import { newScrollContainer, ScrollContainer } from "src/components/scroll-container";
import { GlobalContext, hasDiscoverableCommand, REPEAT, setCurrentView } from "src/global-context";
import {
    getNote,
    getRootNote,
    isHigherLevelTask,
    NoteId,
    recomputeNumTasksInProgressRecursively,
    setCurrentNote,
    state,
    STATUS_IN_PROGRESS,
    TreeNote
} from "src/state";
import { arrayAt } from "src/utils/array-utils";
import { ImCache, imFor, imForEnd, imIf, imIfEnd, imKeyedBegin, imKeyedEnd, imMemo, isFirstishRender } from "src/utils/im-core";
import { elSetStyle, imStr } from "src/utils/im-dom";
import { getNoteViewRoot } from "./note-tree-view";

export type NoteTraversalViewState = {
    viewRoot: TreeNote | null;
    notes: TreeNote[];

    lastChildForViewRoot: Map<NoteId | undefined, NoteId>;
    scrollContainer: ScrollContainer;
    listPosition: ListPosition;

    isFlat: boolean;
};

export function newNoteTraversalViewState(): NoteTraversalViewState {
    return {
        viewRoot: null,
        notes: [],

        scrollContainer: newScrollContainer(),
        lastChildForViewRoot: new Map(),
        listPosition: newListPosition(),

        isFlat: false,
    };
}

function setIdx(ctx: GlobalContext, s: NoteTraversalViewState, idx: number) {
    s.listPosition.idx = clampedListIdx(idx, s.notes.length);
    const note = arrayAt(s.notes, s.listPosition.idx);
    if (note) {
        s.lastChildForViewRoot.set(s.viewRoot?.id, note.id);
        setCurrentNote(state, note.id, ctx.noteBeforeFocus?.id);
    }
}

function handleKeyboardInput(ctx: GlobalContext, s: NoteTraversalViewState) {
    const currentListNote = arrayAt(s.notes, s.listPosition.idx);

    const listNavigation = getNavigableListInput(ctx, s.listPosition.idx, 0, s.notes.length);
    if (listNavigation) {
        setIdx(ctx, s, listNavigation.newIdx);
    }

    if (
        s.viewRoot && 
        !s.isFlat &&
        hasDiscoverableCommand(ctx, ctx.keyboard.leftKey, "Move out", REPEAT)
    ) {
        recomputeTraversal(s, s.viewRoot.id);
    }

    if (
        currentListNote && 
        isHigherLevelTask(currentListNote) && 
        currentListNote.childIds.length > 0 && 
        !s.isFlat &&
        hasDiscoverableCommand(ctx, ctx.keyboard.rightKey, "Move in", REPEAT)
    ) {
        recomputeTraversal(s, currentListNote.childIds[0]);
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Go to note")) {
        setCurrentView(ctx, ctx.views.noteTree);
    }

    if (
        currentListNote && 
        hasDiscoverableCommand(ctx, ctx.keyboard.fKey, s.isFlat ? "Tree mode" : "Flat mode")
    ) {
        s.isFlat = !s.isFlat;
        recomputeTraversal(s, currentListNote.id, true);
    }

    // TODO: left/right should move up/down high level tasks
}

function recomputeTraversal(s: NoteTraversalViewState, noteId: NoteId, useCurrentNote = false) {
    s.notes.length = 0;
    const current = getNote(state.notes, noteId);

    if (s.isFlat) {
        s.viewRoot = getRootNote(state);
    } else {
        s.viewRoot = getNoteViewRoot(state, current);
    }

    const dfs = (note: TreeNote, pushNote: boolean) => {
        if (pushNote) {
            if (note.data._status === STATUS_IN_PROGRESS) {
                const isHlt = isHigherLevelTask(note);
                if (note.childIds.length === 0 || isHlt) {
                    s.notes.push(note);

                    if (!s.isFlat) {
                        // don't go further into this note, unless we're flat.
                        return;
                    }
                }
            }
        }

        for (const id of note.childIds) {
            const child = getNote(state.notes, id);
            dfs(child, true);
        }
    }
    dfs(s.viewRoot, false);

    recomputeNumTasksInProgressRecursively(state);
    s.notes.sort((a, b) => {
        if (
            (a.data._tasksInProgress > 0 && b.data._tasksInProgress > 0) ||
            (a.data._tasksInProgress === 0 && b.data._tasksInProgress === 0)
        ) {
            return b.data.editedAt.getTime() - a.data.editedAt.getTime();
        }

        return b.data._tasksInProgress - a.data._tasksInProgress;
    });

    let noteIdToFocus: NoteId | undefined;

    if (useCurrentNote) {
        noteIdToFocus = current.id;
    }

    if (noteIdToFocus === undefined) {
        noteIdToFocus = s.lastChildForViewRoot.get(s.viewRoot?.id);
    }

    if (noteIdToFocus === undefined && s.notes.length > 0) {
        noteIdToFocus = s.notes[0].id;
    }

    if (noteIdToFocus !== undefined) {
        const idx = s.notes.findIndex(note => note.id === noteIdToFocus);
        if (idx !== -1) {
            s.listPosition.idx = idx;
        }

        setCurrentNote(state, noteIdToFocus);
    }
}

export function imNoteTraversal(c: ImCache, ctx: GlobalContext, s: NoteTraversalViewState) {
    const viewHasFocus = ctx.currentView === s;
    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);
    }

    if (imMemo(c, state._notesMutationCounter)) {
        recomputeTraversal(s, state.currentNoteId, true);
    }

    imLayoutBegin(c, COL); imListRowCellStyle(c); imAlign(c); {
        if (isFirstishRender(c)) {
            elSetStyle(c, "fontWeight", "bold");
        }

        imLayoutBegin(c, BLOCK); imStr(c, "Fast travel"); imLayoutEnd(c);

        if (imIf(c) && s.viewRoot && s.viewRoot !== getRootNote(state)) {
            imLayoutBegin(c, BLOCK); {
                imStr(c, s.viewRoot.data.text); 
            } imLayoutEnd(c);
        } imIfEnd(c);
    } imLayoutEnd(c);

    imLine(c, LINE_HORIZONTAL, 1);

    let renderedAny = false;
    const list = imNavListBegin(c, s.scrollContainer, s.listPosition.idx, viewHasFocus); {
        imFor(c); while (imNavListNextItemArray(list, s.notes)) {
            renderedAny = true;
            const { i } = list;
            const note = s.notes[i];

            imNavListRowBegin(c, list, false, false); {
                imLayoutBegin(c, BLOCK); imListRowCellStyle(c); {
                    imLayoutBegin(c, INLINE); {
                        const isBold = note.data._tasksInProgress > 0;
                        if (imMemo(c, isBold)) elSetStyle(c, "fontWeight", isBold ? "bold" : "");

                        imStr(c, "(");
                        imStr(c, note.data._tasksInProgress);
                        imStr(c, ") ");
                        
                        const text = note.data.text;
                        imStr(c, text); 

                        const canGoIn = note.childIds.length > 0;
                        if (imIf(c) && canGoIn) {
                            imLayoutBegin(c, INLINE_BLOCK); imPadding(c, 0, NA, 10, PX, 0, NA, 10, PX); {
                                imStr(c, " ->");
                            } imLayoutEnd(c);
                        } imIfEnd(c);
                    } imLayoutEnd(c);
                } imLayoutEnd(c);
            } imNavListRowEnd(c);
        } imForEnd(c);

        imKeyedBegin(c, "empty"); {
            if (imIf(c) && !renderedAny) {
                imLayoutBegin(c, ROW); imFlex(c); imAlign(c); imJustify(c); {
                    imStr(c, "This level has been cleared!");
                } imLayoutEnd(c);
            } imIfEnd(c);
        } imKeyedEnd(c);
    } imNavListEnd(c, list);
}

