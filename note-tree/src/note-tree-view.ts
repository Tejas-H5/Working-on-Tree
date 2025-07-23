import {
    imBeginScrollContainer,
    newScrollContainer,
    ScrollContainer,
    scrollToItem,
    startScrolling
} from "src/components/scroll-container";
import { activitiesViewSetIdx } from "./activities-list";
import { imLine } from "./app-components/common";
import { cssVarsApp } from "./app-styling";
import { imTimerRepeat } from "./app-utils/timer";
import {
    CH,
    COL,
    EM,
    imAbsolute,
    imBegin,
    imBg,
    imFlex,
    imInitClasses,
    imOpacity,
    imRelative,
    imSize,
    NOT_SET,
    PX,
    ROW,
    ROW_REVERSE
} from "./components/core/layout";
import { cn } from "./components/core/stylesheets";
import { doExtraTextAreaInputHandling, imBeginTextArea, imEndTextArea } from "./components/editable-text-area";
import { addToNavigationList, BYPASS_TEXT_AREA, GlobalContext, hasDiscoverableCommand, hasDiscoverableHold, REPEAT } from "./global-context";
import {
    imBeginListRow,
    imEndListRow,
    imListRowCellStyle,
    ROW_EDITING,
    ROW_EXISTS,
    ROW_FOCUSED,
    ROW_SELECTED
} from "./list-row";
import { clampedListIdx, getNavigableListInput, ListPosition, newListPosition } from "./navigable-list";
import {
    APP_VIEW_ACTIVITIES,
    APP_VIEW_NOTES,
    COLLAPSED_STATUS,
    createNewNote,
    deleteNoteIfEmpty,
    getCurrentNote,
    getNote,
    getNumSiblings,
    idIsNil,
    idIsNilOrRoot,
    idIsRoot,
    isNoteCollapsed,
    isNoteEmpty,
    noteStatusToString,
    recomputeFlatNotes,
    recomputeNoteParents,
    recomputeNoteStatusRecursively,
    setCurrentNote,
    setIsEditingCurrentNote,
    setNoteText,
    state,
    STATUS_IN_PROGRESS,
    TreeNote
} from "./state";
import { boundsCheck, findLastIndex } from "./utils/array-utils";
import { assert } from "./utils/assert";
import {
    HORIZONTAL,
    imBeginSpan,
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imMemo,
    imNextRoot,
    imOn,
    isFirstishRender,
    setClass,
    setStyle,
    setText
} from "./utils/im-dom-utils";
import * as tree from "./utils/int-tree";

export type NoteTreeViewState = {
    invalidateNote:      boolean; // Only set if we can't recompute the notes immediately - i.e if we're traversing the data structure
    note:                TreeNote;
    noteParentNotes:     TreeNote[];
    viewRoot:            TreeNote;
    viewRootParentNotes: TreeNote[];
    childNotes:          TreeNote[];

    scrollContainer: ScrollContainer;

    listPos: ListPosition;

    // Debugging
    numVisible: number;
};

function setNote(s: NoteTreeViewState, note: TreeNote, invalidate = false) {
    if (invalidate || s.note !== note) {
        if (s.note !== note) {
            invalidate ||= deleteNoteIfEmpty(state, s.note);
        }

        s.note = note;
        startScrolling(s.scrollContainer, true);
        recomputeNoteParents(state, s.noteParentNotes, s.note);
        setCurrentNote(state, note.id);

        const viewRoot = getNoteViewRoot(note);
        if (s.viewRoot !== viewRoot) {
            s.viewRoot = viewRoot;
            startScrolling(s.scrollContainer, false);
            recomputeNoteParents(state, s.viewRootParentNotes, s.viewRoot);
        }

        // flat notes need recompuation when the child changes.
        recomputeFlatNotes(state, s.childNotes, s.viewRoot, s.note, false);
        s.listPos.idx = s.childNotes.indexOf(note);
        assert(s.childNotes.length === 0 || s.listPos.idx !== -1);
    }
}

function getNoteViewRoot(currentNote: TreeNote) {
    let it = currentNote;
    while (!idIsNil(it.parentId)) {
        it = getNote(state, it.parentId);
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
        note,
        viewRoot,
        noteParentNotes:     [],
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

    const parent = getNote(state, s.note.parentId);

    if (moveNote) {
        if (!idIsNil(parent.parentId)) {
            // Move this note to after it's parent
            const parentParent = getNote(state, parent.parentId);
            const parentIdx = parent.idxInParentList;
            tree.insertAt(state.notes, parentParent, s.note, parentIdx + 1);
            recomputeNoteStatusRecursively(state, parent);
            setNote(s, s.note, true);
            ctx.requestSaveState = true;
        }
    } else {
        setNote(s, parent, true);
    }
}

function moveIntoCurrent(
    ctx: GlobalContext,
    s: NoteTreeViewState,
    moveNote: boolean,
) {
    if (!boundsCheck(s.childNotes, s.listPos.idx)) return;
    if (idIsNil(s.note.parentId)) return;

    if (moveNote) {
        const parentIdx = s.note.idxInParentList;
        if (parentIdx !== 0) {
            const parent = getNote(state, s.note.parentId);
            const prevNoteId = parent.childIds[parentIdx - 1];
            const prevNote = getNote(state, prevNoteId);
            let idxUnderPrev = clampedListIdx(
                prevNote.data.lastSelectedChildIdx + 1,
                prevNote.childIds.length
            ) + 1;
            tree.insertAt(state.notes, prevNote, s.note, idxUnderPrev);
            prevNote.data.lastSelectedChildIdx = idxUnderPrev;
            setNote(s, s.note, true);
            recomputeNoteStatusRecursively(state, prevNote);
            ctx.requestSaveState = true;
        }
    } else {
        const nextRoot = s.childNotes[s.listPos.idx];

        if (nextRoot.childIds.length > 0) {
            if (!boundsCheck(nextRoot.childIds, nextRoot.data.lastSelectedChildIdx)) {
                nextRoot.data.lastSelectedChildIdx = nextRoot.childIds.length - 1;
            }

            const nextChildId = nextRoot.childIds[nextRoot.data.lastSelectedChildIdx];
            const nextChild = getNote(state, nextChildId);
            setNote(s, nextChild, true);
        }
    }
}


export function imNoteTreeView(
    ctx: GlobalContext,
    s: NoteTreeViewState,
    viewFocused: boolean
) {
    addToNavigationList(ctx, APP_VIEW_NOTES);

    if (imMemo(state.currentNoteId)) {
        const note = getCurrentNote(state);
        setNote(s, note);
    } 

    if (s.invalidateNote) {
        s.invalidateNote = false;
        setNote(s, s.note, true);
    }

    if (viewFocused) {
        handleKeyboardInput(ctx, s);
    }

    imBegin(COL); imFlex(); {
        imBegin(); {
            s.numVisible = 0;
            imFor(); for (const row of s.viewRootParentNotes) {
                imNextRoot(row);

                imBeginListRow(ROW_EXISTS); {
                    imNoteTreeRow(ctx, s, row, viewFocused);
                } imEndListRow();
            } imEndFor();
        } imEnd();

        imLine(
            HORIZONTAL, 1,
            !!s.scrollContainer.root && s.scrollContainer.root.root.scrollTop > 1,
        );

        imBeginScrollContainer(s.scrollContainer); {
            const SCROLL_TIMEOUT_SECONDS = 1;
            if (imTimerRepeat(SCROLL_TIMEOUT_SECONDS, s.scrollContainer.isScrolling)) {
                s.scrollContainer.isScrolling = false;
            }

            imFor(); for (let i = 0; i < s.childNotes.length; i++) {
                const row = s.childNotes[i];

                imNextRoot(row.id);

                const itemSelected = s.listPos.idx === i;

                let rowStatus = ROW_EXISTS;
                if (itemSelected) {
                    rowStatus = ROW_SELECTED;
                    if (viewFocused) {
                        rowStatus = ROW_FOCUSED;
                        if (state._isEditingFocusedNote) {
                            rowStatus = ROW_EDITING;
                        }
                    }
                }

                const root = imBeginListRow(rowStatus); {
                    imNoteTreeRow(ctx, s, row, viewFocused, i, itemSelected);
                } imEndListRow();

                if (itemSelected) {
                    scrollToItem(s.scrollContainer, root)
                }
            } imEndFor();

            // Want to scroll off the bottom a bit
            imBegin(); imSize(0, NOT_SET, 200, PX); imEnd();
        } imEnd();

    } imEnd();
}


const UNDER = 1;
const AFTER = 2;
function addNoteAtCurrent(ctx: GlobalContext, s: NoteTreeViewState, insertType: typeof UNDER | typeof AFTER): TreeNote {
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

    ctx.requestSaveState = true;

    return newNote;
}

function moveToLocalidx(
    ctx: GlobalContext,
    s: NoteTreeViewState,
    delta: number,
    moveNote: boolean
) {
    if (idIsNil(s.note.parentId)) return;
    
    const parent = getNote(state, s.note.parentId);
    let idx = s.note.idxInParentList + delta;
    idx = clampedListIdx(idx, parent.childIds.length);
    if (!boundsCheck(parent.childIds, idx)) return;

    if (moveNote) {
        tree.insertAt(state.notes, parent, s.note, idx);
        setNote(s, s.note, true);
        ctx.requestSaveState = true;
    } else {
        const childId = parent.childIds[idx];
        const note = getNote(state, childId);
        setNote(s, note, false);
    }
}

function handleKeyboardInput(ctx: GlobalContext, s: NoteTreeViewState) {
    const { keyboard } = ctx;

    const currentNote = getCurrentNote(state);
    const ctrl = hasDiscoverableHold(ctx, keyboard.ctrlKey);
    const shift = hasDiscoverableHold(ctx, keyboard.shiftKey);

    if (!ctx.handled && state._isEditingFocusedNote) {
        if (!ctrl && !shift && hasDiscoverableCommand(ctx, keyboard.escapeKey, "Stop editing", BYPASS_TEXT_AREA)) {
            setIsEditingCurrentNote(state, false);
            ctx.handled = true;
        }
    }

    if (!ctx.handled && !state._isEditingFocusedNote) {
        const delta = getNavigableListInput(ctx);
        const moveNote = keyboard.altKey.held;
        if (delta) {
            moveToLocalidx(ctx, s, delta, moveNote);
            ctx.handled = true;
        } else if (keyboard.leftKey.pressed) {
            moveOutOfCurrent(ctx, s, moveNote);
            ctx.handled = true;
        } else if (keyboard.rightKey.pressed) {
            moveIntoCurrent(ctx, s, moveNote);
            ctx.handled = true;
        }
        
        if (!ctrl && !shift && hasDiscoverableCommand(ctx, keyboard.tabKey, "Go to activity", REPEAT)) {
            // TODO: just recompute this when we set the note
            const idx = findLastIndex(state.activities, a => a.nId === state.currentNoteId && !a.deleted)
            if (idx !== -1) {
                activitiesViewSetIdx(ctx.activityView, idx, true);
                state._currentScreen = APP_VIEW_ACTIVITIES;
            }
            ctx.handled = true;
        }
    }

    // Adding a note can be done in both editing and not editing contexts
    if (!ctx.handled) {
        let noteToSet: TreeNote | undefined;

        let hasCtrlOrShiftHeld = false;

        if (!isNoteEmpty(currentNote)) {
            if (shift) {
                hasCtrlOrShiftHeld = true;
                if (hasDiscoverableCommand(ctx, keyboard.enterKey, "Insert note after", BYPASS_TEXT_AREA)) {
                    noteToSet = addNoteAtCurrent(ctx, s, AFTER);
                }
            } else if (ctrl) {
                hasCtrlOrShiftHeld = true;
                if (hasDiscoverableCommand(ctx, keyboard.enterKey, "Insert note under", BYPASS_TEXT_AREA)) {
                    noteToSet = addNoteAtCurrent(ctx, s, UNDER);
                }
            }
        }

        if (!noteToSet && !state._isEditingFocusedNote && !hasCtrlOrShiftHeld) {
            if (hasDiscoverableCommand(ctx, keyboard.enterKey, "Edit note")) {
                noteToSet = currentNote;
            }
        }

        if (noteToSet) {
            setNote(s, noteToSet, true);
            setIsEditingCurrentNote(state, true);

            ctx.handled = true;
        }
    }
}

function imNoteTreeRow(
    ctx: GlobalContext,
    s: NoteTreeViewState,
    note: TreeNote, 
    viewFocused: boolean,
    idx = -1, 
    itemSelected = false
) {
    s.numVisible++;

    let numInProgress = 0;
    let numDone = 0;
    for (const id of note.childIds) {
        const note = getNote(state, id);
        if (note.data._status === STATUS_IN_PROGRESS) {
            numInProgress++;
        } else {
            numDone++;
        }
    }

    imBegin(ROW); imFlex(); {
        setClass(cn.preWrap, itemSelected);

        // The tree visuals
        imBegin(ROW_REVERSE); {
            imFor();

            const noteIsParent = s.noteParentNotes.includes(note) || idIsRoot(note.id);

            let it = note;
            let foundLineInPath = false;
            let depth = -1;

            while (!idIsNil(it.parentId)) {
                imNextRoot();

                const itPrev = it;
                const itPrevNumSiblings = getNumSiblings(state, itPrev);
                it = getNote(state, it.parentId);
                depth++;

                // |---->| indent
                // [  x  ]Vertical line should line up with the note status above it:
                //    |
                //    |<-| bullet start
                //    |
                //    +-- [ x ] >> blah blah blah

                // const isLineInPath = inPath && prev === note;

                const itIsParent = s.noteParentNotes.includes(it) || idIsRoot(it.id);

                const isLineInPath: boolean = 
                    !foundLineInPath && 
                    idx <= s.listPos.idx && 
                    itIsParent;

                foundLineInPath ||= isLineInPath;

                const hasHLine = itPrev.id === note.id;
                const indent = 30;
                const bulletStart = 5;

                const smallThicnkess = 1;
                const largeThicnkess = 4;
                const isLast = itPrev.idxInParentList === itPrevNumSiblings - 1;

                let pathGoesRight = (noteIsParent || it.id === note.id);

                // if (0) 
                {
                    imBegin(); imRelative(); imSize(indent, PX, 0, NOT_SET); {
                        // horizontal line xD
                        if (imIf() && hasHLine) {
                            imBegin();
                            imAbsolute(0, NOT_SET, 0, PX, 1, EM, 0, NOT_SET);
                            const isThick = isLineInPath && pathGoesRight;
                            imSize(
                                bulletStart, PX,
                                isThick ? largeThicnkess: smallThicnkess, PX,
                            );
                            imBg(cssVarsApp.fgColor); {
                                if (isFirstishRender()) {
                                    setStyle("transform", "translate(0, -100%)");
                                }
                            } imEnd();
                        } imEndIf();

                        const canDrawVerticalLine = !isLast || note === itPrev;

                        if (imIf() && canDrawVerticalLine) {
                            let midpointLen = 1;
                            let midpointUnits = EM;

                            // Vertical line part 1. xd. We need a better API
                            imBegin();
                            imAbsolute(
                                0, NOT_SET, bulletStart, PX,
                                0, PX, 0, isLast ? NOT_SET : PX,
                            );
                            imSize(
                                isLineInPath ? largeThicnkess: smallThicnkess, PX, 
                                midpointLen, midpointUnits
                            );
                            imBg(cssVarsApp.fgColor); {
                            } imEnd();

                            // Vertical line part 2.
                            imBegin();
                            imAbsolute(
                                0, NOT_SET, bulletStart, PX,
                                midpointLen, midpointUnits, 0, isLast ? NOT_SET : PX,
                            );
                            const isThick = isLineInPath && !pathGoesRight;
                            imSize(
                                isThick ? largeThicnkess: smallThicnkess, PX, 
                                0, NOT_SET
                            );
                            imOpacity(isLast ? 0 : 1);
                            imBg(cssVarsApp.fgColor); {
                            } imEnd();
                        } imEndIf();
                    } imEnd();
                }
            }
            imEndFor();
        } imEnd();

        imBegin(ROW); imFlex(); imListRowCellStyle(); {
            if (imMemo(note.data._status)) {
                setStyle("color", note.data._status === STATUS_IN_PROGRESS ? "" : cssVarsApp.unfocusTextColor);
            }

            imBegin(ROW); imFlex(); {
                if (imMemo(itemSelected)) {
                    setClass(cn.preWrap, itemSelected);
                    setClass(cn.pre, !itemSelected);
                    setClass(cn.noWrap, !itemSelected);
                    setClass(cn.overflowHidden, !itemSelected);
                }

                imBegin(ROW); {
                    imInitClasses(cn.noWrap);
                    imBegin(); setText(noteStatusToString(note.data._status)); imEnd();
                    if (imIf() && (numInProgress + numDone) > 0) {
                        imBegin(); imSize(0.5, CH, 0, NOT_SET); imEnd();
                        imBeginSpan(); setText(`(${numDone}/${numInProgress + numDone})`); imEnd();
                    } imEndIf();
                    imBegin(); imSize(0.5, CH, 0, NOT_SET); imEnd();
                } imEnd();

                const isEditing = viewFocused && itemSelected && state._isEditingFocusedNote;
                const isEditingChanged = imMemo(isEditing);

                if (imIf() && isEditing) {
                    const [,textArea] = imBeginTextArea({
                        value: note.data.text,
                    }); {
                        const input = imOn("input");
                        const change = imOn("change");

                        if (input || change) {
                            let status = s.note.data._status;
                            setNoteText(state, s.note, textArea.root.value);
                            ctx.requestSaveState = true;
                            ctx.handled = true;
                            if (status !== s.note.data._status) {
                                s.invalidateNote = true;
                            }
                        }

                        const keyDown = imOn("keydown");
                        if (keyDown) {
                            ctx.handled = doExtraTextAreaInputHandling(keyDown, textArea.root, {})
                        }

                        if (isEditingChanged) {
                            textArea.root.selectionStart = textArea.root.value.length;
                            textArea.root.selectionEnd = textArea.root.value.length;
                        }

                        ctx.textAreaToFocus = textArea;
                    } imEndTextArea();
                } else {
                    imElse();

                    imBeginSpan(); {
                        imBeginSpan(); {
                            if (imMemo(note.data.text)) {
                                let text = note.data.text;
                                if (text.length > 150) {
                                    text = `[${text.length}ch] - ${text}`;
                                }

                                setText(text);
                            }
                        } imEnd();
                    } imEnd();
                } imEndIf();
            } imEnd();
        } imEnd();
    } imEnd();
}


