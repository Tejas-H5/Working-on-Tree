import { countOccurances, filterInPlace } from "./array-utils";
import { formatDate, formatDuration, getTimestamp } from "./datetime";
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

    /** These notes are the _parents_ of notes that we want to keep pinned, useful for switching back and forth between two+ tasks */
    pinnedNoteIds: NoteId[];

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
    lastSelectedChildIdx: number; // this is now an index into 

    // non-serializable fields
    _status: NoteStatus; // used to track if a note is done or not.
    _isSelected: boolean; // used to display '>' or - in the note status
    _isUnderCurrent: boolean; // used to calculate the duration of a specific task.
    _depth: number; // used to visually indent the notes
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
    return note.text.startsWith("DONE") || note.text.startsWith("Done") || note.text.startsWith("done") ||
        note.text.startsWith("DECLINED") || note.text.startsWith("MERGED"); // funny git reference. but actually, DECLINED is somewhat useful
}
export function isTodoNote(note: Note) {
    return note.text.startsWith("TODO") || note.text.startsWith("Todo") || note.text.startsWith("todo");
}

export function isSubtaskNote(note: Note) {
    return note.text.startsWith("*") || note.text.startsWith(">");
}

export function getTodoNotePriorityId(state: State, id: NoteId): number {
    const note = getNote(state, id);
    return getTodoNotePriority(note.data);
}

export function getTodoNotePriority(note: Note): number {
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

export function noteStatusToString(noteStatus: NoteStatus) {
    switch (noteStatus) {
        case STATUS_IN_PROGRESS:
            return "[...]";
        case STATUS_ASSUMED_DONE:
            return "[ * ]";
        case STATUS_DONE:
            return "[ x ]";
    }

    return "??";
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
        pinnedNoteIds: [],
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

export function defaultNote(state: State | null): Note {
    let id = uuid();
    if (state) {
        while (tree.hasNode(state.notes, id)) {
            // I would dread to debug these collisions in the 1/100000000 chance they happen, so might as well do this
            id = uuid();
        }
    }

    return {
        // the following is valuable user data
        id,
        text: "",
        openedAt: getTimestamp(new Date()),
        lastSelectedChildIdx: 0,

        // the following is just visual flags which are frequently recomputed

        _status: STATUS_IN_PROGRESS,
        _isSelected: false,
        _isUnderCurrent: false,
        _depth: 0,
        _task: null,
    };
}

export type NoteFilter = null | {
    status: NoteStatus;
    not: boolean;
};

// NOTE: depends on _isSelected
export function recomputeFlatNotes(state: State, flatNotes: NoteId[], allNotes: boolean) {
    flatNotes.splice(0, flatNotes.length);

    const currentNote = getCurrentNote(state);

    const dfs = (note: TreeNote) => {
        for (const id of note.childIds) {
            const note = getNote(state, id);

            if (!allNotes) {
                if (
                    // never remove the path we are currently on from the flat notes.
                    !note.data._isSelected
                ) {
                    if (note.parentId !== currentNote.parentId) {
                        continue;
                    }
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
        const dfs = (note: TreeNote, depth: number) => {
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

        const dfs = (note: TreeNote) => {
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

            // Current "Done" upward-propagation criteria:
            // - It has zero children and starts with Done done DONE (Computed Above)
            // - it has 1+ children, and (Computed below):
            //      - all the notes are TODO Notes, and every note is done
            //      - every note is done, and either: the final child has zero children and is DONE, or every note is also a TODO note.

            const everyChildNoteIsTODO = note.childIds.every((id) => {
                const note = getNote(state, id);
                return isTodoNote(note.data) && note.data._status === STATUS_DONE;
            });

            const everyChildNoteIsDone = note.childIds.every((id) => {
                const note = getNote(state, id);
                return note.data._status === STATUS_DONE;
            });

            const finalNoteId = note.childIds[note.childIds.length - 1];
            const finalNote = getNote(state, finalNoteId);
            const finalNoteIsDoneLeafNote = isDoneNote(finalNote.data);

            const isDone = everyChildNoteIsDone 
                // && (
                //     everyChildNoteIsTODO ||
                //         finalNoteIsDoneLeafNote
                // );

            note.data._status = isDone ? STATUS_DONE : STATUS_IN_PROGRESS;
        };

        dfs(getRootNote(state));
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
                moveNotePriorityIntoPriorityGroup(state, note.id);
            }

            if (note.parentId) {
                const parent = getNote(state, note.parentId);
                parent.data.lastSelectedChildIdx = parent.childIds.indexOf(note.id);
            }
            return false;
        });
    }

    // recompute _flatNoteIds (after deleting things)
    {
        if (!state._flatNoteIds) {
            state._flatNoteIds = [];
        }

        recomputeFlatNotes(state, state._flatNoteIds, false);
    }

    // recompute the TODO notes
    {
        filterInPlace(state.todoNoteIds, (id) => {
            const note = getNote(state, id);
            return isTodoNote(note.data) && note.data._status !== STATUS_DONE;
        });
    }

    // recompute the pinned notes - delete em as they get deleted.
    // todo notes automatically get deleted, because we rerender each time we edit a note,
    // and in order to delete a note, you have to delete the "TODO" text, which is what
    // gives the note it's TODO status in the first place, meaning that we have to remove
    // it's todo status before we can delete it. 
    // There is no such guarantee for pinned notes.
    {
        filterInPlace(state.pinnedNoteIds, (id) => {
            return hasNote(state, id);
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

export function getActivityDurationMs(activity: Activity, nextActivity?: Activity): number {
    const startTimeMs = new Date(activity.t).getTime();
    const nextStart = (nextActivity ? new Date(nextActivity.t) : new Date()).getTime();
    return nextStart - startTimeMs;
}


export function createNewNote(state: State, text: string): TreeNote {
    const note = defaultNote(state);
    note.text = text;

    return tree.newTreeNode(note, note.id);
}


export function isLastActivityTenuous(state: State) {
    const last = getLastActivity(state);
    const lastIdx = state.activities.length - 1;

    if (last && lastIdx !== state.lastFixedActivityIdx) {
        const duration = getActivityDurationMs(last, undefined);
        const ONE_MINUTE = 1000 * 60;

        if (duration < ONE_MINUTE) {
            return true;
        } 
    }

    return false;
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
        if (isLastActivityTenuous(state)) {
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

    const noteToMoveTo = getNoteNUp(state, note, false) || getNoteNDown(state, note, false);
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
    tree.addAfter(state.notes, currentNote, newNote)
    setCurrentNote(state, newNote.id, false);
    state._isEditingFocusedNote = true;
    return true;
}

export function insertChildNode(state: State): TreeNote | null {
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

export function getNoteTag(note: TreeNote, tagName: string): string | null {
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
        if (midPoint === -1) {
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

export function getNoteNDown(state: State, note: TreeNote, useSiblings: boolean, amount = 1): NoteId | null {
    if (!note.parentId) {
        return null;
    }

    const list = useSiblings ? getNote(state, note.parentId).childIds : state._flatNoteIds;
    const idx = list.indexOf(note.id);
    if (idx < list.length - 1) {
        return list[Math.min(list.length - 1, idx + amount)];
    }

    return null;
}

export function getNoteNUp(state: State, note: TreeNote, useSiblings: boolean, amount = 1): NoteId | null {
    if (!note.parentId) {
        return null;
    }

    const list = useSiblings ? getNote(state, note.parentId).childIds : state._flatNoteIds;
    let idx = list.indexOf(note.id);
    if (idx > 0) {
        return list[Math.max(0, idx - amount)];
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

type NoteFilterFunction = (state: State, note: TreeNote) => boolean;
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
    while (idx >= 0) {
        const note = getNote(state, childIds[idx]);
        if (filterFn(state, note)) {
            return note.id;
        }

        idx--;
    }

    return null;
}


export function getNoteOneDownLocally(state: State, note: TreeNote) {
    if (!note.parentId) {
        return null;
    }

    const siblings = getNote(state, note.parentId).childIds;
    return findNextNote(state, siblings, note.id, isNoteImportant);
}

export function isNoteImportant(state: State, note: TreeNote): boolean {
    if (!note.parentId) {
        return true;
    }

    const siblings = getNote(state, note.parentId).childIds;
    const idx = siblings.indexOf(note.id);

    return (
        idx === 0 ||
        idx === siblings.length - 1 ||
        note.data._isSelected ||
        note.data._status === STATUS_IN_PROGRESS
    );
}

export function getNoteOneUpLocally(state: State, note: TreeNote) {
    if (!note.parentId) {
        return null;
    }

    const siblings = getNote(state, note.parentId).childIds;
    return findPreviousNote(state, siblings, note.id, isNoteImportant);
}

export function getPreviousActivityWithNoteIdx(state: State, idx: number): number {
    if (idx === -1) {
        return -1;
    }

    if (idx > 1) {
        idx--;
    }

    while (idx > 0 && !state.activities[idx].nId) {
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

    while (
        idx < state.activities.length - 1 &&
        !state.activities[idx].nId
    ) {
        idx++;
    }

    return idx;
}

export function dfsPre(state: State, note: TreeNote, fn: (n: TreeNote) => void) {
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

export function getRootNote(state: State) {
    return getNote(state, state.notes.rootId);
}

export function getTimeStr(note: Note) {
    const { openedAt } = note;

    const date = new Date(openedAt);
    return formatDate(date);
}

export function getIndentStr(note: Note) {
    const { _depth: repeats } = note;
    return "     ".repeat(repeats);
}

/** 
 * This is the sum of all activities with this note, or any descendant 
 */
export function getNoteDuration(state: State, note: TreeNote) {
    // recompute _isUnderCurrentNote 
    {
        tree.forEachNode(state.notes, (id) => {
            const note = getNote(state, id);
            note.data._isUnderCurrent = false;
        });

        dfsPre(state, note, (n) => {
            n.data._isUnderCurrent = true;
        });
    }

    if (!note.parentId) {
        return 0;
    }

    const activities = state.activities;
    let duration = 0;

    for (let i = 0; i < activities.length; i++) {
        const activity = activities[i];
        if (!activity.nId) {
            continue;
        }

        if (!tree.hasNode(state.notes, activity.nId)) {
            continue;
        }

        const note = getNote(state, activity.nId);
        if (note.data._isUnderCurrent) {
            const nextActivity = activities[i + 1];
            duration += getActivityDurationMs(activity, nextActivity);
        }
    }

    return duration;
}

export function getSecondPartOfRow(state: State, note: TreeNote) {
    const duration = getNoteDuration(state, note);
    const durationStr = formatDuration(duration);
    const secondPart = " " + durationStr;
    return secondPart;
}

export function getRowIndentPrefix(_state: State, note: Note) {
    return `${getIndentStr(note)} ${noteStatusToString(note._status)}`;
}

export function getFirstPartOfRow(state: State, note: TreeNote) {
    const noteData = note.data;
    // const dashChar = note.data._isSelected ? ">" : "-"
    // having ">" in exported text looks ugly, so I've commented this out for now
    const dashChar = "-";

    return `${getTimeStr(noteData)} | ${getRowIndentPrefix(state, noteData)} ${dashChar} ${noteData.text || " "}`;
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

type AnalyticsSeries = {
    activityIndices: number[];

    // These values can be computed off the activities in the series
    duration: number;
}

export function newAnalyticsSeries(): AnalyticsSeries {
    return { activityIndices: [], duration: 0 };
}

export function resetAnalyticsSeries(series: AnalyticsSeries) {
    series.activityIndices.splice(0, series.activityIndices.length);
    series.duration = 0;
}

// All times are in milliseconds
export type Analytics = {
    multiDayBreaks: AnalyticsSeries;
    breaks: AnalyticsSeries;
    taskTimes: Map<TaskId, AnalyticsSeries>;
    totalTime: number;
}

export function recomputeAnalyticsSeries(state: State, series: AnalyticsSeries) {
    // recompute duration

    series.duration = 0;
    for (const idx of series.activityIndices) {
        const activity = state.activities[idx];
        const nextActivity = state.activities[idx + 1] as Activity | undefined;

        series.duration += getActivityDurationMs(activity, nextActivity);
    }
}

export function recomputeAnalytics(state: State, activityIndices: number[], analytics: Analytics) {
    resetAnalyticsSeries(analytics.breaks);
    resetAnalyticsSeries(analytics.multiDayBreaks);
    analytics.taskTimes.clear();
    analytics.totalTime = 0;

    // recompute which tasks each note belong to.
    {
        const dfs = (id: NoteId) => {
            const note = getNote(state, id);

            let task = getNoteTag(note, "Task");
            if (!task && note.parentId) {
                task = getNote(state, note.parentId).data._task;
            }

            note.data._task = task;

            for (const id of note.childIds) {
                dfs(id);
            }
        }

        dfs(state.notes.rootId);
    }


    // compute which activities belong to which group
    const activities = state.activities;
    for (const i of activityIndices) {
        const activity = activities[i];
        const nextActivity = activities[i + 1] as Activity | undefined;

        if (activity.breakInfo) {
            // Some breaks span from end of day to start of next day. 
            // They aren't very useful for most analytics questions, like 
            //      "How long did I spent working on stuff today vs Lunch?".

            const t = new Date(activity.t);
            const t1 = nextActivity ? new Date(nextActivity.t) : new Date();

            if (
                t.getDate() === t1.getDate() &&
                t.getMonth() === t1.getMonth() &&
                t.getFullYear() === t1.getFullYear()
            ) {
                analytics.breaks.activityIndices.push(i);
                continue;
            }


            analytics.multiDayBreaks.activityIndices.push(i);
            continue;
        }

        if (activity.nId) {
            const note = getNote(state, activity.nId);
            // has the side-effect that a user can just do [Task=<Uncategorized>], that is fine I think
            const task = note.data._task || "<Uncategorized>";

            if (!analytics.taskTimes.has(task)) {
                analytics.taskTimes.set(task, newAnalyticsSeries());
            }

            const series = analytics.taskTimes.get(task)!;
            series.activityIndices.push(i);
            continue;
        }
    }

    // recompute the numbers and aggregates
    recomputeAnalyticsSeries(state, analytics.breaks);
    analytics.totalTime += analytics.breaks.duration;

    recomputeAnalyticsSeries(state, analytics.multiDayBreaks);
    analytics.totalTime += analytics.multiDayBreaks.duration;
    for (const s of analytics.taskTimes.values()) {
        recomputeAnalyticsSeries(state, s);
        analytics.totalTime += s.duration;
    }
}

export function getInnerNoteId(currentNote: TreeNote): NoteId | null {
    const id = currentNote.childIds[currentNote.data.lastSelectedChildIdx];
    if (id) {
        return id;
    }

    if (currentNote.childIds.length !== 0) {
        return currentNote.childIds[currentNote.childIds.length - 1];
    }

    return null;
}
export function isPinned(state: State, id: NoteId): boolean {
    return state.pinnedNoteIds.includes(id);
}

export function unpinNote(state: State, id: NoteId) {
    const idx = state.pinnedNoteIds.indexOf(id);
    if (idx !== -1) {
        state.pinnedNoteIds.splice(idx, 1);
    }
}

export function isInPinnedJumplist(state: State, note: TreeNote): boolean {
    if (!note.parentId) {
        return false;
    }

    if (!isPinned(state, note.parentId)) {
        return false;
    }

    // parent is pinned, and it's last selected note is this one.
    const parent = getNote(state, note.parentId);
    return parent.childIds[parent.data.lastSelectedChildIdx] === note.id;
}

/** returns true if we pinned something. false if it was already pinnned */
export function pinNote(state: State, id: NoteId): boolean {
    if (!isPinned(state, id)) {
        state.pinnedNoteIds.unshift(id);
        return true;
    }

    return false;
}

export function toggleCurrentNotePinned(state: State) {
    // We actually want to 'pin' the parent, so that it doesn't matter where we move under the parent, we can end up right back
    // there when we move through the pinned notes
    const note = getCurrentNote(state);
    if (!note.parentId) {
        return;
    }
    
    if (!pinNote(state, note.parentId)) {
        unpinNote(state, note.parentId);
    } 
}

export function resetState() {
    state = defaultState();
}

export let state = defaultState();

