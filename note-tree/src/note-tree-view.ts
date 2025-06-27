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
import { getCurrentNote, getNote, idIsNil, NoteId, noteStatusToString, recomputeState, state, TreeNote } from "./state";
import { boundsCheck } from "./utils/array-utils";
import { assert } from "./utils/assert";
import {
    deltaTimeSeconds,
    disableIm,
    enableIm,
    getScrollVH,
    imBeginMemo,
    imBeginRoot,
    imBeginSpan,
    imEnd,
    imEndFor,
    imEndIf,
    imEndMemo,
    imFor,
    imIf,
    imMemo,
    imNextRoot,
    isFirstRender,
    imIsOnScreen,
    setClass,
    setStyle,
    setText,
    imRef,
    imState,
    getNumItemsRenderedThisFrame
} from "./utils/im-dom-utils";
import { ROOT_ID } from "./utils/int-tree";


/** Non-serializable. All fields can be derived from other state. */
export type NoteTreeViewState = {
    parentNotes:    TreeNote[];
    childNotesFlat: TreeNote[];
    currentRootId:  NoteId;
    isScrolling:    boolean;
    list:           NavigableList;
    treeVisuals:    TreeVisualsInfo[];

    // Debugging
    numVisible: number;
};

export type TreeVisualsInfo = {
    depth: number;

    // for the tree visuals
    isVisualLeaf: boolean; // Does this note have it's children expanded in the tree note view?
    selectedPathDepth: number;  
    selectedPathDepthIsFirst: boolean;  // Is this the first note on the selected path at this depth? (Nothing to do with Depth first search xD)
}


export function newNoteTreeViewState(): NoteTreeViewState {
    const s: NoteTreeViewState = {
        parentNotes: [],
        childNotesFlat: [],
        currentRootId: ROOT_ID,
        list: newListState(),
        treeVisuals: [],
        isScrolling: false,

        numVisible: 0,
    };

    recomputeState(state);
    const root = getCurrentNote(state);
    setRootNote(s, root);

    return s;
}

function setIdx(s: NoteTreeViewState, idx: number) {
    s.list.idx = clampedListIdx(idx, s.childNotesFlat.length);
    if (s.list.idx !== -1) {
        state.currentNoteId = s.childNotesFlat[s.list.idx].id;
        s.isScrolling = true;
    } 
}

function moveIdx(s: NoteTreeViewState, amount: number) {
    setIdx(s, s.list.idx + amount);
}

function moveOutOfCurrent(s: NoteTreeViewState) {
    const note = getNote(state, s.currentRootId);
    if (note.id === ROOT_ID) return;

    const parent = getNote(state, note.parentId);

    const noteIdxInParent = parent.childIds.indexOf(note.id);
    assert(noteIdxInParent !== -1);

    parent.data.lastSelectedChildIdx = noteIdxInParent;
    setRootNote(s, parent);
}

function setRootNote(s: NoteTreeViewState, note: TreeNote) {
    s.currentRootId = note.id;

    if (0) {
    // Update parent note ids
    s.parentNotes.length = 0;
    let current = note;
    while (!idIsNil(current.parentId)) {
        s.parentNotes.push(current);
        current = getNote(state, current.parentId);
    }
    s.parentNotes.reverse();

    // Update child note ids
    // TODO: traverse till L2 task
    s.childNotesFlat.length = 0;
    for (const id of note.childIds) {
        const note = getNote(state, id);
        s.childNotesFlat.push(note);
    }
    }

    s.parentNotes.length = 0;
    s.childNotesFlat.length = 0;
    let i = 0
    for (const note of state.notes.nodes) {
        i++;
        // With tree view
        // if (i > 1000) break;
        // without tree view
        // if (i > 16000) break;
        if (note) {
            s.childNotesFlat.push(note);
        }
    }

    setIdx(s, note.data.lastSelectedChildIdx);
}

function moveIntoCurrent(s: NoteTreeViewState) {
    if (!boundsCheck(s.childNotesFlat, s.list.idx)) return;

    const nextRoot = s.childNotesFlat[s.list.idx];

    if (nextRoot.childIds.length === 0) return;

    setRootNote(s, nextRoot);
}

export function imNoteTreeView(ctx: GlobalContext) {
    const s = ctx.noteTreeViewState;

    disableIm(); {
        const delta = getNavigableListInput(ctx);

        if (delta) {
            moveIdx(s, delta);
        } else if (ctx.keyboard.left.pressed) {
            moveOutOfCurrent(s);
        } else if (ctx.keyboard.right.pressed) {
            moveIntoCurrent(s);
        }
    } enableIm();

    const rootNote = getNote(state, s.currentRootId);

    imBegin(COL); imFixed(0, 0, 0, 0); {
        imBeginRoot(newH1);
        imPadding(10, PX, 0, NOT_SET, 0, NOT_SET, 0, NOT_SET); {
            if (isFirstRender()) {
                setStyle("textOverflow", "ellipsis");
                setStyle("whiteSpace", "nowrap");
            }

            imBeginSpan(); setText("Note tree"); imEnd();
            imBeginSpan(); setText(" - " + s.numVisible + " things visible - "); imEnd();
            s.numVisible = 0;

            if (imIf() && rootNote.id !== ROOT_ID) {
                imBeginSpan(); setText(" :: "); imEnd();
                imBeginSpan(); setText(rootNote.data.text); imEnd();
            } imEndIf();
        } imEnd();

        imBegin(); {
            imFor(); for (const note of s.parentNotes) {
                imNextRoot();
                imNoteTreeRow(s, note, false, true);
            } imEndFor();
        } imEnd();

        imBegin(); imSize(0, NOT_SET, 3, PX); {
            if (isFirstRender()) {
                setStyle("backgroundColor", cssVarsApp.fgColor);
            }
        } imEnd();

        const scrollParent = imBegin();
        imFlex(); imScrollContainer(); {
            const timeout = imState(newTimer);
            timeout.enabled = s.isScrolling;
            updateTimer(timeout, deltaTimeSeconds());
            const SCROLL_TIMEOUT_SECONDS = 1;
            if (timerHasReached(timeout, SCROLL_TIMEOUT_SECONDS)) {
                s.isScrolling = false;
            }

            imFor(); for (let i = 0; i < s.childNotesFlat.length; i++) {
                imNextRoot();

                const note = s.childNotesFlat[i];
                const focused = s.list.idx === i;
                const inPath = i <= s.list.idx;

                if (imBeginMemo()) {
                } imEndMemo();

                const root = imBeginListRow(focused); {
                    const isOnScreen = imIsOnScreen();
                    if (imBeginMemo() && isOnScreen) {
                        imNoteTreeRow(s, note, focused, inPath);
                    } imEndMemo();
                } imEndListRow();

                // Smooth scroll. only 1 thing can be focused at a time.
                if (focused && s.isScrolling) {
                    const { scrollTop } = getScrollVH(
                        scrollParent.root, root.root,
                        0.5, null
                    );

                    if (Math.abs(scrollTop - scrollParent.root.scrollTop) < 0.1) {
                        s.isScrolling = false;
                    } else {
                        scrollParent.root.scrollTop = lerp(
                            scrollParent.root.scrollTop,
                            scrollTop,
                            20 * deltaTimeSeconds()
                        );
                    }
                }
            } imEndFor();

            // Want to scroll off the bottom a bit
            imBegin(); imSize(0, NOT_SET, 200, PX); imEnd();
        } imEnd();
    } imEnd();
}

function imNoteTreeRow(
    s: NoteTreeViewState,
    note: TreeNote,
    focused: boolean,
    inPath: boolean,
) {
    s.numVisible++;

    const numRendered = getNumItemsRenderedThisFrame();

    imBegin(ROW); imFlex(); {
        setClass(cn.preWrap, focused);

        // The tree visuals
        imBegin(ROW_REVERSE); {
            imFor();
            let current = note;
            // TODO: make the tree visuals somehow. xd.
            while (!idIsNil(current.parentId)) {
                imNextRoot();

                const prev = current;
                current = getNote(state, current.parentId);
                const isLineInPath = inPath && prev === note;

                // |---->| indent
                // [  x  ]Vertical line should line up with the note status above it:
                //    |
                //    |<-| bullet start
                //    |
                //    +-- [ x ] >> blah blah blah

                const hasHLine = current.id === note.parentId;
                const indent = 30;
                const bulletStart = 5;
                const thickness = isLineInPath ? 4 : 1;
                const isLast = prev.data._index === prev.data._numSiblings - 1;
                const bottomVLineThickness = (focused) ? 1 : thickness;

                // if (0) 
                {
                    imBegin(); imRelative(); imSize(indent, PX, 0, NOT_SET); {
                        // horizontal line xD
                        if (imIf() && hasHLine) {
                            imBegin();
                            imAbsolute(0, NOT_SET, 0, PX, 1, EM, 0, NOT_SET);
                            imSize(bulletStart, PX, thickness, PX);
                            imBg(cssVarsApp.fgColor); {
                                if (isFirstRender()) {
                                    setStyle("transform", "translate(0, -100%)");
                                }
                            } imEnd();
                        } imEndIf();

                        const canDrawVerticalLine = !isLast || note === prev;

                        if (imIf() && canDrawVerticalLine) {
                            let midpointLen = 1;
                            let midpointUnits = EM;

                            // Vertical line part 1. xd. We need a better API
                            imBegin();
                            imAbsolute(
                                0, NOT_SET, bulletStart, PX,
                                0, PX, 0, isLast ? NOT_SET : PX,
                            );
                            imSize(thickness, PX, midpointLen, midpointUnits);
                            imBg(cssVarsApp.fgColor); {
                            } imEnd();

                            // Vertical line part 2.
                            imBegin();
                            imAbsolute(
                                0, NOT_SET, bulletStart, PX,
                                midpointLen, midpointUnits, 0, isLast ? NOT_SET : PX,
                            );
                            imSize(bottomVLineThickness, PX, 0, NOT_SET);
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
            imBegin(); imFlex(); {
                imBeginSpan(); setText(noteStatusToString(note.data._status)); imEnd();
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

    imBegin(); {
        imBeginSpan(); setText("" + (getNumItemsRenderedThisFrame() - numRendered)); imEnd();
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

