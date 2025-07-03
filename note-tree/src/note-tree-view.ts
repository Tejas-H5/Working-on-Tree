import { imHLine } from "./app-components/common";
import { cssVarsApp } from "./app-styling";
import { newTimer, timerHasReached, updateTimer } from "./app-utils/timer";
import {
    CH,
    EM,
    imAbsolute,
    imBegin,
    imBg,
    imFlex,
    imInitClasses,
    imOpacity,
    imPadding,
    imRelative,
    imScrollContainer,
    imSize,
    NOT_SET,
    PX,
    ROW,
    ROW_REVERSE
} from "./components/core/layout";
import { cn } from "./components/core/stylesheets";
import { imTextArea } from "./components/editable-text-area";
import { GlobalContext } from "./global-context";
import { lerp } from "./legacy-app-components/canvas-state";
import { clampedListIdx, getNavigableListInput, NavigableList, newListState } from "./navigable-list";
import {
    createNewNote,
    deleteNoteIfEmpty,
    getCurrentNote,
    getNote,
    getNumSiblings,
    idIsNil,
    idIsNilOrRoot,
    idIsRoot,
    isNoteOpaque,
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
import { boundsCheck } from "./utils/array-utils";
import { assert } from "./utils/assert";
import {
    deltaTimeSeconds,
    getScrollVH,
    imBeginSpan,
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imMemo,
    imNextRoot,
    imState,
    isFirstRender,
    setClass,
    setStyle,
    setText,
    UIRoot
} from "./utils/im-dom-utils";
import * as tree from "./utils/int-tree";

export type NoteTreeViewState = {
    invalidateNote:      boolean; // Only set if we can't recompute the notes immediately - i.e if we're traversing the data structure
    note:                TreeNote;
    noteParentNotes:     TreeNote[];
    viewRoot:            TreeNote;
    viewRootParentNotes: TreeNote[];
    childNotes:          TreeNote[];

    scrollContainer: UIRoot<HTMLElement> | null;
    isScrolling:  boolean;
    smoothScroll: boolean;
    list:         NavigableList;


    // Debugging
    numVisible: number;
};

function setNote(s: NoteTreeViewState, note: TreeNote, invalidate = false) {
    if (invalidate || s.note !== note) {
        if (s.note !== note) {
            invalidate ||= deleteNoteIfEmpty(state, s.note);
        }

        s.note = note;
        s.isScrolling = true;
        s.smoothScroll = true;
        recomputeNoteParents(state, s.noteParentNotes, s.note);
        setCurrentNote(state, note.id);

        const viewRoot = getNoteViewRoot(note);
        if (invalidate || s.viewRoot !== viewRoot) {
            s.viewRoot = viewRoot;
            state._currentFlatNotesRootId = viewRoot.id;
            recomputeNoteParents(state, s.viewRootParentNotes, s.viewRoot);
            recomputeFlatNotes(state, s.childNotes, s.viewRoot, s.note, false);
            assert(s.childNotes.length === 0 || s.list.idx !== -1);
            s.smoothScroll = false;
        }

        s.list.idx = s.childNotes.indexOf(note);
    }
}

function getNoteViewRoot(currentNote: TreeNote) {
    let it = currentNote;
    while (!idIsNil(it.parentId)) {
        it = getNote(state, it.parentId);
        if (isNoteOpaque(state, currentNote, it)) {
            break;
        }
    }
    return it;
}

export function newNoteTreeViewState(): NoteTreeViewState {
    const note = getCurrentNote(state);
    const viewRoot = getNoteViewRoot(note);
    const s: NoteTreeViewState = {
        invalidateNote: false,
        note,
        viewRoot,
        noteParentNotes:     [],
        viewRootParentNotes: [],
        childNotes:          [],
        scrollContainer:     null,

        list:           newListState(),
        isScrolling:    false,
        smoothScroll:   false,

        numVisible:     0,
    };

    setNote(s, s.note, true);

    return s;
}

function setIdx(s: NoteTreeViewState, idx: number) {
    s.list.idx = clampedListIdx(idx, s.childNotes.length);
    if (s.list.idx === -1) return;

    const note = s.childNotes[s.list.idx];
    state.currentNoteId = note.id;
    setNote(s, note);
}

function setIdxLocal(s: NoteTreeViewState, localIdx: number) {
    const parent = getNote(state, s.note.parentId);

    localIdx = clampedListIdx(localIdx, parent.childIds.length);
    if (!boundsCheck(parent.childIds, localIdx)) return;
    const childId = parent.childIds[localIdx];

    const note = getNote(state, childId);
    setNote(s, note);
}

function moveIdx(s: NoteTreeViewState, amount: number) {
    setIdx(s, s.list.idx + amount);
}

function moveIdxLocal(s: NoteTreeViewState, amount: number) {
    const localIdx = s.note.idxInParentList;
    setIdxLocal(s, localIdx + amount);
}

function moveOutOfCurrent(
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
        }
    } else {
        setNote(s, parent, true);
    }
}

function moveIntoCurrent(
    s: NoteTreeViewState,
    moveNote: boolean,
) {
    if (!boundsCheck(s.childNotes, s.list.idx)) return;
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
        }
    } else {
        const nextRoot = s.childNotes[s.list.idx];

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

export function imNoteTreeView(ctx: GlobalContext) {
    const s = ctx.noteTreeViewState;

    if (s.invalidateNote) {
        s.invalidateNote = false;
        setNote(s, s.note, true);
    }

    handleKeyboardInput(ctx, s);

    imBegin(); {
        s.numVisible = 0;
        imFor(); for (const row of s.viewRootParentNotes) {
            imNextRoot();

            imBeginListRow(false); {
                imNoteTreeRow(s, row);
            } imEndListRow();
        } imEndFor();
    } imEnd();

    imHLine(
        !!s.scrollContainer && s.scrollContainer.root.scrollTop > 1,
        1
    );

    const scrollParent = imBegin(); imFlex(); imScrollContainer(); 
    s.scrollContainer = scrollParent; {
        // TODO: fix. timer.start, timer.stop.
        const timeout = imState(newTimer);
        timeout.enabled = s.isScrolling;
        updateTimer(timeout, deltaTimeSeconds());
        const SCROLL_TIMEOUT_SECONDS = 1;
        if (timerHasReached(timeout, SCROLL_TIMEOUT_SECONDS)) {
            s.isScrolling = false;
        }

        imFor(); for (let i = 0; i < s.childNotes.length; i++) {
            const row = s.childNotes[i];

            imNextRoot(row.id);

            const focused = s.list.idx === i;

            const root = imBeginListRow(focused, state._isEditingFocusedNote); {
                imNoteTreeRow(s, row, i, focused);
            } imEndListRow();

            // Scrolling. Only 1 thing can be focused at a time.
            if (focused && s.isScrolling) {
                const { scrollTop } = getScrollVH(
                    scrollParent.root, root.root,
                    0.5, null
                );

                if (Math.abs(scrollTop - scrollParent.root.scrollTop) < 0.1) {
                    s.isScrolling = false;
                } else {
                    if (s.smoothScroll) {
                        scrollParent.root.scrollTop = lerp(
                            scrollParent.root.scrollTop,
                            scrollTop,
                            20 * deltaTimeSeconds()
                        );
                    } else {
                        scrollParent.root.scrollTop = scrollTop;
                    }
                }
            }
        } imEndFor();

        // Want to scroll off the bottom a bit
        imBegin(); imSize(0, NOT_SET, 200, PX); imEnd();
    } imEnd();
}


const UNDER = 1;
const AFTER = 2;
function addNoteAtCurrent(s: NoteTreeViewState, insertType: typeof UNDER | typeof AFTER): TreeNote {
    assert(!idIsNil(s.note.parentId), "Cant insert after the root note");

    const newNote = createNewNote(state, "");
    if (insertType === UNDER) {
        tree.addUnder(state.notes, s.note, newNote);
    } else if (insertType === AFTER) {
        tree.addAfter(state.notes, s.note, newNote);
    } else {
        assert(false, "Invalid insertion type");
    }
    recomputeNoteStatusRecursively(state, newNote);
    return newNote;
}

function moveToLocalidx(
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
    } else {
        const childId = parent.childIds[idx];
        const note = getNote(state, childId);
        setNote(s, note, true);
    }
}

function handleKeyboardInput(ctx: GlobalContext, s: NoteTreeViewState) {
    const { keyboard } = ctx;

    if (!ctx.handled && keyboard.enter.pressed) {
        let newNote: TreeNote | undefined;
        if (keyboard.shift.held) {
            newNote = addNoteAtCurrent(s, AFTER);
        } else if (keyboard.ctrl.held) {
            newNote = addNoteAtCurrent(s, UNDER);
        }

        if (newNote) {
            setNote(s, newNote, true);
            setIsEditingCurrentNote(state, true);
            ctx.handled = true;
        }
    }

    if (!ctx.handled && !state._isEditingFocusedNote) {
        if (keyboard.enter.pressed) {
            setIsEditingCurrentNote(state, true);
            ctx.handled = true;
        }  else {
            const delta = getNavigableListInput(ctx);
            const moveNote = keyboard.alt.held;
            if (delta) {
                moveToLocalidx(s, delta, moveNote);
                ctx.handled = true;
            } if (keyboard.left.pressed) {
                moveOutOfCurrent(s, moveNote);
                ctx.handled = true;
            } else if (keyboard.right.pressed) {
                moveIntoCurrent(s, moveNote);
                ctx.handled = true;
            }
        }
    } 

    if (!ctx.handled && state._isEditingFocusedNote) {
        if (keyboard.escape.pressed) {
            setIsEditingCurrentNote(state, false);
            ctx.handled = true;
        }
    }
}

function imNoteTreeRow(
    s: NoteTreeViewState,
    note: TreeNote, 
    idx = -1, 
    focused = false
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
        setClass(cn.preWrap, focused);

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
                    idx <= s.list.idx && 
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
                                if (isFirstRender()) {
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

        imBegin(ROW); imFlex(); imPadding(8, PX, 3, PX, 3, PX, 3, PX); {
            if (imMemo(note.data._status)) {
                setStyle("color", note.data._status === STATUS_IN_PROGRESS ? "" : cssVarsApp.unfocusTextColor);
            }

            imBegin(ROW); imFlex(); {
                if (imMemo(focused)) {
                    setClass(cn.preWrap, focused);
                    setClass(cn.pre, !focused);
                    setClass(cn.noWrap, !focused);
                    setClass(cn.overflowHidden, !focused);
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

                const isEditing = focused && state._isEditingFocusedNote;
                if (imIf() && isEditing) {
                    const [event] = imTextArea({
                        value: note.data.text,
                        focus: true
                    });
                    if (event) {
                        if (event.input || event.change) {
                            let status = s.note.data._status;
                            setNoteText(state, s.note, event.text);
                            if (status !== s.note.data._status) {
                                s.invalidateNote = true;
                            }
                        }
                    }
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


function imBeginListRow(focused: boolean, editing = false) {
    const focusChanged = imMemo(focused);
    const editingChanged = imMemo(editing);

    const root = imBegin(ROW); {
        if (focusChanged) {
            setStyle("backgroundColor", focused ? cssVarsApp.bgColorFocus : "");
        }

        imBegin(); imSize(10, PX, 0, NOT_SET); {
            if (focusChanged || editingChanged) {
                setStyle("backgroundColor", 
                    focused ? ( editing ? cssVarsApp.bgEditing : cssVarsApp.fgColor) : ""
                );
            }
        } imEnd();
    } // imEnd();

    return root;
}

function imEndListRow() {
    imEnd();
}

