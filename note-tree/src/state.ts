import { assert } from "src/utils/assert";
import { formatDateTime } from "src/utils/datetime";
import * as itree from "src/utils/int-tree";
import { logTrace } from "src/utils/log";
import { serializeToJSON } from "src/utils/serialization-utils";
import { darkTheme, lightTheme, setAppTheme } from "./app-styling";
import { MappingGraph, MappingGraphView, newMappingGraph, newMappingGraphView } from "./app-views/graph-view";
import { asNoteTreeGlobalState } from "./schema";
import { arrayAt, filterInPlace } from "./utils/array-utils";
import { VERSION_NUMBER_MONOTONIC } from "./version-number";

// Used by webworker and normal code
export const CHECK_INTERVAL_MS = 1000 * 10;

export function setTheme(newTheme: AppTheme) {
    state.currentTheme = newTheme;

    if (newTheme === "Light") {
        setAppTheme(lightTheme);
    } else {
        setAppTheme(darkTheme);
    }
};


// TODO: remove dead state after rewrite

// NOTE: this is just the state for a single note tree.
// We can only edit 1 tree at a time, basically

export type NoteId = itree.TreeId;

export type TreeNote = itree.TreeNode<Note>;
export type TreeNoteTree = itree.TreeStore<Note>;

export type AppTheme = "Light" | "Dark";

// TODO: remove dead state after rewrite

// NOTE: This state is persisted and loaded+migrated between sessions.
// Do not rename or delete any fields not prefixed with _ without thinking it through.
// 'derived' fields that won't be serialized start with _
export type NoteTreeGlobalState = {
    // Schema major versions occur whenever state cannot be autmatically migrated by dropping, renaming, and adding keys.
    // undefined -> the schema we've had since almost the start
    // 2 ->         the tree is no longer backed by a Record<string, Node> tree, but by a Node[] tree that can be indexed directly like an array.
    // 3 ->         thought of a totally new way to track progress. ASSUMED_DONE is no longer a valid status. We'll need to replace this with DONE
    schemaMajorVersion: number | undefined;

    /** Tasks organised by problem -> subproblem -> subsubproblem etc., not necessarily in the order we work on them */
    notes: TreeNoteTree;
    /** See {@link notesMutated} */
    _notesMutationCounter: number; 
    // NOTE: kinda need to be references - some code will toggle between whenether we're using 
    _isEditingFocusedNote: boolean;

    currentNoteId: NoteId;
    currentTheme: AppTheme;

    // A stupid bug in chrome ~~~causes~~~ used to cause IndexedDB to be non-functional 
    // (at least with the way I'm using it as a drop-in replacement for localStorage.).
    // see usages of this variable for more details.
    // I've kept this in just in case it starts happening again.
    criticalSavingError: string | undefined;

    /** The sequence of tasks as we worked on them. Separate from the tree. One person can only work on one thing at a time */
    activities: Activity[];
    _activitiesMutationCounter: number;
    _activitiesLastTouchedIdx: number;

    // Want to keep this so that we can refresh the page mid-delete.
    textOnArrivalNoteId: NoteId;
    textOnArrival: string;

    settings: AppSettings;

    // A root mark allows us to cycle through the start of all incomplete threads of tasks 
    // recursively under a particular tree.
    rootMarks: (NoteId | null)[];
    _computedMarks: NoteId[][];

    mappingGraph: MappingGraph;
    mappingGraphView: MappingGraphView;

    _activitiesTraversalIdx: number;
    _jumpBackToId: NoteId;

    _criticalLoadingError: string;
    // If true, error modals will include additional info on where to report the error.
    // If false, the user can do something about it, and they don't have anything to report.
    _criticalLoadingErrorWasOurFault: boolean;
    
    _activitiesFromIdx: number;
    _activitiesToIdx: number;

    // notifications
    _showStatusText: boolean;
    _statusText: string;
    _statusTextColor: string;
};

// Increment this to signal to UI that the note tree state has changed
export function notesMutated(state: NoteTreeGlobalState) {
    // This is a good place to put a breakpoint
    state._notesMutationCounter++;
}

export type AppSettings = {
    nonEditingNotesOnOneLine: boolean;
    parentNotesOnOneLine: boolean;
    spacesInsteadOfTabs: boolean;
    tabStopSize: number;
};

export function newAppSettings() {
    return {
        nonEditingNotesOnOneLine: true,
        parentNotesOnOneLine: true,
        spacesInsteadOfTabs: true,
        tabStopSize: 4,
    };
}

export type Note = {
    id: NoteId;
    /** set this via {@link setNoteText} */
    text: string;

    // will be populated as soon as the note is created.
    // TODO: display this info somewhere
    openedAt: Date;

    lastSelectedChildIdx: number; // this is now an index into our child array saying which one we sleected last.

    editedAt: Date; // this is when the note or any of it's children was last edited.

    // non-serializable fields
    _status: NoteStatus; // used to track if a note is done or not.
    _depth: number; // used to visually indent the notes
    _durationUnranged: number;
    _durationUnrangedOpenSince?: Date; // used for recomputing realtime durations - only notes with this thing set would still be increasing in duration
    _durationRanged: number;
    // TODO: fivure out what this is and document it. I think it has something to do with computing the duration of the most recent note ?
    _durationRangedOpenSince?: Date;

    _tasksInProgress: number; // recursive in nature
    _treeVisualsGoDown: boolean;
    _treeVisualsGoRight: boolean;
};


// Since we may have a lot of these, I am somewhat compressing this thing so the JSON will be smaller.
// Yeah it isn't the best practice, but it works
export type Activity = {
    // if it's not undefined, guaranteed to be valid
    nId: NoteId | undefined;
    // Time this note was created
    t: Date;

    // Are we creating a brand new note? 1 if true
    c: number | undefined;
    // only apply to breaks:
    breakInfo: string | undefined;

    locked: true | undefined;
    deleted: true | undefined;
};

// bro uses git? no way dude.
const doneSuffixes = [ "DONE", "MERGED", "DECLINED" ];

export const DONE_SUFFIX = " DONE";

function getDoneNotePrefixOrSuffix(note: Note): string | undefined {
    for (let i = 0; i < doneSuffixes.length; i++) {
        const suffix = doneSuffixes[i];
        if (note.text.trimEnd().endsWith(suffix) || note.text.trimStart().startsWith(suffix)) {
            return suffix;
        }
    }

    return undefined;
}

function isNoteShelved(note: Note): boolean {
    return note.text.trimEnd().endsWith("SHELVED") || 
           note.text.trimStart().startsWith("SHELVED");
}

export function getNoteTextWithoutPriority(note: Note): string {
    const priority = getTodoNotePriority(note);
    let idx = priority;
    return note.text.substring(idx).trim();
}

export function getNoteTextTruncated(note: Note): string {
    return truncate(getNoteTextWithoutPriority(note), 50);
}

function truncate(str: string, len: number): string {
    if (str.length > len) {
        return str.substring(0, len - 3) + "...";
    }

    return str;
}

export function isHigherLevelTask(note: TreeNote): boolean {
    return getTodoNotePriority(note.data) >= 2;
}

export function getTodoNotePriority(note: Note): number {
    // Keep the priority system simple. 
    // Tasks are are always changing priority, and having too many priorities means they will always be assigned the wrong priority.
    // The task priorities/importances should all be in your head. This program should just help you remember which things you're working
    // on now, and which things you want to get to in the future, and you shouldn't be spending all your time ordering the tasks.

    let priority = 0;

    let text = note.text.trimStart();
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== '>') break;
        priority++;
    }

    return priority;
}

type  NoteStatusInstance = number & { __noteStatus: void; };

export const STATUS_NOT_COMPUTED = 0 as NoteStatusInstance;

/** 
 * This is a task that is currently in progress.
 */
export const STATUS_IN_PROGRESS = 1 as NoteStatusInstance;
/**
 * This is a task that you haven't marked as DONE, but we are assuming it is done,
 * because you've moved on to the next task.
 * This status exists, so that you dont have to manually close off every single tas with a new - Done note under it.
 * @deprecated - all tasks must now explicitly be marked as DONE. 
 */
export const STATUS_ASSUMED_DONE = 2 as NoteStatusInstance;
/**
 * This is a task that is marked as DONE at the end.
 * Marking a note as DONE marks all notes before it as DONE, i.e no longer assumed done, but actually done.
 * Only these tasks may be moved out of a note.
 * This ensures that even in the 'done' tree, all notes are calculated as done.
 */
export const STATUS_DONE = 3 as NoteStatusInstance;
/**
 * This status will shelve a parent note, and ALL it's children recursively. 
 * Knowing when to stop working on something is just as important as knowing what you're working on.
 * This status arose from a usecase where I was doing DONE, DONE, DONE, over and over again for all loose ends under a 
 * higher level task.
 */
export const STATUS_SHELVED = 4 as NoteStatusInstance;
/**
 * This note is not a task that needs completion. It contains information that we will
 * refer to later.
 */
export const STATUS_INFO = 5 as NoteStatusInstance;


export function isStatusInProgressOrInfo(note: TreeNote) {
    return note.data._status === STATUS_IN_PROGRESS || note.data._status === STATUS_INFO;
}


export type NoteStatus = 
    typeof STATUS_NOT_COMPUTED |
    typeof STATUS_IN_PROGRESS |
    typeof STATUS_ASSUMED_DONE |
    typeof STATUS_DONE |
    typeof STATUS_SHELVED;


export function noteStatusToString(note: TreeNote) {
    switch (note.data._status) {
        case STATUS_IN_PROGRESS: {
            if (note.childIds.length === 0) return "[ ]";
            return ""; // can just let the the (<done>/<total>) number thing take over 
        }
        case STATUS_ASSUMED_DONE: return "[*]";
        case STATUS_DONE:         return "[x]";
        case STATUS_SHELVED:      return "[-]";
        case STATUS_INFO:         return "(i)";
    }

    return "??";
}


// NOTE: all state needs to be JSON-serializable.
// NO Dates/non-plain objects
// No non-owning references, i.e a reference to a node that really lives in another array
// Typically if state will contain references, non-serializable objects, or are in some way computed from other canonical state,
// it is prepended with '_', which will cause it to be stripped before it gets serialized.
export function newNoteTreeGlobalState(): NoteTreeGlobalState {
    const rootNote = defaultNote();
    rootNote.text = "This root node should not be visible. If it is, you've encountered a bug!";

    const notes = itree.newTreeStore<Note>(rootNote);

    const state: NoteTreeGlobalState = {
        // Only increment this for massive changes! Otherwise, try to keep migrations bacwards compatible
        schemaMajorVersion: 3,

        notes,
        _notesMutationCounter: 0,

        currentNoteId: itree.NIL_ID,
        activities: [],
        _activitiesMutationCounter: 0,
        _activitiesLastTouchedIdx: 0,

        settings: newAppSettings(),

        rootMarks: [],
        _computedMarks: [],

        mappingGraph: newMappingGraph(),
        mappingGraphView: newMappingGraphView(),

        currentTheme: "Light",
        criticalSavingError: "",

        textOnArrival: "",
        textOnArrivalNoteId: itree.NIL_ID,

        _isEditingFocusedNote: false, // global flag to control if we're editing a note

        _activitiesTraversalIdx: -1,

        _jumpBackToId: itree.NIL_ID,

        // don't set this if our tree is corrupted!
        _criticalLoadingError: "",
        _criticalLoadingErrorWasOurFault: false,

        _activitiesFromIdx: -1,
        _activitiesToIdx: -1,


        _showStatusText: false,
        _statusText: "",
        _statusTextColor: "",
    };

    return state;
}

export type LoadStateFromJSONResult = {
    state?: NoteTreeGlobalState;
    error?: string;
    criticalError?: string;
}

export function loadStateFromJSON(savedStateJSON: string): LoadStateFromJSONResult {
    if (!savedStateJSON) {
        return { error: "JSON was empty" };
    }

    try {
        let jsonObj: unknown = JSON.parse(savedStateJSON);

        const loadedState = asNoteTreeGlobalState(jsonObj);

        return { state: loadedState };
    } catch (err: any) {
        return { criticalError: err.message }
    }
}


export function setStateFromJSON(savedStateJSON: string | Blob, then?: (error: string) => void) {
    if (typeof savedStateJSON !== "string") {
        logTrace("Got a blob, converting to string before using...");

        savedStateJSON.text()
            .then(text => setStateFromJSON(text, then))
            .catch(err => console.error("Error with parsing json blob: ", err));

        return;
    }

    logTrace("Setting state from JSON string");

    state._criticalLoadingError = "";

    const loaded = loadStateFromJSON(savedStateJSON);

    if (loaded.criticalError) {
        console.error(loaded.criticalError);
        logTrace("Loading a new state would be a mistake right about now");
        state._criticalLoadingError = loaded.criticalError;
        state._criticalLoadingErrorWasOurFault = true;
    } else if (loaded.error) {
        logTrace("Couldn't load state - " + loaded.error);
        setState(newNoteTreeGlobalState());
    } else if (loaded.state) {
        setState(loaded.state);
    }

    // NOTE: even the error paths should call `then`
    then?.(loaded.criticalError || loaded.error || "Unknown error occured");
}

export function setState(newState: NoteTreeGlobalState) {
    state = newState;
}

export function getLastActivity(state: NoteTreeGlobalState): Activity | undefined {
    return state.activities[state.activities.length - 1];
}

export function getLastActivityWithNote(state: NoteTreeGlobalState): Activity | undefined {
    const idx = getLastActivityWithNoteIdx(state);
    if (idx === -1) return undefined;
    return state.activities[idx];
}

export function getFirstActivityWithNote(state: NoteTreeGlobalState): Activity | undefined {
    const idx = getFirstActivityWithNoteIdx(state);
    if (idx === -1) return undefined;
    return state.activities[idx];
}

export function getLastActivityWithNoteIdx(state: NoteTreeGlobalState): number {
    for (let i = state.activities.length - 1; i >= 0; i--) {
        if (state.activities[i].nId) return i;
    }
    return -1;
}

export function getFirstActivityWithNoteIdx(state: NoteTreeGlobalState): number {
    for (let i = 0; i < state.activities.length; i++) {
        if (state.activities[i].nId) return i;
    }
    return -1;
}

export function getLastActivityForNoteIdx(state: NoteTreeGlobalState, id: NoteId): number {
    for (let i = state.activities.length - 1; i >= 0; i--) {
        if (state.activities[i].nId === id) return i;
    }
    return -1;
}

export function defaultNote(): Note {
    return {
        // the following is valuable user data
        id: itree.NIL_ID,
        text: "",
        openedAt: new Date(),
        editedAt: new Date(),
        lastSelectedChildIdx: 0,

        // the following are just visual flags which are frequently recomputed

        _status: STATUS_NOT_COMPUTED,
        _depth: 0,
        _durationUnranged: 0,
        _durationRanged: 0,
        _tasksInProgress: 0,
        _treeVisualsGoDown: false,
        _treeVisualsGoRight: false,
    };
}

export function getActivityDate(activity: Activity | undefined) {
    if (!activity) {
        return new Date();
    }

    return new Date(activity.t);
}

export function setNoteText(
    state: NoteTreeGlobalState,
    note: TreeNote,
    text: string
) {
    const priority = getTodoNotePriority(note.data);
    note.data.text = text;
    const invalidate = getTodoNotePriority(note.data) !== priority;
    recomputeNoteStatusRecursively(state, note, true, true, invalidate);
    notesMutated(state);

    let current = note;
    const now = new Date();
    while (!idIsNilOrRoot(current.id)) {
        current.data.editedAt = new Date(now);
        current = getNote(state.notes, current.parentId)
    }
}

// Incrementally recompute status of notes in the tree. Rules:
// - Only the very last note under another note can be considered STATUS_IN_PROGRESS, if it has no children. All notes before this are STATUS_ASSUMED_DONE.
//      - If the last note has children, it can't be in progress. in fact, no other note can be in progress either.
// - If a note has no children, and ends with a 'done suffix', then that note, and every other note on that level before it without children can
//      be  marked as STATUS_DONE. No longer an assumption.
// - A note with children is only done when all of it's children have a DONE status.
/** @deprecated We don't do it like this anymore. */
export function recomputeNoteStatusRecursivelyLegacyComputation(
    state: NoteTreeGlobalState,
    note: TreeNote,
    recomputeParents = true,
    recomputeChildren = true
) {
    function shelveNotesRecursively(state: NoteTreeGlobalState, note: TreeNote) {
        note.data._status = STATUS_SHELVED;
        for (let i = 0; i < note.childIds.length; i++) {
            const child = getNote(state.notes, note.childIds[i]);
            shelveNotesRecursively(state, child);
        }
    }


    /** --------------------- Deprecated ----------------------- */
    if (note.childIds.length === 0) {
        recomputeParents = true;
    } else if (note.childIds.length > 0) {
    /** --------------------- Deprecated ----------------------- */
        let status = STATUS_IN_PROGRESS;

        // if the last note in the list is DONE, then we can default to DONE instead. 
        // Same for SHELVED.
    /** --------------------- Deprecated ----------------------- */
        {
            const lastId = note.childIds[note.childIds.length - 1];
            const lastNote = getNote(state.notes, lastId);

    /** --------------------- Deprecated ----------------------- */
            if (getDoneNotePrefixOrSuffix(lastNote.data)) {
                status = STATUS_DONE;
    /** --------------------- Deprecated ----------------------- */
            } else if (isNoteShelved(lastNote.data)) {
                status = STATUS_SHELVED;
            }
        }

    /** --------------------- Deprecated ----------------------- */
        let foundDoneNoteUnderThisParent = false;
        let foundShelvedNoteUnderThisParent = false;
        for (let i = note.childIds.length - 1; i >= 0; i--) {
            const id = note.childIds[i];
            const child = getNote(state.notes, id);
    /** --------------------- Deprecated ----------------------- */

            if (child.childIds.length > 0) {
                if (foundShelvedNoteUnderThisParent) {
                    shelveNotesRecursively(state, child);
                } else if (child.data._status === STATUS_NOT_COMPUTED) {
    /** --------------------- Deprecated ----------------------- */
                    recomputeNoteStatusRecursivelyLegacyComputation(state, child, false, true);
                    assert(child.data._status !== STATUS_NOT_COMPUTED);
                }
    /** --------------------- Deprecated ----------------------- */
            } else {
                if (getDoneNotePrefixOrSuffix(child.data) || foundDoneNoteUnderThisParent) {
                    child.data._status = STATUS_DONE;
    /** --------------------- Deprecated ----------------------- */
                    foundDoneNoteUnderThisParent = true;
                } else if (isNoteShelved(child.data) || foundShelvedNoteUnderThisParent) {
                    foundShelvedNoteUnderThisParent = true;
    /** --------------------- Deprecated ----------------------- */
                    recomputeChildren = false;
                    child.data._status = STATUS_SHELVED;
                } else if (i === note.childIds.length - 1) {
                    child.data._status = STATUS_IN_PROGRESS;
                } else {
                    if (getTodoNotePriority(child.data) === 0) {
                        child.data._status = STATUS_ASSUMED_DONE;
                    } else {
    /** --------------------- Deprecated ----------------------- */
                        child.data._status = STATUS_IN_PROGRESS;
                    }
                }
            }

            if (
    /** --------------------- Deprecated ----------------------- */
                child.data._status !== STATUS_DONE &&
                child.data._status !== STATUS_SHELVED
            ) {
                status = STATUS_IN_PROGRESS;
            }
    /** --------------------- Deprecated ----------------------- */
        }

        const previousStatus = note.data._status;
        const noteStatusChanged = previousStatus !== status;
    /** --------------------- Deprecated ----------------------- */
        if (noteStatusChanged) {
            note.data._status = status;

            // if it isn't computed, we're already computing the parents.
            if (previousStatus !== STATUS_NOT_COMPUTED) {
    /** --------------------- Deprecated ----------------------- */
                recomputeParents = true;
            }

    /** --------------------- Deprecated ----------------------- */
            if (previousStatus === STATUS_SHELVED) {
                // Need to recompute all the children recursively, now that this note is no longer shelved.
                clearNoteStatusRecursively(state, note);
                recomputeNoteStatusRecursivelyLegacyComputation(state, note, false, true);
    /** --------------------- Deprecated ----------------------- */
            }
        }
    }

    /** --------------------- Deprecated ----------------------- */
    if (recomputeParents) {
        if (!idIsNil(note.parentId)) {
            const parent = getNote(state.notes, note.parentId);
    /** --------------------- Deprecated ----------------------- */
            recomputeNoteStatusRecursivelyLegacyComputation(state, parent, true, false);
        }
    /** --------------------- Deprecated ----------------------- */
    }
}

export function recomputeNoteStatusRecursively(
    state: NoteTreeGlobalState,
    note: TreeNote,
    recomputeParents = true,
    recomputeChildren = true,
    invalidateOtherStuff = false,
): boolean {
    invalidateOtherStuff = recomputeNoteStatusRecursivelyInternal(
        state,
        note,
        recomputeParents,
        recomputeChildren,
    ) || invalidateOtherStuff;

    if (invalidateOtherStuff) {
        recomputeNumTasksInProgressRecursively(state);
        recomputeMarkNavigation(state);
    };

    return invalidateOtherStuff;
}

export function recomputeMarkNavigation(state: NoteTreeGlobalState) {
    if (state.rootMarks.length !== 10) {
        state.rootMarks.length = 10;
        state.rootMarks.fill(null);
    }

    const dfs = (note: TreeNote, marks: NoteId[]) => {
        if (note.childIds.length === 0) return;
        if (note.data._status !== STATUS_IN_PROGRESS) return;

        let isFirstInProgress = true;
        for (const id of note.childIds) {
            const child = getNote(state.notes, id);
            if (child.data._status === STATUS_IN_PROGRESS) {
                if (child.childIds.length === 0) {
                    if (isFirstInProgress) {
                        isFirstInProgress = false;
                        marks.push(child.id);
                    }
                }
            }

            dfs(child, marks);
        }
    };

    for (let i = 0; i < state.rootMarks.length; i++) {
        state._computedMarks[i] = [];

        const mark = state.rootMarks[i];
        if (!mark) continue;

        const note = getNote(state.notes, mark);
        dfs(note, state._computedMarks[i]);
    }
}

export function recomputeNoteStatusRecursivelyInternal(
    state: NoteTreeGlobalState,
    note: TreeNote,
    recomputeParents = true,
    recomputeChildren = true
): boolean {
    let didSomething = false;

    if (note.childIds.length === 0) {
        recomputeParents = true;
    } else if (note.childIds.length > 0) {
        const lastNoteId = note.childIds[note.childIds.length - 1];
        const lastNote = getNote(state.notes, lastNoteId);

        const lastNoteWasShelved = isNoteShelved(lastNote.data);

        let foundInProgressNoteUnderThisParent = false;
        let foundShelvedNoteUnderThisParent = lastNoteWasShelved;
        for (let i = note.childIds.length - 1; i >= 0; i--) {
            const id = note.childIds[i];
            const child = getNote(state.notes, id);

            if (child.childIds.length > 0) {
                if (foundShelvedNoteUnderThisParent) {
                    didSomething = shelveNotesRecursively(state, child) || didSomething;
                } else if (child.data._status === STATUS_NOT_COMPUTED) {
                    didSomething = recomputeNoteStatusRecursivelyInternal(state, child, false, true) || didSomething;
                    assert(child.data._status !== STATUS_NOT_COMPUTED);
                }
            } else {
                if (getDoneNotePrefixOrSuffix(child.data)) {
                    didSomething = setNoteStatus(child, STATUS_DONE) || didSomething;
                } else if (isNoteShelved(child.data) || foundShelvedNoteUnderThisParent) {
                    foundShelvedNoteUnderThisParent = true;
                    recomputeChildren = false;

                    didSomething = setNoteStatus(child, STATUS_SHELVED) || didSomething;
                } else if (getTodoNotePriority(child.data) === 1) {
                    didSomething = setNoteStatus(child, STATUS_INFO) || didSomething;
                } else {
                    didSomething = setNoteStatus(child, STATUS_IN_PROGRESS) || didSomething;
                }
            }

            if (child.data._status === STATUS_SHELVED) {
                foundShelvedNoteUnderThisParent = true;
            } else if (child.data._status === STATUS_IN_PROGRESS) {
                foundInProgressNoteUnderThisParent = true;
            }
        }

        // Sort children - done notes should be moved back, in-progress notes should be moved forwards.
        note.childIds.sort((aId, bId) => {
            const a = getNote(state.notes, aId);
            const b = getNote(state.notes, bId);
            return getNoteSortPriority(a) - getNoteSortPriority(b);
        });
        if (itree.reindexChildren(state.notes, note, 0)) {
            notesMutated(state);
            didSomething = true;
        }

        const previousStatus = note.data._status;
        if (foundInProgressNoteUnderThisParent) {
            didSomething = setNoteStatus(note, STATUS_IN_PROGRESS) || didSomething;
        } else if (lastNoteWasShelved) {
            didSomething = setNoteStatus(note, STATUS_SHELVED) || didSomething;
        } else {
            didSomething = setNoteStatus(note, STATUS_DONE) || didSomething;
        }

        const noteStatusChanged = previousStatus !== note.data._status;
        if (noteStatusChanged) {
            didSomething = true;

            // if it isn't computed, we're already computing the parents.
            if (previousStatus !== STATUS_NOT_COMPUTED) {
                recomputeParents = true;
            }

            if (previousStatus === STATUS_SHELVED) {
                // Need to recompute all the children recursively, now that this note is no longer shelved.
                clearNoteStatusRecursively(state, note);
                recomputeNoteStatusRecursivelyInternal(state, note, false, true);
            }
        }
    }

    if (recomputeParents) {
        if (!idIsNil(note.parentId)) {
            const parent = getNote(state.notes, note.parentId);
            didSomething = recomputeNoteStatusRecursivelyInternal(state, parent, true, false) || didSomething;
        }
    }

    return didSomething;
}

function getNoteSortPriority(a: TreeNote): number {
    if (!isStatusInProgressOrInfo(a)) {
        return PRIORITY_NOT_IN_PROGRSS;
    }

    if (a.childIds.length > 0) {
        return PRIORITY_CONTAINER_IN_PROGRESS;
    }

    return PRIORITY_LEAF_IN_PROGRESS;
}

const PRIORITY_NOT_IN_PROGRSS = 0;
const PRIORITY_CONTAINER_IN_PROGRESS = 1;
const PRIORITY_LEAF_IN_PROGRESS = 2;

// NOTE: also recomputes tree visuals
export function recomputeNumTasksInProgressRecursively(state: NoteTreeGlobalState) {
    itree.forEachNode(state.notes, note => {
        note.data._tasksInProgress = 0;
        note.data._treeVisualsGoDown = false;
        note.data._treeVisualsGoRight = false;
    });

    itree.forEachNode(state.notes, note => {
        if (note.childIds.length > 0) return;
        if (getTodoNotePriority(note.data) > 0) return;
        if (note.data._status !== STATUS_IN_PROGRESS) return;

        const parent = getNote(state.notes, note.parentId);
        const prevSib = getNoteOrUndefined(state.notes, arrayAt(parent.childIds, note.idxInParentList - 1));
        if (prevSib && getNoteSortPriority(prevSib) === PRIORITY_LEAF_IN_PROGRESS) return;

        note.data._treeVisualsGoRight = true;
        forEachParentNote(state.notes, note, note => {
            const parent = getNote(state.notes, note.parentId);

            const idx = note.idxInParentList;
            for (let i = idx - 1; i >= 0; i--) {
                const sib = getNote(state.notes, parent.childIds[i]);
                if (sib.data._treeVisualsGoDown) {
                    // already been here before
                    break;
                }
                sib.data._treeVisualsGoDown = true;
            }

            note.data._tasksInProgress++
            parent.data._treeVisualsGoRight = true;
        });
    });
}

function shelveNotesRecursively(state: NoteTreeGlobalState, note: TreeNote): boolean {
    let didSomething = false;

    didSomething = setNoteStatus(note, STATUS_SHELVED);
    for (let i = 0; i < note.childIds.length; i++) {
        const child = getNote(state.notes, note.childIds[i]);
        didSomething = shelveNotesRecursively(state, child) || didSomething;
    }

    return didSomething;
}

function setNoteStatus(note: TreeNote, status: NoteStatusInstance): boolean {
    if (note.data._status === status) return false;
    note.data._status = status;
    return true;
}

function clearNoteStatusRecursively(state: NoteTreeGlobalState, note: TreeNote) {
    note.data._status = STATUS_NOT_COMPUTED;
    for (let i = 0; i < note.childIds.length; i++) {
        const child = getNote(state.notes, note.childIds[i]);
        clearNoteStatusRecursively(state, child);
    }
}

export function recomputeAllNoteDurations(
    state: NoteTreeGlobalState,
    activitiesFrom: Date | null,
    activitiesTo: Date | null
) {
    state._activitiesToIdx = -1;
    state._activitiesFromIdx = -1;

    itree.forEachNode(state.notes, (note) => {
        note.data._durationUnranged = 0;
        note.data._durationUnrangedOpenSince = undefined;
        note.data._durationRanged = 0;
        note.data._durationRangedOpenSince = undefined;
    });

    const activities = state.activities;
    for (let i = 0; i < activities.length; i++) {
        // Activities can be old, and might point to invalid notes. Or they can be breaks, and not refer to any note
        const a0 = activities[i];
        const note = getNoteOrUndefined(state.notes, a0.nId);
        if (!note) {
            continue;
        }

        const a1 = activities[i + 1] as Activity | undefined;
        const duration = getActivityDurationMs(a0, a1);

        const isCurrentActivity = !a1;

        {
            let parentNote = note;
            while (!idIsNil(parentNote.parentId)) {
                if (!isCurrentActivity) {
                    parentNote.data._durationUnranged += duration;
                } else {
                    parentNote.data._durationUnrangedOpenSince = getActivityDate(a0);
                }

                parentNote = getNote(state.notes, parentNote.parentId);
            }
        }

        // TODO: update this to work for activities with start/end times that overlap into the current range
        if (
            (!activitiesFrom || activitiesFrom <= getActivityDate(a0)) && 
            (!activitiesTo || getActivityDate(a1) <= activitiesTo)
        ) {
            if (state._activitiesFromIdx === -1) {
                state._activitiesFromIdx = i;
            }
            state._activitiesToIdx = i;

            {
                let parentNote = note;
                while (!idIsNil(parentNote.parentId)) {
                    if (!isCurrentActivity) {
                        parentNote.data._durationRanged += duration;
                    } else {
                        parentNote.data._durationRangedOpenSince = getActivityDate(a0);
                    }

                    parentNote = getNote(state.notes, parentNote.parentId);
                }
            }
        }
    }
}

export function parentNoteContains(state: NoteTreeGlobalState, parentId: NoteId, note: TreeNote): boolean {
    // one of the parents is the current note
    while (!idIsNil(note.parentId)) {
        if (note.id === parentId) {
            return true;
        }
        note = getNote(state.notes, note.parentId);
    }

    return false;
}

export const NOT_COLLAPSED    = 0;
export const COLLAPSED_HLT    = 1;
export const COLLAPSED_ROOT   = 2;
export const COLLAPSED_STATUS = 3;

export type CollapsedStatus
    = typeof NOT_COLLAPSED
    | typeof COLLAPSED_HLT
    | typeof COLLAPSED_ROOT
    | typeof COLLAPSED_STATUS;

// When we have a particular note selected, and our view is rooted somewhere, can we see this note?
export function isNoteCollapsed(note: TreeNote): CollapsedStatus {
    if (isHigherLevelTask(note))                  return COLLAPSED_HLT;
    if (idIsNilOrRoot(note.id))                   return COLLAPSED_ROOT;
    if (note.data._status !== STATUS_IN_PROGRESS) return COLLAPSED_STATUS;
    return NOT_COLLAPSED;
}

export function getActivityTextOrUndefined(state: NoteTreeGlobalState, activity: Activity): string | undefined {
    if (activity.nId === 0) {
        return "< deleted root note >";
    }

    if (activity.nId) {
        const text = getNote(state.notes, activity.nId).data.text;
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

export function getActivityText(state: NoteTreeGlobalState, activity: Activity): string {
    return getActivityTextOrUndefined(state, activity) || "< unknown activity text! >";
}

export function getActivityDurationMs(activity: Activity, nextActivity: Activity | undefined): number {
    const startTimeMs = getActivityDate(activity).getTime();
    const nextStart = (nextActivity ? getActivityDate(nextActivity) : new Date()).getTime();
    return nextStart - startTimeMs;
}


export function createNewNote(state: NoteTreeGlobalState, text: string): TreeNote {
    const note = defaultNote();
    note.text = text;

    const newTreeNode = itree.newTreeNode(note);
    itree.addAsRoot(state.notes, newTreeNode);
    note.id = newTreeNode.id;

    pushNoteActivity(state, newTreeNode.id, true);

    return newTreeNode;
}


export function activityNoteIdMatchesLastActivity(state: NoteTreeGlobalState, activity: Activity): boolean {
    const lastActivity = getLastActivity(state);
    if (!lastActivity) {
        return false;
    }

    if (isBreak(lastActivity)) {
        return lastActivity.breakInfo === activity.breakInfo;
    }

    return lastActivity.nId === activity.nId;
}

function canActivityBeReplacedWithNewActivity(state: NoteTreeGlobalState, lastActivity: Activity): boolean {
    const ONE_SECOND = 1000;
    const activityDurationMs = getActivityDurationMs(lastActivity, undefined);

    if (
        lastActivity.nId &&
        lastActivity.c === 1 &&
        !lastActivity.deleted
    ) {
        // Can't replace activity for a newly created note
        return false;
    }

    const IRREPLACEABLE_ACTIVITY_DURATION = 60 * ONE_SECOND;
    return activityDurationMs < IRREPLACEABLE_ACTIVITY_DURATION;
}

function pushActivity(state: NoteTreeGlobalState, activity: Activity) {
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
    state._activitiesMutationCounter++;
    state._activitiesLastTouchedIdx = state.activities.length - 1;
}

export function isNoteEmpty(note: TreeNote): boolean {
    return note.data.text.length === 0;
}

export function deleteNoteIfEmpty(state: NoteTreeGlobalState, note: TreeNote): boolean {
    if (!isNoteEmpty(note)) {
        return false;
    }

    // TODO: delete when we've figured out this bug where
    // our tree corrupts itself after some arbitrary time :D
    logTrace("Deleting empty note: ID - " + note.id);

    if (note.childIds.length > 0) {
        if (state.textOnArrivalNoteId === note.id && state.textOnArrival) {
            // We can actually restore the text something more sane than the legacy behaviour
            note.data.text = state.textOnArrival;
            state.textOnArrival = "";
            state.textOnArrivalNoteId = itree.NIL_ID;
        } else {
            // Fallback to legacy behaviour
            note.data.text = "Some note we cant delete because of the x" + note.childIds.length + " notes under it :(";
        }

        state._showStatusText = true;
        state._statusText = "Can't delete notes with children!";
        state._statusTextColor = "#F00";

        notesMutated(state);
        return true;
    }

    if (idIsNil(note.parentId)) {
        return false;
    }

    if (itree.getSizeExcludingRoot(state.notes) <= 1) {
        // don't delete our only note! (other than the root note)
        return false
    }

    const nId = note.id;
    const parentId = note.parentId;

    // delete from the ids list, as well as the note database
    itree.remove(state.notes, note);

    // NOTE: activities should not be deleted from the activities list. they are required, if we want to keep duration info accurate. 
    for (let i = 0; i < state.activities.length; i++) {
        const activity = state.activities[i];
        if (activity.nId === nId) {
            activity.nId = parentId;
            activity.deleted = true;
        }
    }

    while (state.activities.length > 0 && state.activities[state.activities.length - 1].deleted) {
        state.activities.pop();
    }

    filterInPlace(state.rootMarks, m => m !== nId);
    state._computedMarks.forEach(cm =>
        filterInPlace(cm, m => m !== nId)
    );

    notesMutated(state);
    return true;
}

export function insertNoteAfterCurrent(state: NoteTreeGlobalState) {
    const currentNote = getCurrentNote(state);
    if (idIsNil(currentNote.parentId)) throw new Error("Cant insert after the root note");
    if (!currentNote.data.text.trim()) {
        // REQ: don't insert new notes while we're editing blank notes
        return false;
    }

    const newNote = createNewNote(state, "");
    itree.addAfter(state.notes, currentNote, newNote)
    setCurrentNote(state, newNote.id);
    setIsEditingCurrentNote(state, true);
    return true;
}

export function insertChildNote(state: NoteTreeGlobalState): TreeNote | null {
    const currentNote = getCurrentNote(state);
    if (idIsNil(currentNote.parentId)) throw new Error("Cant insert under the root note");
    if (!currentNote.data.text.trim()) {
        // REQ: don't insert new notes while we're editing blank notes
        return null;
    }

    const newNote = createNewNote(state, "");
    itree.addUnder(state.notes, currentNote, newNote);
    setCurrentNote(state, newNote.id);
    setIsEditingCurrentNote(state, true);
    return newNote;
}

export function hasNote(tree: TreeNoteTree, id: NoteId): boolean {
    return itree.hasNode(tree, id);
}

export function getNote(tree: TreeNoteTree, id: NoteId): TreeNote {
    return itree.getNode(tree, id);
}

export function idIsNilOrUndefined(id: NoteId | null | undefined): id is typeof itree.NIL_ID | null | undefined {
    return id === -1 || id === null || id === undefined;
}

/** 
 * mainly used in parent traversals when we do want to start on the current note. 
 */
export function idIsNil(id: NoteId): boolean {
    return id === itree.NIL_ID;
}

/** 
 * mainly used in parent traversals when we don't want to start on the current note.
 */
export function idIsNilOrRoot(id: NoteId): boolean {
    return id === itree.NIL_ID || id === itree.ROOT_ID;
}

export function idIsRoot(id: NoteId): boolean {
    return id === itree.ROOT_ID;
}

export function getNoteOrUndefined(tree: TreeNoteTree, id: NoteId | null | undefined): TreeNote | undefined {
    if (!idIsNilOrUndefined(id) && hasNote(tree, id)) {
        return getNote(tree, id);
    }

    return undefined;
}

// Guaranteed to get a note - this function will actually make a new note if we don't have any notes.
export function getCurrentNote(state: NoteTreeGlobalState) {
    if (!hasNote(state.notes, state.currentNoteId)) {
        // set currentNoteId to the last root note if it hasn't yet been set

        const rootChildIds = getRootNote(state).childIds;
        if (rootChildIds.length === 0) {
            // create the first note if we have no notes
            const newNote = createNewNote(state, "First Note");
            itree.addUnder(state.notes, getRootNote(state), newNote);
        }

        // not using setCurrentNote, because it calls getCurrentNote 
        state.currentNoteId = rootChildIds[rootChildIds.length - 1];
    }

    return getNote(state.notes, state.currentNoteId);
}

export function pushNoteActivity(state: NoteTreeGlobalState, noteId: NoteId, isNewNote: boolean) {
    const activity = defaultActivity(new Date());
    activity.nId = noteId;
    activity.c = isNewNote ? 1 : undefined;
    pushActivity(state, activity);
}

export function defaultActivity(t: Date): Activity {
    return {
        // at least one of these must be defined:
        t,
        nId: undefined,
        breakInfo: undefined,
        c: undefined,
        locked: undefined,
        deleted: undefined,
    };
}

export function newBreakActivity(breakInfoText: string, time: Date, locked: boolean): Activity {
    const activity = defaultActivity(time);
    activity.breakInfo = breakInfoText;
    activity.locked = locked || undefined;
    return activity;
}

export const DONT_INTERRUPT = 1;

export function pushBreakActivity(state: NoteTreeGlobalState, breakActivtiy: Activity, flags = 0) {
    if (breakActivtiy.nId || !breakActivtiy.breakInfo) {
        throw new Error("Invalid break activity");
    }

    pushActivity(state, breakActivtiy);

    if (!(flags & DONT_INTERRUPT)) {
        if (state._isEditingFocusedNote) {
            setIsEditingCurrentNote(state, false);
        }
    }
}

export function isCurrentlyTakingABreak(state: NoteTreeGlobalState): boolean {
    const last = getLastActivity(state);
    return !!last && isBreak(last);
}

export function forEachParentNote(tree: TreeNoteTree, start: TreeNote, it: (note: TreeNote) => void) {
    let current = start;
    while (!idIsNilOrRoot(current.id)) {
        it(current);
        current = getNote(tree, current.parentId);
    }
}

export function forEachChildNote(state: NoteTreeGlobalState, note: TreeNote, it: (note: TreeNote) => void) {
    for (let i = 0; i < note.childIds.length; i++) {
        const id = note.childIds[i];
        const child = getNote(state.notes, id);
        it(child);
    }
}

export function setCurrentNote(
    state: NoteTreeGlobalState,
    noteId: NoteId | null,
    noteIdJumpedFrom?: NoteId | undefined
) {
    if (!noteId) {
        return;
    }

    const note = getNoteOrUndefined(state.notes, noteId);
    if (!note || note === getRootNote(state)) {
        return false;
    }

    const currentNoteBeforeMove = getCurrentNote(state);
    if (currentNoteBeforeMove.id === note.id) {
        return;
    }

    if (!itree.hasNode(state.notes, note.id)) {
        return;
    }

    if (noteIdJumpedFrom) {
        state._jumpBackToId = noteIdJumpedFrom;
    }

    setNoteAsLastSelected(state, note);

    state.currentNoteId = note.id;
    setIsEditingCurrentNote(state, false);
    deleteNoteIfEmpty(state, currentNoteBeforeMove);

    return true;
}

function setNoteAsLastSelected(state: NoteTreeGlobalState, note: TreeNote) {
    if (idIsNil(note.parentId)) {
        return;
    }

    const parent = getNote(state.notes, note.parentId);
    parent.data.lastSelectedChildIdx = parent.childIds.indexOf(note.id);
}

export function setIsEditingCurrentNote(state: NoteTreeGlobalState, isEditing: boolean) {
    if (isEditing) {
        const currentNote = getCurrentNote(state);
        setNoteAsLastSelected(state, currentNote);
        pushNoteActivity(state, currentNote.id, false);

        state._isEditingFocusedNote = true;

        state.textOnArrival       = currentNote.data.text;
        state.textOnArrivalNoteId = currentNote.id;
    } else {
        state._isEditingFocusedNote = false;
    }
}


export function findNextImportantNote(state: NoteTreeGlobalState, note: TreeNote, backwards = false): TreeNote | undefined {
    if (idIsNil(note.parentId)) {
        return undefined;
    }

    const siblings = getNote(state.notes, note.parentId).childIds;
    const idx = siblings.indexOf(note.id);
    if (idx === -1) {
        return undefined;
    }

    const dir = backwards ? -1 : 1;
    const nextNote = getNoteOrUndefined(state.notes, siblings[idx + dir]);
    if (!nextNote) {
        return undefined;
    }

    const isInProgress = nextNote.data._status === STATUS_IN_PROGRESS;
    for (let i = idx + dir; i + dir >= -1 && i + dir <= siblings.length; i += dir) {
        const note = getNote(state.notes, siblings[i]);
        if (
            i <= 0 ||
            i >= siblings.length - 1 ||
            (note.data._status === STATUS_IN_PROGRESS) !== isInProgress
        ) {
            return note;
        }
    }

    return undefined;
}

export function getNoteOneDownLocally(state: NoteTreeGlobalState, note: TreeNote): NoteId | undefined {
    if (idIsNil(note.parentId)) {
        return undefined;
    }

    const backwards = false;
    return findNextImportantNote(state, note, backwards)?.id;
}

export function getNoteOneUpLocally(state: NoteTreeGlobalState, note: TreeNote): NoteId | undefined {
    if (idIsNil(note.parentId)) {
        return undefined;
    }

    const backwards = true;
    return findNextImportantNote(state, note, backwards)?.id;
}

export function getPreviousActivityWithNoteIdx(state: NoteTreeGlobalState, idx: number): number {
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
export function getNextActivityWithNoteIdx(state: NoteTreeGlobalState, idx: number): number {
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

export function dfsPre(state: NoteTreeGlobalState, note: TreeNote, fn: (n: TreeNote) => void) {
    fn(note);

    for (const id of note.childIds) {
        const note = getNote(state.notes, id);
        dfsPre(state, note, fn);
    }
}

export function getRootNote(state: NoteTreeGlobalState) {
    return getNote(state.notes, itree.ROOT_ID);
}

export function getTimeStr(note: Note) {
    const { openedAt } = note;

    const date = new Date(openedAt);
    return formatDateTime(date);
}

export function getIndentStr(note: Note) {
    const { _depth: repeats } = note;
    return "    ".repeat(repeats);
}

export function getNoteDurationUsingCurrentRange(_state: NoteTreeGlobalState, note: TreeNote) {
    let duration = note.data._durationRanged;
    if (note.data._durationRangedOpenSince) {
        duration += Date.now() - note.data._durationRangedOpenSince.getTime();
    }
    return duration;
}

export function getNoteDurationWithoutRange(_state: NoteTreeGlobalState, note: TreeNote) {
    let duration = note.data._durationUnranged;
    if (note.data._durationUnrangedOpenSince) {
        duration += Date.now() - note.data._durationUnrangedOpenSince.getTime();
    }
    return duration;
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


export function isBreak(activity: Activity): boolean {
    return activity.breakInfo !== undefined;
}

export function isMultiDay(activity: Activity, nextActivity: Activity | undefined): boolean {
    const t = getActivityDate(activity);
    const t1 = nextActivity ? getActivityDate(nextActivity) : new Date();

    return !(
        t.getDate() === t1.getDate() &&
        t.getMonth() === t1.getMonth() &&
        t.getFullYear() === t1.getFullYear()
    );
}

// This is recursive
export function getMostRecentlyWorkedOnChildActivityIdx(state: NoteTreeGlobalState, note: TreeNote): number | undefined {
    const noteCreatedAt = new Date(note.data.openedAt);

    for (let i = state.activities.length - 1; i > 0; i--) {
        const activity = state.activities[i];
        if (getActivityDate(activity) < noteCreatedAt) {
            // Can't possibly be any activities before this
            break;
        }

        if (!activity.nId) {
            continue;
        }

        const activityNote = getNote(state.notes, activity.nId);
        if (activityNote.id !== note.id && parentNoteContains(state, note.id, activityNote)) {
            return i;
        }
    }

    return undefined;
}

export function getMostRecentlyWorkedOnChildActivityNote(state: NoteTreeGlobalState, note: TreeNote): TreeNote | undefined {
    const idx = getMostRecentlyWorkedOnChildActivityIdx(state, note);
    if (!idx) {
        return;
    }

    const activity = state.activities[idx];
    return getNoteOrUndefined(state.notes, activity.nId);
}

export function getMostRecentActivityIdx(state: NoteTreeGlobalState, note: TreeNote): number {
    for (let i = state.activities.length - 1; i > 0; i--) {
        if (state.activities[i].nId === note.id) {
            return i;
        }
    }
    return -1;
}

// NOTE: this method will attempt to 'fix' indices that are out of bounds.
export function getLastSelectedNote(state: NoteTreeGlobalState, note: TreeNote): TreeNote | null {
    if (note.childIds.length === 0) {
        return null;
    }

    let idx = note.data.lastSelectedChildIdx;
    if (idx >= note.childIds.length) {
        idx = note.childIds.length - 1;
        note.data.lastSelectedChildIdx = idx;
    }

    const selNoteId = note.childIds[idx]

    return getNote(state.notes, selNoteId);
}

export function noteParentContainsNotesWithChildren(state: NoteTreeGlobalState, note: TreeNote): boolean {
    const parent = getNoteOrUndefined(state.notes, note.parentId);
    if (!parent) {
        return false;
    }

    for (const id of parent.childIds) {
        const note = getNote(state.notes, id);
        if (note.childIds.length > 0) {
            return true;
        }
    }

    return false;
}

export function findPreviousActiviyIndex(state: NoteTreeGlobalState, nId: NoteId, idx: number): number {
    const activities = state.activities;

    if (idx >= activities.length) {
        idx = activities.length - 1;
    }

    for (let i = idx - 1; i >= 0; i--) {
        const a = activities[i];
        if (!a.nId) {
            continue;
        }

        const aNote = getNote(state.notes, a.nId);
        if (parentNoteContains(state, nId, aNote)) {
            return i;
        }
    }

    return -1;
}

export function findNextActiviyIndex(state: NoteTreeGlobalState, nId: NoteId, idx: number): number {
    const activities = state.activities;
    for (let i = idx + 1; i < activities.length; i++) {
        const a = activities[i];
        if (!a.nId) {
            continue;
        }

        const aNote = getNote(state.notes, a.nId);
        if (parentNoteContains(state, nId, aNote)) {
            return i;
        }
    }

    return -1;
}

export function resetState() {
    state = newNoteTreeGlobalState();
}

// TODO: move this to a variable inside of the App component, and just pass it to all the child components.
export let state = newNoteTreeGlobalState();


// We need to prevent a second stale tab from corrupting our data.
// This can happen when we have a second browser window or tab that we havent touched in days, 
// and we close our most recent window, and switch to this stale window. Without
// this extra code that auto-reloads on focus, we'll overwrite our new data with the state data.
// Don't ask how I found this out ... :'(
// (Also I have other projects on local storage so we should prefix these)
const PROJECT_NAME = "note-tree";
const LAST_SAVED_TIMESTAMP_KEY = PROJECT_NAME + "-lastSavedTimestamp";
const LAST_SAVED_VERSION_KEY = PROJECT_NAME + "-lastSavedVersion";
const LAST_AUTO_INSERTED_BREAK_KEY = PROJECT_NAME + "-lastAutoinsertedBreakTime";
// Storing dates as iso-string is a lot more convenient than a Date, as 
// then, dates are immutable value types which are a lot easier to deal with in the code.
let lastSavedTimeThisTab: string | null = null;
let loadStateLoading = false;

let db: IDBDatabase | undefined;

export function getLastSavedForAllTabs() {
    return localStorage.getItem(LAST_SAVED_TIMESTAMP_KEY) || "";
}

export function getLastSavedForThisTab() {
    return lastSavedTimeThisTab;
}

export function toDateOrZero(isoString: string | null | undefined) {
    if (!isoString) return new Date(0);
    return new Date(isoString);
}

export function isLoadingState() {
    return loadStateLoading;
}

// TODO: (low priority) - Promisify and asincify this callback spam.
// But honestly, even thoguh it looks bad, it works. The wrapper design might require some thought. 
export function loadState(then: (error: string) => void) {
    // This app will have looked a lot different if I hadn't used localStorage as the storage API, and started with indexedDB.
    const lastSavedVersion = localStorage.getItem(LAST_SAVED_VERSION_KEY);
    if (lastSavedVersion) {
        const versionInt = parseInt(lastSavedVersion);
        if (versionInt !== null) {
            if (versionInt > VERSION_NUMBER_MONOTONIC) {
                const message = "Your state has been saved using a newer version of the app. You shold close this older version and open that one in order to avoid data loss. Saving has been disabled for this session.";
                logTrace(message);
                state._criticalLoadingError = message;
                state._criticalLoadingErrorWasOurFault = false;
                then(message);
                return;
            }
        }
    }

    if (loadStateLoading) {
        logTrace("Already loading!");
        return;
    }
    loadStateLoading = true;

    const afterStateLoadedOrErrored = (error: string) => {
        loadStateLoading = false;
        lastSavedTimeThisTab = getLastSavedForAllTabs();
        then(error);
    };

    logTrace("Opening DB...");
    const request = window.indexedDB.open(INDEXED_DB_KV_STORE_NAME, 1);

    request.onupgradeneeded = () => {
        logTrace("Migrating DB...");

        db = request.result;

        // Need to make the database.
        // It's just a KV store. 

        const kvStore = db.createObjectStore(INDEXED_DB_KV_STORE_NAME, { keyPath: "key" });
        kvStore.createIndex("value", "value", { unique: false });
    }

    request.onerror = (e) => {
        loadStateFromLocalStorage();
        console.error("Error requesting db - ", e, request.error);
        afterStateLoadedOrErrored("Error requesting db - " + request.error);
    }

    request.onsuccess = () => {
        db = request.result;

        logTrace("Opened DB");

        if (!db) throw new Error("DB should be defined here");
        const kvStore = db.transaction([INDEXED_DB_KV_STORE_NAME], "readonly")
            .objectStore(INDEXED_DB_KV_STORE_NAME);

        const txRequest = kvStore.get(KV_STORE_STATE_KEY);
        txRequest.onerror = (e) => {
            console.error("Error getting kv store - ", e, request.error);
            afterStateLoadedOrErrored("Error getting kv store - " + request.error);
        }

        txRequest.onsuccess = () => {
            logTrace("Checking IndexedDB...");
            const savedStateJSONWrapper: { key: string, value: string } | undefined = txRequest.result;
            if (!savedStateJSONWrapper) {
                logTrace("We don't have anything saved yet. We might have something in local storage though. If not, we'll just start with fresh state");

                // Let's just load the state from local storage in case it exists...
                loadStateFromLocalStorage();

                afterStateLoadedOrErrored("");
                return;
            }

            logTrace("Loaded data from IndexedDB (and not localStorage)");
            setStateFromJSON(
                savedStateJSONWrapper.value,
                afterStateLoadedOrErrored
            );
        }
    };
}

export function saveState(state: NoteTreeGlobalState, then: (serialize: string) => void) {
    if (state._criticalLoadingError) {
        logTrace("State shouldn't be saved right now - most likely we'll irrecoverably corrupt it");
        then("");
        return;
    }

    if (!db) {
        console.error("Tried to save the state before we even have our database!!!");
        return;
    }

    const serialized = serializeToJSON(state);

    // https://developer.chrome.com/blog/blob-support-for-Indexeddb-landed-on-chrome-dev
    // NOTE: I'm not even going to attempt to save as a string, because that simply won't work on chromium browsers
    // in the long run: https://github.com/google/leveldb/issues/299
    // They solved their issue by moving to blob storage instead of strings, and it has worked for me as well.
    const serializedBlob = new Blob([serialized], { type: "text/plain" });

    const kvStoreTx = db.transaction([INDEXED_DB_KV_STORE_NAME], "readwrite");

    kvStoreTx.objectStore(INDEXED_DB_KV_STORE_NAME).put({
        key: KV_STORE_STATE_KEY,
        value: serializedBlob,
    });

    // Do something when all the data is added to the database.
    kvStoreTx.oncomplete = () => {
        const timestamp = new Date().toISOString();
        const version = VERSION_NUMBER_MONOTONIC;
        localStorage.setItem(LAST_SAVED_TIMESTAMP_KEY, timestamp);
        localStorage.setItem(LAST_SAVED_VERSION_KEY, version.toString());
        lastSavedTimeThisTab = timestamp;

        logTrace("Saved! (as a blob this time, and not text!)");
        then(serialized);
    };

    kvStoreTx.onerror = (event) => {
        console.error("An error occured while trying to save as a blob: ", event, kvStoreTx.error);
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

export function getHigherLevelTask(state: NoteTreeGlobalState, note: TreeNote): TreeNote | undefined {
    let result: TreeNote | undefined = undefined;

    while (!idIsNil(note.parentId)) {
        if (isHigherLevelTask(note)) {
            result = note;
            break;
        }

        note = getNote(state.notes, note.parentId);
    }

    return result;
}

export function getNumSiblings(state: NoteTreeGlobalState, note: TreeNote): number {
    if (idIsNil(note.parentId)) return 0;
    const parent = getNote(state.notes, note.parentId);
    return parent.childIds.length;
}

export function isLastNote(state: NoteTreeGlobalState, note: TreeNote) {
    const numSiblings = getNumSiblings(state, note);
    return note.idxInParentList === numSiblings - 1;
}

export function removeNoteFromNoteIds(noteIds: NoteId[], id: NoteId) {
    filterInPlace(noteIds, nId => nId !== id);
}

export function clamp(val: number, min: number, max: number) {
    if (val < min) return min;
    if (val > max) return max;
    return val;
}

export type InProgressNotesState = {
    inProgressIds: NoteId[];
    currentInProgressNoteIdx: number;
    inProgressNoteDepths: number[];
};


// I used to have tabs, but I literally never used then, so I've just removed those components.
// However, "Everything" is the name of my current note tree, so that is just what I've hardcoded here.
// The main benefit of having just a single tree (apart from simplicity and less code) is that
// You can track all your activities and see analytics for all of them in one place. 
// As it turns out, storing state in anything besides the global state object can result in bugs. so I've completely removed this now.
const LOCAL_STORAGE_KEY_LEGACY = "NoteTree.Everything";
const INDEXED_DB_KV_STORE_NAME = "NoteTreeKVStore";
const KV_STORE_STATE_KEY = "State";

export function getCurrentStateAsJSON() {
    return serializeToJSON(state);
}

export function loadStateFromBackup(text: string): NoteTreeGlobalState | null {
    // I expect there to be 1 more format if I ever start storing multiple keys in the kv store. But
    // I have already decided against this due to the much higher potential for bugs r.e partial saving
    logTrace("Loading backup format v2");

    const res = loadStateFromJSON(text);
    if (res.state) {
        return res.state;
    }

    // fallback to the legacy format.
    // The legacy format just grabbed every local storage key, put it into an object, and JSON-serialized that.
    let obj = JSON.parse(text);
    if (LOCAL_STORAGE_KEY_LEGACY in obj) {
        logTrace("Loading legacy backup format");
        return loadStateFromJSON(obj[LOCAL_STORAGE_KEY_LEGACY]).state ?? null;
    }

    return null;
}


// no point in saving this in the app state.
export function getBreakAutoInsertLastPolledTime() {
    return localStorage.getItem(LAST_AUTO_INSERTED_BREAK_KEY) ?? new Date().toISOString();
}

export function updateBreakAutoInsertLastPolledTime() {
    return localStorage.setItem(LAST_AUTO_INSERTED_BREAK_KEY, new Date().toISOString());
}

export function toggleNoteRootMark(state: NoteTreeGlobalState, id: NoteId, idx: number) {
    if (state.rootMarks[idx] === id) {
        state.rootMarks[idx] = null;
    } else {
        if  (state.rootMarks[idx]) {
            // Don't just overwrite an existing mark
            setCurrentNote(state, state.rootMarks[idx], state.currentNoteId);
        } else {
            state.rootMarks[idx] = id;
        }
    }

    recomputeMarkNavigation(state);
    notesMutated(state);
}


const KEYBOARD_NUMBERS = "1234567890";
export function markIdxToString(idx: number): string {
    return KEYBOARD_NUMBERS[idx];
}
