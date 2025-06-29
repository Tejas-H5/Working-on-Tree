import { imHLine } from "./app-components/common";
import { cssVarsApp } from "./app-styling";
import { newTimer, timerHasReached, updateTimer } from "./app-utils/timer";
import {
    COL,
    EM,
    imAbsolute,
    imBegin,
    imBg,
    imFixed,
    imFlex,
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
import { newH1 } from "./components/core/new-dom-nodes";
import { cn } from "./components/core/stylesheets";
import { GlobalContext } from "./global-context";
import { lerp } from "./legacy-app-components/canvas-state";
import { clampedListIdx, getNavigableListInput, NavigableList, newListState } from "./navigable-list";
import {
    getCurrentNote,
    getNote,
    idIsNil,
    idIsNilOrRoot,
    idIsRoot,
    isStoppingPointForNotViewExpansion,
    noteStatusToString,
    recomputeFlatNotes,
    recomputeNoteParents,
    state,
    STATUS_IN_PROGRESS,
    TreeNote
} from "./state";
import { boundsCheck } from "./utils/array-utils";
import { assert } from "./utils/assert";
import {
    deltaTimeSeconds,
    disableIm,
    enableIm,
    getScrollVH,
    imBeginRoot,
    imBeginSpan,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imIsOnScreen,
    imMemo,
    imNextRoot,
    imState,
    isFirstRender,
    setClass,
    setStyle,
    setText,
    UIRoot
} from "./utils/im-dom-utils";

export type NoteTreeViewState = {
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
        s.note = note;
        s.isScrolling = true;
        s.smoothScroll = true;
        recomputeNoteParents(state, s.noteParentNotes, s.note);

        const viewRoot = getNoteViewRoot(note);
        if (invalidate || s.viewRoot !== viewRoot) {
            s.viewRoot = viewRoot;
            state._currentFlatNotesRootId = viewRoot.id;
            recomputeNoteParents(state, s.viewRootParentNotes, s.viewRoot);
            recomputeFlatNotes(state, s.childNotes, s.viewRoot, false);
            assert(s.childNotes.length === 0 || s.list.idx !== -1);
            s.smoothScroll = false;
        }

        s.list.idx = s.childNotes.indexOf(note);
    }
}

function getNoteViewRoot(note: TreeNote) {
    let current = note;
    while (!idIsNil(current.parentId)) {
        current = getNote(state, current.parentId);
        if (isStoppingPointForNotViewExpansion(state, current)) {
            break;
        }
    }
    return current;
}

export function newNoteTreeViewState(): NoteTreeViewState {
    const note = getCurrentNote(state);
    const viewRoot = getNoteViewRoot(note);
    const s: NoteTreeViewState = {
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
    const localIdx = s.note.data._index;
    setIdxLocal(s, localIdx + amount);
}

function moveOutOfCurrent(s: NoteTreeViewState) {
    if (idIsNilOrRoot(s.note.parentId)) return;

    const parent = getNote(state, s.note.parentId);
    setNote(s, parent);
}

function moveIntoCurrent(s: NoteTreeViewState) {
    if (!boundsCheck(s.childNotes, s.list.idx)) return;

    const nextRoot = s.childNotes[s.list.idx];

    if (nextRoot.childIds.length === 0) return;

    if (!boundsCheck(nextRoot.childIds, nextRoot.data.lastSelectedChildIdx)) {
        nextRoot.data.lastSelectedChildIdx = nextRoot.childIds.length - 1;
    }

    const nextChildId = nextRoot.childIds[nextRoot.data.lastSelectedChildIdx];
    const nextChild = getNote(state, nextChildId);
    setNote(s, nextChild);
}

export function imNoteTreeView(ctx: GlobalContext) {
    const s = ctx.noteTreeViewState;

    imBegin(); {
        s.numVisible = 0;
        imFor(); for (const row of s.viewRootParentNotes) {
            imNextRoot();

            imBeginListRow(false); {
                imNoteTreeRow(s, true, row);
            } imEndListRow();
        } imEndFor();
    } imEnd();

    imHLine(!!s.scrollContainer && s.scrollContainer.root.scrollTop > 1);

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
            imNextRoot();

            const row = s.childNotes[i];
            const focused = s.list.idx === i;

            const root = imBeginListRow(focused); {
                imNoteTreeRow(s, false, row, i, focused);
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

    disableIm(); {
        const delta = getNavigableListInput(ctx);

        if (delta) {
            moveIdxLocal(s, delta);
        } else if (ctx.keyboard.left.pressed) {
            moveOutOfCurrent(s);
        } else if (ctx.keyboard.right.pressed) {
            moveIntoCurrent(s);
        }
    } enableIm();
}

function imNoteTreeRow(
    s: NoteTreeViewState,
    aboveTheLine: boolean,
    note: TreeNote, 
    idx = -1, focused = true
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
                const isLast = itPrev.data._index === itPrev.data._numSiblings - 1;

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

            imBegin(); imFlex(); {
                imBeginSpan(); setText(noteStatusToString(note.data._status)); imEnd();
                if (imIf() && (numInProgress + numDone) > 0) {
                    imBeginSpan(); setText(` (${numDone}/${numInProgress+numDone}) `); imEnd();
                } imEndIf();
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
        } imEnd();
    } imEnd();
}

function imBeginListRow(focused: boolean) {
    const root = imBegin(ROW); {
        if (imMemo(focused)) {
            setStyle("backgroundColor", focused ? cssVarsApp.bgColorFocus : "");
        }

        imBegin(); imSize(10, PX, 0, NOT_SET); {
            if (imMemo(focused)) {
                setStyle("backgroundColor", focused ? cssVarsApp.fgColor : "");
            }
        } imEnd();
    } // imEnd();

    return root;
}

function imEndListRow() {
    imEnd();
}

