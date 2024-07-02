import { AsciiCanvasLayer } from "src/canvas";
import { addDays, floorDateLocalTime, formatDate, formatDuration, getTimestamp } from "src/utils/datetime";
import { logTrace } from "src/utils/log";
import * as tree from "src/utils/tree";
import { uuid } from "src/utils/uuid";
import { assert } from "./utils/assert";
import { GraphData, newGraphData } from "./interactive-graph";

export type NoteId = string;
export type TaskId = string;

export type TreeNote = tree.TreeNode<Note>;

export type DockableMenu = "activities" | "todoLists";
export type AppTheme = "Light" | "Dark";

// NOTE: can't be JSON-serialized.
type Cache<T> = {
    map: Map<string, T>;
    timeSet: number;
    options: CacheOptions;
}
type CacheOptions = {
    maxAgeMs: number;
}

function newCache<T>(options: CacheOptions): Cache<T> {
    return {
        map: new Map(),
        timeSet: 0,
        options,
    };
}

function getCachedValue<T>(cache: Cache<T>, key: string, computeFn: (key: string) => T): T {
    if (Date.now() - cache.timeSet > cache.options.maxAgeMs) {
        cache.map.clear();
    }

    if (!cache.map.has(key)) {
        cache.map.set(key, computeFn(key));
        cache.timeSet = Date.now();
    }

    return cache.map.get(key)!;
}



// NOTE: this is just the state for a single note tree.
// We can only edit 1 tree at a time, basically
export type State = {
    /** Tasks organised by problem -> subproblem -> subsubproblem etc., not necessarily in the order we work on them */
    notes: tree.TreeStore<Note>;
    currentNoteId: NoteId;
    dockedMenu: DockableMenu;
    showDockedMenu: boolean;
    breakAutoInsertLastPolledTime: string;
    currentTheme: AppTheme;

    // A stupid bug in chrome causes IndexedDB to be non-functional 
    // (at least with the way I'm using it as a drop-in replacement for localStorage.).
    // see usages of this variable for more details.
    criticalSavingError: string | undefined;

    /** The quicklist. This is different from the activities list. **/

    /** The sequence of tasks as we worked on them. Separate from the tree. One person can only work on one thing at a time */
    activities: Activity[];

    scratchPadCanvasLayers: AsciiCanvasLayer[];

    mainGraphData: GraphData;

    settings: AppSettings;

    // non-serializable fields start with _
    
    _todoNoteIds: NoteId[];
    _todoNoteFilters: number;
    _todoRootId: NoteId;  
    _currentlyViewingActivityIdx: number;
    _flatNoteIds: NoteId[];
    _isEditingFocusedNote: boolean;
    _isShowingDurations: boolean;
    _activitiesFrom: Date | null;       // NOTE: Date isn't JSON serializable
    _activitiesTo: Date | null;         // NOTE: Date isn't JSON serializable
    _durationsOnlyUnderSelected: boolean;
    _durationsCache: Cache<number>;
    _useActivityIndices: boolean;
    _activityIndices: number[];
    _lastNoteId: NoteId | undefined;
};

type AppSettings = {
    alwaysShowEstimates: boolean;
}


type JsonBoolean = true | undefined;

export type Note = {
    id: NoteId;
    text: string;
    openedAt: string; // will be populated whenever text goes from empty -> not empty (TODO: ensure this is happening)
    lastSelectedChildIdx: number; // this is now an index into 

    // Should this note be sticky?
    isSticky: JsonBoolean;

    /** 
     * The ID of this note's parent before it was archived. 
     * Only notes with a parent (ever note that isn't the root note) can be archived.
     */
    preArchivalParentId: NoteId | undefined;

    // non-serializable fields
    _status: NoteStatus; // used to track if a note is done or not.
    _everyChildNoteDone: boolean;
    _isSelected: boolean; // this now just means "is this note the current note or an ancestor of the current note?"
    _isUnderCurrent: boolean; // used to calculate the duration of a specific task. Or as an arbitrary boolean flag for anything really.
    _depth: number; // used to visually indent the notes
    _task: TaskId | null;  // What higher level task does this note/task belong to ? Typically inherited
};


export function recomputeNoteIsUnderFlag(state: State, note: TreeNote) {state
    tree.forEachNode(state.notes, (id) => {
        const note = getNote(state, id);
        note.data._isUnderCurrent = false;
    });

    dfsPre(state, note, (note) => {
        note.data._isUnderCurrent = true;
    });
}

// Since we may have a lot of these, I am somewhat compressing this thing so the JSON will be smaller.
// Yeah it isn't the best practice, but it works
export type Activity = {
    nId?: NoteId;
    // Time this note was created
    t: string;
    // Are we creating a brand new note? 1 if true
    c?: number;

    _t?: Date;

    // only apply to breaks:
    breakInfo?: string;
    locked?: true;
    deleted?: true;
}

const donePrefixes = [
    "DONE",
    "RESOLVED",
    "FIXED",
    "MERGED",
    "DECLINED",
    "REJECTED",
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

export function getNoteTextWithoutPriority(note: Note): string {
    const priority = getTodoNotePriority(note);
    return note.text.substring(priority).trim();
}

export function getTodoNotePriority(note: Note): number {
    // Keep the priority system simple. 
    // Tasks are are always changing priority, and having too many priorities means they will always be assigned the wrong priority.
    // The task priorities/importances should all be in your head. This program should just help you remember which things you're working
    // on now, and which things you want to get to in the future, and you shouldn't be spending all your time ordering the tasks.

    let priority = 0;

    const text = note.text;
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== '>') {
            break;
        }

        priority++;
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
export function defaultState(): State {
    const rootNote = defaultNote(null);
    rootNote.id = tree.ROOT_KEY;
    rootNote.text = "This root node should not be visible. If it is, you've encountered a bug!";

    const notes = tree.newTreeStore<Note>(rootNote);

    const state: State = {
        notes,
        currentNoteId: "",
        dockedMenu: "activities",
        showDockedMenu: false,
        activities: [],
        scratchPadCanvasLayers: [],
        mainGraphData: newGraphData(),
        settings: {
            alwaysShowEstimates: false,
        },
        currentTheme: "Light",
        breakAutoInsertLastPolledTime: "",
        criticalSavingError: "",

        _flatNoteIds: [], // used by the note tree view, can include collapsed subsections
        _isEditingFocusedNote: false, // global flag to control if we're editing a note
        _todoNoteIds: [],
        _todoRootId: notes.rootId,
        _todoNoteFilters: 0,
        _currentlyViewingActivityIdx: 0,
        _isShowingDurations: false,
        _durationsCache: newCache({ maxAgeMs: 1000 }),
        _activitiesFrom: null,
        _activitiesTo: null,
        _durationsOnlyUnderSelected: true,
        _activityIndices: [],
        _useActivityIndices: false,
        _lastNoteId: undefined,

    };

    setActivityRangeToday(state);

    return state;
}

export function loadStateFromJSON(savedStateJSON: string): State | null {
    if (!savedStateJSON) {
        return null;
    }

    const loadedState = JSON.parse(savedStateJSON) as State;

    return migrateState(loadedState);
}

export function migrateState(loadedState: State) {
    // prevents missing item cases that may occur when trying to load an older version of the state.
    // it is our way of auto-migrating the schema. Only works for new root level keys and not nested ones tho
    // TODO: handle new fields in notes. Shouldn't be too hard actually
    const mergedLoadedState = autoMigrate(loadedState, defaultState());

    tree.forEachNode(mergedLoadedState.notes, (id) => {
        const node = tree.getNode(mergedLoadedState.notes, id);
        node.data = autoMigrate(node.data, defaultNote(null));
    });

    // I should actually be doing migrations and validations here but I'm far too lazy

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

export function getLastActivityWithNote(state: State): Activity | undefined {
    const idx = getLastActivityWithNoteIdx(state);
    if (idx === -1) {
        return undefined;
    }
    return state.activities[idx];
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
        isSticky: undefined,

        // the following is just visual flags which are frequently recomputed

        _status: STATUS_IN_PROGRESS,
        _everyChildNoteDone: false,
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

export function getAllNoteIdsInTreeOrder(state: State): NoteId[] {
    const noteIds: NoteId[] = [];
    
    const root = getRootNote(state);
    for (const childId of root.childIds) {
        const note = getNote(state, childId);
        dfsPre(state, note, (note) => {
            noteIds.push(note.id);
        });
    }
    
    return noteIds;
}

export function recomputeFlatNotes(state: State, flatNotes: NoteId[]) {
    flatNotes.splice(0, flatNotes.length);

    const currentNote = getCurrentNote(state);
    if (!currentNote.parentId) {
        return;
    }
    const parent = getNote(state, currentNote.parentId);

    tree.forEachParent(state.notes, currentNote, (note) => {
        if (note.id === currentNote.id) {
            return;
        }

        flatNotes.push(note.id);
    });

    flatNotes.reverse();
    for (const childId of parent.childIds) {
        flatNotes.push(childId);
    }
}

export function setActivityTime(activity: Activity, t: Date) {
    activity.t = getTimestamp(t);
    activity._t = t;
}

export function getActivityTime(activity: Activity) {
    if (!activity._t) {
        activity._t = new Date(activity.t);
    }

    return activity._t!;
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
    
    // delete the empty notes
    {
        dfsPre(state, getRootNote(state), (n) => {
            if (n.childIds.length === 0 && n.id !== state.currentNoteId) {
                deleteNoteIfEmpty(state, n.id)
            }
        });
    }

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
            let hasInProgressNoteWithoutChildren = false;
            for (let i = note.childIds.length - 1; i >= 0; i--) {
                const childId = note.childIds[i];
                const child = getNote(state, childId);
                if (child.childIds.length > 0) {
                    dfs(child);
                    continue;
                }

                if (isTodoNote(child.data)) {
                    child.data._status = STATUS_IN_PROGRESS;
                    hasInProgressNoteWithoutChildren = true;
                    continue;
                }

                if (isDoneNote(child.data) || foundDoneNote) {
                    child.data._status = STATUS_DONE;
                    foundDoneNote = true;
                    continue;
                }

                if (i === note.childIds.length - 1) {
                    child.data._status = STATUS_IN_PROGRESS;
                    hasInProgressNoteWithoutChildren = true;
                } else {
                    child.data._status = STATUS_ASSUMED_DONE;
                }
            }

            const everyChildNoteIsDone = note.childIds.every((id) => {
                const note = getNote(state, id);
                return note.data._status === STATUS_DONE 
                    || note.data._status === STATUS_ASSUMED_DONE;
            });

            const lastNote = note.childIds.length === 0 ? undefined :
                getNote(state, note.childIds[note.childIds.length - 1]);

            // Make sure a note can only be closed out if all the notes under it are > 0
            const lastChildNoteIsDoneLeafNote = lastNote && (
                lastNote.childIds.length === 0 &&
                isDoneNote(lastNote.data)
            );

            const isDone = everyChildNoteIsDone && lastChildNoteIsDoneLeafNote;
            note.data._status = isDone ? STATUS_DONE : STATUS_IN_PROGRESS;
            note.data._everyChildNoteDone = everyChildNoteIsDone;
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

        recomputeFlatNotes(state, state._flatNoteIds);
    }

    // recompute the TODO note list
    {
        // Should be somewhat inefficient. but I don't care. 
        // most of the calculations here suck actually, now that I think about it...
        // They're really easy to verify the correctness of and change later though.

        state._todoNoteIds.splice(0, state._todoNoteIds.length);

        tree.forEachNode(state.notes, (id) => {
            const note = getNote(state, id);
            note.data._isUnderCurrent = false;
        });

        const currentNote = getCurrentNote(state);
        const currentHLT = getHigherLevelTask(state, currentNote);
        let showedNilTask = false;

        for (let i = state.activities.length - 1; i >= 0; i--) {
            const nId = state.activities[i].nId;
            const note = getNoteOrUndefined(state, nId);
            if (!note) {
                continue;
            }

            if (
                note.parentId === null ||
                note.data._isUnderCurrent ||
                (note.data._status !== STATUS_IN_PROGRESS) ||
                (note.data._status === STATUS_IN_PROGRESS && note.childIds.length > 0 && !note.data._everyChildNoteDone)
            ) {
                continue;
            }

            if (state._todoNoteFilters === -1) {
                // only show other todo notes with the same higher level task as this one
                const hlt = getHigherLevelTask(state, note);
                if (hlt !== currentHLT) {
                    continue;
                }
            } else if (state._todoNoteFilters === 1) {
                // only show the most recent of each higher level task.
                const hlt = getHigherLevelTask(state, note);
                if (hlt) {
                    if (hlt.data._isUnderCurrent) {
                        continue;
                    }
                    hlt.data._isUnderCurrent = true;
                } else {
                    if (showedNilTask) {
                        continue;
                    }
                    showedNilTask = true;
                }
            }

            state._todoNoteIds.push(note.id);
            note.data._isUnderCurrent = true;

            if (state._todoNoteIds.length > 100) {
                break;
            }
        }
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
        const [hasValidRange, start, end] = getActivityRange(state);
        if (state._isShowingDurations && hasValidRange) {
            state._useActivityIndices = true;

            const currentNote = getCurrentNote(state);
            recomputeNoteIsUnderFlag(state, currentNote);

            state._activityIndices.splice(0, state._activityIndices.length);

            for (let i = start; i <= end; i++) {
                const activity = state.activities[i];
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

export function getActivityRange(state: State): [boolean, number, number] {
    // NOTE: it's fine for both to be null
    let hasValidRange = state._activitiesFrom === null ||
        state._activitiesTo === null ||
        state._activitiesFrom < state._activitiesTo;

    const activities = state.activities;
    if (!hasValidRange) {
        return [false, 0, -1];
    }

    let start = 0;
    if (state._activitiesFrom) {
        // this range is typically from today T=- to tomorrow T=0 , so let's optimize for that
        
        start = activities.length;
        while (
            start > 0 &&
            getActivityTime(activities[start - 1]) > state._activitiesFrom
        ) {
            start--;
        }
    }

    if (start === activities.length) {
        return [true, 0, -1];
    }

    let end = activities.length - 1;
    if (state._activitiesTo) {
        end = start;
        while (
            end < activities.length - 1 &&
            getActivityTime(activities[end]) < state._activitiesTo
        ) {
            end++;
        }
    }

    if (end === start) {
        return [true, 0, -1];
    }

    return [true, start, end];
}


export function isCurrentNoteOnOrInsideNote(state: State, note: TreeNote): boolean {
    return note.data._isSelected ||    // Current note inside this note
        isNoteUnderParent(state, state.currentNoteId, note);    // Current note directly above this note
}

export function isNoteUnderParent(state: State, parentId: NoteId, note: TreeNote): boolean {
    // one of the parents is the current note
    return tree.forEachParent(state.notes, note, (note) => {
        return note.id === parentId;
    });
}

export function getActivityTextOrUndefined(state: State, activity: Activity): string | undefined {
    if (activity.nId === state.notes.rootId) {
        return "< deleted root note >";
    }

    if (activity.nId) {
        const text = getNote(state, activity.nId).data.text;
        if (activity.deleted) {
            return "< used to be under > " + text;
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

export function getActivityDurationMs(activity: Activity, nextActivity: Activity | undefined): number {
    const startTimeMs = getActivityTime(activity).getTime();
    const nextStart = (nextActivity ? getActivityTime(nextActivity) : new Date()).getTime();
    return nextStart - startTimeMs;
}


export function createNewNote(state: State, text: string): TreeNote {
    const note = defaultNote(state);
    note.text = text;

    const newTreeNode = tree.newTreeNode(note, note.id);

    pushNoteActivity(state, newTreeNode.id, true);

    return newTreeNode;
}


export function activityNoteIdMatchesLastActivity(state: State, activity: Activity) : boolean {
    const lastActivity = getLastActivity(state);
    if (!lastActivity) {
        return false;
    }

    if (isBreak(lastActivity)) {
        return lastActivity.breakInfo === activity.breakInfo;
    }

    return lastActivity.nId === activity.nId;
}

function canActivityBeReplacedWithNewActivity(state: State, lastActivity: Activity): boolean {
    const ONE_SECOND = 1000;
    const activityDurationMs = getActivityDurationMs(lastActivity, undefined);

    if (
        lastActivity && 
        lastActivity.nId && 
        lastActivity.c === 1 && 
        !lastActivity.deleted 
    ) {
        return false;
    }

    if (
        // A bunch of conditions that make this activity something we don't need to keep around as much
        !lastActivity || 
        !lastActivity.nId ||
        !hasNote(state, lastActivity.nId) || 
        lastActivity.deleted || 
        lastActivity.c !== 1 || // activity wasn't created, but edited
        isBreak(lastActivity) || 
        !getNote(state, lastActivity.nId).data.text.trim()  // empty text
    ) {
        // The activity is more replaceable, so we extend this time.
        const LONG_DEBOUNCE = 1 * 60 * ONE_SECOND;
        return activityDurationMs < LONG_DEBOUNCE;
    }

    const SHORT_DEBOUNCE = 2 * ONE_SECOND;
    return activityDurationMs < SHORT_DEBOUNCE;
}

function pushActivity(state: State, activity: Activity) {
    const lastActivity = getLastActivity(state);
    if (activityNoteIdMatchesLastActivity(state, activity)) {
        // Don't push the same activity twice in a row
        return;
    }

    if (lastActivity && canActivityBeReplacedWithNewActivity(state, lastActivity)) {
        // this activity may be popped - effectively replaced with the new activity
        state.activities.pop();
        
        if (activityNoteIdMatchesLastActivity(state, activity)) {
            // Still, don't push the same activity twice in a row
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
    if (!!note.data.text.trim()) {
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

    const nId = note.id;
    const parentId = note.parentId;

    // delete from the ids list, as well as the note database
    tree.remove(state.notes, note);

    // NOTE: activities should not be deleted from the activities list. they are required, if we want to keep duration info accurate. 
    for (let i = 0; i < state.activities.length; i++) {
        const activity = state.activities[i];
        if (activity.nId === nId) {
            activity.nId = parentId;
            activity.deleted = true;
        }
    }

    while(state.activities.length > 0 && state.activities[state.activities.length - 1].deleted) {
        state.activities.pop();
    }

    // setting the note appends an activity. so we have to do it at the end
    setCurrentNote(state, noteToMoveTo);

    return true;
}

export function insertNoteAfterCurrent(state: State) {
    const currentNote = getCurrentNote(state);
    assert(currentNote.parentId, "Cant insert after the root note");
    if (!currentNote.data.text.trim()) {
        // REQ: don't insert new notes while we're editing blank notes
        return false;
    }

    const newNote = createNewNote(state, "");
    tree.addAfter(state.notes, currentNote, newNote)
    setCurrentNote(state, newNote.id);
    setIsEditingCurrentNote(state, true);
    return true;
}

export function insertChildNote(state: State): TreeNote | null {
    const currentNote = getCurrentNote(state);
    assert(currentNote.parentId, "Cant insert after the root note");
    if (!currentNote.data.text.trim()) {
        // REQ: don't insert new notes while we're editing blank notes
        return null;
    }

    const newNote = createNewNote(state, "");
    tree.addUnder(state.notes, currentNote, newNote);
    setCurrentNote(state, newNote.id);
    setIsEditingCurrentNote(state, true);
    return newNote;
}

export function hasNote(state: State, id: NoteId): boolean {
    return !!id && tree.hasNode(state.notes, id);
}

export function getNote(state: State, id: NoteId) {
    return tree.getNode(state.notes, id);
}

export function getNoteOrUndefined(state: State, id: NoteId | null | undefined): TreeNote | undefined {
    if (!id) {
        return undefined;
    }
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
    const date = new Date();
    pushActivity(state, {
        nId: noteId,
        t: getTimestamp(date),
        c: isNewNote ? 1 : undefined,
    });
}

export function newBreakActivity(breakInfoText: string, time: Date, locked: boolean): Activity {
    time = time || new Date();
    return {
        nId: undefined,
        t: getTimestamp(time),
        breakInfo: breakInfoText,
        locked: locked || undefined,
    };
}

export function pushBreakActivity(state: State, breakActivtiy: Activity) {
    if (breakActivtiy.nId || !breakActivtiy.breakInfo) {
        throw new Error("Invalid break activity");
    }

    pushActivity(state, breakActivtiy);

    if (state._isEditingFocusedNote) {
        setIsEditingCurrentNote(state, false);
    }

}

export function isCurrentlyTakingABreak(state: State): boolean {
    const last = getLastActivity(state);
    return !!last && isBreak(last);
}

export function getNoteNDown(state: State, note: TreeNote, useSiblings: boolean, amount = 1): NoteId | undefined {
    if (!note.parentId) {
        return undefined;
    }

    const list = useSiblings ? getNote(state, note.parentId).childIds : state._flatNoteIds;
    const idx = list.indexOf(note.id);
    if (idx < list.length - 1) {
        return list[Math.min(list.length - 1, idx + amount)];
    }

    return undefined;
}

export function getNoteNUp(state: State, note: TreeNote, useSiblings: boolean, amount = 1): NoteId | undefined {
    if (!note.parentId) {
        return undefined;
    }

    const list = useSiblings ? getNote(state, note.parentId).childIds : state._flatNoteIds;
    let idx = list.indexOf(note.id);
    if (idx > 0) {
        return list[Math.max(0, idx - amount)];
    }

    return undefined;
}

export function setCurrentNote(state: State, noteId: NoteId | null, saveJump = false) {
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

    setNoteAsLastSelected(state, note);

    state._lastNoteId = !saveJump ? undefined : state.currentNoteId;
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

function setNoteAsLastSelected(state: State, note: TreeNote) {
    if (!note.parentId) {
        return;
    }

    const parent = getNote(state, note.parentId);
    parent.data.lastSelectedChildIdx = parent.childIds.indexOf(note.id);
}

export function setIsEditingCurrentNote(state: State, isEditing: boolean) {
    state._isEditingFocusedNote = isEditing;

    if (isEditing) {
        const currentNote = getCurrentNote(state);
        pushNoteActivity(state, currentNote.id, false);
        setCurrentActivityIdxToCurrentNote(state);

        setNoteAsLastSelected(state, currentNote);
    } else {
        if (!isCurrentlyTakingABreak(state)) {
            pushBreakActivity(state, newBreakActivity("Planning/organising tasks", new Date(), false));
        }
    }
}


export function findNextImportantNote(state: State, note: TreeNote, backwards = false): TreeNote | undefined {
    if (!note.parentId) {
        return undefined;
    }

    const siblings = getNote(state, note.parentId).childIds;
    const idx = siblings.indexOf(note.id);
    if (idx === -1) {
        return undefined;
    }

    const dir = backwards ? -1 : 1;
    const nextNote = getNoteOrUndefined(state, siblings[idx + dir]);
    if (!nextNote) {
        return undefined;
    }

    const isInProgress = nextNote.data._status === STATUS_IN_PROGRESS;
    for (let i = idx + dir; i + dir >= -1 &&  i + dir <= siblings.length; i += dir) {
        const note = getNote(state, siblings[i]);
        if (
            i <= 0 ||
            i >= siblings.length - 1 ||
            (!note.data._isSelected && note.data.isSticky) ||
            (note.data._status === STATUS_IN_PROGRESS) !== isInProgress
        ) {
            return note;
        }
    }

    return undefined;
}

export function getNoteOneDownLocally(state: State, note: TreeNote) {
    if (!note.parentId) {
        return undefined;
    }

    const backwards = false;
    return findNextImportantNote(state, note, backwards)?.id;
}

export function getNoteOneUpLocally(state: State, note: TreeNote) {
    if (!note.parentId) {
        return undefined;
    }

    const backwards = true;
    return findNextImportantNote(state, note, backwards)?.id;
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

function getNoteDurationUsingCurrentRange(state: State, noteId: NoteId) {
    const note = getNote(state, noteId);
    return getNoteDuration(state, note, true);
}

export function getNoteDurationUsingCurrentRangeCached(state: State, noteId: NoteId) {
    return getCachedValue(state._durationsCache, noteId, (noteId) => {
        return getNoteDurationUsingCurrentRange(state, noteId);
    });
}

/** 
 * This is the sum of all activities with this note, or any descendant 
 */
export function getNoteDuration(state: State, note: TreeNote, useRange: boolean) {
    recomputeNoteIsUnderFlag(state, note);

    const activities = state.activities;
    let duration = 0;

    let start = 0, end = activities.length - 1;
    if (useRange) {
        let hasRange;
        [hasRange, start, end] = getActivityRange(state);
    }


    for (let i = start; i <= end; i++) {
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

// NOTE: doesn't detect the 'h'. so it might be inaccurate.
function hasEstimate(text: string) {
    const DELIMITER = "E=";
    return text.indexOf(DELIMITER) !== -1;
}

function parseNoteEstimate(text: string): number {
    const DELIMITER = "E=";
    const start = text.indexOf(DELIMITER) + DELIMITER.length;
    if (start === -1) {
        return 0;
    }

    const END_DELIMITER = "h";
    const end = text.indexOf(END_DELIMITER, start + 1);
    if (end === -1) {
        return 0;
    }

    const hoursStr = text.substring(start, end);
    const hours = parseFloat(hoursStr);
    if (!hours) {
        return 0;
    }

    return Math.floor(hours * 60 * 60 * 1000);
}

export function getNoteEstimate(state: State, note: TreeNote): number {
    if (!hasEstimate(note.data.text)) {
        // if this note doesn't have any parent notes with estimates, we shouldn't recurse down all children to find estimates.
        // In this way, we can prevent 'estimates' from leaking all the way up the tree - only subtrees with E= can have estimates for now.
        if (!tree.forEachParent(
            state.notes, 
            note, 
            (note) => hasEstimate(note.data.text),
        )) {
            return 0;
        }
    }

    let estimate = 0;
    const dfs = (note: TreeNote) => {
        estimate += parseNoteEstimate(note.data.text);

        for (const id of note.childIds) {
            const note = getNote(state, id);
            dfs(note);
        }
    };

    dfs(note);

    return estimate;
}



export function getSecondPartOfRow(state: State, note: TreeNote) {
    const duration = getNoteDuration(state, note, false);
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
    const t = getActivityTime(activity);
    const t1 = nextActivity ? getActivityTime(nextActivity) : new Date();

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

    if (!idx) {
        return note;
    }

    const activity = state.activities[idx];
    if (!activity.nId) {
        return note;
    }

    return getNote(state, activity.nId);
}

// This is recursive
export function getMostRecentlyWorkedOnChildActivityIdx(state: State, note: TreeNote): number | undefined {
    recomputeNoteIsUnderFlag(state, note);

    const noteCreatedAt = new Date(note.data.openedAt);

    for (let i = state.activities.length - 1; i > 0; i--) {
        const activity = state.activities[i];
        if (getActivityTime(activity) < noteCreatedAt) {
            // Can't possibly be any activities before this
            break;
        }

        if (!activity.nId) {
            continue;
        }

        const note = getNote(state, activity.nId);
        if (note.data._isUnderCurrent) {
            return i;
        }
    }

    return undefined;
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

export function findPreviousActiviyIndex(state: State, nId: NoteId, idx: number): number {
    // Why couldn't they just have findLastIndex whyyyyyy??
    const activities = state.activities;
    for (let i = idx - 1; i >= 0; i--) {
        const a = activities[i];
        if (!a.nId) {
            continue;
        }

        const aNote = getNote(state, a.nId);
        if (isNoteUnderParent(state, nId, aNote)) {
            return i;
        }
    }

    return -1;
}

export function findNextActiviyIndex(state: State, nId: NoteId, idx: number): number {
    const activities = state.activities;
    for (let i = idx + 1; i < activities.length; i++) {
        const a = activities[i];
        if (!a.nId) {
            continue;
        }

        const aNote = getNote(state, a.nId);
        if (isNoteUnderParent(state, nId, aNote)) {
            return i;
        }
    }

    return -1;
}

export function toggleCurrentNoteSticky(state: State) {
    const currentNote = getCurrentNote(state);
    currentNote.data.isSticky = (!currentNote.data.isSticky) || undefined;
}

export function resetState() {
    state = defaultState();
}

// TODO: rename to `globalState`
export let state = defaultState();


let db: IDBDatabase | undefined;

// TODO: (low priority) - Promisify and asincify this callback spam.
// But honestly, even thoguh it looks bad, it works. The wrapper design might require some thought. 
export function loadState(then: () => void) {
    // This app will have looked a lot different if I hadn't used localStorage as the storage API, and started with indexedDB.

    logTrace("Opening DB...");
    const request = window.indexedDB.open(INDEXED_DB_KV_STORE_NAME, 1);
    request.onerror = (e) => {
        loadStateFromLocalStorage();
        console.error("Error requesting db - ", e, request.error);

        then();
    }

    request.onupgradeneeded = () => {
        logTrace("Migrating DB...");

        db = request.result;

        // Need to make the database.
        // It's just a KV store. 

        const kvStore = db.createObjectStore(INDEXED_DB_KV_STORE_NAME, { keyPath: "key" });
        kvStore.createIndex("value", "value", { unique: false });
    }

    request.onsuccess = ()  => {
        db = request.result;

        logTrace("Opened DB");

        assert(!!db, "DB should be defined here");
        const kvStore = db.transaction([INDEXED_DB_KV_STORE_NAME], "readonly")
            .objectStore(INDEXED_DB_KV_STORE_NAME);

        const txRequest = kvStore.get(KV_STORE_STATE_KEY);
        txRequest.onerror = (e) => {
            console.error("Error getting kv store - ", e, request.error);
            then();
        }

        txRequest.onsuccess = () => {
            logTrace("Checking IndexedDB...");
            const savedStateJSONWrapper: { key: string, value: string } | undefined = txRequest.result;
            if (!savedStateJSONWrapper) {
                logTrace("We don't have anything saved yet. We might have something in local storage though. If not, we'll just start with fresh state");

                // Let's just load the state from local storage in case it exists...
                loadStateFromLocalStorage();

                then();
                return;
            }

            logTrace("Loaded data from IndexedDB (and not localStorage)");
            setStateFromJSON(savedStateJSONWrapper.value);
            then();
        }
    };
}


export function saveState(state: State, then: (serialize: string) => void) {
    if (!db) {
        console.error("Tried to save the state before we even have our database!!!");
        return;
    }

    const nonCyclicState = recursiveShallowCopy(state);
    const serialized = JSON.stringify(nonCyclicState);

    const kvStoreTx = db.transaction([INDEXED_DB_KV_STORE_NAME], "readwrite");

    kvStoreTx.objectStore(INDEXED_DB_KV_STORE_NAME).put({
        key: KV_STORE_STATE_KEY,
        value: serialized,
    });

    // Do something when all the data is added to the database.
    kvStoreTx.oncomplete = () => {
        logTrace("Saved!");
        then(serialized);
    };

    kvStoreTx.onerror = (event) => {
        console.error("An error occured while trying to save: ", event, kvStoreTx.error);
    };
}

function loadStateFromLocalStorage(): boolean {
    const savedStateJSON = localStorage.getItem(LOCAL_STORAGE_KEY_LEGACY);
    if (savedStateJSON) {
        logTrace("Loaded legacy data from local storage");
        setStateFromJSON(savedStateJSON);
        return true;
    }

    logTrace("No saved data was found");
    return false;
}

export function getHigherLevelTask(state: State, note: TreeNote) {
    let higherLevelNote: TreeNote | undefined;

    tree.forEachParent(state.notes, note, (parent) => {
        if (getTodoNotePriority(parent.data) >= 2) {
            higherLevelNote = parent;
            return true;
        }
    });

    return higherLevelNote;
}

// I used to have tabs, but I literally never used then, so I've just removed those components.
// However, "Everything" is the name of my current note tree, so that is just what I've hardcoded here.
// The main benefit of having just a single tree (apart from simplicity and less code) is that
// You can track all your activities and see analytics for all of them in one place. 
// As it turns out, storing state in anything besides the global state object can result in bugs. so I've completely removed this now.
const LOCAL_STORAGE_KEY_LEGACY = "NoteTree.Everything";
const INDEXED_DB_KV_STORE_NAME = "NoteTreeKVStore";
const KV_STORE_STATE_KEY = "State";

export function getCurrentStateAsJSON() {
    const nonCyclicState = recursiveShallowCopy(state);
    const serialized = JSON.stringify(nonCyclicState);
    return serialized;
}

export function loadStateFromBackup(text: string) {
    const obj = JSON.parse(text);
    if (LOCAL_STORAGE_KEY_LEGACY in obj) {
        logTrace("Loading legacy backup format");
        return loadStateFromJSON(obj[LOCAL_STORAGE_KEY_LEGACY]);
    }

    // I expect there to be 1 more format if I ever start storing multiple keys in the kv store. But
    // I have already decided against this due to the much higher potential for bugs r.e partial saving
    logTrace("Loading backup format v2");
    return migrateState(obj as State);
}


export function tryForceIndexedDBCompaction() {
    // HACK:
    // https://github.com/localForage/localForage/issues/339#issuecomment-503879440
    // A user wrote:
    // > Chromium's implementation of IndexedDB will compact storage after a write of ~4Mb.
    // > https://stackoverflow.com/questions/15841828/why-does-empty-indexeddb-still-take-up-space
    // > I found this Chromium commit that says a compaction can be forced by deleting a database.
    // > https://codereview.chromium.org/100013003
    // > I wrote a small hack with Dexie.js to create and delete a database to force a compaction, but it doesn't work consistently. 
    // > It works well when there's a big difference between reported storage (the output of navigator.storage.estimate()), 
    //      and "desired" storage (the amount of storage you know you've written, excluding "tombstone records")

    // I have faced a similar issue with my own production data, where IndexedDB would grow to 15GB and then crash chrome whenever opening this app.
    // The 'total data' taken up by our state was only ~2mb. But each save increased our IndexedDB size by 1 mb.
    // In order to avoid this bug, we need to do some hacks to manually trigger a compaction in levelDB.
    //


    // NOTE: this is what I believe the hack is, as suggested by the user.
    // HOWEVER, THIS CODE CURRENTLY ISN't WORKING !!!!
    
    // logTrace("Forcing a compaction (or trying to, at least). Opening DB...");
    // const request = window.indexedDB.open(FORCE_COMPACTION_STORE_NAME, 1);
    // request.onerror = (e) => {
    //     console.error("Error requesting db for compaction - ", e, request.error);
    // }
    // request.onupgradeneeded = () => {
    //     logTrace("Creating temp store...");
    //
    //     const db = request.result;
    //     db.createObjectStore("tempStore", { keyPath: "k" });
    //
    //     logTrace("Created temp store");
    // }
    // request.onsuccess = () => {
    //     logTrace("Deleting temp store...");
    //     const db = request.result;
    //     db.close();
    //
    //     const request2 = indexedDB.deleteDatabase(FORCE_COMPACTION_STORE_NAME);
    //     request2.onsuccess = () => {
    //         logTrace("Deleted temp store!");
    //     }
    //     request2.onerror = (e) => {
    //         console.error("Error deleting db for compaction - ", e, request2.error);
    //     }
    //
    // }
}
