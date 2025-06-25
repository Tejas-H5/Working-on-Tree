import { cssVarsApp } from "./app-styling";
import {
    COL,
    imBegin,
    imFixed,
    imFlex,
    imInitClasses,
    imPadding,
    imScrollContainer,
    imSize,
    NOT_SET,
    PX,
    ROW
} from "./components/core/layout";
import { newH1 } from "./components/core/new-dom-nodes";
import { cn } from "./components/core/stylesheets";
import { GlobalContext } from "./global-context";
import { lerp } from "./legacy-app-components/canvas-state";
import { clampedListIdx, getNavigableListInput, NavigableList, newListState } from "./navigable-list";
import { getNote, idIsNil, NoteId, state, TreeNote } from "./state";
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
    imMemo,
    imNextRoot,
    isFirstRender,
    setStyle,
    setText
} from "./utils/im-dom-utils";
import { ROOT_ID } from "./utils/int-tree";


/** Non-serializable */
export type NoteTreeViewState = {
    parentNotes:   TreeNote[];
    currentRootId: NoteId;
    isScrolling:   boolean;
    list:          NavigableList;
};

export function newNoteTreeViewState(): NoteTreeViewState {
    return {
        parentNotes: [],
        currentRootId: ROOT_ID,
        list: newListState(),
        isScrolling: false,
    };
}

function setIdx(s: NoteTreeViewState, idx: number) {
    const note = getNote(state, s.currentRootId);
    const childIds = note.childIds;

    s.isScrolling = true;
    note.data.lastSelectedChildIdx = s.list.idx;
    s.list.idx = clampedListIdx(idx, childIds.length);
    if (s.list.idx !== -1) {
        state.currentNoteId = childIds[s.list.idx];
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

    // Update parent note ids
    s.parentNotes.length = 0;
    let current = note;
    while (!idIsNil(current.parentId)) {
        s.parentNotes.push(current);
        current = getNote(state, current.parentId);
    }
    s.parentNotes.reverse();

    setIdx(s, note.data.lastSelectedChildIdx);
}

function moveIntoCurrent(s: NoteTreeViewState) {
    const note = getNote(state, s.currentRootId);
    const childIds = note.childIds;

    if (!boundsCheck(childIds, s.list.idx)) return;

    const nextRoot = getNote(state, childIds[s.list.idx]);
    if (nextRoot.childIds.length === 0) return;

    setRootNote(s, nextRoot);
}

const INDENT = 20;

export function imNoteTreeView(ctx: GlobalContext) {
    const s = ctx.noteTreeViewState;state.currentNoteId

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
    const childIds = rootNote.childIds;

    imBegin(COL); imFixed(0, 0, 0, 0); {
        imBeginRoot(newH1); 
        imPadding(10, PX, 0, NOT_SET, 0, NOT_SET, 0, NOT_SET); {
            if (isFirstRender()) {
                setStyle("textOverflow", "ellipsis");
                setStyle("whiteSpace", "nowrap");
            }

            imBeginSpan(); setText("Note tree"); imEnd();

            if (imIf() && rootNote.id !== ROOT_ID) {
                imBeginSpan(); setText(" :: "); imEnd();
                imBeginSpan(); setText(rootNote.data.text); imEnd();
            } imEndIf();
        } imEnd();

        imBegin(); {
            imFor(); for (const note of s.parentNotes) {
                imNextRoot();
                imNoteRow(s, note, false);
            } imEndFor();
        } imEnd();

        imBegin(); imSize(0, NOT_SET, 3, PX); {
            if (isFirstRender()) {
                setStyle("backgroundColor", cssVarsApp.fgColor);
            }
        } imEnd();

        const scrollParent = imBegin();
        imFlex(); imScrollContainer(); {
            imFor(); for (let i = 0; i < childIds.length; i++) {
                imNextRoot();

                const note = getNote(state, childIds[i]);
                const focused = s.list.idx === i;

                const root = imNoteRow(s, note, focused);

                // Smooth scroll. 
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

function imNoteRow(
    s: NoteTreeViewState,
    note: TreeNote,
    focused: boolean
) {
    const root = imBegin(ROW); {
        imInitClasses(cn.preWrap);

        imBegin(); imSize(10, PX, 0, NOT_SET); {
            if (imMemo(focused)) {
                setStyle("backgroundColor", focused ? cssVarsApp.fgColor : "");
            }
        } imEnd();
        imBegin(ROW); imFlex(); imPadding(8, PX, 3, PX, 3, PX, 3, PX); {
            if (imMemo(focused)) {
                setStyle("backgroundColor", focused ? cssVarsApp.bgColorFocus : "");
            }

            let width = note.data._depth * INDENT;
            imBegin(); imSize(width, PX, 0, NOT_SET); imEnd();
            imBegin(); imFlex(); {
                // setText(note.data.text); 

                if (imMemo(note.data.text)) {
                    setText(note.data.text); 
                }
            } imEnd();
        } imEnd();

    } imEnd();

    return root;
}

