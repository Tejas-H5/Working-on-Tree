import { imActivitiesList } from "./activities-list";
import { COL, imAlign, imBegin, imJustify, INLINE, ROW } from "./components/core/layout";
import { imBeginScrollContainer, newScrollContainer, ScrollContainer } from "./components/scroll-container";
import { addToNavigationList, APP_VIEW_NOTES, APP_VIEW_TRAVERSAL, GlobalContext, hasDiscoverableCommand } from "./global-context";
import { imBeginListRow, imEndListRow, imListRowCellStyle } from "./list-row";
import { clampedListIdx, getNavigableListInput, ListPosition, newListPosition } from "./navigable-list";
import { getNoteViewRoot } from "./note-tree-view";
import { getCurrentNote, getNote, isHigherLevelTask, setCurrentNote, state, STATUS_IN_PROGRESS, TreeNote } from "./state";
import { get } from "./utils/array-utils";
import { imEnd, imEndFor, imEndIf, imFor, imIf, imIsFirstishRender, imMemo, imNextRoot, imState, MEMO_CHANGED, MEMO_FIRST_RENDER, setStyle, setText } from "./utils/im-dom-utils";


export type NoteTraversalViewState = {
    viewRoot: TreeNote | null;
    noteBeforeFocus: TreeNote | null;
    notes: TreeNote[];

    scrollContainer: ScrollContainer;
    listPosition: ListPosition;
};

export function newNoteTraversalViewState(): NoteTraversalViewState {
    return {
        viewRoot: null,
        noteBeforeFocus: null,
        notes: [],

        scrollContainer: newScrollContainer(),
        listPosition: newListPosition(),
    };
}

function setIdx(
    ctx: GlobalContext,
    s: NoteTraversalViewState,
    idx: number
) {
    s.listPosition.idx = clampedListIdx(idx, s.notes.length);
    const note = get(s.notes, s.listPosition.idx);
    if (note) {
        setCurrentNote(
            state,
            note.id,
            s.noteBeforeFocus?.id
        );
    }
}

function handleKeyboardInput(ctx: GlobalContext, s: NoteTraversalViewState) {
    const delta = getNavigableListInput(ctx);
    if (!ctx.handled && delta) {
        setIdx(ctx, s, s.listPosition.idx + delta);
        ctx.handled = true;
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Go to note")) {
        ctx.currentScreen = APP_VIEW_NOTES;
        ctx.handled = true;
    }


    // TODO: left/right should move up/down high level tasks
}

export function imNoteTraversal(
    ctx: GlobalContext,
    viewHasFocus: boolean
) {
    addToNavigationList(ctx, APP_VIEW_TRAVERSAL);

    const s = imState(newNoteTraversalViewState);
    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);
    }

    if (imMemo(state._notesMutationCounter)) {
        s.notes.length = 0;

        // TODO: sort by date last edited

        const current = getCurrentNote(state);
        s.viewRoot = getNoteViewRoot(state, current);

        const dfs = (note: TreeNote, doThing = false) => {
            if (doThing) {
                if (note.data._status === STATUS_IN_PROGRESS) {
                    if (note.childIds.length === 0 || isHigherLevelTask(note)) {
                        s.notes.push(note);
                    }
                }
            }

            for (const id of note.childIds) {
                const child = getNote(state, id);
                dfs(child, true);
            }
        }

        dfs(s.viewRoot);
    }

    imBegin(COL); imListRowCellStyle(); imAlign(); {
        if (imIsFirstishRender()) {
            setStyle("fontWeight", "bold");
        }

        imBegin(); setText("Fast travel"); imEnd();

        if (imIf() && s.viewRoot) {
            imBegin(); setText(s.viewRoot.data.text); imEnd();
        } imEndIf();
    } imEnd();

    imBeginScrollContainer(s.scrollContainer); {
        imFor(); for (
            let idx = 0;
            idx < s.notes.length;
            idx++
        ) {
            imNextRoot();
            const note = s.notes[idx];
            const itemSelected = idx === s.listPosition.idx;

            imBeginListRow(
                itemSelected,
                itemSelected && viewHasFocus,
            ); {
                imBegin(); imListRowCellStyle(); {
                    const text = note.data.text;
                    imBegin(INLINE); {
                        const isHlt = isHigherLevelTask(note);
                        if (imMemo(isHlt)) {
                            setStyle("fontWeight", isHlt ? "bold" : "");
                        }
                        
                        setText(text); 
                    } imEnd();
                } imEnd();
            } imEndListRow();
        } imEndFor();
    } imEnd();
}

