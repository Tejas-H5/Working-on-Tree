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
import { imui, BLOCK, ROW, COL, PX, NA, INLINE_BLOCK, INLINE } from "src/utils/im-js/im-ui";
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
import { im, ImCache, imdom, el, ev, } from "src/utils/im-js";

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

    if (im.Memo(c, state._notesMutationCounter)) {
        recomputeTraversal(s, state.currentNoteId, true);
    }

    imui.Begin(c, COL); imListRowCellStyle(c); imui.Align(c); {
        if (im.isFirstishRender(c)) {
            imdom.setStyle(c, "fontWeight", "bold");
        }

        imui.Begin(c, BLOCK); imdom.Str(c, "Fast travel"); imui.End(c);

        if (im.If(c) && s.viewRoot && s.viewRoot !== getRootNote(state)) {
            imui.Begin(c, BLOCK); {
                imdom.Str(c, s.viewRoot.data.text); 
            } imui.End(c);
        } im.IfEnd(c);
    } imui.End(c);

    imLine(c, LINE_HORIZONTAL, 1);

    let renderedAny = false;
    const list = imNavListBegin(c, s.scrollContainer, s.listPosition.idx, viewHasFocus); {
        im.For(c); while (imNavListNextItemArray(list, s.notes)) {
            renderedAny = true;
            const { i } = list;
            const note = s.notes[i];

            imNavListRowBegin(c, list, false, false); {
                imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                    imui.Begin(c, INLINE); {
                        const isBold = note.data._tasksInProgress > 0;
                        if (im.Memo(c, isBold)) imdom.setStyle(c, "fontWeight", isBold ? "bold" : "");

                        imdom.Str(c, "(");
                        imdom.Str(c, note.data._tasksInProgress);
                        imdom.Str(c, ") ");
                        
                        const text = note.data.text;
                        imdom.Str(c, text); 

                        const canGoIn = note.childIds.length > 0;
                        if (im.If(c) && canGoIn) {
                            imui.Begin(c, INLINE_BLOCK); imui.Padding(c, 0, NA, 10, PX, 0, NA, 10, PX); {
                                imdom.Str(c, " ->");
                            } imui.End(c);
                        } im.IfEnd(c);
                    } imui.End(c);
                } imui.End(c);
            } imNavListRowEnd(c);
        } im.ForEnd(c);

        im.KeyedBegin(c, "empty"); {
            if (im.If(c) && !renderedAny) {
                imui.Begin(c, ROW); imui.Flex(c); imui.Align(c); imui.Justify(c); {
                    imdom.Str(c, "This level has been cleared!");
                } imui.End(c);
            } im.IfEnd(c);
        } im.KeyedEnd(c);
    } imNavListEnd(c, list);
}

