import {
    imListRowCellStyle
} from "src/app-components/list-row";
import {
    clampedListIdx,
    getNavigableListInput,
    imNavListBegin,
    imNavListEnd,
    imNavListNextItemArray,
    imNavListRowBegin,
    imNavListRowEnd,
    ListPosition,
    NavigableListState,
    newListPosition
} from "src/app-components/navigable-list";
import { cssVarsApp } from "src/app-styling";
import {
    BLOCK,
    CH,
    COL,
    EM,
    imAbsolute,
    imBg,
    imFlex,
    imGap,
    imLayoutBegin,
    imLayoutEnd,
    imNoWrap,
    imOpacity,
    imRelative,
    imSize,
    INLINE,
    NA,
    PX,
    ROW,
    ROW_REVERSE
} from "src/components/core/layout";
import { cn } from "src/components/core/stylesheets";
import { doExtraTextAreaInputHandling, imTextAreaBegin, imTextAreaEnd } from "src/components/editable-text-area";
import { imLine, LINE_HORIZONTAL } from "src/components/im-line";
import {
    newScrollContainer,
    ScrollContainer,
    startScrolling
} from "src/components/scroll-container";
import {
    BYPASS_TEXT_AREA,
    CTRL,
    debouncedSave,
    GlobalContext,
    hasDiscoverableCommand,
    HIDDEN,
    REPEAT,
    setCurrentView,
    SHIFT
} from "src/global-context";
import {
    COLLAPSED_STATUS,
    createNewNote,
    deleteNoteIfEmpty,
    DONE_SUFFIX,
    forEachChildNote,
    getCurrentNote,
    getLastActivity,
    getNote,
    getNoteDurationUsingCurrentRange,
    getNoteDurationWithoutRange,
    getNoteOrUndefined,
    getNumSiblings,
    idIsNil,
    idIsNilOrRoot,
    idIsRoot,
    isBreak,
    isNoteCollapsed,
    isNoteEmpty,
    isStatusInProgressOrInfo,
    markIdxToString,
    notesMutated,
    noteStatusToString,
    NoteTreeGlobalState,
    parentNoteContains,
    pushNoteActivity,
    recomputeNoteStatusRecursively,
    setCurrentNote,
    setIsEditingCurrentNote,
    setNoteText,
    state,
    STATUS_DONE,
    STATUS_IN_PROGRESS,
    STATUS_INFO,
    toggleNoteRootMark,
    TreeNote
} from "src/state";
import { arrayAt, boundsCheck, filterInPlace, findLastIndex } from "src/utils/array-utils";
import { assert } from "src/utils/assert";
import { formatDateTime, formatDurationAsHours } from "src/utils/datetime";
import { EXTENT_END, EXTENT_VERTICAL, getElementExtentNormalized } from "src/utils/dom-utils";
import { ImCache, imFor, imForEnd, imGet, imIf, imIfElse, imIfEnd, imKeyedBegin, imKeyedEnd, imMemo, imSet, isFirstishRender } from "src/utils/im-core";
import { EL_B, elSetClass, elSetStyle, EV_CHANGE, EV_INPUT, EV_KEYDOWN, getGlobalEventSystem, imElBegin, imElEnd, imOn, imStr, imStrFmt } from "src/utils/im-dom";
import * as tree from "src/utils/int-tree";
import { isKeyHeld, isKeyPressed } from "src/utils/key-state";
import { activitiesViewSetIdx, NOT_IN_RANGE } from "./activities-list";

export type NoteTreeViewState = {
    invalidateNote:      boolean; // Only set if we can't recompute the notes immediately - i.e if we're traversing the data structure
    invalidateVisibleNotes: boolean;

    note:                TreeNote;
    noteParentNotes:     TreeNote[];
    stickyNotes:         TreeNote[];
    viewRoot:            TreeNote;
    viewRootParentNotes: TreeNote[];
    childNotes:          TreeNote[];

    scrollContainer: ScrollContainer;

    listPos: ListPosition;

    // Debugging
    numVisible: number;
};

// NOTE: recompute status _after_ doing this
function setNote(
    s: NoteTreeViewState,
    note: TreeNote,
    invalidate = false
) {
    let mutated = false;
    if (invalidate || s.note !== note) {
        if (s.note !== note) {
            mutated ||= deleteNoteIfEmpty(state, s.note);
            invalidate ||=mutated;
        }

        s.note = note;
        setCurrentNote(state, note.id);
        recomputeNoteStatusRecursively(state, note, true, true, true);

        recomputeVisibleNotes(s);
    }

    if (invalidate) {
        recomputeNoteStatusRecursively(state, note);
    }
}

function recomputeNoteParents(
    state: NoteTreeGlobalState,
    flatNotes: TreeNote[],
    currentNote: TreeNote,
) {
    flatNotes.length = 0;

    // Add the parents to the top of the list.
    // need the root tree to compute these.

    let note = currentNote;
    while (!idIsNil(note.parentId)) {
        flatNotes.push(note);
        note = getNote(state.notes, note.parentId);
    }

    flatNotes.reverse();
}


function recomputeFlatNotes(
    state: NoteTreeGlobalState,
    flatNotes: TreeNote[],
    viewRoot: TreeNote,
    currentNote: TreeNote,
) {
    flatNotes.length = 0;

    const dfs = (note: TreeNote) => {
        flatNotes.push(note);

        let isVisualLeaf = note.childIds.length === 0;

        if (!isVisualLeaf) {
            const collapsed = isNoteCollapsed(note);
            if (collapsed) {
                isVisualLeaf = true;

                if (collapsed === COLLAPSED_STATUS) {
                    const currentNoteIsInsideThisOne = 
                        currentNote !== note && // don't want to see through the current note
                        parentNoteContains(state, note.id, currentNote);
                    if (currentNoteIsInsideThisOne) {
                        isVisualLeaf = false;
                    }
                }
            }
        }

        if (isVisualLeaf) {
            return;
        }

        for (const childId of note.childIds) {
            const note = getNote(state.notes, childId);
            dfs(note);
        }
    }

    for (const childId of viewRoot.childIds) {
        const note = getNote(state.notes, childId);
        dfs(note);
    }
}

function recomputeVisibleNotes(s: NoteTreeViewState) {
    s.invalidateVisibleNotes = false;

    if (s.scrollContainer) startScrolling(s.scrollContainer, true);

    recomputeNoteParents(state, s.noteParentNotes, s.note);

    const viewRoot = getNoteViewRoot(state, s.note);

    if (s.viewRoot !== viewRoot) {
        // Don't smoothscroll when the view root changes
        startScrolling(s.scrollContainer, false);

        s.viewRoot = viewRoot;
        s.stickyNotes.length = 0;
        recomputeNoteParents(state, s.viewRootParentNotes, s.viewRoot);
    }

    // flat notes need recompuation when the child changes.
    recomputeFlatNotes(state, s.childNotes, s.viewRoot, s.note);
    s.listPos.idx = s.childNotes.indexOf(s.note);
}

export function getNoteViewRoot(state: NoteTreeGlobalState, currentNote: TreeNote) {
    let it = currentNote;
    while (!idIsNil(it.parentId)) {
        it = getNote(state.notes, it.parentId);
        const collapsed = isNoteCollapsed(it);
        if (
            collapsed &&
            collapsed !== COLLAPSED_STATUS  // we want to peek into 'done' notes if that is the current note.
        ) {
            break;
        }
    }
    return it;
}

export function newNoteTreeViewState(): NoteTreeViewState {
    const note = getCurrentNote(state);
    const viewRoot = note; // needs to be wrong, so that it can be recomputed
    const s: NoteTreeViewState = {
        invalidateNote: false,
        invalidateVisibleNotes: false,
        note,
        viewRoot,
        noteParentNotes:     [],
        stickyNotes:         [],
        viewRootParentNotes: [],
        childNotes:          [],

        scrollContainer: newScrollContainer(),
        listPos: newListPosition(),
        numVisible:     0,
    };

    setNote(s, s.note, true);

    return s;
}


function moveOutOfCurrent(
    ctx: GlobalContext,
    s: NoteTreeViewState,
    moveNote: boolean,
) {
    if (idIsNilOrRoot(s.note.parentId)) return;

    const parent = getNote(state.notes, s.note.parentId);

    if (moveNote) {
        if (!idIsNil(parent.parentId)) {
            // Move this note to after it's parent
            const parentParent = getNote(state.notes, parent.parentId);
            const parentIdx = parent.idxInParentList;
            tree.insertAt(state.notes, parentParent, s.note, parentIdx + 1);
            setNote(s, s.note, true);
            recomputeNoteStatusRecursively(state, parent, true, true, true);
            debouncedSave(ctx, state, "Moved a note");
        }
    } else {
        setNote(s, parent, false);
    }
}

function moveIntoCurrent(
    _ctx: GlobalContext,
    s: NoteTreeViewState,
    moveNote: boolean,
) {
    if (!boundsCheck(s.childNotes, s.listPos.idx)) return;
    if (idIsNil(s.note.parentId)) return;

    if (moveNote) {
        const parentIdx = s.note.idxInParentList;
        if (parentIdx !== 0) {
            const parent = getNote(state.notes, s.note.parentId);
            const prevNoteId = parent.childIds[parentIdx - 1];
            const prevNote = getNote(state.notes, prevNoteId);
            let idxUnderPrev = clampedListIdx(
                prevNote.data.lastSelectedChildIdx + 1,
                prevNote.childIds.length
            ) + 1;
            tree.insertAt(state.notes, prevNote, s.note, idxUnderPrev);
            prevNote.data.lastSelectedChildIdx = idxUnderPrev;
            setNote(s, s.note, true);
            recomputeNoteStatusRecursively(state, prevNote, true, true, true);
            notesMutated(state);
        }
    } else {
        const nextRoot = s.childNotes[s.listPos.idx];

        if (nextRoot.childIds.length > 0) {
            if (!boundsCheck(nextRoot.childIds, nextRoot.data.lastSelectedChildIdx)) {
                nextRoot.data.lastSelectedChildIdx = nextRoot.childIds.length - 1;
            }

            const nextChildId = nextRoot.childIds[nextRoot.data.lastSelectedChildIdx];
            const nextChild = getNote(state.notes, nextChildId);
            setNote(s, nextChild, false);
        }
    }
}


export function imNoteTreeView(c: ImCache, ctx: GlobalContext, s: NoteTreeViewState) {
    const viewFocused = ctx.currentView === s;

    if (imMemo(c, state._notesMutationCounter)) {
        s.invalidateVisibleNotes = true;
    }

    // Only push an activity for the current note once we've moved to it, _AND_ this view is in focus.
    const currentNote = getCurrentNote(state);
    if (imMemo(c, currentNote) | imMemo(c, viewFocused)) {
        if (viewFocused) {
            const lastActivity = getLastActivity(state);
            if (lastActivity && !isBreak(lastActivity)) {
                const currentNote = getCurrentNote(state);
                if (currentNote.id !== lastActivity.nId) {
                    pushNoteActivity(state, currentNote.id, false);
                }
            }
        }
    }


    // invalidate properties as needed
    {
        // When we reload our state, the note object reference will change, so we need to memoize on that, not the ID.
        const currentNote = getCurrentNote(state);
        if (imMemo(c, currentNote)) {
            setNote(s, currentNote);
        }
    }

    // recompute invalidated properties in order
    {
        if (s.invalidateNote) {
            setNote(s, s.note, true);
        }

        if (s.invalidateVisibleNotes) {
            recomputeVisibleNotes(s);
        }
    }

    if (viewFocused) {
        handleKeyboardInput(ctx, s);
    }


    const sc = s.scrollContainer;
    if (sc && !state._isEditingFocusedNote) {
        sc.wantedScrollOffsetItem = 0.5;
        sc.wantedScrollOffsetViewport = 0.5;
    }


    imLayoutBegin(c, COL); imFlex(c); {
        imLayoutBegin(c, BLOCK); {
            s.numVisible = 0;
            imFor(c); for (const row of s.viewRootParentNotes) {
                imKeyedBegin(c, row); {
                    imNoteTreeRow(c, ctx, null, s, row, viewFocused);
                } imKeyedEnd(c);
            } imForEnd(c);
        } imLayoutEnd(c);

        imLine(
            c,
            LINE_HORIZONTAL, 1,
            !!s.scrollContainer.root && s.scrollContainer.root.scrollTop > 1,
        );

        imLayoutBegin(c, BLOCK); {
            imFor(c); for (const row of s.stickyNotes) {
                imKeyedBegin(c, row); {
                    imNoteTreeRow(c, ctx, null, s, row, viewFocused);
                } imKeyedEnd(c);
            } imForEnd(c);
        } imLayoutEnd(c);

        const list = imNavListBegin(c, s.scrollContainer, s.listPos.idx, viewFocused, state._isEditingFocusedNote); {
            imFor(c); while (imNavListNextItemArray(list, s.childNotes)) {
                const { i, itemSelected } = list;
                const note = s.childNotes[i];

                imKeyedBegin(c, note); {
                    const root = imNoteTreeRow(c, ctx, list, s, note, viewFocused, i, itemSelected);

                    // Add or remove this note as 'sticky', if it is an offscreen parent.
                    // This note won't be in the viewRootNoteParents, so we add it to this third intermediary list instead.
                    {
                        const canAddAsSticky = s.noteParentNotes.includes(note);
                        const canRemovefromSticky = s.stickyNotes.includes(note);
                        if ((canRemovefromSticky || canAddAsSticky) && s.scrollContainer.root) {
                            const verticalEndExtent = getElementExtentNormalized(
                                s.scrollContainer.root,
                                root,
                                EXTENT_VERTICAL | EXTENT_END
                            );
                            if (!s.stickyNotes.includes(note) && verticalEndExtent < 0) {
                                s.stickyNotes.push(note);
                            } else if (s.stickyNotes.includes(note) && verticalEndExtent > 0) {
                                filterInPlace(s.stickyNotes, n => n !== note);
                            }
                        }
                    }
                } imKeyedEnd(c);
            } imForEnd(c);;

            // Want to scroll off the bottom a bit
            imKeyedBegin(c, "scrolloff"); {
                imLayoutBegin(c, BLOCK); imSize(c, 0, NA, 500, PX); imLayoutEnd(c);
            } imKeyedEnd(c);
        } imNavListEnd(c, list);

        let hasMarks = false;
        for (const m of state._computedMarks) {
            if (m != null) hasMarks = true;
        }

        if (imIf(c) && hasMarks) {
            imLine(c, LINE_HORIZONTAL, 1);

            imLayoutBegin(c, COL); {
                imFor(c); for (let i = 0; i < state._computedMarks.length; i++) {
                    const allMarks = state._computedMarks[i];
                    const mark = state.rootMarks[i];
                    if (!mark) continue;

                    imLayoutBegin(c, ROW); imNoWrap(c); {
                        if (isFirstishRender(c)) elSetStyle(c, "overflow", "hidden");

                        imLayoutBegin(c, INLINE); {
                            if (isFirstishRender(c)) elSetStyle(c, "fontWeight", "bold");
                            imStrFmt(c, i, markIdxToString);
                            imStr(c, ": ");
                        } imLayoutEnd(c);

                        imLayoutBegin(c, ROW); imFlex(c); {

                            if (imIf(c) && allMarks.length === 0) {
                                imLayoutBegin(c, ROW); {
                                    imStr(c, "Nothing in progress under this mark");
                                } imLayoutEnd(c);
                            } else {
                                imIfElse(c);

                                imFor(c); for (let slotIdx = 0; slotIdx < allMarks.length; slotIdx++) {
                                    const noteId = allMarks[slotIdx];
                                    const note = getNote(state.notes, noteId);
                                    const isSelected = noteId === state.currentNoteId;

                                    const flexRatio = isSelected ? 3 : 1;
                                    imLayoutBegin(c, ROW); imFlex(c, flexRatio); imBg(c, isSelected ? cssVarsApp.bgColorFocus : ""); {
                                        imArrow(c);

                                        if (isFirstishRender(c)) elSetStyle(c, "overflow", "hidden");
                                        imStr(c, note.data.text);
                                    } imLayoutEnd(c);
                                } imForEnd(c);
                            } imIfEnd(c);

                        } imLayoutEnd(c);
                    } imLayoutEnd(c);
                } imForEnd(c);
            } imLayoutEnd(c);
        } imIfEnd(c);

        imLine(c, LINE_HORIZONTAL, 1);

        const currentNote = getCurrentNote(state);
        imLayoutBegin(c, ROW); imGap(c, 10, PX); {
            imLayoutBegin(c, BLOCK); imStr(c, "Created " + formatDateTime(currentNote.data.openedAt)); imLayoutEnd(c);
            imLayoutBegin(c, BLOCK); imStr(c, "|"); imLayoutEnd(c);
            imLayoutBegin(c, BLOCK); imStr(c, "Last Edited " + formatDateTime(currentNote.data.editedAt)); imLayoutEnd(c);
        } imLayoutEnd(c);
    } imLayoutEnd(c);
}

function imArrow(c: ImCache) {
    imElBegin(c, EL_B); {
        if (isFirstishRender(c)) elSetStyle(c, "padding", "0 10px");

        imStr(c, " -> ");
    } imElEnd(c, EL_B);
}

const UNDER = 1;
const AFTER = 2;
function addNoteAtCurrent(_ctx: GlobalContext, s: NoteTreeViewState, insertType: typeof UNDER | typeof AFTER): TreeNote {
    assert(!idIsNil(s.note.parentId)); // Cant insert after the root note

    const currentNote = getCurrentNote(state);
    assert(!isNoteEmpty(currentNote)); // was checked before we called this, hopefully

    const newNote = createNewNote(state, "");
    if (insertType === UNDER) {
        tree.addUnder(state.notes, s.note, newNote);
    } else if (insertType === AFTER) {
        tree.addAfter(state.notes, s.note, newNote);
    } else {
        assert(false); // Invalid insertion type
    }

    recomputeNoteStatusRecursively(state, newNote);

    return newNote;
}

function moveToLocalidx(
    _ctx: GlobalContext,
    s: NoteTreeViewState,
    idx: number,
    moveNote: boolean
) {
    if (idIsNil(s.note.parentId)) return;
    
    const parent = getNote(state.notes, s.note.parentId);
    idx = clampedListIdx(idx, parent.childIds.length);
    if (!boundsCheck(parent.childIds, idx)) return;

    if (moveNote) {
        tree.insertAt(state.notes, parent, s.note, idx);
        setNote(s, s.note);
        recomputeNoteStatusRecursively(state, s.note, true, true, true);
        notesMutated(state);
    } else {
        const childId = parent.childIds[idx];
        const note = getNote(state.notes, childId);
        setNote(s, note, false);
    }
}

function toggleMark(currentNote: TreeNote, idx: number) {
    toggleNoteRootMark(state, currentNote.id, idx);
}

function navigateToMark(s: NoteTreeViewState, currentNote: TreeNote, idx: number) {
    const allMarks = arrayAt(state._computedMarks, idx);
    if (!allMarks)             return;
    if (allMarks.length === 0) return;

    const markSlotIndex = allMarks.indexOf(currentNote.id);
    let noteId;
    if (markSlotIndex === -1) {
        noteId = allMarks[0];
    } else {
        noteId = allMarks[(markSlotIndex + 1) % allMarks.length];
    }

    const note = getNote(state.notes, noteId);
    setCurrentNote(state, note.id, currentNote.id);
}

function handleKeyboardInput(ctx: GlobalContext, s: NoteTreeViewState) {
    const { keyboard } = ctx;

    const currentNote = getCurrentNote(state);
    const parent = getNote(state.notes, currentNote.parentId);

    if (state._isEditingFocusedNote) {
        if (hasDiscoverableCommand(ctx, keyboard.escapeKey, "Stop editing", BYPASS_TEXT_AREA)) {
            setIsEditingCurrentNote(state, false);
        }
    }

    if (hasDiscoverableCommand(ctx, keyboard.tKey, "Fast-travel")) {
        setCurrentView(ctx, ctx.views.fastTravel);
    }

    if (!state._isEditingFocusedNote) {
        if (!ctx.handled) {
            const keys = getGlobalEventSystem().keyboard.keys;

            const moveNote = isKeyHeld(keys, keyboard.altKey);
            const listNavInput = getNavigableListInput(ctx, currentNote.idxInParentList, 0, parent.childIds.length);
            const ctrlOrShift = isKeyHeld(keys, keyboard.ctrlKey) || isKeyHeld(keys, keyboard.shiftKey);

            if (listNavInput) {
                moveToLocalidx(ctx, s, listNavInput.newIdx, moveNote);
            } else if (isKeyPressed(keys, keyboard.leftKey) && !ctrlOrShift) {
                moveOutOfCurrent(ctx, s, moveNote);
                ctx.handled = true;
            } else if (isKeyPressed(keys, keyboard.rightKey) && !ctrlOrShift) {
                moveIntoCurrent(ctx, s, moveNote);
                ctx.handled = true;
            }
        }
        
        if (hasDiscoverableCommand(ctx, keyboard.aKey, "Note activity", REPEAT)) {
            // TODO: just recompute this when we set the note
            const idx = findLastIndex(state.activities, a => a.nId === state.currentNoteId && !a.deleted)
            if (idx !== -1) {
                activitiesViewSetIdx(ctx, ctx.views.activities, idx, NOT_IN_RANGE);
                setCurrentView(ctx, ctx.views.activities);
            }
        }

        if (hasDiscoverableCommand(ctx, keyboard.slashKey, "URLs", CTRL)) {
            setCurrentView(ctx, ctx.views.urls);
        }

        if (hasDiscoverableCommand(ctx, keyboard.num1Key, "toggle mark 0", HIDDEN | SHIFT)) toggleMark(currentNote, 0);
        if (hasDiscoverableCommand(ctx, keyboard.num2Key, "toggle mark 1", HIDDEN | SHIFT)) toggleMark(currentNote, 1);
        if (hasDiscoverableCommand(ctx, keyboard.num3Key, "toggle mark 2", HIDDEN | SHIFT)) toggleMark(currentNote, 2);
        if (hasDiscoverableCommand(ctx, keyboard.num4Key, "toggle mark 3", HIDDEN | SHIFT)) toggleMark(currentNote, 3);
        if (hasDiscoverableCommand(ctx, keyboard.num5Key, "toggle mark 4", HIDDEN | SHIFT)) toggleMark(currentNote, 4);
        if (hasDiscoverableCommand(ctx, keyboard.num6Key, "toggle mark 5", HIDDEN | SHIFT)) toggleMark(currentNote, 5);
        if (hasDiscoverableCommand(ctx, keyboard.num7Key, "toggle mark 6", HIDDEN | SHIFT)) toggleMark(currentNote, 6);
        if (hasDiscoverableCommand(ctx, keyboard.num8Key, "toggle mark 7", HIDDEN | SHIFT)) toggleMark(currentNote, 7);
        if (hasDiscoverableCommand(ctx, keyboard.num9Key, "toggle mark 8", HIDDEN | SHIFT)) toggleMark(currentNote, 8);
        if (hasDiscoverableCommand(ctx, keyboard.num0Key, "toggle mark 9", HIDDEN | SHIFT)) toggleMark(currentNote, 9);

        if (hasDiscoverableCommand(ctx, keyboard.num1Key, "navigate to mark 0", HIDDEN | REPEAT)) navigateToMark(s, currentNote, 0);
        if (hasDiscoverableCommand(ctx, keyboard.num2Key, "navigate to mark 1", HIDDEN | REPEAT)) navigateToMark(s, currentNote, 1);
        if (hasDiscoverableCommand(ctx, keyboard.num3Key, "navigate to mark 2", HIDDEN | REPEAT)) navigateToMark(s, currentNote, 2);
        if (hasDiscoverableCommand(ctx, keyboard.num4Key, "navigate to mark 3", HIDDEN | REPEAT)) navigateToMark(s, currentNote, 3);
        if (hasDiscoverableCommand(ctx, keyboard.num5Key, "navigate to mark 4", HIDDEN | REPEAT)) navigateToMark(s, currentNote, 4);
        if (hasDiscoverableCommand(ctx, keyboard.num6Key, "navigate to mark 5", HIDDEN | REPEAT)) navigateToMark(s, currentNote, 5);
        if (hasDiscoverableCommand(ctx, keyboard.num7Key, "navigate to mark 6", HIDDEN | REPEAT)) navigateToMark(s, currentNote, 6);
        if (hasDiscoverableCommand(ctx, keyboard.num8Key, "navigate to mark 7", HIDDEN | REPEAT)) navigateToMark(s, currentNote, 7);
        if (hasDiscoverableCommand(ctx, keyboard.num9Key, "navigate to mark 8", HIDDEN | REPEAT)) navigateToMark(s, currentNote, 8);
        if (hasDiscoverableCommand(ctx, keyboard.num0Key, "navigate to mark 9", HIDDEN | REPEAT)) navigateToMark(s, currentNote, 9);
    }

    if (hasDiscoverableCommand(ctx, keyboard.dKey, "Toggle DONE", CTRL | BYPASS_TEXT_AREA)) {
        if (!reviveNote(currentNote)) {
            completeNote(currentNote)
        }
    }

    // Adding a note can be done in both editing and not editing contexts
    {
        let noteToSet: TreeNote | undefined;

        if (!isNoteEmpty(currentNote)) {
            if (hasDiscoverableCommand(ctx, keyboard.enterKey, "Insert note after", SHIFT | BYPASS_TEXT_AREA)) {
                noteToSet = addNoteAtCurrent(ctx, s, AFTER);
            } else if (hasDiscoverableCommand(ctx, keyboard.enterKey, "Insert note under", CTRL | BYPASS_TEXT_AREA)) {
                noteToSet = addNoteAtCurrent(ctx, s, UNDER);
            }
        }

        if (noteToSet) {
            setNote(s, noteToSet, true);
            setIsEditingCurrentNote(state, true);
            ctx.handled = true;
        }
    }

    if (!state._isEditingFocusedNote) {
        if (hasDiscoverableCommand(ctx, keyboard.enterKey, "Edit note")) {
            setIsEditingCurrentNote(state, true);
        }
    }
}

function reviveNote(note: TreeNote): boolean {
    if (note.data._status !== STATUS_DONE)     return false;
    if (!note.data.text.endsWith(DONE_SUFFIX)) return false;

    note.data.text = note.data.text.substring(
        0,
        note.data.text.length - DONE_SUFFIX.length
    );
    recomputeNoteStatusRecursively(state, note);
    notesMutated(state);
    return true;
}

function completeNote(note: TreeNote): void {
    if (note.childIds.length > 0) {
        let incompleteChild: TreeNote | undefined;
        forEachChildNote(state, note, child => {
            if (child.data._status === STATUS_IN_PROGRESS && !incompleteChild) {
                incompleteChild = child;
            }
        });

        if (incompleteChild) {
            setCurrentNote(state, incompleteChild.id);
            return;
        }
    }

    if (!note.data.text.endsWith(DONE_SUFFIX)) {
        note.data.text += DONE_SUFFIX;
    }

    // After marking the current note as DONE, we create and move to a new note directly under it.
    
    const newNote = createNewNote(state, "");
    tree.addAfter(state.notes, note, newNote);

    setCurrentNote(state, newNote.id);
    setIsEditingCurrentNote(state, true);

    recomputeNoteStatusRecursively(state, note, true, true, true);
    notesMutated(state);
}

function imNoteTreeRow(
    c: ImCache,
    ctx: GlobalContext,
    list: NavigableListState | null,
    s: NoteTreeViewState,
    note: TreeNote, 
    viewFocused: boolean,
    idx = -1, 
    itemSelected = false
) {
    s.numVisible++;

    const isEditing = viewFocused && itemSelected && state._isEditingFocusedNote;
    const isEditingChanged = imMemo(c, isEditing);
    const selectedChanged = imMemo(c, itemSelected);

    let numInProgress = 0;
    let numDone = 0;
    for (const id of note.childIds) {
        const note = getNote(state.notes, id);
        if (note.data._status === STATUS_IN_PROGRESS) {
            numInProgress++;
        } else {
            numDone++;
        }
    }

    const root = imNavListRowBegin(c, list, false, false); {
        imLayoutBegin(c, ROW); imFlex(c); {
            if (selectedChanged) {
                elSetClass(c, cn.preWrap, itemSelected);
            }

            // The tree visuals
            imLayoutBegin(c, ROW_REVERSE); {
                const noteIsParent = s.viewRootParentNotes.includes(note) || idIsRoot(note.id);

                let it = note;
                let foundLineInPath = false;
                let depth = -1;

                imFor(c); while (!idIsNil(it.parentId)) {
                    const itPrev = it;
                    const itPrevNumSiblings = getNumSiblings(state, itPrev);
                    it = getNote(state.notes, it.parentId);
                    const itNext = getNoteOrUndefined(state.notes, it.parentId);

                    let nextSibling: TreeNote | undefined;
                    if (itPrev.idxInParentList + 1 < it.childIds.length) {
                        nextSibling = getNote(state.notes, it.childIds[itPrev.idxInParentList + 1]);
                    }

                    depth++;

                    const isLineInPath: boolean =
                        // !foundLineInPath &&
                        // idx <= s.listPos.idx &&
                        // idx <= s.childNextTaskIdx && 
                        // itPrev.data._tasksInProgress > 0 
                        itPrev.data._treeVisualsGoDown || 
                        (itPrev === note && itPrev.data._treeVisualsGoRight);
                        // itIsParent;

                    foundLineInPath ||= isLineInPath;
                    const hasHLine = itPrev.id === note.id;

                    // |---->| indent
                    // [  x  ] (c1) Vertical line should line up with the note status above it:
                    //    |
                    //    |<-| bullet start
                    //    |
                    //    +-- [ x ] >> blah blah blah
                    //
                    // As it turns out, we can maintain the constraint c1 simply by setting
                    // bulletStart = indent - 22;
                    const indent = 29;
                    const bulletStart = indent - 22;

                    const smallThicnkess = 1;
                    const largeThicnkess = 4;
                    const isLast = itPrev.idxInParentList === itPrevNumSiblings - 1;

                    let pathGoesRight = itPrev.data._treeVisualsGoRight;
                    let pathGoesDown = itPrev.data._treeVisualsGoDown;

                    // the tree visuals. It was a lot easier to do these here than in my last framework
                    {
                        let midpointLen = 0.9;
                        let midpointUnits = EM;

                        imLayoutBegin(c, BLOCK); imRelative(c); imSize(c, indent, PX, 0, NA); {
                            // horizontal line xD
                            if (imIf(c) && hasHLine) {
                                imLayoutBegin(c, BLOCK); imAbsolute(c, midpointLen, midpointUnits, 0, PX, 0, NA, 0, NA); {
                                    if (isFirstishRender(c)) {
                                        elSetStyle(c, "transform", "translate(0, -100%)");
                                    }

                                    const isThick = isLineInPath && pathGoesRight;
                                    imSize(
                                        c,
                                        bulletStart, PX,
                                        isThick ? largeThicnkess : smallThicnkess, PX,
                                    );
                                    imBg(c, cssVarsApp.fgColor); 
                                } imLayoutEnd(c);
                            } imIfEnd(c);

                            const canDrawVerticalLine = !isLast || note === itPrev;

                            if (imIf(c) && canDrawVerticalLine) {
                                // Vertical line part 1. xd. We need a better API
                                imLayoutBegin(c, BLOCK); imAbsolute(c, 0, PX, bulletStart, PX, 0, isLast ? NA : PX, 0, NA); {
                                    imSize(
                                        c,
                                        isLineInPath ? largeThicnkess : smallThicnkess, PX,
                                        midpointLen, midpointUnits
                                    );
                                    imBg(c, cssVarsApp.fgColor); 
                                } imLayoutEnd(c);

                                // Vertical line part 2.
                                imLayoutBegin(c, BLOCK); {
                                    const isThick = isLineInPath && pathGoesDown;
                                    imAbsolute(c, midpointLen, midpointUnits, bulletStart, PX, 0, isLast ? NA : PX, 0, NA); 
                                    imSize(
                                        c,
                                        isThick ? largeThicnkess : smallThicnkess, PX,
                                        0, NA
                                    );
                                    imOpacity(c, isLast ? 0 : 1);
                                    imBg(c, cssVarsApp.fgColor);
                                } imLayoutEnd(c);
                            } imIfEnd(c);
                        } imLayoutEnd(c);
                    }
                } imForEnd(c);
            } imLayoutEnd(c);

            imLayoutBegin(c, ROW); imFlex(c); imListRowCellStyle(c); {
                if (imMemo(c, note.data._status)) {
                    let color;
                    if (isStatusInProgressOrInfo(note)) {
                        color = "";
                    } else {
                        color = cssVarsApp.unfocusTextColor;
                    }

                    elSetStyle(c, "color", color);
                }

                imLayoutBegin(c, ROW); imFlex(c); {
                    let shouldPreserveNewlines = itemSelected;
                    if (note.data._status === STATUS_INFO) {
                        shouldPreserveNewlines = true;
                    }

                    if (imMemo(c, shouldPreserveNewlines)) {
                        elSetClass(c, cn.preWrap, shouldPreserveNewlines);
                        elSetClass(c, cn.noWrap, !shouldPreserveNewlines);
                        elSetClass(c, cn.overflowHidden, !shouldPreserveNewlines);
                    }

                    imLayoutBegin(c, ROW); {
                        if (isFirstishRender(c)) {
                            elSetClass(c, cn.noWrap);
                        }

                        imLayoutBegin(c, BLOCK); {
                            imStr(c, noteStatusToString(note)); 
                        } imLayoutEnd(c);

                        if (imIf(c) && (numInProgress + numDone) > 0) {
                            imLayoutBegin(c, BLOCK); imSize(c, 0.5, CH, 0, NA); imLayoutEnd(c);
                            imStr(c, `(${numDone}/${numInProgress + numDone})`);
                        } imIfEnd(c);
                        imLayoutBegin(c, BLOCK); imSize(c, 0.5, CH, 0, NA); imLayoutEnd(c);
                    } imLayoutEnd(c);

                    if (imIf(c) && isEditing) {
                        const [, textArea] = imTextAreaBegin(c, {
                            value: note.data.text,
                        }); {
                            const input = imOn(c, EV_INPUT);
                            const change = imOn(c, EV_CHANGE);

                            if (input || change) {
                                let status = s.note.data._status;
                                let collapseStatus = isNoteCollapsed(s.note);

                                setNoteText(state, s.note, textArea.value);

                                ctx.handled = true;
                                if (
                                    status !== s.note.data._status ||
                                    collapseStatus !== isNoteCollapsed(s.note)
                                ) {
                                    s.invalidateNote = true;
                                }
                            }

                            const keyDown = imOn(c, EV_KEYDOWN);
                            if (keyDown) {
                                ctx.handled = doExtraTextAreaInputHandling(keyDown, textArea, {
                                    tabStopSize: state.settings.tabStopSize,
                                    useSpacesInsteadOfTabs: state.settings.spacesInsteadOfTabs,
                                })
                            }

                            if (isEditingChanged) {
                                textArea.selectionStart = textArea.value.length;
                                textArea.selectionEnd = textArea.value.length;
                            }

                            ctx.textAreaToFocus = textArea;
                        } imTextAreaEnd(c);

                        // Make the scroll container scroll to the part of the text where the cursor is. 
                        // Mainly applies when we've typed a LOT of text into the buffer
                        const sc = list?.scrollContainer;
                        if (sc) {
                            const start = textArea.selectionStart;
                            const end = textArea.selectionEnd;
                            const text = note.data.text;

                            const textLengthChanged = imMemo(c, text.length);
                            const startChanged = imMemo(c, start);
                            const endChanged = imMemo(c, end);

                            if (textLengthChanged || startChanged || endChanged) {
                                let posToScrollTo;
                                if (startChanged) {
                                    posToScrollTo = start;
                                } else {
                                    posToScrollTo = end;
                                }

                                let numNewlines = 0;
                                let numNewlinesBeforePosToScrollTo = 0;
                                let pos = 0;
                                for (const c of text) {
                                    if (c === '\n') {
                                        numNewlines++;
                                        if (pos < posToScrollTo) numNewlinesBeforePosToScrollTo++;
                                    }
                                    pos++;
                                }

                                // NOTE: doesn't work for one long line of text that then gets wrapped :)
                                // we could just make the text editor width unbounded, and autoscroll sideways too ...
                                const ratio = numNewlines === 0 ? 0 : numNewlinesBeforePosToScrollTo / numNewlines;
                                sc.wantedScrollOffsetItem = ratio;
                                sc.wantedScrollOffsetViewport = 0.5;
                            }
                        }
                    } else {
                        imIfElse(c);

                        const textChanged = imMemo(c, note.data.text);
                        let text = imGet(c, String);
                        if (text === undefined || textChanged || selectedChanged) {
                            let val = note.data.text;

                            const shouldTruncate = !selectedChanged;
                            if (shouldTruncate) {
                                const truncationLines = 5;

                                let numNewlines = 0;
                                let pos = 0;
                                let truncated = false;
                                let truncatePos = 0;
                                for (const c of val) {
                                    if (c === '\n') numNewlines++;
                                    if (!truncated && numNewlines >= truncationLines) {
                                        truncated = true;
                                        truncatePos = pos;
                                    }
                                    pos++;
                                }

                                if (truncated) {
                                    val = `[${numNewlines} lines] - ${val.substring(0, truncatePos)}...`
                                }
                            }

                            text = imSet(c, val);
                        }

                        imStr(c, text);
                    } imIfEnd(c);
                } imLayoutEnd(c);
            } imLayoutEnd(c);

            if (imIf(c) && ctx.viewingDurations) {
                imLayoutBegin(c, ROW); {
                    const durationTimesheet = getNoteDurationUsingCurrentRange(state, note);
                    const durationAllTime = getNoteDurationWithoutRange(state, note);
                    imStrFmt(c, durationTimesheet, formatDurationAsHours);
                    imStr(c, " / ");
                    imStrFmt(c, durationAllTime, formatDurationAsHours);
                } imLayoutEnd(c);
            } imIfEnd(c);
        } imLayoutEnd(c);
    } imNavListRowEnd(c);

    return root;
}
