import {
    newScrollContainer,
    ScrollContainer,
    startScrolling
} from "src/components/scroll-container";
import { activitiesViewSetIdx, NOT_IN_RANGE } from "./activities-list";
import { imLine } from "./app-components/common";
import { cssVarsApp } from "./app-styling";
import {
    CH,
    COL,
    EM,
    imAbsolute,
    imBegin,
    imBg,
    imFlex,
    imGap,
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
import {
    BYPASS_TEXT_AREA,
    CTRL,
    GlobalContext,
    hasDiscoverableCommand,
    REPEAT,
    SHIFT
} from "./global-context";
import {
    imListRowCellStyle
} from "./list-row";
import {
    clampedListIdx,
    getNavigableListInput,
    imBeginNavList,
    imBeginNavListRow,
    imEndNavList,
    imEndNavListRow,
    imNavListNextItemArray,
    ListPosition,
    NavigableListState,
    newListPosition
} from "./navigable-list";
import {
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
    NoteTreeGlobalState,
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
import { formatDateTime } from "./utils/datetime";
import {
    HORIZONTAL,
    imBeginSpan,
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imIsFirstishRender,
    imMemo,
    imNextListRoot,
    imOn,
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

// NOTE: recompute status _after_ doing this
function setNote(s: NoteTreeViewState, note: TreeNote, invalidate = false) {
    let mutated = false;
    if (invalidate || s.note !== note) {
        if (s.note !== note) {
            mutated ||= deleteNoteIfEmpty(state, s.note);
            invalidate ||=mutated;
        }

        s.note = note;
        if (s.scrollContainer) startScrolling(s.scrollContainer, true);
        recomputeNoteParents(state, s.noteParentNotes, s.note);
        // if (state.currentNoteId !== note.id) {
            setCurrentNote(state, note.id);
        // }

        const viewRoot = getNoteViewRoot(state, note);
        if (s.viewRoot !== viewRoot) {
            s.viewRoot = viewRoot;
            if (s.scrollContainer) startScrolling(s.scrollContainer, false);
            recomputeNoteParents(state, s.viewRootParentNotes, s.viewRoot);
        }

        // flat notes need recompuation when the child changes.
        recomputeFlatNotes(state, s.childNotes, s.viewRoot, s.note, false);
        s.listPos.idx = s.childNotes.indexOf(note);
        assert(s.childNotes.length === 0 || s.listPos.idx !== -1);
    }

    if (invalidate) {
        recomputeNoteStatusRecursively(state, note);
        state._notesMutationCounter++;
    }
}

export function getNoteViewRoot(state: NoteTreeGlobalState, currentNote: TreeNote) {
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
            setNote(s, s.note, true);
            recomputeNoteStatusRecursively(state, parent);
            state._notesMutationCounter++;
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
            state._notesMutationCounter++;
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


export function imNoteTreeView(ctx: GlobalContext, s: NoteTreeViewState) {
    const viewFocused = ctx.currentView === s;

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
                imNextListRoot(row); 
                imNoteTreeRow(ctx, null, s, row, viewFocused);
            } imEndFor();
        } imEnd();

        imLine(
            HORIZONTAL, 1,
            !!s.scrollContainer.root && s.scrollContainer.root.root.scrollTop > 1,
        );

        const list = imBeginNavList(s.scrollContainer, s.listPos.idx, viewFocused, state._isEditingFocusedNote); {
            while (imNavListNextItemArray(list, s.childNotes)) {
                const { i, itemSelected } = list;
                const row = s.childNotes[i];
                imNoteTreeRow(ctx, list, s, row, viewFocused, i, itemSelected);
            };

            // Want to scroll off the bottom a bit
            imNextListRoot("scrolloff");
            imBegin(); imSize(0, NOT_SET, 500, PX); imEnd();
        } imEndNavList(list);

        imLine(HORIZONTAL, 1);

        const currentNote = getCurrentNote(state);
        imBegin(ROW); imGap(10, PX); {
            imBegin(); setText("Created " + formatDateTime(currentNote.data.openedAt)); imEnd();
            imBegin(); setText("|"); imEnd();
            imBegin(); setText("Last Edited " + formatDateTime(currentNote.data.editedAt)); imEnd();
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
    state._notesMutationCounter++;

    return newNote;
}

function moveToLocalidx(
    ctx: GlobalContext,
    s: NoteTreeViewState,
    idx: number,
    moveNote: boolean
) {
    if (idIsNil(s.note.parentId)) return;
    
    const parent = getNote(state, s.note.parentId);
    idx = clampedListIdx(idx, parent.childIds.length);
    if (!boundsCheck(parent.childIds, idx)) return;

    if (moveNote) {
        tree.insertAt(state.notes, parent, s.note, idx);
        setNote(s, s.note, true);
        recomputeNoteStatusRecursively(state, s.note);
        state._notesMutationCounter++;
    } else {
        const childId = parent.childIds[idx];
        const note = getNote(state, childId);
        setNote(s, note, false);
    }
}

function handleKeyboardInput(ctx: GlobalContext, s: NoteTreeViewState) {
    const { keyboard } = ctx;

    const currentNote = getCurrentNote(state);
    const parent = getNote(state, currentNote.parentId);

    if (state._isEditingFocusedNote) {
        if (hasDiscoverableCommand(ctx, keyboard.escapeKey, "Stop editing", BYPASS_TEXT_AREA)) {
            setIsEditingCurrentNote(state, false);
        }
    }

    if (hasDiscoverableCommand(ctx, keyboard.tKey, "Fast-travel")) {
        ctx.currentView = ctx.views.fastTravel;
    }

    if (!state._isEditingFocusedNote) {
        if (!ctx.handled) {
            const moveNote = keyboard.altKey.held;
            const listNavInput = getNavigableListInput(ctx, currentNote.idxInParentList, 0, parent.childIds.length);
            if (listNavInput) {
                moveToLocalidx(ctx, s, listNavInput.newIdx, moveNote);
            } else if (keyboard.leftKey.pressed) {
                moveOutOfCurrent(ctx, s, moveNote);
                ctx.handled = true;
            } else if (keyboard.rightKey.pressed) {
                moveIntoCurrent(ctx, s, moveNote);
                ctx.handled = true;
            }
        }
        
        if (hasDiscoverableCommand(ctx, keyboard.aKey, "Note activity", REPEAT)) {
            // TODO: just recompute this when we set the note
            const idx = findLastIndex(state.activities, a => a.nId === state.currentNoteId && !a.deleted)
            if (idx !== -1) {
                activitiesViewSetIdx(ctx, ctx.views.activities, idx, NOT_IN_RANGE);
                ctx.currentView = ctx.views.activities;
            }
        }

        if (hasDiscoverableCommand(ctx, keyboard.slashKey, "URLs", CTRL)) {
            ctx.currentView = ctx.views.urls;
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

function imNoteTreeRow(
    ctx: GlobalContext,
    list: NavigableListState | null,
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

    const root = imBeginNavListRow(list); {
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
                    imNextListRoot();

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

                    // the tree visuals. It was a lot easier to do these here than in my last framework
                    {
                        imBegin(); imRelative(); imSize(indent, PX, 0, NOT_SET); {
                            // horizontal line xD
                            if (imIf() && hasHLine) {
                                imBegin();
                                imAbsolute(0, NOT_SET, 0, PX, 1, EM, 0, NOT_SET);
                                const isThick = isLineInPath && pathGoesRight;
                                imSize(
                                    bulletStart, PX,
                                    isThick ? largeThicnkess : smallThicnkess, PX,
                                );
                                imBg(cssVarsApp.fgColor); {
                                    if (imIsFirstishRender()) {
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
                                    isLineInPath ? largeThicnkess : smallThicnkess, PX,
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
                                    isThick ? largeThicnkess : smallThicnkess, PX,
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
                        const [, textArea] = imBeginTextArea({
                            value: note.data.text,
                        }); {
                            const input = imOn("input");
                            const change = imOn("change");

                            if (input || change) {
                                let status = s.note.data._status;
                                let collapseStatus = isNoteCollapsed(s.note);

                                setNoteText(state, s.note, textArea.root.value);

                                state._notesMutationCounter++;
                                ctx.handled = true;
                                if (
                                    status !== s.note.data._status ||
                                    collapseStatus !== isNoteCollapsed(s.note)
                                ) {
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
    } imEndNavListRow();

    return root;
}


