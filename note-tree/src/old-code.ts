// Old code that has been commented out but may only be useful long after I've forgotten I wrote it should go here.
// "But that is what a VCS is for" but whos actually writing code and then thinks to themselves "Oh yeah I remember the function I wrote from that PR 2 years ago, I'll just grab that from VC" ??
// Anway, all the code here should be commented out so it doesn't contribute to the bundle.
// Also, we should clean this up routinely if we know for a fact we don't need it - a bit like real comments

// TODO Notes are now derived from the tree, they can't just be moved around...
/* export function moveNotePriorityIntoPriorityGroup(
    state: State,
    noteId: NoteId,
) {
    const idxThis = state._todoNoteIds.indexOf(noteId);
    if (idxThis === -1) {
        // this code should never run
        throw new Error("Can't move up a not that isn't in the TODO list. There is a bug in the program somewhere");
    }

    let idx = idxThis;
    const currentPriority = getTodoNotePriorityId(state, noteId);

    while (
        idx < state._todoNoteIds.length - 1 &&
        getTodoNotePriorityId(state, state._todoNoteIds[idx + 1]) > currentPriority
    ) {
        idx++;
    }

    while (
        idx > 0 &&
        getTodoNotePriorityId(state, state._todoNoteIds[idx - 1]) < currentPriority
    ) {
        idx--;
    }

    if (idxThis !== idx) {
        state._todoNoteIds.splice(idxThis, 1);
        state._todoNoteIds.splice(idx, 0, noteId);
    }
} */

// Somewhat unused, but I'm keeping it around, because it is a nice example of how to do a bi-directional iteration loop
/* export function moveNotePriorityUpOrDown(
    state: State,
    noteId: NoteId,
    down: boolean,  // setting this to false moves the note's priority up (obviously)
) {
    const idxThis = state.todoNoteIds.indexOf(noteId);
    if (idxThis === -1) {
        // this code should never run
        throw new Error("Can't move up a not that isn't in the TODO list. There is a bug in the program somewhere");
    }

    const currentNote = getCurrentNote(state);
    const currentPriority = getTodoNotePriority(currentNote.data);

    let idx = idxThis;
    const direction = down ? 1 : -1;
    while (
        (direction === -1 && idx > 0) ||
        (direction === 1 && idx < state.todoNoteIds.length - 1)
    ) {
        idx += direction;

        const noteId = state.todoNoteIds[idx];
        const note = getNote(state, noteId);
        if (
            note.id === currentNote.id ||
            note.data._isSelected ||
            getTodoNotePriority(note.data) !== currentPriority
        ) {
            idx -= direction;
            break;
        }
    }

    if (idxThis !== idx) {
        state.todoNoteIds.splice(idxThis, 1);
        state.todoNoteIds.splice(idx, 0, noteId);
    }
}
*/


