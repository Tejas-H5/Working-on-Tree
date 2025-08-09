import { AsciiCanvasLayer, getLayersString } from "src/legacy-app-components/canvas-state";
import { assert } from "src/utils/assert";
import {
    addDays,
    floorDateLocalTime,
    floorDateToWeekLocalTime,
    formatDateTime,
    formatDuration,
    ONE_DAY,
    ONE_HOUR,
    ONE_MINUTE,
    ONE_SECOND,
    pad2,
    parseIsoDate
} from "src/utils/datetime";
import * as tree from "src/utils/int-tree";
import { logTrace } from "src/utils/log";
import { serializeToJSON } from "src/utils/serialization-utils";
import * as oldTree from "src/utils/tree";
import { darkTheme, lightTheme, setAppTheme } from "./app-styling";
import { GraphData, newGraphData } from "./legacy-app-components/interactive-graph-state";
import { asNoteTreeGlobalState } from "./schema";
import { clampIndexToArrayBounds, clearArray, filterInPlace } from "./utils/array-utils";
import { fuzzyFind } from "./utils/fuzzyfind";
import { isEditingTextSomewhereInDocument } from "./utils/im-utils-dom";
import { VERSION_NUMBER_MONOTONIC } from "./version-number";

const SAVE_DEBOUNCE = 1500;
const ERROR_TIMEOUT_TIME = 5000;

const GITHUB_PAGE = "https://github.com/Tejas-H5/Working-on-Tree";
const GITHUB_PAGE_ISSUES = "https://github.com/Tejas-H5/Working-on-Tree/issues/new?template=Blank+issue";

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

export type NoteId = tree.TreeId;

export type TreeNote = tree.TreeNode<Note>;

export type DockableMenu = "activities" | "quicklist";
export type AppTheme = "Light" | "Dark";

export type CurrentDateScope = "any" | "week";

// TODO: remove dead state after rewrite

// NOTE: this is just the state for a single note tree.
// We can only edit 1 tree at a time, basically
export type NoteTreeGlobalState = {
    /** Tasks organised by problem -> subproblem -> subsubproblem etc., not necessarily in the order we work on them */
    notes: tree.TreeStore<Note>;
    _notesMutationCounter: number;

    currentNoteId: NoteId;
    dockedMenu: DockableMenu;
    showDockedMenu: boolean;
    breakAutoInsertLastPolledTime: string;
    currentTheme: AppTheme;

    // A stupid bug in chrome ~~~causes~~~ used to cause IndexedDB to be non-functional 
    // (at least with the way I'm using it as a drop-in replacement for localStorage.).
    // see usages of this variable for more details.
    // I've kept this in just in case it starts happening again.
    criticalSavingError: string | undefined;

    /** The sequence of tasks as we worked on them. Separate from the tree. One person can only work on one thing at a time */
    activities: Activity[];
    _activitiesMutationCounter: number;

    /** 
     * A task stream is way to group tasks, and chunk out which ones we're working on at any given time. 
     * It is a replacement for simply pinning notes - we end up pinning way too many of them.
     * Streams can be reordered, and notes inside of them can be reordered.
     * Notes may belong to multiple streams.
     * Guess what - it actually worked! Literally the first day, saw a massive improvement. 
     * I'm literally no longer looking for "what was I working on" - it's always quickly available now
     **/
    taskStreams: TaskStream[];
    scheduledNoteIds: NoteId[];
    /** -1 now refers to the schedule stream */
    currentTaskStreamIdx: number;

    // Want to keep this so that we can refresh the page mid-delete.
    textOnArrivalNoteId: NoteId;
    textOnArrival: string;

    workdayConfig: WorkdayConfig;

    _scratchPadCanvasLayers: AsciiCanvasLayer[];
    _scratchPadCanvasCurrentNoteIdPendingSave: NoteId;

    mainGraphData: GraphData;

    settings: AppSettings;
    // This might make the program unopenable, so it's a transient setting for now
    _showAllNotes: boolean;

    // Schema major versions occur whenever state cannot be autmatically migrated by dropping, renaming, and adding keys.
    // undefined -> the schema we've had since almost the start
    // 2 ->         the tree is no longer backed by a Record<string, Node> tree, but by a Node[] tree that can be indexed directly like an array.
    schemaMajorVersion: number | undefined;

    // non-serializable fields start with _

    _criticalLoadingError: string;
    // If true, error modals will include additional info on where to report the error.
    // If false, the user can do something about it, and they don't have anything to report.
    _criticalLoadingErrorWasOurFault: boolean;
    

    _currentlyViewingActivityIdx: number;
    // TODO: doesn't need to be a reference
    _currentActivityScopedNoteId: NoteId;
    // NOTE: kinda need to be references - some code will toggle between whenether we're using 
    // child ids or flat note ids, and it's better if we don't have to recompute a child list each time.
    _flatNoteIds: NoteId[];
    _isEditingFocusedNote: boolean;
    _isShowingDurations: boolean;
    _activitiesFrom: Date | null;
    _activitiesFromIdx: number;
    _activitiesTo: Date | null;
    _activitiesToIdx: number;
    _useActivityIndices: boolean;
    _activityIndices: number[];
    // TODO: doesn't need to be a reference
    _lastNoteId: NoteId | undefined;
    _currentDateScope: CurrentDateScope;
    _currentDateScopeWeekDay: number;
    // NOTE: this note isn't really the 'flat notes root', it's just one note _before_ the flat note when traversing upwards
    // TODO: doesn't need to be a reference
    _currentFlatNotesRootId: NoteId;
    // TODO: doesn't need to be a reference
    _currentFlatNotesRootHltId: NoteId;

    // App state
    _currentModal: number;

    // notifications

    _showStatusText: boolean;
    _statusText: string;
    _statusTextColor: string;
};

export type TaskStream = {
    name: string;
    noteIds: NoteId[];

    _idx: number;
};


export function newTaskStream(name: string): TaskStream {
    return { name, noteIds: [], _idx: 0 };
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

    editedAt: Date; // this is when the note or any of it's children was last edited. since it was added later, some notes may not have this field.


    // The note's higher level task.
    _higherLevelTask: TreeNote | undefined;

    // non-serializable fields
    _status: NoteStatus; // used to track if a note is done or not.
    _shelved: boolean; // Is this note or any of it's parents shelved?
    _everyChildNoteDone: boolean;
    _isAboveCurrentNote: boolean; // this now just means "is this note the current note or an ancestor of the current note?"
    _isUnderCurrent: boolean; // used to calculate the duration of a specific task. Or as an arbitrary boolean flag for anything really.
    _depth: number; // used to visually indent the notes
    _durationUnranged: number;
    _durationUnrangedOpenSince?: Date; // used for recomputing realtime durations - only notes with this thing set would still be increasing in duration
    _durationRanged: number;
    _durationRangedOpenSince?: Date;
    _activityListMostRecentIdx: number; // what is our position inside of NoteTreeGlobalState#_todoNoteIds ?

    _taskStreams: TaskStream[];
    _isScheduled: boolean; 
};


export function recomputeNoteIsUnderFlag(state: NoteTreeGlobalState, note: TreeNote) {
    tree.forEachNode(state.notes, (note) => {
        note.data._isUnderCurrent = false;
    });

    dfsPre(state, note, (note) => {
        note.data._isUnderCurrent = true;
    });
}

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

function getDoneNotePrefixOrSuffix(note: Note): string | undefined {
    for (const suffix of doneSuffixes) {
        if (note.text.trimEnd().endsWith(suffix) || note.text.trimStart().startsWith(suffix)) {
            return suffix;
        }
    }

    return undefined;
}

// @deprecated. just call getDoneNoteSuffix(note)
export function isDoneNote(note: Note) {
    return false;
}

// @deprecated. Just call getDoneNoteSuffix.
export function isDoneNoteWithExtraInfoDepracatadXd(note: Note): boolean {
    const prefix = getDoneNotePrefixOrSuffix(note);
    if (!prefix) {
        return false;
    }

    return prefix.length !== note.text.length;
}

export function isTodoNote(note: Note) {
    return getTodoNotePriority(note) > 0;
}


export function getTodoNotePriorityId(state: NoteTreeGlobalState, id: NoteId): number {
    const note = getNote(state, id);
    return getTodoNotePriority(note.data);
}

export function getNoteTextWithoutPriority(note: Note): string {
    const priority = getTodoNotePriority(note);
    let idx = priority;
    const shelved = isNoteRequestingShelf(note);
    if (shelved) {
        idx += 2;
    }
    return (shelved ? "[Shelved] " : "") + note.text.substring(idx).trim();
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

export function getHltHeader(state: NoteTreeGlobalState, note: TreeNote): string {
    const strBuilder: string[] = [];

    while (note.parentId !== -1) {
        if (isHigherLevelTask(note)) {
            const noteText = getNoteTextWithoutPriority(note.data);
            strBuilder.push(noteText);
        }
        note = getNote(state, note.parentId);
    }

    return strBuilder.reverse().join(" :: ");
}


export function isNoteRequestingShelf(note: Note): boolean {
    return note.text.startsWith("||")
}

export function getTodoNotePriority(note: Note): number {
    // Keep the priority system simple. 
    // Tasks are are always changing priority, and having too many priorities means they will always be assigned the wrong priority.
    // The task priorities/importances should all be in your head. This program should just help you remember which things you're working
    // on now, and which things you want to get to in the future, and you shouldn't be spending all your time ordering the tasks.

    let priority = 0;

    let text = note.text;
    let pos = 0;
    if (isNoteRequestingShelf(note)) {
        pos += 2;
    }
    if (text[pos] === " ") {
        pos++;
    }

    for (let i = pos; i < text.length; i++) {
        if (text[i] !== '>') {
            break;
        }

        priority++;
    }

    return priority;
}

type  NoteStatusInstance = number & { __noteStatus: void; };

export const STATUS_NOT_COMPUTED = 0 as NoteStatusInstance;

/** This is a task that is currently in progress */
export const STATUS_IN_PROGRESS = 1 as NoteStatusInstance;
/**
 * This is a task that you haven't marked as DONE, but we are assuming it is done,
 * because you've moved on to the next task.
 * This status exists, so that you dont have to manually close off every single tas with a new - Done note under it.
 */
export const STATUS_ASSUMED_DONE = 2 as NoteStatusInstance;
/**
 * This is a task that is marked as DONE at the end.
 * Marking a note as DONE marks all notes before it as DONE, i.e no longer assumed done, but actually done.
 * Only these tasks may be moved out of a note.
 * This ensures that even in the 'done' tree, all notes are calculated as done.
 */
export const STATUS_DONE = 3 as NoteStatusInstance;

export type NoteStatus = 
    typeof STATUS_NOT_COMPUTED |
    typeof STATUS_IN_PROGRESS |
    typeof STATUS_ASSUMED_DONE |
    typeof STATUS_DONE;

export function noteStatusToString(noteStatus: NoteStatus) {
    switch (noteStatus) {
        case STATUS_IN_PROGRESS:
            return "[ ]";
        case STATUS_ASSUMED_DONE:
            return "[*]";
        case STATUS_DONE:
            return "[x]";
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

    const notes = tree.newTreeStore<Note>(rootNote);

    const state: NoteTreeGlobalState = {
        // Only increment this for massive changes! Otherwise, try to keep migrations bacwards compatible
        schemaMajorVersion: 2,

        notes,
        _notesMutationCounter: 0,

        currentNoteId: tree.NIL_ID,
        dockedMenu: "activities",
        showDockedMenu: false,
        activities: [],
        _activitiesMutationCounter: 0,

        _scratchPadCanvasLayers: [],
        _scratchPadCanvasCurrentNoteIdPendingSave: tree.NIL_ID,

        mainGraphData: newGraphData(),
        settings: newAppSettings(),
        _showAllNotes: false,
        currentTheme: "Light",
        breakAutoInsertLastPolledTime: "",
        criticalSavingError: "",

        taskStreams: [],
        scheduledNoteIds: [],
        currentTaskStreamIdx: 0,

        textOnArrival: "",
        textOnArrivalNoteId: tree.NIL_ID,

        workdayConfig: {
            weekdayConfigs: [newWorkdayConfigWeekDay(9, 7.5)],
            holidays: [],
        },

        _flatNoteIds: [], // used by the note tree view, can include collapsed subsections
        _isEditingFocusedNote: false, // global flag to control if we're editing a note

        // don't set this if our tree is corrupted!
        _criticalLoadingError: "",
        _criticalLoadingErrorWasOurFault: false,

        _currentlyViewingActivityIdx: 0,
        _currentActivityScopedNoteId: tree.NIL_ID,
        _isShowingDurations: false,
        _activitiesFrom: null,
        _activitiesFromIdx: -1,
        _activitiesTo: null,
        _activitiesToIdx: -1,
        _activityIndices: [],
        _useActivityIndices: false,
        _lastNoteId: undefined,
        _currentDateScope: "week",
        _currentDateScopeWeekDay: -1,
        _currentFlatNotesRootId: tree.NIL_ID,
        _currentFlatNotesRootHltId: tree.NIL_ID,

        _currentModal: 0,

        _showStatusText: false,
        _statusText: "",
        _statusTextColor: "",
    };

    setActivityRangeToToday(state);

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

// Legacy method. TODO: put this code where it belongs. 
// Techinally not needed since my only 2 users (me at home, me at work) have already migrated to the latest version,
// but would be nice to learn about what it takes to write 100% backwards-compatible software
function migrateToSchemaMajorVersion2(loadedState: NoteTreeGlobalState, defaultState: NoteTreeGlobalState) {
    if (loadedState.schemaMajorVersion && loadedState.schemaMajorVersion >= 2) {
        return;
    }

    if (!loadedState.notes) {
        throw new Error("No notes present for us to migrate");
    }

    // ---- UNSAFE CODE ----
    // The types on loadedState are not what they seem - we've just loaded it from some JSON, could be literally anything.

    const newIdsMap = new Map<string, tree.TreeId>();

    // let's build a new tree from our old tree
    {
        const newNotes = defaultState.notes;
        const oldNotes: oldTree.TreeStore<Note> = loadedState.notes as unknown as oldTree.TreeStore<Note>;


        const dfs = (parent: oldTree.TreeNode<Note>, newParent: tree.TreeNode<Note>) => {
            for (let i = 0; i < parent.childIds.length; i++) {
                const childId = parent.childIds[i];
                const childNote = oldTree.getNode(oldNotes, childId);
                const data = childNote.data;
                const oldId = data.id as unknown as string; // NoteID used to be string
                if (typeof oldId !== "string") {
                    throw new Error("Expectations of reality have not been met :'(");
                }

                const newChild = tree.newTreeNode(data);
                tree.addUnder(newNotes, newParent, newChild);
                newIdsMap.set(oldId, newChild.id);
                data.id = newChild.id;
                dfs(childNote, newChild);
            }
        }

        const oldRootNote = oldTree.getNode(oldNotes, oldTree.ROOT_KEY);
        const newRootNote = tree.getNode(newNotes, 0);
        dfs(oldRootNote, newRootNote);

        loadedState.notes = newNotes;
    }

    // update references in global state
    {
        loadedState.currentNoteId = newIdsMap.get(
            loadedState.currentNoteId as unknown as string
        ) ?? tree.NIL_ID;
    }

    // update references in the activities
    {
        for (const activity of loadedState.activities) {
            if (activity.nId) {
                activity.nId = newIdsMap.get(
                    activity.nId as unknown as string
                );
            }
        }
    }

    loadedState.schemaMajorVersion = 2;
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
    if (idx === -1) {
        return undefined;
    }
    return state.activities[idx];
}

export function getLastActivityWithNoteIdx(state: NoteTreeGlobalState): number {
    let i = state.activities.length - 1;
    while (i >= 0) {
        if (state.activities[i].nId) {
            return i;
        }

        i--;
    }

    return -1;
}

export function defaultNote(): Note {
    return {
        // the following is valuable user data
        id: tree.NIL_ID,
        text: "",
        openedAt: new Date(),
        editedAt: new Date(),
        lastSelectedChildIdx: 0,

        // the following are just visual flags which are frequently recomputed

        _higherLevelTask: undefined,
        _status: STATUS_NOT_COMPUTED,
        _shelved: false,
        _everyChildNoteDone: false,
        _isAboveCurrentNote: false,
        _isUnderCurrent: false,
        _depth: 0,
        _durationUnranged: 0,
        _durationRanged: 0,
        _activityListMostRecentIdx: 0,
        _taskStreams: [],
        _isScheduled: false,
    };
}

export type NoteFilter = null | {
    status: NoteStatus;
    not: boolean;
};

export function getAllNoteIdsInTreeOrder(state: NoteTreeGlobalState): NoteId[] {
    const noteIds: NoteId[] = [];

    const root = getRootNote(state);
    dfsPre(state, root, (note) => {
        noteIds.push(note.id);
    });

    return noteIds;
}

export function recomputeNoteParents(
    state: NoteTreeGlobalState,
    flatNotes: TreeNote[],
    currentNote: TreeNote,
) {
    clearArray(flatNotes);

    // Add the parents to the top of the list
    let note = currentNote;
    while (!idIsNil(note.parentId)) {
        flatNotes.push(note);
        note = getNote(state, note.parentId);
    }

    flatNotes.reverse();
}

export function recomputeFlatNotes(
    state: NoteTreeGlobalState,
    flatNotes: TreeNote[],
    viewRoot: TreeNote,
    currentNote: TreeNote,
    includeParents = true
) {
    clearArray(flatNotes);

    if (includeParents) {
        recomputeNoteParents(state, flatNotes, viewRoot);
    }

    const dfs = (note: TreeNote) => {
        flatNotes.push(note);

        let isVisualLeaf = note.childIds.length === 0;

        if (!isVisualLeaf) {
            const collapsed = isNoteCollapsed(note);
            if (collapsed) {
                isVisualLeaf = true;

                if (collapsed === COLLAPSED_STATUS) {
                    const currentNoteIsInsideThisOne = 
                        currentNote !== note && // don't want to see through the current note
                        parentNoteContains(state, note.id, currentNote);
                    if (currentNoteIsInsideThisOne) {
                        isVisualLeaf = false;
                    }
                }
            }
        }

        if (isVisualLeaf) {
            return;
        }

        for (const childId of note.childIds) {
            const note = getNote(state, childId);
            dfs(note);
        }
    }

    for (const childId of viewRoot.childIds) {
        const note = getNote(state, childId);
        dfs(note);
    }
}

/**
 * @deprecated - we now serialize and deserialize data directly into the correct type, so this is useless
 */
export function setActivityTime(activity: Activity, t: Date) {
    activity.t = t;
}

export function getActivityTime(activity: Activity | undefined) {
    if (!activity) {
        return new Date();
    }

    return activity.t;
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

export function setNoteText(
    state: NoteTreeGlobalState,
    note: TreeNote,
    text: string
) {
    note.data.text = text;
    recomputeNoteStatusRecursively(state, note);
    state._notesMutationCounter++;

    let current = note;
    const now = new Date();
    while (!idIsNilOrRoot(current.id)) {
        current.data.editedAt = new Date(now);
        current = getNote(state, current.parentId)
    }
}

// Incrementally recompute status of notes in the tree. Rules:
// - Only the very last note under another note can be considered STATUS_IN_PROGRESS, if it has no children. All notes before this are STATUS_ASSUMED_DONE.
//      - If the last note has children, it can't be in progress. in fact, no other note can be in progress either.
// - If a note has no children, and ends with a 'done suffix', then that note, and every other note on that level before it without children can
//      be  marked as STATUS_DONE. No longer an assumption.
// - A note with children is only done when all of it's children have a DONE status.
export function recomputeNoteStatusRecursively(
    state: NoteTreeGlobalState,
    note: TreeNote,
    recomputeParents = true,
    recomputeChildren = true
) {
    if (note.childIds.length === 0) {
        recomputeParents = true;
    } else if (note.childIds.length > 0) {
        let status = STATUS_IN_PROGRESS;
        // if the last note in the list is DONE, then we can default to DONE instead
        {
            const lastId = note.childIds[note.childIds.length - 1];
            const lastNote = getNote(state, lastId);
            if (getDoneNotePrefixOrSuffix(lastNote.data)) {
                status = STATUS_DONE;
            }
        }

        let foundDoneNoteUnderThisParent = false;
        for (let i = note.childIds.length - 1; i >= 0; i--) {
            const id = note.childIds[i];
            const child = getNote(state, id);

            if (child.childIds.length > 0) {
                if (
                    recomputeChildren || 
                    child.data._status === STATUS_NOT_COMPUTED
                ) {
                    recomputeNoteStatusRecursively(state, child, false, true);
                    assert(child.data._status !== STATUS_NOT_COMPUTED);
                }
            } else {
                const doneSuffix = getDoneNotePrefixOrSuffix(child.data);
                if (doneSuffix || foundDoneNoteUnderThisParent) {
                    child.data._status = STATUS_DONE;
                    foundDoneNoteUnderThisParent = true;
                } else if (i === note.childIds.length - 1) {
                    child.data._status = STATUS_IN_PROGRESS;
                } else {
                    if (getTodoNotePriority(child.data) === 0) {
                        child.data._status = STATUS_ASSUMED_DONE;
                    } else {
                        child.data._status = STATUS_IN_PROGRESS;
                    }
                }
            }

            if (child.data._status !== STATUS_DONE) {
                status = STATUS_IN_PROGRESS;
            }
        }

        if (note.data._status !== status) {
            if (note.data._status !== STATUS_NOT_COMPUTED) {
                recomputeParents = true;
            }

            note.data._status = status;
        }
    }

    if (recomputeParents) {
        if (!idIsNil(note.parentId)) {
            const parent = getNote(state, note.parentId);
            recomputeNoteStatusRecursively(state, parent, true, false);
        }
    }
}

// called just before we render things.
// It recomputes all state that needs to be recomputed
// TODO: super inefficient, need to set up a compute graph or something more complicated
// TODO: deprecate this method once we've reached a point where we don't need to ever call it again.
export function recomputeState(state: NoteTreeGlobalState) {
    if (!state) throw new Error("WTF!");

    // delete the empty notes
    {
        tree.forEachNode(state.notes, (n) => {
            if (n.childIds.length === 0 && n.id !== state.currentNoteId) {
                deleteNoteIfEmpty(state, n)
            }
        });
    }

    // recompute _depth, _parent, _index. Somewhat required for a lot of things after to work.
    // tbh a lot of these things should just be updated as we are moving the elements around, but I find it easier to write this (shit) code at the moment
    {
        const dfs = (note: TreeNote, depth: number, index: number, numSiblings: number) => {
            note.data._depth = depth;

            for (let i = 0; i < note.childIds.length; i++) {
                const c = getNote(state, note.childIds[i]);
                dfs(c, depth + 1, i, note.childIds.length);
            }
        };

        dfs(getRootNote(state), -1, 0, 1);
    }


    // recompute _shelved
    {
        tree.forEachNode(state.notes, (note) => {
            note.data._shelved = false;
        });

        const shelveSubtree = (note: TreeNote) => {
            for (let i = 0; i < note.childIds.length; i++) {
                const childId = note.childIds[i];
                const child = getNote(state, childId);
                child.data._shelved = true;
                shelveSubtree(child);
            }
        }

        const dfs = (note: TreeNote) => {
            if (isNoteRequestingShelf(note.data)) {
                // Don't shelve this root note - if it is still in progress, 
                // we don't want to forget about it
                note.data._shelved = true;
                shelveSubtree(note);
                return;
            }

            for (let i = 0; i < note.childIds.length; i++) {
                const childId = note.childIds[i];
                const child = getNote(state, childId);
                dfs(child);
            }
        }
        dfs(getRootNote(state));
    }

    // recompute _status, do some sorting (OLD)
    if (0) {
        tree.forEachNode(state.notes, (note) => {
            note.data._status = STATUS_IN_PROGRESS;
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
    } else {
        recomputeNoteStatusRecursively(state, getRootNote(state));
    }

    // TODO: new status recomputation

    // recompute _isSelected to just be the current note + all parent notes 
    {
        tree.forEachNode(state.notes, (note) => {
            note.data._isAboveCurrentNote = false;
        });

        const current = getCurrentNote(state);

        let note = current;
        while (!idIsNil(note.parentId)) {
            note.data._isAboveCurrentNote = true;
            note = getNote(state, note.parentId);
        }
    }

    // recompute the activity list most recent index.
    {
        tree.forEachNode(state.notes, (note) => {
            note.data._activityListMostRecentIdx = -1;
        });

        for (let i = state.activities.length - 1; i >= 0; i--) {
            const noteId = state.activities[i].nId;
            if (!noteId) {
                continue;
            }

            const note = getNoteOrUndefined(state, noteId);
            if (!note) {
                continue;
            }

            if (note.data._activityListMostRecentIdx === -1) {
                note.data._activityListMostRecentIdx = i;
            }

            const hlt = getHigherLevelTask(state, note);
            if (hlt && hlt.data._activityListMostRecentIdx === -1) {
                hlt.data._activityListMostRecentIdx = i;
            }
        }
    }

    // compute the duration range as needed
    {
        // Once we leave the duration view, ensure that activitiesTo resets to today if it doesn't already include today.
        // Note that this still means we can increase the total time window we are seeing to longer than a day, but 
        // this reset to today only happens if today isn't in that time range
        if (
            !state._isShowingDurations &&
            !!state._activitiesTo && state._activitiesTo < new Date()
        ) {
            setActivityRangeToToday(state);
        }

        if (state._isShowingDurations) {
            // if scope is week, make sure we always have a week-long window set,
            // which also starts at day 0. (in JS land it's sunday. who cares tbh)
            if (state._currentDateScope === "week") {
                if (state._activitiesFrom === null) {
                    state._activitiesFrom = new Date();
                }

                floorDateToWeekLocalTime(state._activitiesFrom)

                if (state._currentDateScopeWeekDay >= 0) {
                    // scope the date to the current week day selected within the week
                    addDays(state._activitiesFrom, state._currentDateScopeWeekDay);
                    state._activitiesTo = new Date(state._activitiesFrom);
                    addDays(state._activitiesTo, 1);
                } else {
                    // scope the date to the whole week
                    state._activitiesTo = new Date(state._activitiesFrom);
                    addDays(state._activitiesTo, 7);
                }
            }
        }
    }

    // recompute note durations, with and without the range.
    {
        state._activitiesToIdx = -1;
        state._activitiesFromIdx = -1;
        tree.forEachNode(state.notes, (note) => {
            note.data._durationUnranged = 0;
            note.data._durationUnrangedOpenSince = undefined;
            note.data._durationRanged = 0;
            note.data._durationRangedOpenSince = undefined;
        });

        const activities = state.activities;
        for (let i = 0; i < activities.length; i++) {
            // Activities can be old, and might point to invalid notes. Or they can be breaks, and not refer to any note
            const a0 = activities[i];
            const note = getNoteOrUndefined(state, a0.nId);
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
                        parentNote.data._durationUnrangedOpenSince = getActivityTime(a0);
                    }

                    parentNote = getNote(state, parentNote.parentId);
                }
            }

            // TODO: update this to work for activities with start/end times that overlap into the current range
            if (
                (!state._activitiesFrom || state._activitiesFrom <= getActivityTime(a0))
                && (!state._activitiesTo || getActivityTime(a1) <= state._activitiesTo)
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
                            parentNote.data._durationRangedOpenSince = getActivityTime(a0);
                        }

                        parentNote = getNote(state, parentNote.parentId);
                    }
                }
            }
        }
    }

    // recompute the current filtered activities
    {
        state._useActivityIndices = false;
        const hasValidRange = state._activitiesFromIdx !== -1;
        const useDurations = state._isShowingDurations && hasValidRange;
        if (useDurations || !idIsNil(state._currentActivityScopedNoteId)) {
            state._useActivityIndices = true;
            clearArray(state._activityIndices);

            let start = useDurations ? state._activitiesFromIdx : 0;
            let end = useDurations ? state._activitiesToIdx : state.activities.length - 1;

            for (let i = start; i >= 0 && i <= end; i++) {
                const activity = state.activities[i];

                if (!idIsNil(state._currentActivityScopedNoteId) && (
                    activity.deleted ||
                    !activity.nId ||
                    !parentNoteContains(state, state._currentActivityScopedNoteId, getNote(state, activity.nId),)
                )) {
                    continue;
                }

                state._activityIndices.push(i);
            }
        }
    }


    // recompute _flatNoteIds and _parentFlatNoteIds (after deleting things)
    /* {
        if (!state._flatNoteIds) {
            state._flatNoteIds = [];
        }

        if (state._showAllNotes) {
            state._currentFlatNotesRootId = tree.ROOT_ID;
            state._currentFlatNotesRootHltId = tree.ROOT_ID;

            clearArray(state._flatNoteIds);
            tree.forEachNode(state.notes, (note) => {
                state._flatNoteIds.push(note.id);
            });
        } else {
            let startNote = getCurrentNote(state);
            while (!idIsNilOrRoot(startNote.parentId)) {
                const nextNote = getNote(state, startNote.parentId);

                if (isStoppingPointForNotViewExpansion(state, nextNote)) {
                    break;
                }

                startNote = nextNote;
            }

            state._currentFlatNotesRootId = startNote.id;
            state._currentFlatNotesRootHltId = startNote.parentId;

            recomputeFlatNotes(state, state._flatNoteIds, startNote, true);
        }
    } */

    // recompute the stream indexes
    {
        for (let i = 0; i < state.taskStreams.length; i++) {
            const stream = state.taskStreams[i];
            stream._idx = i;
        }
    }

    // recompute the task streams every note is in
    {
        tree.forEachNode(state.notes, n => clearArray(n.data._taskStreams));
        for (const ts of state.taskStreams) {
            for (const id of ts.noteIds) {
                const note = getNote(state, id);
                note.data._taskStreams.push(ts);
            }
        }
    }

    // recompute which notes are scheduled
    {
        tree.forEachNode(state.notes, n => n.data._isScheduled = false);
        for (const id of state.scheduledNoteIds) {
            const note = getNote(state, id);
            note.data._isScheduled = true;
        }
    }
}


export function isCurrentNoteOnOrInsideNote(state: NoteTreeGlobalState, note: TreeNote): boolean {
    return note.data._isAboveCurrentNote ||    // Current note inside this note
        parentNoteContains(state, state.currentNoteId, note);    // Current note directly above this note
}

export function parentNoteContains(state: NoteTreeGlobalState, parentId: NoteId, note: TreeNote): boolean {
    // one of the parents is the current note
    while (!idIsNil(note.parentId)) {
        if (note.id === parentId) {
            return true;
        }
        note = getNote(state, note.parentId);
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

export function getActivityText(state: NoteTreeGlobalState, activity: Activity): string {
    return getActivityTextOrUndefined(state, activity) || "< unknown activity text! >";
}

export function getActivityDurationMs(activity: Activity, nextActivity: Activity | undefined): number {
    const startTimeMs = getActivityTime(activity).getTime();
    const nextStart = (nextActivity ? getActivityTime(nextActivity) : new Date()).getTime();
    return nextStart - startTimeMs;
}


export function createNewNote(state: NoteTreeGlobalState, text: string): TreeNote {
    const note = defaultNote();
    note.text = text;

    const newTreeNode = tree.newTreeNode(note);
    tree.addAsRoot(state.notes, newTreeNode);
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
}


export function isNoteEmpty(note: TreeNote): boolean {
    return note.data.text.length === 0;
}

export function deleteNoteIfEmpty(state: NoteTreeGlobalState, note: TreeNote): boolean {
    if (!isNoteEmpty(note)) {
        return false;
    }

    if (note.childIds.length > 0) {
        if (state.textOnArrivalNoteId === note.id && state.textOnArrival) {
            // We can actually restore the text something more sane than the legacy behaviour
            note.data.text = state.textOnArrival;
            state.textOnArrival = "";
            state.textOnArrivalNoteId = tree.NIL_ID;
        } else {
            // Fallback to legacy behaviour
            note.data.text = "Some note we cant delete because of the x" + note.childIds.length + " notes under it :(";
        }

        state._showStatusText = true;
        state._statusText = "Can't delete notes with children!";
        state._statusTextColor = "#F00";

        state._notesMutationCounter++;
        return true;
    }

    if (idIsNil(note.parentId)) {
        return false;
    }

    if (tree.getSizeExcludingRoot(state.notes) <= 1) {
        // don't delete our only note! (other than the root note)
        return false
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

    while (state.activities.length > 0 && state.activities[state.activities.length - 1].deleted) {
        state.activities.pop();
    }

    // delete this note from streams.
    for (const stream of state.taskStreams) {
        removeNoteFromNoteIds(stream.noteIds, note.id);
    }
    removeNoteFromNoteIds(state.scheduledNoteIds, note.id);

    state._notesMutationCounter++;
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
    tree.addAfter(state.notes, currentNote, newNote)
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
    tree.addUnder(state.notes, currentNote, newNote);
    setCurrentNote(state, newNote.id);
    setIsEditingCurrentNote(state, true);
    return newNote;
}

export function hasNote(state: NoteTreeGlobalState, id: NoteId): boolean {
    return tree.hasNode(state.notes, id);
}

export function getNote(state: NoteTreeGlobalState, id: NoteId) {
    return tree.getNode(state.notes, id);
}

export function idIsNilOrUndefined(id: NoteId | null | undefined): id is typeof tree.NIL_ID | null | undefined {
    return id === -1 || id === null || id === undefined;
}

/** 
 * mainly used in parent traversals when we do want to start on the current note. 
 */
export function idIsNil(id: NoteId): boolean {
    return id === tree.NIL_ID;
}

/** 
 * mainly used in parent traversals when we don't want to start on the current note.
 */
export function idIsNilOrRoot(id: NoteId): boolean {
    return id === tree.NIL_ID || id === tree.ROOT_ID;
}

export function idIsRoot(id: NoteId): boolean {
    return id === tree.ROOT_ID;
}

export function getNoteOrUndefined(state: NoteTreeGlobalState, id: NoteId | null | undefined): TreeNote | undefined {
    if (!idIsNilOrUndefined(id) && hasNote(state, id)) {
        return getNote(state, id);
    }

    return undefined;
}

// Guaranteed to get a note - this function will actually make a new note if we don't have any notes.
export function getCurrentNote(state: NoteTreeGlobalState) {
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

function pushNoteActivity(state: NoteTreeGlobalState, noteId: NoteId, isNewNote: boolean) {
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

export function getNoteNDownForMovement(state: NoteTreeGlobalState, note: TreeNote, useSiblings: boolean, amount = 1): NoteId | undefined {
    if (idIsNil(note.parentId)) {
        return undefined;
    }

    const list = useSiblings ? getNote(state, note.parentId).childIds : state._flatNoteIds;
    const idx = list.indexOf(note.id);
    if (idx < list.length - 1) {
        return list[Math.min(list.length - 1, idx + amount)];
    }

    return undefined;
}

export function getNoteNUpForMovement(state: NoteTreeGlobalState, note: TreeNote, useSiblings: boolean, amount = 1): NoteId | undefined {
    if (idIsNil(note.parentId)) {
        return undefined;
    }

    const list = useSiblings ? getNote(state, note.parentId).childIds : state._flatNoteIds;
    let idx = list.indexOf(note.id);
    if (idx === -1) {
        return undefined
    }

    let i = idx;
    while (i >= 0 && amount > 0) {
        i--;
        amount--;

        if (list[i] === state._currentFlatNotesRootHltId) {
            return list[i + 1];
        }
    }

    return list[i];
}

export function getNoteNUp(state: NoteTreeGlobalState, note: TreeNote, useSiblings: boolean, amount = 1): NoteId | undefined {
    if (idIsNil(note.parentId)) {
        return undefined;
    }

    const list = useSiblings ? getNote(state, note.parentId).childIds : state._flatNoteIds;
    let idx = list.indexOf(note.id);
    if (idx > 0) {
        return list[Math.max(0, idx - amount)];
    }

    return undefined;
}

export function getNoteNDown(state: NoteTreeGlobalState, note: TreeNote, useSiblings: boolean, amount = 1): NoteId | undefined {
    if (idIsNil(note.parentId)) {
        return undefined;
    }

    const list = useSiblings ? getNote(state, note.parentId).childIds : state._flatNoteIds;
    const idx = list.indexOf(note.id);
    if (idx < list.length - 1) {
        return list[Math.min(list.length - 1, idx + amount)];
    }

    return undefined;
}


export function forEachParentNote(state: NoteTreeGlobalState, start: TreeNote, it: (note: TreeNote) => void) {
    let current = start;
    while (!idIsNilOrRoot(current.id)) {
        it(current);
        current = getNote(state, current.parentId);
    }
}

export function forEachChildNote(state: NoteTreeGlobalState, note: TreeNote, it: (note: TreeNote) => void) {
    for (let i = 0; i < note.childIds.length; i++) {
        const id = note.childIds[i];
        const child = getNote(state, id);
        it(child);
    }
}

// TODO: fix this method.
export function setCurrentNote(state: NoteTreeGlobalState, noteId: NoteId | null, noteIdJumpedFrom?: NoteId | undefined) {
    if (!noteId) {
        return;
    }

    const note = getNoteOrUndefined(state, noteId);
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

    state._lastNoteId = noteIdJumpedFrom;
    state.currentNoteId = note.id;
    setIsEditingCurrentNote(state, false);
    deleteNoteIfEmpty(state, currentNoteBeforeMove);
    setCurrentActivityIdxToCurrentNote(state);

    return true;
}

export function setCurrentActivityIdxToCurrentNote(state: NoteTreeGlobalState) {
    const note = getCurrentNote(state);
    const idx = getMostRecentActivityIdx(state, note);
    if (idx !== -1) {
        state._currentlyViewingActivityIdx = idx;
    }
}

function setNoteAsLastSelected(state: NoteTreeGlobalState, note: TreeNote) {
    if (idIsNil(note.parentId)) {
        return;
    }

    const parent = getNote(state, note.parentId);
    parent.data.lastSelectedChildIdx = parent.childIds.indexOf(note.id);
}

export function setIsEditingCurrentNote(state: NoteTreeGlobalState, isEditing: boolean) {
    state._isEditingFocusedNote = isEditing;

    if (isEditing) {
        const currentNote = getCurrentNote(state);
        pushNoteActivity(state, currentNote.id, false);
        setCurrentActivityIdxToCurrentNote(state);

        setNoteAsLastSelected(state, currentNote);

        state.textOnArrival = currentNote.data.text;
        state.textOnArrivalNoteId = currentNote.id;
    } else {
        if (!isCurrentlyTakingABreak(state)) {
            pushBreakActivity(state, newBreakActivity("Planning/organising tasks", new Date(), false));
        }
    }
}


export function findNextImportantNote(state: NoteTreeGlobalState, note: TreeNote, backwards = false): TreeNote | undefined {
    if (idIsNil(note.parentId)) {
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
    for (let i = idx + dir; i + dir >= -1 && i + dir <= siblings.length; i += dir) {
        const note = getNote(state, siblings[i]);
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
        const note = getNote(state, id);
        dfsPre(state, note, fn);
    }
}

export function getRootNote(state: NoteTreeGlobalState) {
    return getNote(state, tree.ROOT_ID);
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

// NOTE: doesn't detect the 'h'. so it might be inaccurate.
// You should do getNoteEstimate(note) === -1 instead.
function hasEstimate(text: string) {
    return parseNoteEstimate(text)[0] !== -1;
}

function isNumber(c: string) {
    return c === "." || ("0" <= c && c <= "9");
}

function isHms(c: string | undefined) {
    return c === undefined || c === "h" || c === "m" || c === "s";
}

export const ESTIMATE_START_PREFIX = "E=";
export function parseNoteEstimate(text: string): [estimate: number, start: number, end: number] {
    const start = text.indexOf(ESTIMATE_START_PREFIX);
    if (start === -1) {
        return [-1, -1, -1];
    }

    let totalMs = 0;

    let iLast = start + ESTIMATE_START_PREFIX.length;
    for (let i = iLast; i <= text.length; i++) {
        if (isNumber(text[i])) {
            continue;
        }

        if (isHms(text[i])) {
            const numStr = text.substring(iLast, i);
            iLast = i + 1;

            const num = parseFloat(numStr);

            if (text[i] === "h") {
                totalMs += num * ONE_HOUR;
            } else if (text[i] === "m") {
                totalMs += num * ONE_MINUTE;
            } else if (text[i] === "s") {
                totalMs += num * ONE_SECOND;
            }

            continue;
        }

        break;
    }

    return [totalMs, start, iLast + 1];
}

export function formatDurationAsEstimate(totalMs: number): string {
    const hours = Math.floor(totalMs / ONE_HOUR);
    const minutes = Math.floor((totalMs % ONE_HOUR) / ONE_MINUTE);
    const seconds = Math.floor(((totalMs % ONE_HOUR) % ONE_MINUTE) / ONE_SECOND);

    // Why tf do we support seconds for our estimates. lol. lmao even.
    return ESTIMATE_START_PREFIX + hours + "h" + pad2(minutes) + "m" + seconds + "s";
}

export function getParentNoteWithEstimate(state: NoteTreeGlobalState, note: TreeNote): TreeNote | undefined {
    let estimateNote = note;
    while (!idIsNil(estimateNote.parentId)) {

        if (hasEstimate(note.data.text)) {
            return estimateNote;
        }

        estimateNote = getNote(state, estimateNote.parentId);
    }

    return undefined;
}

export function getNoteEstimate(note: TreeNote): number {
    return parseNoteEstimate(note.data.text)[0];
}

export function getNoteChildEstimates(state: NoteTreeGlobalState, note: TreeNote): number {
    let totalEstimate = 0;

    const dfs = (note: TreeNote) => {
        for (const childId of note.childIds) {
            const note = getNote(state, childId);

            if (
                note.data._status === STATUS_DONE
                || note.data._status === STATUS_ASSUMED_DONE
            ) {
                // don't need an estimate, since we know exactly how long it took to complete, actually
                totalEstimate += getNoteDurationWithoutRange(state, note);
                continue;
            }

            if (!hasEstimate(note.data.text)) {
                dfs(note);
                continue;
            }

            totalEstimate += getNoteEstimate(note);
        }
    }
    dfs(note);

    return totalEstimate;
}

export function getSecondPartOfRow(state: NoteTreeGlobalState, note: TreeNote) {
    const duration = getNoteDurationWithoutRange(state, note);
    const durationStr = formatDuration(duration);
    const secondPart = " " + durationStr;
    return secondPart;
}

export function getRowIndentPrefix(_state: NoteTreeGlobalState, note: Note) {
    return `${getIndentStr(note)} ${noteStatusToString(note._status)}`;
}

export function getFirstPartOfRow(state: NoteTreeGlobalState, note: TreeNote) {
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


type AnalyticsSeries = {
    activityIndices: number[];

    // These values can be computed off the activities in the series
    duration: number;
}

export function newAnalyticsSeries(): AnalyticsSeries {
    return { activityIndices: [], duration: 0 };
}

export function resetAnalyticsSeries(series: AnalyticsSeries) {
    clearArray(state._activityIndices);
    series.duration = 0;
}

export function isBreak(activity: Activity): boolean {
    return activity.breakInfo !== undefined;
}

export function isMultiDay(activity: Activity, nextActivity: Activity | undefined): boolean {
    const t = getActivityTime(activity);
    const t1 = nextActivity ? getActivityTime(nextActivity) : new Date();

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
        if (getActivityTime(activity) < noteCreatedAt) {
            // Can't possibly be any activities before this
            break;
        }

        if (!activity.nId) {
            continue;
        }

        const activityNote = getNote(state, activity.nId);
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
    return getNoteOrUndefined(state, activity.nId);
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

    return getNote(state, selNoteId);
}

export function noteParentContainsNotesWithChildren(state: NoteTreeGlobalState, note: TreeNote): boolean {
    const parent = getNoteOrUndefined(state, note.parentId);
    if (!parent) {
        return false;
    }

    for (const id of parent.childIds) {
        const note = getNote(state, id);
        if (note.childIds.length > 0) {
            return true;
        }
    }

    return false;
}


export function setActivityRangeToToday(state: NoteTreeGlobalState) {
    const dateFrom = new Date();
    const dateTo = new Date();
    addDays(dateTo, 1);
    floorDateLocalTime(dateFrom);
    floorDateLocalTime(dateTo);
    state._currentDateScope = "any";
    state._activitiesFrom = dateFrom;
    state._activitiesTo = dateTo;
}

export function setActivityRangeToThisWeek(state: NoteTreeGlobalState) {
    const dateFrom = new Date();
    floorDateToWeekLocalTime(dateFrom);

    const dateTo = new Date(dateFrom.getTime());
    addDays(dateTo, 7);

    state._activitiesFrom = dateFrom;
    state._activitiesTo = dateTo;
}


export function deleteDoneNote(state: NoteTreeGlobalState, note: TreeNote): string | undefined {
    // WARNING: this is a A destructive action that permenantly deletes user data. Take every precaution, and do every check

    if (!hasNote(state, note.id)) {
        return "Note doesn't exist to delete. It may have already been deleted.";
    }

    recomputeState(state);

    if (note.data._status !== STATUS_DONE) {
        return "Notes that aren't DONE (i.e all notes under them are DONE) can't be deleted";
    }

    const parentId = note.parentId;
    if (idIsNil(parentId)) {
        return "Note needs a parent to be deleted";
    }

    // figure out where to move to if possible
    const parent = getNote(state, parentId);
    const idToMoveTo = parent.id;

    // Do the deletion
    tree.removeSubtree(state.notes, note);

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
        assert(!idIsNilOrUndefined(activity.nId));
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
    setCurrentNote(state, getCurrentNote(state).id);
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

        const aNote = getNote(state, a.nId);
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

        const aNote = getNote(state, a.nId);
        if (parentNoteContains(state, nId, aNote)) {
            return i;
        }
    }

    return -1;
}


export function shouldScrollToNotes(state: NoteTreeGlobalState): boolean {
    if (isEditingTextSomewhereInDocument() && !state._isEditingFocusedNote) {
        return false;
    }

    if (state._isShowingDurations) {
        return false;
    }

    return true;
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
let lastLoadedTime = "";
let loading = false;

let db: IDBDatabase | undefined;

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
                then("OLD_VERSION");
                return;
            }
        }
    }

    if (loading) {
        logTrace("Already loading!");
        return;
    }

    if (lastLoadedTime === localStorage.getItem(LAST_SAVED_TIMESTAMP_KEY)) {
        logTrace("We're already at the latest version, no need to reload");
        return;
    }

    loading = true;
    const thenInternal = (error: string) => {
        loading = false;
        lastLoadedTime = localStorage.getItem(LAST_SAVED_TIMESTAMP_KEY) || "";
        then(error);
    };

    logTrace("Opening DB...");
    const request = window.indexedDB.open(INDEXED_DB_KV_STORE_NAME, 1);
    request.onerror = (e) => {
        loadStateFromLocalStorage();
        console.error("Error requesting db - ", e, request.error);
        loading = false;
    }

    request.onupgradeneeded = () => {
        logTrace("Migrating DB...");

        db = request.result;

        // Need to make the database.
        // It's just a KV store. 

        const kvStore = db.createObjectStore(INDEXED_DB_KV_STORE_NAME, { keyPath: "key" });
        kvStore.createIndex("value", "value", { unique: false });
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
            loading = false;
        }

        txRequest.onsuccess = () => {
            logTrace("Checking IndexedDB...");
            const savedStateJSONWrapper: { key: string, value: string } | undefined = txRequest.result;
            if (!savedStateJSONWrapper) {
                logTrace("We don't have anything saved yet. We might have something in local storage though. If not, we'll just start with fresh state");

                // Let's just load the state from local storage in case it exists...
                loadStateFromLocalStorage();

                thenInternal("");
                return;
            }

            logTrace("Loaded data from IndexedDB (and not localStorage)");
            setStateFromJSON(savedStateJSONWrapper.value, thenInternal);
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
        lastLoadedTime = timestamp;

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

        note = getNote(state, note.parentId);
    }

    return result;
}

export function getNumSiblings(state: NoteTreeGlobalState, note: TreeNote): number {
    if (idIsNil(note.parentId)) return 0;
    const parent = getNote(state, note.parentId);
    return parent.childIds.length;
}

export function isLastNote(state: NoteTreeGlobalState, note: TreeNote) {
    const numSiblings = getNumSiblings(state, note);
    return note.idxInParentList === numSiblings - 1;
}

export function toggleActivityScopedNote(state: NoteTreeGlobalState) {
    if (!idIsNil(state._currentActivityScopedNoteId)) {
        state._currentActivityScopedNoteId = tree.NIL_ID;
    } else {
        state._currentActivityScopedNoteId = state.currentNoteId;
    }
}

export function isNoteInTaskStream(stream: TaskStream, note: TreeNote): boolean {
    return note.data._taskStreams.includes(stream);
}

export function indexOfNoteInTaskStream(stream: TaskStream, note: TreeNote): number {
    return stream.noteIds.indexOf(note.id);
}

export function getNumParentsInTaskStream(state: NoteTreeGlobalState, stream: TaskStream, note: TreeNote): number {
    let count = 0;
    let parentNote = note;
    while (!idIsNilOrRoot(parentNote.parentId)) {
        parentNote = getNote(state, parentNote.parentId);

        if (isNoteInTaskStream(stream, parentNote)) {
            count += 1;
        }
    }

    return count;
}

export function insertNewTaskStreamAt(state: NoteTreeGlobalState, idx: number, name: string) {
    if (idx < 0) return;

    const stream = newTaskStream(name);
    state.taskStreams.splice(idx, 0, stream);
}

export function deleteTaskStream(state: NoteTreeGlobalState, stream: TaskStream) {
    if (stream.noteIds.length > 0) {
        console.warn("Some code was trying to delete a task stream that stil contained notes");
        return;
    }

    const idx = state.taskStreams.indexOf(stream);
    if (idx === -1) {
        return;
    }

    state.taskStreams.splice(idx, 1);
}

export function addNoteToTaskStream(stream: TaskStream | null, note: TreeNote): boolean {
    if (stream) {
        if (!isNoteInTaskStream(stream, note)) {
            stream.noteIds.push(note.id);
            return true;
        }
    } else {
        if (!note.data._isScheduled) {
            state.scheduledNoteIds.push(note.id);
            return true;
        }
    }

    return false;
}

export function removeNoteFromNoteIds(noteIds: NoteId[], id: NoteId) {
    filterInPlace(noteIds, nId => nId !== id);
}

export type ViewCurrentScheduleState = {
    noteIdx: number;
    isEstimating: boolean;
    isEstimatingRemainder: boolean;
    remainderText: string;
    isConfiguringWorkday: boolean;
    goBack(): void;
};

export type ViewAllTaskStreamsState = {
    isRenaming: boolean;
    canDelete: boolean;
    isCurrentNoteInStream: boolean;
    isViewingCurrentStream: boolean;

    // expensive to compute - understandable if we only do this once when the modal appears
    viewTaskStreamStates: ViewTaskStreamState[];

    scheduleViewState: ViewCurrentScheduleState;
};


export const MIN_TASK_STREAM_IDX = -1;

export function recomputeViewAllTaskStreamsState(
    state: ViewAllTaskStreamsState,
    globalState: NoteTreeGlobalState,
    init: boolean,
    currentNote: TreeNote,
    taskStreams: TaskStream[],
) {
    if (init) {
        state.isRenaming = false;
        state.scheduleViewState.isEstimating = false;
        state.scheduleViewState.isEstimatingRemainder = false;
    }

    // NOTE: this may be expensive...
    // for now I'm not computing this on init, because we may reorder
    // the streams, and we'd have to recompute them... 
    // There may be a simple solution to this, but I can't think right now
    {
        state.viewTaskStreamStates.length = taskStreams.length;
        for (let i = 0; i < state.viewTaskStreamStates.length; i++) {
            if (!state.viewTaskStreamStates[i]) {
                state.viewTaskStreamStates[i] = {
                    isViewingInProgress: false,
                    taskStream: taskStreams[i], currentStreamNoteIdx: 0, streamNoteDepths: [], inProgressNotes: [],
                    isFinding: false,
                    currentQuery: "",
                };
            }

            if (init) {
                state.viewTaskStreamStates[i].isViewingInProgress = false;
                state.viewTaskStreamStates[i].isFinding = false;
                state.viewTaskStreamStates[i].currentQuery = "";
            }

            recomputeViewTaskStreamState(state.viewTaskStreamStates[i], globalState, taskStreams[i], false);
        }
    }

    if (init) {
        state.isViewingCurrentStream = false;

        const scheduleIdx = globalState.scheduledNoteIds.indexOf(currentNote.id);
        if (scheduleIdx !== -1) {
            state.isViewingCurrentStream = true;
            state.scheduleViewState.noteIdx = scheduleIdx;
            globalState.currentTaskStreamIdx = -1;
        } else {
            // we should open this modal to where this current note is, if possible.
            // Let's find the closest ancestor that is in any task stream:
            let noteWithStreams: TreeNote | undefined;
            {
                let parentNote = currentNote;
                while (!idIsNil(parentNote.parentId)) {
                    if (parentNote.data._taskStreams.length > 0) {
                        break;
                    }

                    parentNote = getNote(globalState, parentNote.parentId);
                }
                noteWithStreams = parentNote;
            }

            if (noteWithStreams) {
                for (const taskStream of noteWithStreams.data._taskStreams) {
                    globalState.currentTaskStreamIdx = taskStream._idx;
                    state.isViewingCurrentStream = true;

                    // If the current note is in the inProgressIds, let's focus that as well.
                    const streamViewState = getCurrentTaskStreamState(state, globalState);
                    if (streamViewState) {
                        streamViewState.isViewingInProgress = false;
                        const streamNoteIdx = taskStream.noteIds.indexOf(noteWithStreams.id);
                        // streamNoteIdx !== -1 because taskStream was taken from noteWithStreams
                        assert(streamNoteIdx !== -1);
                        assert(taskStream.noteIds.length === streamViewState.inProgressNotes.length);
                        const inProgressState = streamViewState.inProgressNotes[streamNoteIdx];
                        const inProgressIdx = inProgressState.inProgressIds.indexOf(currentNote.id);
                        if (inProgressIdx !== -1) {
                            streamViewState.isViewingInProgress = true;
                            inProgressState.currentInProgressNoteIdx = inProgressIdx;
                            // we found a stream where we were also in the progress ids. no need to continue looking
                            break;
                        }
                    }
                }
            }
        }
    }

    globalState.currentTaskStreamIdx = clamp(globalState.currentTaskStreamIdx, MIN_TASK_STREAM_IDX, taskStreams.length - 1);
    state.canDelete = false;
    state.isCurrentNoteInStream = false;

    const currentTaskStreamState = getCurrentTaskStreamState(state, globalState);
    const currentStream = currentTaskStreamState?.taskStream;
    if (currentStream) {
        state.canDelete = currentStream.noteIds.length === 0;
        state.isCurrentNoteInStream = isNoteInTaskStream(currentStream, currentNote);
    }
}

export function clamp(val: number, min: number, max: number) {
    if (val < min) return min;
    if (val > max) return max;
    return val;
}


export function getCurrentTaskStreamState(state: ViewAllTaskStreamsState, globalState: NoteTreeGlobalState): ViewTaskStreamState | undefined {
    if (globalState.currentTaskStreamIdx < 0) return undefined;
    if (globalState.currentTaskStreamIdx >= state.viewTaskStreamStates.length) return undefined;
    return state.viewTaskStreamStates[globalState.currentTaskStreamIdx];
}

export function recomputeViewTaskStreamState(
    state: ViewTaskStreamState,
    globalState: NoteTreeGlobalState,
    stream: TaskStream,
    // TODO: think about using this, if needed
    _skipExpensiveStuff = false,
) {
    state.taskStream = stream;

    state.currentStreamNoteIdx = clampIndexToArrayBounds(state.currentStreamNoteIdx, stream.noteIds);

    // recompute custom note ids and depths.
    {
        state.streamNoteDepths.length = stream.noteIds.length;
        for (let i = 0; i < state.streamNoteDepths.length; i++) {
            state.streamNoteDepths[i] = 0;
        }

        state.inProgressNotes.length = stream.noteIds.length;
        for (let i = 0; i < state.inProgressNotes.length; i++) {
            if (!state.inProgressNotes[i]) {
                state.inProgressNotes[i] = {
                    inProgressIds: [],
                    inProgressNoteDepths: [],
                    currentInProgressNoteIdx: 0,
                };
            }
            const current = state.inProgressNotes[i];

            // TODO: there may be a way to make use of different depths here.
            clearArray(current.inProgressIds);
            clearArray(current.inProgressNoteDepths);

            const id = stream.noteIds[state.currentStreamNoteIdx];
            if (!idIsNilOrUndefined(id)) {
                // add just the in-progress notes 
                const dfs = (note: TreeNote, depth: number) => {
                    for (const id of note.childIds) {
                        const note = getNote(globalState, id);
                        if (note.data._status !== STATUS_IN_PROGRESS) {
                            continue;
                        }
                        // dont add them twice...
                        // TODO: debug the performance...
                        if (stream.noteIds.includes(note.id)) {
                            continue;
                        }
                        if (current.inProgressIds.includes(note.id)) {
                            continue;
                        }

                        current.inProgressIds.push(note.id);
                        current.inProgressNoteDepths.push(depth);
                        dfs(note, depth + 1);
                    }
                }
                dfs(getNote(globalState, id), 0);
            }
        }

        // dont add notes that dont fit the query. (needs to be done after the DFS and not during).
        if (state.isFinding && state.currentQuery.length > 0) {
            for (let i = 0; i < state.inProgressNotes.length; i++) {
                const current = state.inProgressNotes[i];

                const newInProgressIds: NoteId[] = [];
                const newDepths: number[] = [];

                for (let i = 0; i < current.inProgressIds.length; i++) {
                    const note = getNote(globalState, current.inProgressIds[i]);

                    const result = fuzzyFind(note.data.text, state.currentQuery, { limit: 1, allowableMistakes: 1 });
                    if (result.ranges.length === 0) {
                        continue;
                    }

                    newInProgressIds.push(note.id);
                    newDepths.push(current.inProgressNoteDepths[i]);
                }

                current.inProgressNoteDepths = newDepths;
                current.inProgressIds = newInProgressIds;
            }
        }
    }


    // clamp after the array has been computed
    {
        for (let i = 0; i < state.inProgressNotes.length; i++) {
            const current = state.inProgressNotes[i];
            current.currentInProgressNoteIdx = clampIndexToArrayBounds(current.currentInProgressNoteIdx, current.inProgressIds);
        }
    }
}

export type InProgressNotesState = {
    inProgressIds: NoteId[];
    currentInProgressNoteIdx: number;
    inProgressNoteDepths: number[];
};

export function getCurrentInProgressState(state: ViewTaskStreamState): InProgressNotesState | undefined {
    return state.inProgressNotes[state.currentStreamNoteIdx];
}


export type ViewTaskStreamState = {
    isViewingInProgress: boolean; // are we viewing the 'in progress' note ids list? (not is the viewing in progress?)

    taskStream: TaskStream;
    currentStreamNoteIdx: number;
    streamNoteDepths: number[];

    inProgressNotes: InProgressNotesState[];
    currentQuery: string;
    isFinding: boolean;
};

export function applyPendingScratchpadWrites(state: NoteTreeGlobalState) {
    if (state._scratchPadCanvasLayers.length === 0) {
        return;
    }

    const scratchpadNote = getNoteOrUndefined(state, state._scratchPadCanvasCurrentNoteIdPendingSave);
    if (!scratchpadNote) {
        return;
    }

    const text = getLayersString(state._scratchPadCanvasLayers);
    scratchpadNote.data.text = text;

    // we don't need to update the text every time - just when we've actually written to it
    state._scratchPadCanvasCurrentNoteIdPendingSave = tree.NIL_ID;
}

export type TaskCompletion = {
    remaining: number;
    taskId: NoteId;
    date: Date;
};

export type TaskCompletions = {
    completions: TaskCompletion[];
    dayOffset: number;
    dateFloored: Date;
};

export type WorkdayConfigWeekDay = {
    dayStartHour: number;
    workingHours: number;
    // index 0 -> sunday
    weekdayFlags: Boolean7; // Could have been bitflags but no, we had to make it boolean[7]. xD
};

export function newWorkdayConfigWeekDay(dayStartHour: number = 0, workingHours: number = 0): WorkdayConfigWeekDay {
    return {
        dayStartHour,
        workingHours,
        weekdayFlags: [false, false, false, false, false, false, false],
    };
}


export type Boolean7 = [boolean, boolean, boolean, boolean, boolean, boolean, boolean];

export type WorkdayConfigHoliday = {
    name: string;
    date: Date;
}

export function getWorkdayConfigHolidayDate(wh: WorkdayConfigHoliday): Date {
    if (!wh.date) {
        const date = parseIsoDate(wh.date);
        if (!date) {
            wh.date = new Date(NaN);
        } else {
            wh.date = date;
        }
    }

    return wh.date;
}

export type WorkdayConfig = {
    weekdayConfigs: WorkdayConfigWeekDay[];
    holidays: WorkdayConfigHoliday[];
};


type WorkdayIterator = {
    wc: WorkdayConfig;
    workdayOffset: number;
    weekday: number;
    date: Date;
    timeOfDayNow: number;
    startOfDay: number;
    endOfDay: number;
}

export function hasAnyTimeAtAll(wc: WorkdayConfig): boolean {
    for (const wd of wc.weekdayConfigs) {
        if (wd.weekdayFlags.some(f => f)) {
            if (wd.workingHours > 0) {
                return true;
            }
        }
    }

    return false;
}

const DAYS_IN_LIFETIME = 365 * 200;

function advanceWorkdayIterator(it: WorkdayIterator, ms: number): boolean {
    let daysSimulated = 0;
    while (ms > 0) {
        if (daysSimulated > DAYS_IN_LIFETIME) {
            break;
        }

        const config = getTodayConfig(it);
        if (
            !config ||
            config.workingHours === 0 ||
            !config.weekdayFlags[it.weekday] ||
            isHoliday(it)
        ) {
            it.workdayOffset++;
            it.weekday = (it.weekday + 1) % 7;
            addDays(it.date, 1);
            resetIterator(it);
            daysSimulated++;
            continue;
        }

        const remainingTime = it.endOfDay - it.timeOfDayNow;

        if (ms - remainingTime < 0) {
            it.timeOfDayNow += ms;
            ms = 0;
        } else {
            ms -= remainingTime;
            it.workdayOffset++;
            it.weekday = (it.weekday + 1) % 7;
            addDays(it.date, 1);
            resetIterator(it);
            daysSimulated++;
            continue;
        }
    }

    return true;
}

function getTodayConfig(it: WorkdayIterator): WorkdayConfigWeekDay | undefined {
    let config: WorkdayConfigWeekDay | undefined;
    for (const c of it.wc.weekdayConfigs) {
        if (c.weekdayFlags[it.weekday]) {
            config = c;
            break;
        }
    }
    return config;
}

function isHoliday(it: WorkdayIterator): boolean {
    for (const wh of it.wc.holidays) {
        const date = getWorkdayConfigHolidayDate(wh);
        if (
            it.date.getFullYear() === date.getFullYear() && 
            it.date.getMonth() === date.getMonth() &&
            it.date.getDate() === date.getDate()
        ) {
            return true;
        }
    }

    return false;
}

function resetIterator(it: WorkdayIterator) {
    const config = getTodayConfig(it);

    if (!config) {
        it.startOfDay = 0;
        it.endOfDay = 0;
        it.timeOfDayNow = 0;
    } else {
        // We actually start this iterator at the current time _now_, and only use the dayStartHour for the following days.
        if (it.workdayOffset === 0) {
            const now = new Date();
            it.startOfDay = now.getHours() * ONE_HOUR + now.getMinutes() * ONE_MINUTE;
        } else {
            it.startOfDay = config.dayStartHour * ONE_HOUR;
        }
        // Assume we won't pull an all-nighter - limit endOfDay to 24 hrs
        it.endOfDay = Math.min(ONE_DAY, it.startOfDay + Math.max(config.workingHours, 0) * ONE_HOUR);
        it.timeOfDayNow = it.startOfDay;
    }
}

// NOTE: calling this method will sort the holidays in the workday config
export function predictTaskCompletions(
    state: NoteTreeGlobalState, 
    noteIds: NoteId[], 
    wc: WorkdayConfig,
    dst: TaskCompletions[],
) {
    dst.length = 0;

    wc.holidays.sort((a, b) => {
        return getWorkdayConfigHolidayDate(a).getTime() 
            - getWorkdayConfigHolidayDate(b).getTime();
    });

    if (!hasAnyTimeAtAll(wc)) {
        return;
    }

    const it: WorkdayIterator = { 
        wc, startOfDay: 0, endOfDay: 0, timeOfDayNow: 0, workdayOffset: 0, 
        weekday: (new Date()).getDay(),
        date: new Date(),
    };
    floorDateLocalTime(it.date);
    resetIterator(it);

    for (let i = 0; i < noteIds.length; i++) {
        const id = noteIds[i];
        const note = getNote(state, id);

        let estimate = getNoteEstimate(note);
        if (estimate === -1) {
            estimate = 0;
        }

        const duration = getNoteDurationWithoutRange(state, note);
        const remaining = estimate - duration;

        advanceWorkdayIterator(it, remaining);

        const estimatedCompletion = new Date();
        floorDateLocalTime(estimatedCompletion);
        addDays(estimatedCompletion, it.workdayOffset);
        estimatedCompletion.setMilliseconds(it.timeOfDayNow);

        const completion: TaskCompletion = { taskId: id, date: estimatedCompletion, remaining };

        if (dst.length > 0) {
            const lastCompletion = dst[dst.length - 1];
            if (lastCompletion.dayOffset === it.workdayOffset) {
                lastCompletion.completions.push(completion);
                continue;
            }
        } 

        const dateFloored = new Date(estimatedCompletion);
        floorDateLocalTime(dateFloored);

        dst.push({
            dayOffset: it.workdayOffset,
            dateFloored,
            completions: [completion]
        });
    }
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

