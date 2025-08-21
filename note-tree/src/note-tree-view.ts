import {
    newScrollContainer,
    ScrollContainer,
    startScrolling
} from "src/components/scroll-container";
import { activitiesViewSetIdx, NOT_IN_RANGE } from "./activities-list";
import { imLine, LINE_HORIZONTAL } from "./app-components/common";
import { cssVarsApp } from "./app-styling";
import {
    CH,
    COL,
    EM,
    imAbsolute,
    imLayout,
    imBg,
    imFlex,
    imGap,
    imOpacity,
    imRelative,
    imSize,
    NA,
    PX,
    ROW,
    ROW_REVERSE,
    BLOCK,
    imLayoutEnd
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
import { boundsCheck, filterInPlace, findLastIndex } from "./utils/array-utils";
import { assert } from "./utils/assert";
import { formatDateTime } from "./utils/datetime";
import * as tree from "./utils/int-tree";
import { ImCache, imFor, imForEnd, imGet, imIf, imIfElse, imIfEnd, imKeyed, imKeyedEnd, imMemo, imSet, inlineTypeId, isFirstishRender } from "./utils/im-core";
import { EXTENT_END, EXTENT_START, EXTENT_VERTICAL, getElementExtentNormalized } from "./utils/dom-utils";
import { elSetClass, elSetStyle, EV_CHANGE, EV_CLICK, EV_INPUT, EV_KEYDOWN, imOn, imStr } from "./utils/im-dom";

export type NoteTreeViewState = {
    invalidateNote:      boolean; // Only set if we can't recompute the notes immediately - i.e if we're traversing the data structure
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
            s.stickyNotes.length = 0;
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


export function imNoteTreeView(c: ImCache, ctx: GlobalContext, s: NoteTreeViewState) {
    const viewFocused = ctx.currentView === s;

    if (imMemo(c, state.currentNoteId)) {
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

    imLayout(c, COL); imFlex(c); {
        imLayout(c, BLOCK); {
            s.numVisible = 0;
            imFor(c); for (const row of s.viewRootParentNotes) {
                imKeyed(c, row); {
                    imNoteTreeRow(c, ctx, null, s, row, viewFocused);
                } imKeyedEnd(c);
            } imForEnd(c);
        } imLayoutEnd(c);

        imLine(
            c,
            LINE_HORIZONTAL, 1,
            !!s.scrollContainer.root && s.scrollContainer.root.scrollTop > 1,
        );

        imLayout(c, BLOCK); {
            imFor(c); for (const row of s.stickyNotes) {
                imKeyed(c, row); {
                    imNoteTreeRow(c, ctx, null, s, row, viewFocused);
                } imKeyedEnd(c);
            } imForEnd(c);
        } imLayoutEnd(c);

        const list = imBeginNavList(c, s.scrollContainer, s.listPos.idx, viewFocused, state._isEditingFocusedNote); {
            while (imNavListNextItemArray(list, s.childNotes)) {
                const { i, itemSelected } = list;
                const note = s.childNotes[i];

                const root = imNoteTreeRow(c, ctx, list, s, note, viewFocused, i, itemSelected);

                // A bit stupid but yeah whatever.
                if (
                    s.noteParentNotes.includes(note) &&
                    s.scrollContainer.root
                ) {
                    if (
                        !s.stickyNotes.includes(note) &&
                        getElementExtentNormalized(s.scrollContainer.root, root, EXTENT_VERTICAL | EXTENT_END) < 0
                    ) {
                        s.stickyNotes.push(note);
                    } else if (
                        s.stickyNotes.includes(note) &&
                        getElementExtentNormalized(s.scrollContainer.root, root, EXTENT_VERTICAL | EXTENT_START) > 0
                    ) {
                        filterInPlace(s.stickyNotes, n => n !== note);
                    }
                }
            };

            // Want to scroll off the bottom a bit
            imKeyed(c, "scrolloff"); {
                imLayout(c, BLOCK); imSize(c, 0, NA, 500, PX); imLayoutEnd(c);
            } imKeyedEnd(c);
        } imEndNavList(c, list);

        imLine(c, LINE_HORIZONTAL, 1);

        const currentNote = getCurrentNote(state);
        imLayout(c, ROW); imGap(c, 10, PX); {
            imLayout(c, BLOCK); imStr(c, "Created " + formatDateTime(currentNote.data.openedAt)); imLayoutEnd(c);
            imLayout(c, BLOCK); imStr(c, "|"); imLayoutEnd(c);
            imLayout(c, BLOCK); imStr(c, "Last Edited " + formatDateTime(currentNote.data.editedAt)); imLayoutEnd(c);
        } imLayoutEnd(c);
    } imLayoutEnd(c);
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

    const root = imBeginNavListRow(c, list); {
        imLayout(c, ROW); imFlex(c); {
            elSetClass(c, cn.preWrap, itemSelected);

            // The tree visuals
            imLayout(c, ROW_REVERSE); {
                const noteIsParent = s.noteParentNotes.includes(note) || idIsRoot(note.id);

                let it = note;
                let foundLineInPath = false;
                let depth = -1;

                imFor(c); while (!idIsNil(it.parentId)) {
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
                        imLayout(c, BLOCK); imRelative(c); imSize(c, indent, PX, 0, NA); {
                            // horizontal line xD
                            if (imIf(c) && hasHLine) {
                                imLayout(c, BLOCK); imAbsolute(c, 0, NA, 0, PX, 1, EM, 0, NA); {
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
                                let midpointLen = 1;
                                let midpointUnits = EM;

                                // Vertical line part 1. xd. We need a better API
                                imLayout(c, BLOCK); imAbsolute(c, 0, NA, bulletStart, PX, 0, PX, 0, isLast ? NA : PX); {
                                    imSize(
                                        c,
                                        isLineInPath ? largeThicnkess : smallThicnkess, PX,
                                        midpointLen, midpointUnits
                                    );
                                    imBg(c, cssVarsApp.fgColor); 
                                } imLayoutEnd(c);

                                // Vertical line part 2.
                                imLayout(c, BLOCK); {
                                    const isThick = isLineInPath && !pathGoesRight;
                                    imAbsolute(c, 0, NA, bulletStart, PX, midpointLen, midpointUnits, 0, isLast ? NA : PX); 
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

            imLayout(c, ROW); imFlex(c); imListRowCellStyle(c); {
                if (imMemo(c, note.data._status)) {
                    elSetStyle(c, "color", note.data._status === STATUS_IN_PROGRESS ? "" : cssVarsApp.unfocusTextColor);
                }

                imLayout(c, ROW); imFlex(c); {
                    if (imMemo(c, itemSelected)) {
                        elSetClass(c, cn.preWrap, itemSelected);
                        elSetClass(c, cn.pre, !itemSelected);
                        elSetClass(c, cn.noWrap, !itemSelected);
                        elSetClass(c, cn.overflowHidden, !itemSelected);
                    }

                    imLayout(c, ROW); {
                        if (isFirstishRender(c)) {
                            elSetClass(c, cn.noWrap);
                        }

                        imLayout(c, BLOCK); imStr(c, noteStatusToString(note.data._status)); imLayoutEnd(c);
                        if (imIf(c) && (numInProgress + numDone) > 0) {
                            imLayout(c, BLOCK); imSize(c, 0.5, CH, 0, NA); imLayoutEnd(c);
                            imStr(c, `(${numDone}/${numInProgress + numDone})`);
                        } imIfEnd(c);
                        imLayout(c, BLOCK); imSize(c, 0.5, CH, 0, NA); imLayoutEnd(c);
                    } imLayoutEnd(c);

                    const isEditing = viewFocused && itemSelected && state._isEditingFocusedNote;
                    const isEditingChanged = imMemo(c, isEditing);

                    if (imIf(c) && isEditing) {
                        const [, textArea] = imBeginTextArea(c, {
                            value: note.data.text,
                        }); {
                            const input = imOn(c, EV_INPUT);
                            const change = imOn(c, EV_CHANGE);

                            if (imMemo(c, state.settings.tabStopSize)) {
                                elSetStyle(c, "tabSize", "" + state.settings.tabStopSize);
                            }

                            if (input || change) {
                                let status = s.note.data._status;
                                let collapseStatus = isNoteCollapsed(s.note);

                                setNoteText(state, s.note, textArea.value);

                                state._notesMutationCounter++;
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
                        } imEndTextArea(c);
                    } else {
                        imIfElse(c);

                        const textChanged = imMemo(c, note.data.text);
                        let text = imGet(c, String);
                        if (text === undefined || textChanged) {
                            let val = note.data.text;
                            if (val.length > 150) {
                                val = `[${val.length}ch] - ${text}`;
                            }

                            text = imSet(c, val);
                        }

                        imStr(c, text);
                    } imIfEnd(c);
                } imLayoutEnd(c);
            } imLayoutEnd(c);
        } imLayoutEnd(c);
    } imEndNavListRow(c);

    return root;
}


