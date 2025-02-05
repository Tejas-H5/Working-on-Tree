import { AsciiCanvasLayer } from "src/canvas";
import { assert } from "src/utils/assert";
import { addDays, floorDateLocalTime, floorDateToWeekLocalTime, formatDate, formatDuration, getTimestamp } from "src/utils/datetime";
import { logTrace } from "src/utils/log";
import { recursiveShallowCopy } from "src/utils/serialization-utils";
import * as oldTree from "src/utils/tree";
import * as tree from "src/utils/int-tree";

import { GraphData, newGraphData } from "./interactive-graph";
import { Insertable, isEditingTextSomewhereInDocument, newColor, newColorFromHex, setCssVars } from "./utils/dom-utils";
import { Theme } from "./styling";
import { clearArray, filterInPlace } from "./utils/array-utils";
import { fuzzyFind, scoreFuzzyFind, Range } from "./utils/fuzzyfind";

const lightThemeColours: Theme = {
    bgInProgress: newColor(1, 0, 0, 0.1),
    fgInProgress: newColorFromHex("#FFF"),
    bgColor: newColorFromHex("#FFF"),
    bgColorFocus: newColorFromHex("#CCC"),
    bgColorFocus2: newColor(0, 0, 0, 0.4),
    fgColor: newColorFromHex("#000"),
    unfocusTextColor: newColorFromHex("#A0A0A0"),
    pinned: newColorFromHex("#0A0"),
    focusedTreePathWidth: "4px",
    unfocusedTreePathWidth: "1px",
};

const darkThemeColours: Theme = {
    bgInProgress: newColor(1, 0, 0, 0.1),
    fgInProgress: newColorFromHex("#FFF"),
    bgColor: newColorFromHex("#000"),
    bgColorFocus: newColorFromHex("#333"),
    bgColorFocus2: newColor(1, 1, 1, 0.4),
    fgColor: newColorFromHex("#EEE"),
    unfocusTextColor: newColorFromHex("#707070"),
    pinned: newColorFromHex("#0A0"),
    focusedTreePathWidth: "4px",
    unfocusedTreePathWidth: "1px",
};

export function setTheme(newTheme: AppTheme) {
    state.currentTheme = newTheme;

    if (newTheme === "Light") {
        setCssVars(lightThemeColours);
    } else {
        setCssVars(darkThemeColours);
    }
};


export type NoteId = number;

export type TreeNote = tree.TreeNode<Note>;

export type DockableMenu = "activities" | "quicklist";
export type AppTheme = "Light" | "Dark";

export type CurrentDateScope = "any" | "week";

export type FuzzyFindState = {
    query: string;
    matches: NoteFuzzyFindMatches[];
    counts: {
        numInProgress: number;
        numFinished: number;
        numShelved: number;
        numPinned: number;
    },
    currentIdx: number;
    currentIdxLocal: number;
    currentIdxGlobal: number;
    scopedToNoteId: NoteId;
}

function newFuzzyFindState(): FuzzyFindState {
    return {
        query: "",
        matches: [],
        counts: {
            numInProgress: 0,
            numFinished: 0,
            numShelved: 0,
            numPinned: 0,
        },
        currentIdx: 0,
        currentIdxLocal: 0,
        currentIdxGlobal: 0,
        scopedToNoteId: -1,
    };
}


// NOTE: this is just the state for a single note tree.
// We can only edit 1 tree at a time, basically
export type NoteTreeGlobalState = {
    /** Tasks organised by problem -> subproblem -> subsubproblem etc., not necessarily in the order we work on them */
    notes: tree.TreeStore<Note>;
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

    scratchPadCanvasLayers: AsciiCanvasLayer[];

    mainGraphData: GraphData;

    settings: AppSettings;
    // This might make the program unopenable, so it's a transient setting for now
    _showAllNotes: boolean;

    // Schema major versions
    // undefined -> the schema we've had since almost the start
    // 2 ->         the tree is no longer backed by a Record<string, Node> tree, but by a Node[] tree that can be indexed directly like an array.
    schemaMajorVersion: number | undefined;

    // non-serializable fields start with _

    _criticalLoadingError: string;

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
    _fuzzyFindState: FuzzyFindState;

    // App state
    _currentModal: Insertable | null;
};

type AppSettings = {
    nonEditingNotesOnOneLine: boolean;
    parentNotesOnOneLine: boolean;
};

type JsonBoolean = true | undefined;

export type Note = {
    id: NoteId;
    text: string;

    // will be populated as soon as the note is created.
    // TODO: display this info somewhere
    openedAt: string; 

    lastSelectedChildIdx: number; // this is now an index into our child array saying which one we sleected last.
    isSticky: JsonBoolean; // Should this note be pinned / marked as important?

    // non-serializable fields
    _status: NoteStatus; // used to track if a note is done or not.
    _shelved: boolean;
    _everyChildNoteDone: boolean;
    _isSelected: boolean; // this now just means "is this note the current note or an ancestor of the current note?"
    _isUnderCurrent: boolean; // used to calculate the duration of a specific task. Or as an arbitrary boolean flag for anything really.
    _higherLevelTaskId: NoteId; // the note's higher level task, as per the TODO list calculation. This is only valid if it's in the TODO list.
    _depth: number; // used to visually indent the notes
    _durationUnranged: number;
    _durationUnrangedOpenSince?: Date; // used for recomputing realtime durations - only notes with this thing set would still be increasing in duration
    _durationRanged: number;
    _durationRangedOpenSince?: Date;
    _activityListMostRecentIdx: number; // what is our position inside of NoteTreeGlobalState#_todoNoteIds ?
    _index: number; // which position is this in the current child list?
    _numSiblings: number;

    // for the tree visuals
    _isVisualLeaf: boolean; // Does this note have it's children expanded in the tree note view?
    _selectedPathDepth: number;  // NOTE - not set if it isn't being displayed
    _selectedPathDepthIsFirst: boolean;  // Is this the first note on the selected path at this depth? (Nothing to do with Depth first search xD)
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
        notes,
        currentNoteId: -1,
        dockedMenu: "activities",
        showDockedMenu: false,
        activities: [],
        scratchPadCanvasLayers: [],
        mainGraphData: newGraphData(),
        settings: {
            nonEditingNotesOnOneLine: true,
            parentNotesOnOneLine: true,
        },
        _showAllNotes: false,
        currentTheme: "Light",
        breakAutoInsertLastPolledTime: "",
        criticalSavingError: "",

        // Only increment this for massive changes! Otherwise, try to keep migrations bacwards compatible
        schemaMajorVersion: 2,

        _flatNoteIds: [], // used by the note tree view, can include collapsed subsections
        _isEditingFocusedNote: false, // global flag to control if we're editing a note

        // don't set this if our tree is corrupted!
        _criticalLoadingError: "",

        _currentlyViewingActivityIdx: 0,
        _currentActivityScopedNoteId: -1,
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
        _currentFlatNotesRootId: -1,
        _currentFlatNotesRootHltId: -1,
        _fuzzyFindState: newFuzzyFindState(),

        _currentModal: null,
    };

    setActivityRangeToToday(state);

    return state;
}

interface LoadStateFromJSONResult {
    state?: NoteTreeGlobalState;
    error?: string;
    criticalError?: string;
}

export function loadStateFromJSON(savedStateJSON: string): LoadStateFromJSONResult {
    if (!savedStateJSON) {
        return { error: "JSON was empty" };
    }

    try {
        const loadedState = JSON.parse(savedStateJSON) as NoteTreeGlobalState;
        migrateState(loadedState);
        return { state: loadedState };
    } catch (err: any) {
        return { criticalError: err.message }
    }
}

function migrateToSchemaMajorVersion2(loadedState: NoteTreeGlobalState, defaultState: NoteTreeGlobalState) {
    if (loadedState.schemaMajorVersion && loadedState.schemaMajorVersion >= 2) {
        return;
    }

    if (!loadedState.notes) {
        throw new Error("No notes present for us to migrate");
    }

    // ---- UNSAFE CODE ----
    // The types on loadedState are not what they seem - we've just loaded it from some JSON, could be literally anything.
    
    const newIdsMap = new Map<string, number>();

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
        ) ?? -1;
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

export function migrateState(loadedState: NoteTreeGlobalState) {
    const defaultState = newNoteTreeGlobalState();

    migrateToSchemaMajorVersion2(loadedState, defaultState);

    // prevents missing item cases that may occur when trying to load an older version of the state.
    // it is our way of auto-migrating the schema. Only works for new root level keys and not nested ones tho
    // TODO: handle new fields in notes. Shouldn't be too hard actually
    const mergedLoadedState = autoMigrate(loadedState, newNoteTreeGlobalState());

    tree.forEachNode(mergedLoadedState.notes, (note) => {
        const node = tree.getNode(mergedLoadedState.notes, note.id);
        node.data = autoMigrate(node.data, defaultNote());
    });

    // I should actually be doing mgrations and validations here but I'm far too lazy

    return mergedLoadedState;

}

export function setStateFromJSON(savedStateJSON: string | Blob, then?: () => void) {
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
        logTrace("Loading a new state would be a mistake right about now");
        state._criticalLoadingError = loaded.criticalError;
    } else if (loaded.error) {
        logTrace("Couldn't load state - " + loaded.error);
        state = newNoteTreeGlobalState();
    } else if (loaded.state) {
        state = loaded.state;
    }

    // NOTE: even the error paths should call `then`
    then?.();

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
        id: -1,
        text: "",
        openedAt: getTimestamp(new Date()),
        lastSelectedChildIdx: 0,
        isSticky: undefined,

        // the following are just visual flags which are frequently recomputed

        _status: STATUS_IN_PROGRESS,
        _shelved: false,
        _everyChildNoteDone: false,
        _higherLevelTaskId: -1,
        _isSelected: false,
        _isUnderCurrent: false,
        _depth: 0,
        _durationUnranged: 0,
        _durationRanged: 0,
        _activityListMostRecentIdx: 0,
        _index: 0,
        _numSiblings: 0,
        _isVisualLeaf: false,
        _selectedPathDepth: -1,
        _selectedPathDepthIsFirst: false,
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

export function recomputeFlatNotes(state: NoteTreeGlobalState, flatNotes: NoteId[], currentNote: TreeNote, includeParents: boolean) {
    clearArray(flatNotes);

    const parent = getNoteOrUndefined(state, currentNote.parentId);
    if (!parent) {
        return;
    }

    if (includeParents) {
        // Add the parents to the top of the list
        let note = currentNote;
        while (!idIsNilOrRoot(note.parentId)) {
            note = getNote(state, note.parentId);
            flatNotes.push(note.id);
        }

        flatNotes.reverse();
    }

    const dfs = (note: TreeNote) => {
        flatNotes.push(note.id);

        note.data._isVisualLeaf = note.childIds.length === 0 || 
            isStoppingPointForNotViewExpansion(state, note);
        if (note.data._isVisualLeaf) {
            return;
        }

        for (const childId of note.childIds) {
            const note = getNote(state, childId);
            dfs(note);
        }
    }

    for (const childId of parent.childIds) {
        const note = getNote(state, childId);
        dfs(note);
    }
}

export function setActivityTime(activity: Activity, t: Date) {
    activity.t = getTimestamp(t);
    activity._t = t;
}

export function getActivityTime(activity: Activity | undefined) {
    if (!activity) {
        return new Date();
    }

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
export function recomputeState(state: NoteTreeGlobalState) {
    assert(!!state, "WTF");

    // delete the empty notes
    {
        tree.forEachNode(state.notes, (n) => {
            if (n.childIds.length === 0 && n.id !== state.currentNoteId) {
                deleteNoteIfEmpty(state, n.id)
            }
        });
    }

    // recompute _depth, _parent, _index. Somewhat required for a lot of things after to work.
    // tbh a lot of these things should just be updated as we are moving the elements around, but I find it easier to write this (shit) code at the moment
    {
        const dfs = (note: TreeNote, depth: number, index: number, numSiblings: number) => {
            note.data._depth = depth;
            note.data._index = index;
            note.data._numSiblings = numSiblings;

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

    // recompute _status, do some sorting
    {
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
    }

    // recompute _isSelected to just be the current note + all parent notes 
    {
        tree.forEachNode(state.notes, (note) => {
            note.data._isSelected = false;
        });

        const current = getCurrentNote(state);

        let note = current;
        while (!idIsNil(note.parentId)) {
            note.data._isSelected = true;
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
            state._activityIndices.splice(0, state._activityIndices.length);

            let start = useDurations ? state._activitiesFromIdx : 0;
            let end = useDurations ? state._activitiesToIdx : state.activities.length - 1;

            for (let i = start; i >= 0 && i <= end; i++) {
                const activity = state.activities[i];

                if (!idIsNil(state._currentActivityScopedNoteId) && (
                    activity.deleted ||
                    !activity.nId ||
                    !isNoteUnderParent(state, state._currentActivityScopedNoteId, getNote(state, activity.nId),)
                )) {
                    continue;
                }

                state._activityIndices.push(i);
            }
        }
    }

    // remove deleted notes from the quicklist
    {
        filterInPlace(state._fuzzyFindState.matches, (match) => {
            return !!getNoteOrUndefined(state, match.note.id);
        });
    }

    // recompute _flatNoteIds and _parentFlatNoteIds (after deleting things)
    {
        if (!state._flatNoteIds) {
            state._flatNoteIds = [];
        }

        if (state._showAllNotes) {
            state._currentFlatNotesRootId = 0;
            state._currentFlatNotesRootHltId = 0;

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
    }

    // recompute tree visual path _selectedPathDepth, _selectedPathDepthIsFirst from _flatNoteIds
    {
        for (const id of state._flatNoteIds) {
            const note = getNote(state, id);
            note.data._selectedPathDepth = -1;
            note.data._selectedPathDepthIsFirst = false;
        }

        const currentNote = getCurrentNote(state);
        const currentNoteIdx = state._flatNoteIds.indexOf(currentNote.id);
        if (currentNoteIdx !== -1) {
            // If you take a picture of the tree diagram and then trace out
            // the 'focused' path, then this code will actually make sense
            let currentFocusedDepth = currentNote.data._depth;
            for (let i = currentNoteIdx; i >= 0; i--) {
                const id = state._flatNoteIds[i];
                const note = getNote(state, id);

                let newDepth = Math.min(currentFocusedDepth, note.data._depth);

                note.data._selectedPathDepth = newDepth;
                note.data._selectedPathDepthIsFirst = i === currentNoteIdx || 
                    currentFocusedDepth !== newDepth;

                currentFocusedDepth = newDepth;
            }
        }
    }
}

export function setFuzzyFindIndex(state: FuzzyFindState, idx: number) {
    if (idx < 0) {
        idx = 0;
    }
    if (idx >= state.matches.length) {
        idx = state.matches.length - 1;
    }

    state.currentIdx = idx;
    if (!idIsNil(state.scopedToNoteId)) {
        state.currentIdxLocal = state.currentIdx;
    } else {
        state.currentIdxGlobal = state.currentIdx;
    }
}

export function setQuicklistIndex(state: NoteTreeGlobalState, idx: number) {
    setFuzzyFindIndex(state._fuzzyFindState, idx);
}

export function getQuicklistIndex(state: NoteTreeGlobalState): number {
    return state._fuzzyFindState.currentIdx;
}

export function isCurrentNoteOnOrInsideNote(state: NoteTreeGlobalState, note: TreeNote): boolean {
    return note.data._isSelected ||    // Current note inside this note
        isNoteUnderParent(state, state.currentNoteId, note);    // Current note directly above this note
}

export function isNoteUnderParent(state: NoteTreeGlobalState, parentId: NoteId, note: TreeNote): boolean {
    // one of the parents is the current note
    while (!idIsNil(note.parentId)) {
        if (note.id === parentId) {
            return true;
        }
        note = getNote(state, note.parentId);
    }

    return false;
}

// The note that we're in may be an 'expanded' note, and not necessarily the root of the view.
// The `upwards` param allows it to be assymetrical with respect to uwpards and downwards traversals.
export function isStoppingPointForNotViewExpansion(state: NoteTreeGlobalState, note: TreeNote): boolean {
    return isHigherLevelTask(note)
        || note.id === 0
        || (
            note.data._status !== STATUS_IN_PROGRESS && 
            !(note.data._isSelected && note.id !== state.currentNoteId)
        );
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


export function deleteNoteIfEmpty(state: NoteTreeGlobalState, id: NoteId) {
    const note = getNote(state, id);
    if (note.data.text.length > 0) {
        return false;
    }

    if (!note.data.text && note.childIds.length > 0) {
        note.data.text = "Some note we cant delete because of the x" + note.childIds.length + " notes under it :(";
        return true;
    }

    if (idIsNil(note.parentId)) {
        return false;
    }

    if (tree.getSizeExcludingRoot(state.notes) <= 1) {
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

    while (state.activities.length > 0 && state.activities[state.activities.length - 1].deleted) {
        state.activities.pop();
    }

    // setting the note appends an activity. so we have to do it at the end
    setCurrentNote(state, noteToMoveTo);

    return true;
}

export function insertNoteAfterCurrent(state: NoteTreeGlobalState) {
    const currentNote = getCurrentNote(state);
    assert(!idIsNil(currentNote.parentId), "Cant insert after the root note");
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
    assert(!idIsNil(currentNote.parentId), "Cant insert under the root note");
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

export function idIsNilOrUndefined(id: NoteId | null | undefined): id is -1 | null | undefined {
    return id === -1 || id === null || id === undefined;
}

/** 
 * mainly used in parent traversals when we do want to start on the current note. 
 */
export function idIsNil(id: NoteId): boolean {
    return id === -1;
}

/** 
 * mainly used in parent traversals when we don't want to start on the current note.
 */
export function idIsNilOrRoot(id: NoteId): boolean {
    return id === -1 || id === 0;
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

export function pushBreakActivity(state: NoteTreeGlobalState, breakActivtiy: Activity) {
    if (breakActivtiy.nId || !breakActivtiy.breakInfo) {
        throw new Error("Invalid break activity");
    }

    pushActivity(state, breakActivtiy);

    if (state._isEditingFocusedNote) {
        setIsEditingCurrentNote(state, false);
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

export function setCurrentNote(state: NoteTreeGlobalState, noteId: NoteId | null, saveJump = false) {
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
            (!note.data._isSelected && note.data.isSticky) ||
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
    return getNote(state, 0);
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
function hasEstimate(text: string) {
    return parseNoteEstimate(text) !== -1;
}

function isNumber(c: string) {
    return c === "." || ("0" <= c && c <= "9");
}

function isHms(c: string | undefined) {
    return c === undefined || c === "h" || c === "m" || c === "s";
}

function parseNoteEstimate(text: string): number {
    const ONE_SECOND = 1000;
    const ONE_MINUTE = ONE_SECOND * 60;
    const ONE_HOUR = 60 * ONE_MINUTE;

    const DELIMITER = "E=";
    const start = text.indexOf(DELIMITER);
    if (start === -1) {
        return -1;
    }

    let totalMs = 0;

    let iLast = start + DELIMITER.length;
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

    return totalMs;
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
    return parseNoteEstimate(note.data.text);
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


const fieldsToMigrate = new Set(["settings"]);

function autoMigrate<T extends object>(loadedData: T, defaultSchema: T) {
    for (const k in defaultSchema) {
        const defaultValue = defaultSchema[k];
        if (!(k in loadedData)) {
            loadedData[k] = defaultValue;
            continue;
        }

        // Migrate nested objects.
        // TODO: less hardcoded solution, this only works for 1 level deep
        if (
            typeof defaultValue === "object" && 
            defaultValue !== null &&
            fieldsToMigrate.has(k)
        ) {
            autoMigrate(
                loadedData[k] as Record<string, object>, 
                defaultValue as Record<string, object>,
            );
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
        if (activityNote.id !== note.id && isNoteUnderParent(state, note.id, activityNote)) {
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
        if (isNoteUnderParent(state, nId, aNote)) {
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
        if (isNoteUnderParent(state, nId, aNote)) {
            return i;
        }
    }

    return -1;
}

export function toggleNoteSticky(note: TreeNote) {
    note.data.isSticky = (!note.data.isSticky) || undefined;
}

export function shouldScrollToNotes(state: NoteTreeGlobalState): boolean {
    if (isEditingTextSomewhereInDocument() && !state._isEditingFocusedNote) {
        return false;
    }

    if (state._isShowingDurations) {
        return false;
    }

    if (state._currentModal) {
        return false;
    }

    return true;
}

export function resetState() {
    state = newNoteTreeGlobalState();
}


type NoteFuzzyFindMatches = {
    note: TreeNote;
    ranges: Range[];
    score: number;
};

export function fuzzySearchNotes(
    state: NoteTreeGlobalState,
    rootNote: TreeNote,
    query: string,
    matches: NoteFuzzyFindMatches[],
) {
    matches.splice(0, matches.length);

    if (query.length === 0) {
        // if no query, default to just the pinned items.

        dfsPre(state, rootNote, (note) => {
            if (note.data.isSticky) {
                matches.push({
                    note,
                    ranges: [],
                    score: note.data._activityListMostRecentIdx,
                });
            }
        });

        matches.sort((a, b) => b.score - a.score);
        return;
    }

    const SORT_BY_SCORE = 1;
    const SORT_BY_RECENCY = 2;

    let useMinScore = true;
    let sortMethod = SORT_BY_SCORE;

    // this can chain with the other two queries
    const isShelvedQuery = query.startsWith("||");
    if (isShelvedQuery) {
        query = query.substring(2).trim();
    }

    // Adding a few carve-outs specifically for finding tasks in progress and higher level tasks.
    // It's too hard to find them in the todo list, so I'm trying other options.
    const isHltQuery = query.startsWith(">>");
    const isInProgressQuery = query.startsWith(">") && !isHltQuery;

    if (isHltQuery) {
        query = query.substring(2).trim();
    } else if (isInProgressQuery) {
        query = query.substring(1).trim();
    } 

    if (isHltQuery || isInProgressQuery || isShelvedQuery) {
        if (query.trim().length === 0) {
            sortMethod = SORT_BY_RECENCY;
            useMinScore = false;
        }
    }

    dfsPre(state, rootNote, (n) => {
        if (idIsNil(n.parentId)) {
            // ignore the root note
            return;
        }

        let text = n.data.text.toLowerCase();

        if (
            isShelvedQuery ||
            isHltQuery ||
            isInProgressQuery
        ) {
            if (isShelvedQuery !== n.data._shelved) {
                return;
            }

            if (isShelvedQuery && isHltQuery) {
                if (!isNoteRequestingShelf(n.data)) {
                    return;
                }

                const parent = getNoteOrUndefined(state, n.parentId);
                if (parent && isNoteRequestingShelf(parent.data)) {
                    // If `n` wants to be shelved but its parent is already shelved, 
                    // don't include this in the list of matches
                    return;
                }
            }

            if (isHltQuery && !isHigherLevelTask(n)) {
                return;
            }

            if (isInProgressQuery && isHigherLevelTask(n)) {
                return;
            }

            if (isHltQuery || isInProgressQuery) {
                if (n.data._status !== STATUS_IN_PROGRESS) {
                    return;
                }
            }
        }

        let results = fuzzyFind(text, query);
        let score = 0;

        if (sortMethod === SORT_BY_RECENCY) {
            score -= n.data._activityListMostRecentIdx;
        } else {
            score = scoreFuzzyFind(results);
            if (n.data._status === STATUS_IN_PROGRESS) {
                score *= 2;
            }
        }

        if (useMinScore) {
            const minScore = getMinFuzzyFindScore(query);
            if (score < minScore) {
                return;
            }
        }

        if (n.data.isSticky) {
            score += 999999;
        }

        matches.push({
            note: n,
            ranges: results,
            score,
        });
    });

    matches.sort((a, b) => {
        return b.score - a.score;
    });
}

// yep, doesnt need any info about the matches, total count, etc.
// Although, I do wonder if this is the right place for it. 
// This only works because I know the implementation of the fuzzy find scoring algo, since I wrote it
function getMinFuzzyFindScore(query: string, strict = false) {
    if (!strict) {
        return Math.pow(query.length * 0.3, 2);
    }

    return Math.pow(query.length * 0.7, 2);
}


// TODO: rename to `globalState`
export let state = newNoteTreeGlobalState();


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

        assert(!!db, "DB should be defined here");
        const kvStore = db.transaction([INDEXED_DB_KV_STORE_NAME], "readonly")
            .objectStore(INDEXED_DB_KV_STORE_NAME);

        const txRequest = kvStore.get(KV_STORE_STATE_KEY);
        txRequest.onerror = (e) => {
            console.error("Error getting kv store - ", e, request.error);
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
            setStateFromJSON(savedStateJSONWrapper.value, then);
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

    const nonCyclicState = recursiveShallowCopy(state);
    const serialized = JSON.stringify(nonCyclicState);

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
    while (!idIsNil(note.parentId)) {
        if (isHigherLevelTask(note)) {
            return note;
        }

        note = getNote(state, note.parentId);
    }

    return undefined;
}


export function toggleActivityScopedNote(state: NoteTreeGlobalState) {
    if (!idIsNil(state._currentActivityScopedNoteId)) {
        state._currentActivityScopedNoteId = -1;
    } else {
        state._currentActivityScopedNoteId = state.currentNoteId;
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
    const nonCyclicState = recursiveShallowCopy(state);
    const serialized = JSON.stringify(nonCyclicState);
    return serialized;
}

export function loadStateFromBackup(text: string): NoteTreeGlobalState | null {
    const obj = JSON.parse(text);
    if (LOCAL_STORAGE_KEY_LEGACY in obj) {
        logTrace("Loading legacy backup format");
        return loadStateFromJSON(obj[LOCAL_STORAGE_KEY_LEGACY]).state ?? null;
    }

    // I expect there to be 1 more format if I ever start storing multiple keys in the kv store. But
    // I have already decided against this due to the much higher potential for bugs r.e partial saving
    logTrace("Loading backup format v2");
    return migrateState(obj as NoteTreeGlobalState);
}

