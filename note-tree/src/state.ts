import { AsciiCanvasLayer } from "./canvas";
import { addDays, floorDateLocalTime, formatDate, formatDuration, getTimestamp } from "./datetime";
import { assert } from "./dom-utils";
import * as tree from "./tree";
import { uuid } from "./uuid";

export type NoteId = string;
export type TaskId = string;

export type TreeNote = tree.TreeNode<Note>;

export type DockableMenu = "activities" | "todoLists";

// NOTE: this is just the state for a single note tree.
// We can only edit 1 tree at a time, basically
export type State = {
    /** Tasks organised by problem -> subproblem -> subsubproblem etc., not necessarily in the order we work on them */
    notes: tree.TreeStore<Note>;
    currentNoteId: NoteId;
    dockedMenu: DockableMenu;
    showDockedMenu: boolean;

    /** The sequence of tasks as we worked on them. Separate from the tree. One person can only work on one thing at a time */
    activities: Activity[];

    scratchPadCanvasLayers: AsciiCanvasLayer[];

    // non-serializable fields start with _
    
    /** These notes are in order of their priority, i.e how important the user thinks a note is. */
    _todoNoteIds: NoteId[];
    _currentlyViewingActivityIdx: number;
    _flatNoteIds: NoteId[];
    _isEditingFocusedNote: boolean;
    _debounceNewNoteActivity: boolean;
    _isShowingDurations: boolean;
    _activitiesFrom: Date | null;       // NOTE: Date isn't JSON serializable
    _activitiesTo: Date | null;         // NOTE: Date isn't JSON serializable
    _durationsOnlyUnderSelected: boolean;         // NOTE: Date isn't JSON serializable
    _useActivityIndices: boolean;
    _activityIndices: number[];
};


export type Note = {
    id: NoteId;
    text: string;
    openedAt: string; // will be populated whenever text goes from empty -> not empty (TODO: ensure this is happening)
    lastSelectedChildIdx: number; // this is now an index into 

    /** 
     * The ID of this note's parent before it was archived. 
     * Only notes with a parent (ever note that isn't the root note) can be archived.
     */
    preArchivalParentId: NoteId | undefined;

    // non-serializable fields
    _status: NoteStatus; // used to track if a note is done or not.
    _isSelected: boolean; // used to display '>' or - in the note status
    _isUnderCurrent: boolean; // used to calculate the duration of a specific task.
    _depth: number; // used to visually indent the notes
    _task: TaskId | null;  // What higher level task does this note/task belong to ? Typically inherited
};


export function recomputeNoteIsUnderFlag(state: State, note: TreeNote) {
    tree.forEachNode(state.notes, (id) => {
        const note = getNote(state, id);
        note.data._isUnderCurrent = false;
    });

    dfsPre(state, note, (note) => {
        note.data._isUnderCurrent = true;
    });
}

// Since we may have a lot of these, I am somewhat compressing this thing so the JSON will be smaller.
// Yeah it isn't the best practice
export type Activity = {
    nId?: NoteId;
    t: string;

    // only apply to breaks:
    breakInfo?: string;
    locked?: true;
    deleted?: true;
}

const donePrefixes = [
    "DONE",
    "Done",
    "done",
    "DECLINED",
    "MERGED",
];

function getDoneNotePrefix(note: Note): string | undefined {
    for (const prefix of donePrefixes) {
        if (note.text.startsWith(prefix)) {
            return prefix;
        }
    }

    return undefined;
}

export function isDoneNote(note: Note) {
    return !!getDoneNotePrefix(note);
}

export function isDoneNoteWithExtraInfo(note: Note): boolean {
    const prefix = getDoneNotePrefix(note);
    if (!prefix) {
        return false;
    }

    return prefix.length !== note.text.length;
}

export function isTodoNote(note: Note) {
    return getTodoNotePriority(note) > 0;
}


export function getTodoNotePriorityId(state: State, id: NoteId): number {
    const note = getNote(state, id);
    return getTodoNotePriority(note.data);
}

export function getTodoNotePriority(note: Note): number {
    // Keep the priority system simple. 
    // Tasks are are always changing priority, and having too many priorities means they will always be assigned the wrong priority.
    // The task priorities/importances should all be in your head. This program should just help you remember which things you're working
    // on now, and which things you want to get to in the future, and you shouldn't be spending all your time ordering the tasks.

    // In progress / working set
    if (note.text.startsWith(">>>")) return 3;
    // Todo - candidate
    if (note.text.startsWith(">>")) return 2;
    // Backlog
    if (note.text.startsWith(">")) return 1;

    return 0;
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
export function defaultState(): State {
    const rootNote = defaultNote(null);
    rootNote.id = tree.ROOT_KEY;
    rootNote.text = "This root node should not be visible. If it is, you've encountered a bug!";

    const state: State = {
        _flatNoteIds: [], // used by the note tree view, can include collapsed subsections
        _isEditingFocusedNote: false, // global flag to control if we're editing a note
        _debounceNewNoteActivity: false,
        _todoNoteIds: [],

        _currentlyViewingActivityIdx: 0,
        _isShowingDurations: false,
        _activitiesFrom: null,
        _activitiesTo: null,
        _durationsOnlyUnderSelected: true,
        _activityIndices: [],
        _useActivityIndices: false,

        notes: tree.newTreeStore<Note>(rootNote),
        currentNoteId: "",
        dockedMenu: "activities",
        showDockedMenu: false,
        activities: [],
        scratchPadCanvasLayers: [],
    };

    setActivityRangeToday(state);

    return state;
}

export function loadStateFromJSON(savedStateJSON: string): State | null {
    if (!savedStateJSON) {
        return null;
    }

    const loadedState = JSON.parse(savedStateJSON) as State;

    // prevents missing item cases that may occur when trying to load an older version of the state.
    // it is our way of auto-migrating the schema. Only works for new root level keys and not nested ones tho
    // TODO: handle new fields in notes. Shouldn't be too hard actually
    const mergedLoadedState = autoMigrate(loadedState, defaultState());

    tree.forEachNode(mergedLoadedState.notes, (id) => {
        const node = tree.getNode(mergedLoadedState.notes, id);
        node.data = autoMigrate(node.data, defaultNote(null));
    });

    return mergedLoadedState;
}

export function setStateFromJSON(savedStateJSON: string) {
    const loaded = loadStateFromJSON(savedStateJSON);
    if (!loaded) {
        state = defaultState();
        return;
    }
    
    state = loaded;
}

export function getLastActivity(state: State): Activity | undefined {
    return state.activities[state.activities.length - 1];
}

export function getLastActivityWithNoteIdx(state: State): number {
    let i = state.activities.length - 1;
    while (i >= 0) {
        if(state.activities[i].nId) {
            return i;
        }

        i--;
    }

    return -1;
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
        preArchivalParentId: undefined,

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
        });

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

                if (isTodoNote(child.data)) {
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

            const everyChildNoteIsDone = note.childIds.every((id) => {
                const note = getNote(state, id);
                return note.data._status === STATUS_DONE 
                    || note.data._status === STATUS_ASSUMED_DONE;
            });

            const isDone = everyChildNoteIsDone;
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
        // Should be somewhat inefficient. but I don't care.
        // Seems quite effective, actually. All notes on the
        // todo list are in the same order as they are in the tree, and they are
        // all packed together. It's like I'm looking at a compressed version of the tree

        state._todoNoteIds.splice(0, state._todoNoteIds.length);
        const dfs = (note: TreeNote, priority: number) => {
            for (const id of note.childIds) {
                const note = getNote(state, id);
                const notePriority = getTodoNotePriority(note.data);
                if (notePriority === priority && note.data._status !== STATUS_DONE) {
                    state._todoNoteIds.push(id);
                } else if (notePriority === 0) {
                    dfs(note, priority);
                }
            }
        }
        dfs(getRootNote(state), 3);
        dfs(getRootNote(state), 2);
        dfs(getRootNote(state), 1);
    }

    // recompute the range 
    {
        if (
            !state._isShowingDurations &&
            !!state._activitiesTo &&
            state._activitiesTo < new Date()
        ) {
            setActivityRangeToday(state);
        }
    }

    // recompute the current filtered activities
    {
        state._useActivityIndices = false; ;

        // NOTE: it's fine for both to be null
        let hasValidRange = state._activitiesFrom === null ||
            state._activitiesTo === null ||
            state._activitiesFrom < state._activitiesTo;
        if (state._isShowingDurations && hasValidRange) {
            state._useActivityIndices = true;

            const currentNote = getCurrentNote(state);
            recomputeNoteIsUnderFlag(state, currentNote);

            state._activityIndices.splice(0, state._activityIndices.length);
            for (let i = 0; i < state.activities.length; i++) {
                const activity = state.activities[i];
                if (!isActivityInRange(state, activity)) {
                    continue;
                }

                if (state._durationsOnlyUnderSelected && (
                    activity.deleted ||
                    !activity.nId ||
                    !getNote(state, activity.nId).data._isUnderCurrent
                )) {
                    continue;
                }

                state._activityIndices.push(i);
            }
        }
    }
}

export function isCurrentNoteOnOrInsideNote(state: State, note: TreeNote): boolean {
    return note.data._isSelected ||    // Current note inside this note
        isNoteUnderParent(state, state.currentNoteId, note);    // Current note directly above this note
}

export function isNoteUnderParent(state: State, parentId: NoteId, note: TreeNote): boolean {
    // one of the parents is the current note
    let isParentCurrent = false;
    tree.forEachParent(state.notes, note, (note) => {
        if (note.id === parentId) {
            isParentCurrent = true;
            return true;
        }
        return false;
    });

    return isParentCurrent;
}

export function getActivityTextOrUndefined(state: State, activity: Activity): string | undefined {
    if (activity.nId === state.notes.rootId) {
        return "< deleted root note >";
    }

    if (activity.nId) {
        const text = getNote(state, activity.nId).data.text;
        if (activity.deleted) {
            return "< deleted > " + text;
        }

        return text;
    }

    if (activity.breakInfo) {
        return activity.breakInfo;
    }

    return undefined;
}

export function getActivityText(state: State, activity: Activity): string {
    return getActivityTextOrUndefined(state, activity) || "< unknown activity text! >";
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


export function activityNoteIdMatchesLastActivity(state: State, activity: Activity) : boolean {
    return (
        !isBreak(activity) &&
        state.activities.length > 0 &&
        state.activities[state.activities.length - 1].nId === activity.nId
    );
}

export function pushActivity(state: State, activity: Activity, isNewNote = false) {
    if (activityNoteIdMatchesLastActivity(state, activity)) {
        // Don't push the same note twice in a row, unless it's a break
        return;
    }

    if (
        !isNewNote &&
        state._debounceNewNoteActivity &&
        !isBreak(activity)
    ) {
        const ONE_MINUTE = 1000 * 60;
        const lastActivity = getLastActivity(state);
        if (
            lastActivity && 
            !isBreak(lastActivity) &&
            getActivityDurationMs(lastActivity, activity) < ONE_MINUTE
        ) {
            state.activities.pop();
            state._debounceNewNoteActivity = false;
        }

        if (activityNoteIdMatchesLastActivity(state, activity)) {
            // Still, don't push the same note twice in a row, unless it's a break
            return;
        }
    }

    state.activities.push(activity);
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
    if (!!note.data.text) {
        return false;
    }

    if (!note.data.text && note.childIds.length > 0) {
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

    // NOTE: activities should not be deleted from the activities list. they are required, if we want to keep duration info accurate. 
    for (let i = 0; i < state.activities.length; i++) {
        const activity = state.activities[i];
        if (activity.nId === note.id) {
            activity.nId = note.parentId;
            activity.deleted = true;
        }
    }

    while(state.activities.length > 0 && state.activities[state.activities.length - 1].deleted) {
        state.activities.pop();
    }

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
    setCurrentNote(state, newNote.id);
    setIsEditingCurrentNote(state, true, true);
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
    setCurrentNote(state, newNote.id);
    setIsEditingCurrentNote(state, true, true);
    return newNote;
}

export function hasNote(state: State, id: NoteId): boolean {
    return !!id && tree.hasNode(state.notes, id);
}

export function getNote(state: State, id: NoteId) {
    return tree.getNode(state.notes, id);
}

export function getNoteOrUndefined(state: State, id: NoteId): TreeNote | undefined {
    if (hasNote(state, id)) {
        return getNote(state, id);
    }

    return undefined;
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

function pushNoteActivity(state: State, noteId: NoteId, isNewNote: boolean) {
    pushActivity(state, {
        nId: noteId,
        t: getTimestamp(new Date()),
    }, isNewNote);
}

export function pushBreakActivity(state: State, breakInfoText: string, locked: undefined | true, timestamp?: string) {
    pushActivity(state, {
        nId: undefined,
        t: timestamp || getTimestamp(new Date()),
        breakInfo: breakInfoText,
        locked: locked,
    });

    setIsEditingCurrentNote(state, false);
}

export function isCurrentlyTakingABreak(state: State): boolean {
    const last = getLastActivity(state);
    return !!last && isBreak(last);
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

export function setCurrentNote(state: State, noteId: NoteId | null) {
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
    setIsEditingCurrentNote(state, false);
    deleteNoteIfEmpty(state, currentNoteBeforeMove.id);
    setCurrentActivityIdxToCurrentNote(state);

    return true;
}

export function setCurrentActivityIdxToCurrentNote(state: State) {
    const note = getCurrentNote(state);
    const idx = getMostRecentActivityIdx(state, note);
    if (idx !== -1) {
        state._currentlyViewingActivityIdx = idx;
    }
}


export function setIsEditingCurrentNote(state: State, isEditing: boolean, isNewNote = false) {
    state._isEditingFocusedNote = isEditing;

    if (isEditing) {
        const currentNote = getCurrentNote(state);
        pushNoteActivity(state, currentNote.id, isNewNote);
        setCurrentActivityIdxToCurrentNote(state);

        // Prevents multiple notes being added when we sometimes press "Enter" on a note
        // only to then create a new note under it.
        // This should then be set to false as soon as we edit the note, or a similar action that would 'cement' this activity
        state._debounceNewNoteActivity = true;

        if (currentNote.parentId) {
            const parent = getNote(state, currentNote.parentId);
            parent.data.lastSelectedChildIdx = parent.childIds.indexOf(currentNote.id);
        }
    }
}


type NoteFilterFunction = (state: State, note: TreeNote, nextNote: TreeNote | undefined) => boolean;
export function findNextNote(state: State, childIds: NoteId[], id: NoteId, filterFn: NoteFilterFunction) {
    let idx = childIds.indexOf(id) + 1;
    while (idx < childIds.length) {
        const note = getNote(state, childIds[idx]);
        const nextNote = getNoteOrUndefined(state, childIds[idx + 1]);
        if (filterFn(state, note, nextNote)) {
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
        const nextNote = getNoteOrUndefined(state, childIds[idx - 1]);
        if (filterFn(state, note, nextNote)) {
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

export function isNoteImportant(state: State, note: TreeNote, nextNote: TreeNote | undefined): boolean {
    if (!note.parentId) {
        return true;
    }

    const siblings = getNote(state, note.parentId).childIds;

    return (
        siblings[0] === note.id ||
        siblings[siblings.length - 1] === note.id ||
        note.data._isSelected ||
        (!!nextNote && (note.data._status === STATUS_IN_PROGRESS) !== (nextNote.data._status === STATUS_IN_PROGRESS))
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
    return "    ".repeat(repeats);
}

/** 
 * This is the sum of all activities with this note, or any descendant 
 */
export function getNoteDuration(state: State, note: TreeNote, activityFilterFn?: (activityIdx: number) => boolean) {
    recomputeNoteIsUnderFlag(state, note);

    const activities = state.activities;
    let duration = 0;

    for (let i = 0; i < activities.length; i++) {
        const activity = activities[i];
        if (!activity.nId) {
            continue;
        }

        if (activityFilterFn && !activityFilterFn(i)) {
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

function autoMigrate<T extends object>(loadedData: T, defaultSchema: T) {
    for (const k in defaultSchema) {
        if (!(k in loadedData)) {
            loadedData[k] = defaultSchema[k];
        }
    }

    for (const k in loadedData) {
        if (!(k in defaultSchema)) {
            delete loadedData[k];
        }
    }

    return loadedData;
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

export function isBreak(activity: Activity): boolean {
    return !!activity.breakInfo;
}

export function isMultiDay(activity: Activity, nextActivity: Activity | undefined) : boolean {
    const t = new Date(activity.t);
    const t1 = nextActivity ? new Date(nextActivity.t) : new Date();

    return !(
        t.getDate() === t1.getDate() &&
        t.getMonth() === t1.getMonth() &&
        t.getFullYear() === t1.getFullYear()
    );
}

export function getMostRecentlyWorkedOnChild(state: State, note: TreeNote): TreeNote {
    const idx = getMostRecentlyWorkedOnChildActivityIdx(state, note);
    if (idx === -1) {
        return note;
    }

    const activity = state.activities[idx];
    if (!activity.nId) {
        return note;
    }

    return getNote(state, activity.nId);
}

// This is recursive
export function getMostRecentlyWorkedOnChildActivityIdx(state: State, note: TreeNote): number {
    recomputeNoteIsUnderFlag(state, note);

    for (let i = state.activities.length - 1; i > 0; i--) {
        const activity = state.activities[i];
        if (!activity.nId) {
            continue;
        }

        const note = getNote(state, activity.nId);
        if (note.data._isUnderCurrent) {
            return i;
        }
    }

    throw new Error("This code should never be reached, if `note` is really in the tree");
}

export function getMostRecentActivityIdx(state: State, note: TreeNote): number {
    for (let i = state.activities.length - 1; i > 0; i--) {
        if (state.activities[i].nId === note.id) {
            return i;
        }
    }
    return -1;
}

// NOTE: this method will attempt to 'fix' indices that are out of bounds.
export function getLastSelectedNote(state: State, note: TreeNote): TreeNote | null {
    if (note.childIds.length === 0) {
        return null;
    }

    let idx = note.data.lastSelectedChildIdx;
    if (idx >= note.childIds.length) {
        idx = note.childIds.length - 1;
        note.data.lastSelectedChildIdx = idx;
    }

    const selNoteId = note.childIds[idx]

    return getNote(state, selNoteId);
}


export function setActivityRangeToday(state: State) {
    const dateFrom = new Date();
    const dateTo = new Date();
    addDays(dateTo, 1);
    floorDateLocalTime(dateFrom);
    floorDateLocalTime(dateTo);
    state._activitiesFrom = dateFrom;
    state._activitiesTo = dateTo;
}

export function isActivityInRange(state: State, activity: Activity) {
    const t = new Date(activity.t);

    if (!!state._activitiesFrom && t < state._activitiesFrom) {
        return false;
    }

    if (!!state._activitiesTo && t > state._activitiesTo) {
        return false;
    }

    return true;
}

export function deleteDoneNote(state: State, note: TreeNote): string | undefined {
    // WARNING: this is a A destructive action that permenantly deletes user data. Take every precaution, and do every check
    
    if (!hasNote(state, note.id)) {
        return "Note doesn't exist to delete. It may have already been deleted.";
    }

    recomputeState(state);

    if (note.data._status !== STATUS_DONE) {
        return "Notes that aren't DONE (i.e all notes under them are DONE) can't be deleted";
    }

    const parentId = note.parentId;
    if (!parentId) {
        return "Note needs a parent to be deleted";
    }

    // figure out where to move to if possible
    const parent = getNote(state, parentId);
    let idx = parent.childIds.indexOf(note.id);
    if (idx === parent.childIds.length - 1) {
        idx--;
    }
    let idToMoveTo: NoteId | undefined = parent.childIds[idx - 1] || parent.childIds[idx + 1];

    // Do the deletion
    tree.removeSubtree(state.notes, note);

    tree.forEachNode(state.notes, (id) => {
        const note = tree.getNode(state.notes, id);
        if (note.parentId && !tree.hasNode(state.notes, note.parentId)) {
            tree.remove(state.notes, note);
        }
    });

    for (const activity of state.activities) {
        if (!activity.nId) {
            continue;
        }

        if (
            !hasNote(state, activity.nId) || 
            activity.deleted 
        ) {
            activity.nId = parentId;
            activity.deleted = true;
        }
    }


    // Remove activities that have: same activity behind them, or have an activity that is also deleted behind them
    for (let i = 1; i < state.activities.length; i++) {
        const activity = state.activities[i];
        const lastActivity = state.activities[i - 1];
        if (lastActivity.nId === activity.nId) {
            state.activities.splice(i, 1);
            i--;
        }
    }

    // move to another note nearby if possible
    if (idToMoveTo) {
        setCurrentNote(state, idToMoveTo);
        return;
    }

    // if not, just move move to the last note...
    const lastActivityIdx = getLastActivityWithNoteIdx(state);
    if (lastActivityIdx !== -1) {
        const activity = state.activities[lastActivityIdx];
        assert(activity.nId);
        setCurrentNote(state, activity.nId);    
        return;
    }

    // If not, move to literally any note..
    const root = getRootNote(state);
    const lastId = root.childIds[root.childIds.length - 1];
    if (lastId) {
        setCurrentNote(state, lastId);
        return;
    }

    // If we implemented deleting right, we simply have no more notes to move to now...
}

export function resetState() {
    state = defaultState();
}

export let state = defaultState();



