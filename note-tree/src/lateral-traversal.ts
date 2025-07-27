import { imBegin, INLINE } from "./components/core/layout";
import { imBeginScrollContainer, newScrollContainer, ScrollContainer } from "./components/scroll-container";
import { GlobalContext } from "./global-context";
import { imBeginListRow, imEndListRow, imListRowCellStyle } from "./list-row";
import { ListPosition, newListPosition } from "./navigable-list";
import { getNoteTextWithoutPriority, TreeNote } from "./state";
import { imNowInCodepath, imEnd, imEndFor, imFor, imNextRoot, imState, setText } from "./utils/im-dom-utils";


export type NoteTraversalViewState = {
    notes: TreeNote[];

    scrollContainer: ScrollContainer;
    listPosition: ListPosition;
};

export function newNoteTraversalViewState(): NoteTraversalViewState {
    return {
        notes: [],

        scrollContainer: newScrollContainer(),
        listPosition: newListPosition(),
    };
}

export function imNoteTraversal(
    ctx: GlobalContext,
    viewHasFocus: boolean
) {
    const s = imState(newNoteTraversalViewState);

    if (imNowInCodepath()) {
        console.log("Recompute lateral traversal");
    }

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
                    const text = getNoteTextWithoutPriority(note.data);
                    imBegin(INLINE); setText(text); imEnd();
                } imEnd();
            } imEndListRow();
        } imEndFor();
    } imEnd();
}

