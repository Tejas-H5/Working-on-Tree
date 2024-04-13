import { filterInPlace } from "./array-utils";
import { formatDate, formatDuration, getDurationMS, getTimestamp } from "./datetime";
import { assert } from "./dom-utils";
import * as tree from "./tree";
import { uuid } from "./uuid";

export type NoteId = string;
export type TaskId = string;

export type TreeNote = tree.TreeNode<Note>;

// NOTE: this is just the state for a single note tree.
// We can only edit 1 tree at a time, basically
export type State = {
    /** Tasks organised by problem -> subproblem -> subsubproblem etc., not necessarily in the order we work on them */
    notes: tree.TreeStore<Note>;
    currentNoteId: NoteId;
    
    currentNoteFilterIdx: number;

    scratchPad: string;

    /** These notes are in order of their priority, i.e how important the user thinks a note is. */
    todoNoteIds: NoteId[];

    /** The sequence of tasks as we worked on them. Separate from the tree. One person can only work on one thing at a time */
    activities: Activity[];

    // The last activity that we appended which cannot be popped due to debounce logic
    // NOTE: we're kinda using the note's index like it's ID here. this is fine,
    // because activities are guaranteed to not change order (at least that is what we would like)
    lastFixedActivityIdx: number | null;


    // non-serializable fields
    _flatNoteIds: NoteId[];
    _isEditingFocusedNote: boolean;
};


export type Note = {
    id: NoteId;
    text: string;
    openedAt: string; // will be populated whenever text goes from empty -> not empty (TODO: ensure this is happening)
    lastSelectedChildId: NoteId;

    // non-serializable fields
    _status: NoteStatus; // used to track if a note is done or not.
    _isSelected: boolean; // used to display '>' or - in the note status
    _depth: number; // used to visually indent the notes
    _filteredOut: boolean; // Has this note been filtered out?
    _task: TaskId | null;  // What higher level task does this note/task belong to ? Typically inherited
};

// Since we may have a lot of these, I am somewhat compressing this thing so the JSON will be smaller.
// Yeah it isn't the best practice
export type Activity = {
    nId?: NoteId;
    t: string;

    // only apply to breaks:
    breakInfo?: string;
    locked?: true;
}

export function isDoneNote(note: Note) {
    return note.text.startsWith("DONE") || note.text.startsWith("Done") || note.text.startsWith("done");
}
export function isTodoNote(note: Note) {
    return note.text.startsWith("TODO") || note.text.startsWith("Todo") || note.text.startsWith("todo");
}

export function isSubtaskNote(note: Note) {
    return note.text.startsWith("*"); 
}

export function getTodoNotePriorityId(state: State, id: NoteId): number {
    const note = getNote(state, id);
    return getTodoNotePriority(note.data);
}

export function getTodoNotePriority(note: Note): number{
    let priority = 0;
    let i = "TODO".length;

    let character = note.text[i];
    if (character === "?") {
        while (i < note.text.length && note.text[i] === "?") {
            priority--;
            i++;
        }
    }

    if (character === "!") {
        while (i < note.text.length && note.text[i] === "!") {
            priority++;
            i++;
        }
    }

    return priority;
}

export type NoteStatus = 1 | 2 | 3;

/** This is a task that is currently in progress */
export const STATUS_IN_PROGRESS: NoteStatus = 1;
/**
 * This is a task that you haven't marked as DONE, but we are assuming it is done,
 * because you've moved on to the next task.
 * This status exists, so that you dont have to manually close off every single tas with a new - Done note under it.
 */
export const STATUS_ASSUMED_DONE: NoteStatus = 2;
/**
 * This is a task that is marked as DONE at the end.
 * Marking a note as DONE marks all notes before it as DONE, i.e no longer assumed done, but actually done.
 * Only these tasks may be moved out of a note.
 * This ensures that even in the 'done' tree, all notes are calculated as done.
 */
export const STATUS_DONE: NoteStatus = 3;

export function getNoteStateString(note: Note) {
    switch (note._status) {
        case STATUS_IN_PROGRESS:
            return "[...]";
        case STATUS_ASSUMED_DONE:
            return "[ * ]";
        case STATUS_DONE:
            return "[ x ]";
    }
}


// NOTE: all state needs to be JSON-serializable.
// NO Dates/non-plain objects
// No non-owning references, i.e a reference to a node that really lives in another array
// Typically if state will contain references, non-serializable objects, or are in some way computed from other canonical state,
// it is prepended with '_', which will cause it to be stripped before it gets serialized.
function defaultState(): State {
    const rootNote = defaultNote(null);
    rootNote.id = tree.ROOT_KEY;
    rootNote.text = "This root node should not be visible. If it is, you've encountered a bug!";

    const state: State = {
        _flatNoteIds: [], // used by the note tree view, can include collapsed subsections
        _isEditingFocusedNote: false, // global flag to control if we're editing a note

        notes: tree.newTreeStore<Note>(rootNote),
        currentNoteId: "",
        todoNoteIds: [],
        activities: [],
        lastFixedActivityIdx: 0,

        currentNoteFilterIdx: 0,

        scratchPad: "",
    };

    return state;
}

export function loadStateFromJSON(savedStateJSON: string) {
    if (!savedStateJSON) {
        state = defaultState();
        return;
    }

    const loadedState = JSON.parse(savedStateJSON) as State;

    // prevents missing item cases that may occur when trying to load an older version of the state.
    // it is our way of auto-migrating the schema. Only works for new root level keys and not nested ones tho
    // TODO: handle new fields in notes. Shouldn't be too hard actually
    const mergedLoadedState = merge(loadedState, defaultState());

    tree.forEachNode(mergedLoadedState.notes, (id) => {
        const node = tree.getNode(mergedLoadedState.notes, id);
        node.data = merge(node.data, defaultNote(null));
    });

    state = mergedLoadedState;
}

export function getLastActivity(state: State): Activity | undefined {
    return state.activities[state.activities.length - 1];
}

export function defaultNote(state: State | null) : Note {
    let id = uuid();
    if (state) {
        while(tree.hasNode(state.notes, id)) {
            // I would dread to debug these collisions in the 1/100000000 chance they happen, so might as well do this
            id = uuid();
        }
    }

    return {
        // the following is valuable user data
        id, 
        text: "",
        openedAt: getTimestamp(new Date()), 
        lastSelectedChildId: "",

        // the following is just visual flags which are frequently recomputed

        _status: STATUS_IN_PROGRESS,
        _isSelected: false, 
        _depth: 0, 
        _filteredOut: false, 
        _task: null,
    };
}

export type NoteFilter = null | {
    status: NoteStatus;
    not: boolean;
};

// NOTE: depends on _filteredOut, _isSelected
export function recomputeFlatNotes(state: State, flatNotes: NoteId[]) {
    flatNotes.splice(0, flatNotes.length);

    const currentNote = getCurrentNote(state);

    const dfs = (note: tree.TreeNode<Note>) => {
        for (const id of note.childIds) {
            const note = getNote(state, id);

            if (
                // never remove the path we are currently on from the flat notes.
                !note.data._isSelected
            ) {
                if (note.parentId !== currentNote.parentId) {
                    continue;
                }

                if (note.data._filteredOut) {
                    continue;
                }
            }

            flatNotes.push(note.id);

            dfs(note);
        }
    };

    dfs(getRootNote(state));
}

export function shouldFilterOutNote(data: Note, filter: NoteFilter): boolean {
    if (filter === null) {
        return false;
    }

    let val = false;
    if (filter.status) {
        val = data._status !== filter.status;
    }

    if (filter.not) {
        val = !val;
    }

    return val;
}

// called just before we render things.
// It recomputes all state that needs to be recomputed
// TODO: super inefficient, need to set up a compute graph or something more complicated
export function recomputeState(state: State) {
    assert(!!state, "WTF");

    // recompute _depth, _parent, _localIndex, _localList. Somewhat required for a lot of things after to work.
    // tbh a lot of these things should just be updated as we are moving the elements around, but I find it easier to write this (shit) code at the moment
    {
        const dfs = (note: tree.TreeNode<Note>, depth: number) => {
            note.data._depth = depth;

            for (let i = 0; i < note.childIds.length; i++) {
                const c = getNote(state, note.childIds[i]);
                dfs(c, depth + 1);
            }
        };

        dfs(getRootNote(state), -1);
    }

    // recompute _status, do some sorting
    {
        tree.forEachNode(state.notes, (id) => {
            getNote(state, id).data._status = STATUS_IN_PROGRESS;
        })

        const dfs = (note: tree.TreeNode<Note>) => {
            if (note.childIds.length === 0) {
                return;
            }

            let foundDoneNote = false;
            for (let i = note.childIds.length - 1; i >= 0; i--) {
                const childId = note.childIds[i];
                const child = getNote(state, childId);
                if (child.childIds.length > 0) {
                    dfs(child);
                    continue;
                }

                if (isTodoNote(child.data) || isSubtaskNote(child.data)) {
                    child.data._status = STATUS_IN_PROGRESS;
                    continue;
                }

                if (isDoneNote(child.data) || foundDoneNote) {
                    child.data._status = STATUS_DONE;
                    foundDoneNote = true;
                    continue;
                }

                if (i === note.childIds.length - 1) {
                    child.data._status = STATUS_IN_PROGRESS;
                } else {
                    child.data._status = STATUS_ASSUMED_DONE;
                }
            }

            // Current "Done" upward-propagation criteria criteria:
            // - It has zero children and starts with Done done DONE
            // - it has 1+ children, and the final child starts with Done done DONE
            // I am actually reconsidering this. I don't think it is good that I am losing notes...

            const everyChildNoteIsDone = note.childIds.every((id) => {
                const note = getNote(state, id);
                return note.data._status === STATUS_DONE;
            });

            const finalNoteId = note.childIds[note.childIds.length - 1];
            const finalNote = getNote(state, finalNoteId);
            const finalNoteIsDoneLeafNote = isDoneNote(finalNote.data);

            note.data._status =
                everyChildNoteIsDone && finalNoteIsDoneLeafNote ? STATUS_DONE : STATUS_IN_PROGRESS;
        };

        dfs(getRootNote(state));
    }

    // recompute _filteredOut (depends on _status)
    {
        tree.forEachNode(state.notes, (id) => {
            const note = getNote(state, id);
            note.data._filteredOut = shouldFilterOutNote(note.data, ALL_FILTERS[state.currentNoteFilterIdx][1]);
        });

    }

    // recompute _isSelected to just be the current note + all parent notes 
    {
        tree.forEachNode(state.notes, (id) => {
            const note = getNote(state, id);
            note.data._isSelected = false;
        });

        const current = getCurrentNote(state);
        tree.forEachParent(state.notes, current, (note) => {
            note.data._isSelected = true;

            // Also let's add these notes to the todoNoteIds list if applicable.
            if (isTodoNote(note.data) && !state.todoNoteIds.includes(note.id)) {
                // this will get auto-deleted from recomputeState, so we don't have to do that here
                state.todoNoteIds.push(note.id);
            }


            if (note.parentId) { 
                const parent = getNote(state, note.parentId);
                parent.data.lastSelectedChildId = note.id;
            }
            return false;
        });
    }

    // recompute _flatNoteIds (after deleting things, and computing _filteredOut)
    {
        if (!state._flatNoteIds) {
            state._flatNoteIds = [];
        }

        recomputeFlatNotes(state, state._flatNoteIds);
    }

    // recompute the TODO notes
    {
        filterInPlace(state.todoNoteIds, (id) => {
            const note = getNote(state, id);
            return isTodoNote(note.data) && note.data._status !== STATUS_DONE;
        });
    }

    // recompute the last fixed note
    {
        if (
            state.lastFixedActivityIdx && 
            state.lastFixedActivityIdx >= state.activities.length
        ) {
            // sometimes we backspace notes we create. So this needs to be recomputed
            state.lastFixedActivityIdx = state.activities.length - 1;
        }
    }
}


export function getActivityText(state: State, activity: Activity): string {
    if (activity.nId) {
        return getNote(state, activity.nId).data.text;
    }

    if (activity.breakInfo) {
        return activity.breakInfo;
    }

    return "< unknown activity text! >";
}

export function getActivityDurationMs(activity: Activity, nextActivity?: Activity) : number {
    const startTimeMs = new Date(activity.t).getTime();
    const nextStart = (nextActivity ? new Date(nextActivity.t): new Date()).getTime();
    return nextStart - startTimeMs;
}


export function createNewNote(state: State, text: string): tree.TreeNode<Note> {
    const note = defaultNote(state);
    note.text = text;

    return tree.newTreeNode(note, note.id);
}




export function pushActivity(state: State, activity: Activity, shouldDebounce: boolean) {
    const last = getLastActivity(state);
    const lastIdx = state.activities.length - 1;
    if (!last) {
        state.lastFixedActivityIdx = state.activities.length;
        state.activities.push(activity);
        return;
    }

    if (last && last.nId) {
        if (
            shouldDebounce &&
            lastIdx !== state.lastFixedActivityIdx
        ) {
            const duration = getActivityDurationMs(last, undefined);
            const ONE_MINUTE = 1000 * 60;

            if (duration < ONE_MINUTE) {
                // we are debouncing this append operation, so that we don't append like 10 activities by just moving around for example.
                // This would just mean that we replace the last thing we pushed instead of pushing a new thing
                state.activities.pop();
            } else {
                // Actually, we don't even need to do this. The simple fact that
                // it is older than 1 minute will already have the same effect as the lastFixedActivity variable, i.e
                // prevent the activities.pop() from happening.
                // But there's no real harm to put this here either
                state.lastFixedActivityIdx = lastIdx
            }
        }
         
        if (getLastActivity(state)?.nId === activity.nId) {
            // don't add the same activity twice in a row
            return;
        }
    }

    state.activities.push(activity);
    if (!shouldDebounce) {
        state.lastFixedActivityIdx = state.activities.length - 1;
    }
}


// currently:
//  - drops all properties with '_'
// NOTE: the state shouldn't be cyclic. do not attempt to make this resistant to cycles,
// it is _supposed_ to throw that too much recursion exception
export function recursiveShallowCopy(obj: any): any {
    if (Array.isArray(obj)) {
        return obj.map((x) => recursiveShallowCopy(x));
    }

    if (typeof obj === "object" && obj !== null) {
        const clone = {};
        for (const key in obj) {
            if (key[0] === "_") {
                continue;
            }

            // @ts-ignore
            clone[key] = recursiveShallowCopy(obj[key]);
        }
        return clone;
    }

    return obj;
}


export function deleteNoteIfEmpty(state: State, id: NoteId) {
    const note = getNote(state, id);
    if (note.data.text) {
        return false;
    }

    if (note.childIds.length > 0) {
        note.data.text = "Some note we cant delete because of the x" + note.childIds.length + " notes under it :(";
        return true;
    }

    if (!note.parentId) {
        return false;
    }

    if (tree.getSize(state.notes) <= 1) {
        // don't delete our only note! (other than the root note)
        return false
    }

    const noteToMoveTo = getOneNoteUp(state, note, false) || getOneNoteDown(state, note, false);
    if (!noteToMoveTo) {
        // cant delete this note if there are no other notes we can move to
        return false;
    }

    setCurrentNote(state, noteToMoveTo);

    // delete from the ids list, as well as the note database
    tree.remove(state.notes, note);

    // delete relevant activities from the activity list and last viewed list
    filterInPlace(state.activities, (activity) => activity.nId !== note.id);

    return true;
}

export function insertNoteAfterCurrent(state: State) {
    const currentNote = getCurrentNote(state);
    assert(currentNote.parentId, "Cant insert after the root note");
    if (!currentNote.data.text) {
        // REQ: don't insert new notes while we're editing blank notes
        return false;
    }

    const newNote = createNewNote(state, "");

    const parent = getNote(state, currentNote.parentId);
    tree.addUnder(state.notes, parent, newNote)

    setCurrentNote(state, newNote.id, false);
    return true;
}

export function insertChildNode(state: State): tree.TreeNode<Note> | null {
    const currentNote = getCurrentNote(state);
    assert(currentNote.parentId, "Cant insert after the root note");
    if (!currentNote.data.text) {
        // REQ: don't insert new notes while we're editing blank notes
        return null;
    }

    const newNote = createNewNote(state, "");

    tree.addUnder(state.notes, currentNote, newNote);
    setCurrentNote(state, newNote.id, false);

    return newNote;
}

export function hasNote(state: State, id: NoteId): boolean {
    return !!id && tree.hasNode(state.notes, id);
}

export function getNote(state: State, id: NoteId) {
    return tree.getNode(state.notes, id);
}

export function getNoteTag(note: tree.TreeNode<Note>, tagName: string): string | null {
    const text = note.data.text;
    let idxStart = 0;

    while (idxStart !== -1 && idxStart < note.data.text.length) {
        idxStart = text.indexOf("[", idxStart);
        if (idxStart === -1) {
            return null;
        }
        idxStart++;

        const idxEnd = text.indexOf("]", idxStart);
        if (idxEnd === -1) { 
            return null;
        }

        const tagText = text.substring(idxStart, idxEnd).trim();
        if (tagText.length === 0) {
            return null;
        }

        idxStart = idxEnd + 1;

        const midPoint = tagText.indexOf("=");
        if (midPoint === -1)  {
            continue;
        }

        if (tagText.substring(0, midPoint).trim() !== tagName) {
            continue;
        }

        const tagValue = tagText.substring(midPoint + 1).trim();
        return tagValue;
    }

    return null;
}

export function getCurrentNote(state: State) {
    if (!hasNote(state, state.currentNoteId)) {
        // set currentNoteId to the last root note if it hasn't yet been set

        const rootChildIds = getRootNote(state).childIds;
        if (rootChildIds.length === 0) {
            // create the first note if we have no notes
            const newNote = createNewNote(state, "First Note");
            tree.addUnder(state.notes, getRootNote(state), newNote);
        }

        // not using setCurrentNote, because it calls getCurrentNote 
        state.currentNoteId = rootChildIds[rootChildIds.length - 1];
    }

    return getNote(state, state.currentNoteId);
}

export function pushBreakActivity(state: State, breakInfoText: string, locked: undefined | true) {
    pushActivity(state, {
        nId: undefined,
        t: getTimestamp(new Date()),
        breakInfo: breakInfoText,
        locked: locked,
    }, false);
}

export function isCurrentlyTakingABreak(state: State): boolean {
    const last = getLastActivity(state);
    return !!last?.breakInfo;
}

export function getOneNoteDown(state: State, note: tree.TreeNode<Note>, useSiblings: boolean): NoteId | null {
    if (!note.parentId) {
        return null;
    }

    const list = useSiblings ? getNote(state, note.parentId).childIds : state._flatNoteIds;
    const idx = list.indexOf(note.id);
    if (idx < list.length - 1) {
        return list[idx + 1];
    }

    return null;
}

export function getOneNoteUp(state: State, note: tree.TreeNode<Note>, useSiblings: boolean): NoteId | null {
    if (!note.parentId) {
        return null;
    }

    const list = useSiblings ? getNote(state, note.parentId).childIds : state._flatNoteIds;
    let idx = list.indexOf(note.id);
    if (idx > 0) {
        return list[idx - 1];
    }

    return null;
}

export function setCurrentNote(state: State, noteId: NoteId | null, debounceActivity = true) {
    if (!noteId) {
        return;
    }

    const note = getNote(state, noteId);
    if (!note || note === getRootNote(state)) {
        return false;
    }

    const currentNoteBeforeMove = getCurrentNote(state);
    if (currentNoteBeforeMove.id === note.id) {
        return;
    }

    if (!tree.hasNode(state.notes, note.id)) {
        return;
    }

    state.currentNoteId = note.id;
    state._isEditingFocusedNote = false;
    deleteNoteIfEmpty(state, currentNoteBeforeMove.id);

    pushActivity(state, {
        t: getTimestamp(new Date()),
        nId: note.id,
    }, debounceActivity);


    return true;
}

type NoteFilterFunction = (state: State, note: tree.TreeNode<Note>) => boolean;
export function findNextNote(state: State, childIds: NoteId[], id: NoteId, filterFn: NoteFilterFunction) {
    let idx = childIds.indexOf(id) + 1;
    while (idx < childIds.length) {
        const note = getNote(state, childIds[idx]);
        if (filterFn(state, note)) {
            return note.id;
        }

        idx++;
    }

    return null;
}

export function findPreviousNote(state: State, childIds: NoteId[], id: NoteId, filterFn: NoteFilterFunction) {
    let idx = childIds.indexOf(id) - 1;
    while (idx >= 0)  {
        const note = getNote(state, childIds[idx]);
        if (filterFn(state, note)) {
            return note.id;
        }

        idx--;
    }

    return null;
}


export function getNoteOneDownLocally(state: State, note: tree.TreeNode<Note>) {
    if (!note.parentId) {
        return null;
    }

    const siblings = getNote(state, note.parentId).childIds;
    return findNextNote(state, siblings, note.id, isNoteImportant);
}

export function isNoteImportant(state: State, note: tree.TreeNode<Note>) : boolean {
    if (!note.parentId) {
        return true;
    }

    const siblings = getNote(state, note.parentId).childIds;
    const idx = siblings.indexOf(note.id);

    return (
        idx === 0 ||
        idx === siblings.length - 1 ||
        note.data._isSelected ||
        // getRealChildCount(note) !== 0 ||
        note.data._status === STATUS_IN_PROGRESS
    );
}

export function getNoteOneUpLocally(state: State, note: tree.TreeNode<Note>) {
    if (!note.parentId) {
        return null;
    }

    // this was the old way. but now, we only display notes on the same level as the parent, or all ancestors
    // const parent = getNote(state, note.parentId);
    // return findPreviousNote(state, parent.childIds, note.id, (note) => note.data._filteredOut);

    const siblings = getNote(state, note.parentId).childIds;
    return findPreviousNote(state, siblings, note.id, isNoteImportant);
}

export function getPreviousActivityWithNoteIdx(state: State, idx: number): number {
    if (idx === -1) {
        return -1;
    }

    if (idx > 1){
        idx--;
    }

    while(idx > 0 && !state.activities[idx].nId) {
        idx--;
    }

    return idx;
}
export function getNextActivityWithNoteIdx(state: State, idx: number): number {
    if (idx === -1) {
        return -1;
    }

    if (idx < state.activities.length - 1) {
        idx++;
    }

    while(
        idx < state.activities.length - 1 && 
        !state.activities[idx].nId
    ) {
        idx++;
    }

    return idx;
}

export function getFinalChildNote(state: State, note: tree.TreeNode<Note>): NoteId | null {
    let finalNoteIdx = note.childIds.length - 1;
    while (finalNoteIdx >= 0) {
        const childNote = getNote(state, note.childIds[finalNoteIdx]);
        if (!childNote.data._filteredOut) {
            return childNote.id;
        }

        finalNoteIdx--;
    }

    return null;
}

export function dfsPre(state: State, note: tree.TreeNode<Note>, fn: (n: tree.TreeNode<Note>) => void) {
    fn(note);

    for (const id of note.childIds) {
        const note = getNote(state, id);
        dfsPre(state, note, fn);
    }
}

export function moveNotePriorityIntoPriorityGroup(
    state: State, 
    noteId: NoteId,
) {
    const idxThis = state.todoNoteIds.indexOf(noteId);
    if (idxThis === -1) {
        // this code should never run
        throw new Error("Can't move up a not that isn't in the TODO list. There is a bug in the program somewhere");
    }

    let idx = idxThis;
    const currentPriority = getTodoNotePriorityId(state, noteId);

    while (
        idx < state.todoNoteIds.length - 1 && 
        getTodoNotePriorityId(state, state.todoNoteIds[idx + 1]) > currentPriority
    ) {
        idx++;
    }

    while (
        idx > 0 &&
        getTodoNotePriorityId(state, state.todoNoteIds[idx - 1]) < currentPriority
    ) {
        idx--;
    }

    if (idxThis !== idx) {
        state.todoNoteIds.splice(idxThis, 1);
        state.todoNoteIds.splice(idx, 0, noteId);
    }
}

// function dfsPost(state: State, note: tree.TreeNode<Note>, fn: (n: tree.TreeNode<Note>) => void) {
//     for (const id of note.childIds) {
//         const note = getNote(state, id);
//         dfsPost(state, note, fn);
//     }

//     fn(note);
// }

// function copyState(state: State) {
//     return JSON.parse(JSON.stringify(recursiveShallowCopy(state)));
// }

export function getRootNote(state: State) {
    return getNote(state, state.notes.rootId);
}

// function getNotePriority(state: State, noteId: NoteId) {
//     const priority = state.todoNoteIds.indexOf(noteId);
//     if (priority === -1) {
//         return undefined;
//     }

//     return priority + 1;
// }

export function getTimeStr(note: Note) {
    const { openedAt } = note;

    const date = new Date(openedAt);
    return formatDate(date);
}

export function getIndentStr(note: Note) {
    const { _depth: repeats } = note;
    return "     ".repeat(repeats);
}

export function getNoteDuration(state: State, note: tree.TreeNode<Note>) {
    if (!note.parentId) {
        return 0;
    }

    const parent = getNote(state, note.parentId);

    const noteData = note.data;
    if (noteData._status === STATUS_IN_PROGRESS) {
        return getDurationMS(noteData.openedAt, getTimestamp(new Date()));
    }

    if (note.childIds.length === 0) {
        // the duration is the difference between this note and the next non-TODO note.
        const idx = parent.childIds.indexOf(note.id);
        if (idx < parent.childIds.length - 1) {
            // skip over todo notes
            let nextNoteIdx = idx + 1;
            while (nextNoteIdx < parent.childIds.length - 1) {
                const nextNoteId = parent.childIds[nextNoteIdx];
                if (isTodoNote(getNote(state, nextNoteId).data)) {
                    nextNoteIdx++;
                }
                break;
            }

            const nextNoteId = parent.childIds[nextNoteIdx];
            return getDurationMS(noteData.openedAt, getNote(state, nextNoteId).data.openedAt);
        }

        return 0;
    }

    let latestNote = note;
    dfsPre(state, note, (note) => {
        if (latestNote.data.openedAt < note.data.openedAt) {
            latestNote = note;
        }
    });

    return getDurationMS(noteData.openedAt, latestNote.data.openedAt);
}

export function getSecondPartOfRow(state: State, note: tree.TreeNode<Note>) {
    const duration = getNoteDuration(state, note);
    const durationStr = formatDuration(duration);
    const secondPart = " " + durationStr;
    return secondPart;
}

export function getRowIndentPrefix(_state: State, note: Note) {
    return `${getIndentStr(note)} ${getNoteStateString(note)}`;
}

export function getFirstPartOfRow(state: State, note: tree.TreeNode<Note>) {
    const noteData = note.data;
    // const dashChar = note.data._isSelected ? ">" : "-"
    // having ">" in exported text looks ugly, so I've commented this out for now
    const dashChar = "-";

    return `${getTimeStr(noteData)} | ${getRowIndentPrefix(state, noteData)} ${dashChar} ${noteData.text || " "}`;
}

export function previousFilter(state: State) {
    state.currentNoteFilterIdx++;
    if (state.currentNoteFilterIdx >= ALL_FILTERS.length) {
        state.currentNoteFilterIdx = 0;
    }
}

export function nextFilter(state: State) {
    state.currentNoteFilterIdx--;
    if (state.currentNoteFilterIdx < 0) {
        state.currentNoteFilterIdx = ALL_FILTERS.length - 1;
    }
}

export function isEditableBreak(activity: Activity) {
    if (!activity) {
        return false;
    }

    if (!activity.breakInfo) {
        return false;
    }

    if (activity.locked === true) {
        // can't edit breaks that we've locked.
        return false;
    }

    return true;
}

function merge<T extends object>(a: T, b: T) {
    for (const k in b) {
        if (!(k in a)) {
            a[k] = b[k];
        }
    }

    return a;
}
export const ALL_FILTERS: [string, NoteFilter][] = [
    ["No filters", null],
    ["Done", { not: false, status: STATUS_DONE }],
    ["Not-done", { not: true, status: STATUS_DONE }],
];

export function resetState() {
    state = defaultState();
}

export let state = defaultState();