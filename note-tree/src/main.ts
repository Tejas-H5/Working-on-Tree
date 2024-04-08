import "./styles.css"
import "./style-utils.css"

import {
    Insertable,
    Renderable,
    appendChild,
    assert,
    makeComponent,
    setClass,
    setInputValue,
    setInputValueAndResize,
    setTextContent,
    setVisible,
    makeComponentList as makeComponentList,
    div,
    el,
} from "./dom-utils";

import * as tree from "./tree";
import { filterInPlace } from "./array-utils";
import { Checkbox, DateTimeInput, FractionBar, Modal, makeButton } from "./generic-components";
import { formatDate, truncate } from "./utils";

// const INDENT_BASE_WIDTH = 100;
// const INDENT_WIDTH_PX = 50;
const SAVE_DEBOUNCE = 1000;
const STATUS_TEXT_PERSIST_TIME = 1000;
const ERROR_TIMEOUT_TIME = 5000;


function isDoneNote(note: Note) {
    return note.text.startsWith("DONE") || note.text.startsWith("Done") || note.text.startsWith("done");
}
function isTodoNote(note: Note) {
    return note.text.startsWith("TODO") || note.text.startsWith("Todo") || note.text.startsWith("todo");
}

type NoteStatus = 1 | 2 | 3;

/** This is a task that is currently in progress */
const STATUS_IN_PROGRESS: NoteStatus = 1;
/**
 * This is a task that you haven't marked as DONE, but we are assuming it is done,
 * because you've moved on to the next task.
 * This status exists, so that you dont have to manually close off every single tas with a new - Done note under it.
 */
const STATUS_ASSUMED_DONE: NoteStatus = 2;
/**
 * This is a task that is marked as DONE at the end.
 * Marking a note as DONE marks all notes before it as DONE, i.e no longer assumed done, but actually done.
 * Only these tasks may be moved out of a note.
 * This ensures that even in the 'done' tree, all notes are calculated as done.
 */
const STATUS_DONE: NoteStatus = 3;

function getNoteStateString(note: Note) {
    switch (note._status) {
        case STATUS_IN_PROGRESS:
            return "[...]";
        case STATUS_ASSUMED_DONE:
            return "[ * ]";
        case STATUS_DONE:
            return "[ x ]";
    }
}

const ALL_FILTERS: [string, NoteFilter][] = [
    ["No filters", null],
    ["Done", { not: false, status: STATUS_DONE }],
    ["Not-done", { not: true, status: STATUS_DONE }],
];

function formatDuration(ms: number) {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / 1000 / 60) % 60;
    const hours = Math.floor(ms / 1000 / 60 / 60) % 24;
    const days = Math.floor(ms / 1000 / 60 / 60 / 24);

    if (ms < 1000) {
        return `${ms} ms`;
    }

    const str = [];
    if (days) {
        str.push(`${days} days`);
    }

    if (hours) {
        // str.push(`${hours} hours`);
        str.push(`${hours} h`);
    }

    if (minutes) {
        // str.push(`${minutes} minutes`);
        str.push(`${minutes} m`);
    }

    if (seconds) {
        // str.push(`${seconds} seconds`);
        str.push(`${seconds} s`);
    }

    return str.join(", ");
}

function getDurationMS(aIsoString: string, bIsoString: string) {
    return new Date(bIsoString).getTime() - new Date(aIsoString).getTime();
}

// function getLastNote(state: State, lastNote: tree.TreeNode<Note>) {
//     while (lastNote.childIds.length > 0) {
//         lastNote = getNote(state, lastNote.childIds[lastNote.childIds.length - 1]);
//     }

//     return lastNote;
// }

function getTimestamp(date: Date) {
    return date.toISOString();
}

// https://stackoverflow.com/questions/105034/how-do-i-create-a-guid-uuid
function uuid() {
    function S4() {
        return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
    }
    return S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4();
}

type Note = {
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
type Activity = {
    nId?: NoteId;
    t: string;

    // only apply to breaks:
    breakInfo?: string;
    locked?: true;
}

function defaultNote() : Note {
    return {
        // the following is valuable user data

        id: uuid(),
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


function getActivityText(state: State, activity: Activity): string {
    if (activity.nId) {
        return getNote(state, activity.nId).data.text;
    }

    if (activity.breakInfo) {
        return activity.breakInfo;
    }

    return "< unknown activity text! >";
}

function getActivityDurationMs(activity: Activity, nextActivity?: Activity) : number {
    const startTimeMs = new Date(activity.t).getTime();
    const nextStart = (nextActivity ? new Date(nextActivity.t): new Date()).getTime();
    return nextStart - startTimeMs;
}


function createNewNote(text: string): tree.TreeNode<Note> {
    const note = defaultNote();
    note.text = text;

    return tree.newTreeNode(note, note.id);
}

const STATE_KEY_PREFIX = "NoteTree.";
function getAvailableTrees(): string[] {
    const keys = Object.keys(localStorage)
        .map((key) => {
            if (!key.startsWith(STATE_KEY_PREFIX)) {
                return undefined;
            }

            const name = key.substring(STATE_KEY_PREFIX.length);
            if (!name) {
                return undefined;
            }

            return name;
        })
        .filter((key) => !!key)
        .sort();

    return keys as string[];
}

function merge<T extends object>(a: T, b: T) {
    for (const k in b) {
        if (!(k in a)) {
            a[k] = b[k];
        }
    }

    return a;
}

type NoteId = string;
type TaskId= string;

type State = {
    /** Tasks organised by problem -> subproblem -> subsubproblem etc., not necessarily in the order we work on them */
    notes: tree.TreeStore<Note>;
    currentNoteId: NoteId;
    lastEditedNoteIds: NoteId[];
    // NOTE: we're kinda using the note's index like it's ID here. this is fine,
    // because activities are guaranteed to not change order (at least that is what we would like)
    currentNoteFilterIdx: number;

    scratchPad: string;

    /** These notes are in order of their priority, i.e how important the user thinks a note is. */
    todoNoteIds: NoteId[];

    /** The sequence of tasks as we worked on them. Separate from the tree. One person can only work on one thing at a time */
    activities: Activity[];
    // The last activity that we appended which cannot be popped due to debounce logic
    lastFixedActivityIdx: number | null;


    // non-serializable fields
    _flatNoteIds: NoteId[];
};

type NoteFilter = null | {
    status: NoteStatus;
    not: boolean;
};


function pushActivity(state: State, activity: Activity, shouldDebounce: boolean) {
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

function getLastActivity(state: State): Activity | undefined {
    return state.activities[state.activities.length - 1];
}

function getSecondLastActivity(state: State): Activity | undefined {
    return state.activities[state.activities.length - 2];
}

// function popLastActivity(state: State): Activity | undefined {
//     return state.activities.pop();
// }

// NOTE: all state needs to be JSON-serializable.
// NO Dates/non-plain objects
// No non-owning references, i.e a reference to a node that really lives in another array
// Typically if state will contain references, non-serializable objects, or are in some way computed from other canonical state,
// it is prepended with '_', which will cause it to be stripped before it gets serialized.
function defaultState(): State {
    const rootNote = defaultNote();
    rootNote.id = tree.ROOT_KEY;
    rootNote.text = "This root node should not be visible. If it is, you've encountered a bug!";

    const state: State = {
        _flatNoteIds: [], // used by the note tree view, can include collapsed subsections

        notes: tree.newTreeStore<Note>(rootNote),
        currentNoteId: "",
        lastEditedNoteIds: [],
        todoNoteIds: [],
        activities: [],
        lastFixedActivityIdx: 0,

        currentNoteFilterIdx: 0,

        scratchPad: "",
    };

    return state;
}


function loadState(name: string): State {
    const savedStateJSON = localStorage.getItem(STATE_KEY_PREFIX + name);
    if (!savedStateJSON) {
        throw new Error(`Couldn't find ${name}.`);
    }

    if (savedStateJSON) {
        const loadedState = JSON.parse(savedStateJSON) as State;

        // prevents missing item cases that may occur when trying to load an older version of the state.
        // it is our way of auto-migrating the schema. Only works for new root level keys and not nested ones tho
        // TODO: handle new fields in notes. Shouldn't be too hard actually
        const mergedLoadedState = merge(loadedState, defaultState());

        tree.forEachNode(mergedLoadedState.notes, (id) => {
            const node = tree.getNode(mergedLoadedState.notes, id);
            node.data = merge(node.data, defaultNote());
        });

        return mergedLoadedState;
    }

    return defaultState();
}

function getLocalStorageKeyForTreeName(name: string) {
    return STATE_KEY_PREFIX + name;
}

// currently:
//  - drops all properties with '_'
// NOTE: the state shouldn't be cyclic. do not attempt to make this resistant to cycles,
// it is _supposed_ to throw that too much recursion exception
function recursiveShallowCopy(obj: any): any {
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

function saveState(state: State, name: string) {
    const nonCyclicState = recursiveShallowCopy(state);
    const serialized = JSON.stringify(nonCyclicState);
    localStorage.setItem(getLocalStorageKeyForTreeName(name), serialized);
}

function deleteNoteIfEmpty(state: State, id: NoteId) {
    const note = getNote(state, id);
    if (note.data.text) {
        return false;
    }

    if (!note.parentId) {
        return false;
    }

    if (note.id === state.currentNoteId) {
        // don't delete the note we're working on rn
        return false;
    }

    if (tree.getSize(state.notes) <= 1) {
        // don't delete our only note!
        return false
    }

    const noteToMoveTo = getOneNoteUp(state, note) || getOneNoteDown(state, note);
    if (!noteToMoveTo) {
        // cant delete this note if there are no other notes we can move to
        return false;
    }

    // delete from the ids list, as well as the note database
    tree.remove(state.notes, note);

    // delete relevant activities from the activity list and last viewed list
    filterInPlace(state.activities, (activity) => activity.nId !== note.id);
    filterInPlace(state.lastEditedNoteIds, (id) => id !== note.id);

    return true;
}

function insertNoteAfterCurrent(state: State) {
    const currentNote = getCurrentNote(state);
    assert(currentNote.parentId, "Cant insert after the root note");
    if (!currentNote.data.text) {
        // REQ: don't insert new notes while we're editing blank notes
        return false;
    }

    const newNote = createNewNote("");

    const parent = getNote(state, currentNote.parentId);
    tree.addUnder(state.notes, parent, newNote)

    setCurrentNote(state, newNote.id, false);
    return true;
}

function insertChildNode(state: State) {
    const currentNote = getCurrentNote(state);
    assert(currentNote.parentId, "Cant insert after the root note");
    if (!currentNote.data.text) {
        // REQ: don't insert new notes while we're editing blank notes
        return false;
    }

    const newNote = createNewNote("");

    tree.addUnder(state.notes, currentNote, newNote);
    setCurrentNote(state, newNote.id, false);

    return true;
}

function hasNote(state: State, id: NoteId): boolean {
    return !!id && tree.hasNode(state.notes, id);
}

function getNote(state: State, id: NoteId) {
    return tree.getNode(state.notes, id);
}

function getNoteTag(note: tree.TreeNode<Note>, tagName: string): string | null {
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

function getCurrentNote(state: State) {
    if (!hasNote(state, state.currentNoteId)) {
        // set currentNoteId to the last root note if it hasn't yet been set

        const rootChildIds = getRootNote(state).childIds;
        if (rootChildIds.length === 0) {
            // create the first note if we have no notes
            const newNote = createNewNote("First Note");
            tree.addUnder(state.notes, getRootNote(state), newNote);
        }

        // not using setCurrentNote, because it calls getCurrentNote 
        state.currentNoteId = rootChildIds[rootChildIds.length - 1];
    }

    return getNote(state, state.currentNoteId);
}


function pushBreakActivity(state: State, breakInfoText: string, locked: undefined | true) {
    pushActivity(state, {
        nId: undefined,
        t: getTimestamp(new Date()),
        breakInfo: breakInfoText,
        locked: locked,
    }, false);
}

function isCurrentlyTakingABreak(state: State): boolean {
    const last = getLastActivity(state);
    return !!last?.breakInfo;
}

function getOneNoteDown(state: State, note: tree.TreeNode<Note>): NoteId | null {
    if (!note.parentId) {
        return null;
    }

    const idx = state._flatNoteIds.indexOf(note.id);
    if (idx < state._flatNoteIds.length - 1) {
        return state._flatNoteIds[idx + 1];
    }

    return null;
}

function getOneNoteUp(state: State, note: tree.TreeNode<Note>): NoteId | null {
    if (!note.parentId) {
        return null;
    }

    const idx = state._flatNoteIds.indexOf(note.id);
    if (idx > 0) {
        return state._flatNoteIds[idx - 1];
    }

    return null;
}

function setCurrentNote(state: State, noteId: NoteId | null, debounceActivity = true) {
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
    deleteNoteIfEmpty(state, currentNoteBeforeMove.id);

    pushActivity(state, {
        t: getTimestamp(new Date()),
        nId: note.id,
    }, debounceActivity);

    return true;
}

type NoteFilterFunction = (state: State, note: tree.TreeNode<Note>) => boolean;
function findNextNote(state: State, childIds: NoteId[], id: NoteId, filterFn: NoteFilterFunction) {
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

function findPreviousNote(state: State, childIds: NoteId[], id: NoteId, filterFn: NoteFilterFunction) {
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


function getNoteOneDownLocally(state: State, note: tree.TreeNode<Note>) {
    if (!note.parentId) {
        return null;
    }

    // this was the old way. but now, we only display notes on the same level as the parent, or all ancestors
    // const parent = getNote(state, note.parentId);
    // return findNextNote(state, parent.childIds, note.id, (note) => note.data._filteredOut);

    // now, we hop between unfiltered
    return findNextNote(state, state._flatNoteIds, note.id, isNoteImportant);
}

function isNoteImportant(state: State, note: tree.TreeNode<Note>) : boolean {
    if (!note.parentId) {
        return true;
    }

    const siblings = getNote(state, note.parentId).childIds;
    const idx = siblings.indexOf(note.id);

    return (
        idx === 0 ||
        idx === siblings.length - 1 ||
        getRealChildCount(note) !== 0 ||
        note.data._status === STATUS_IN_PROGRESS
    );
}

function getNoteOneUpLocally(state: State, note: tree.TreeNode<Note>) {
    if (!note.parentId) {
        return null;
    }

    // this was the old way. but now, we only display notes on the same level as the parent, or all ancestors
    // const parent = getNote(state, note.parentId);
    // return findPreviousNote(state, parent.childIds, note.id, (note) => note.data._filteredOut);

    return findPreviousNote(state, state._flatNoteIds, note.id, isNoteImportant);
}

function unindentCurrentNoteIfPossible(state: State) {
    const note = getCurrentNote(state);
    if (!note.parentId) {
        return;
    }

    if (!isLastNote(state, note)) {
        // can't indent or unindent the last note in the sequence
        return;
    }

    const parent = getNote(state, note.parentId);
    if (
        !parent.parentId ||        // parent parent can't be null, that is where the unindented note will go
        !isLastNote(state, parent) // for unindent, the parent should also be the last note in it's sequence
    ) {
        return;
    }

    const parentParent = getNote(state, parent.parentId);

    tree.remove(state.notes, note);
    tree.addUnder(state.notes, parentParent, note);
}

function indentCurrentNoteIfPossible(state: State) {
    const note = getCurrentNote(state);
    if (!note.parentId) {
        return;
    }


    const parent = getNote(state, note.parentId);
    const idx = parent.childIds.indexOf(note.id);
    const isLast = idx === parent.childIds.length - 1;
    if (
        !isLast ||  // can't indent or unindent the last note in the sequence
        idx === 0   // can't indent the first note
    ) {
        return;
    }

    const previousNote = getNote(state, parent.childIds[idx - 1]);
    tree.remove(state.notes, note);
    tree.addUnder(state.notes, previousNote, note);
}

function isLastNote(state: State, note: tree.TreeNode<Note>) : boolean{
    if (!note.parentId) {
        // root is the last note, technically
        return true;
    }

    const parent = getNote(state, note.parentId);
    return parent.childIds.indexOf(note.id) === parent.childIds.length - 1;
}

function getLastEditedNoteId(state: State) {
    return state.lastEditedNoteIds[state.lastEditedNoteIds.length - 1];
}

const MAX_LAST_EDITED_NOTE_MEMORY_LENGTH = 10;
function pushLastEditedNoteId(state: State, noteId: NoteId) {
    state.lastEditedNoteIds.push(noteId);
    // Totally arbitrary number
    while (state.lastEditedNoteIds.length > MAX_LAST_EDITED_NOTE_MEMORY_LENGTH) {
        state.lastEditedNoteIds.splice(0, 1);
    }
}

function moveToLastEditedNote(state: State) {
    if (state.lastEditedNoteIds.length === 0) {
        return;
    }


    const note = getCurrentNote(state);
    if (
        note &&
        getLastEditedNoteId(state) === note.id
    ) {
        state.lastEditedNoteIds.pop();

        if (state.lastEditedNoteIds.length === 0) {
            return;
        }
    }

    setCurrentNote(state, getLastEditedNoteId(state));
}

// returns true if the app should re-render
function handleNoteInputKeyDown(state: State, e: KeyboardEvent) : boolean {
    const ctrlPressed = e.ctrlKey || e.metaKey;
    const shiftPressed = e.shiftKey;
    const currentNoteId = state.currentNoteId;
    const currentNote = getCurrentNote(state);

    switch (e.key) {
        case "Enter":
            e.preventDefault();

            if (shiftPressed) {
                return insertChildNode(state);
            } else {
                return insertNoteAfterCurrent(state);
            }
        case "Backspace":
            // NOTE: alt + backspace is a global key-bind
            if (!ctrlPressed && !shiftPressed) {
                return deleteNoteIfEmpty(state, state.currentNoteId);
            }
            break;
        case "Tab":
            // TODO: move between the tabs
            e.preventDefault();

            // I don't like this. It's convenient, but it means that we can't use tab for other things.
            // But 

            if (shiftPressed) {
                unindentCurrentNoteIfPossible(state);
            } else {
                indentCurrentNoteIfPossible(state);
            }

            break;
        case "K": // cause of vim binds, I use hjkl and not ijkl as a gamer might expect
            if (ctrlPressed && shiftPressed) {
                e.preventDefault();
                // setCurrentNote(state, getNoteOneUpLocally(state, currentNote));
                setCurrentNote(state, getOneNoteUp(state, currentNote));
            }
            break;
        case "ArrowUp":
            if (!(ctrlPressed && shiftPressed)) {
                e.preventDefault();
                setCurrentNote(state, getOneNoteUp(state, currentNote));
            }
            break;
        case "PageUp":
            for (let i = 0; i < 10; i++) {
                e.preventDefault();
                setCurrentNote(state, getOneNoteUp(state, getCurrentNote(state)));
            }
            break;
        case "PageDown":
            for (let i = 0; i < 10; i++) {
                setCurrentNote(state, getOneNoteDown(state, getCurrentNote(state)));
            }
            break;
        case "J":
            if (ctrlPressed && shiftPressed) {
                e.preventDefault();
                // setCurrentNote(state, getNoteOneDownLocally(state, currentNote));
                setCurrentNote(state, getOneNoteDown(state, currentNote));
            }
            break;
        case "ArrowDown":
            setCurrentNote(state, getOneNoteDown(state, currentNote));
            break;
        case "H":
            if (ctrlPressed && shiftPressed) {
                e.preventDefault();
                setCurrentNote(state, currentNote.parentId)
            }
            break;
        case "L":
            if (ctrlPressed && shiftPressed) {
                e.preventDefault();
                if (
                    currentNote.data.lastSelectedChildId && 
                    // We could start editing an empty note and then move up. In which case it was deleted, but the id is now invalid :(
                    // TODO: just don't set this to an invalid value
                    tree.hasNode(state.notes, currentNote.data.lastSelectedChildId)  
                ) {
                    setCurrentNote(state, currentNote.data.lastSelectedChildId);
                } else {
                    setCurrentNote(state, getFinalChildNote(state, currentNote));
                }
            }
            break;
        case "F":
            if (ctrlPressed && shiftPressed) {
                e.preventDefault();
                nextFilter(state);
            }
            break;
    }

    return true;
}

function getFinalChildNote(state: State, note: tree.TreeNode<Note>): NoteId | null {
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

function dfsPre(state: State, note: tree.TreeNode<Note>, fn: (n: tree.TreeNode<Note>) => void) {
    fn(note);

    for (const id of note.childIds) {
        const note = getNote(state, id);
        dfsPre(state, note, fn);
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

function getRootNote(state: State) {
    return getNote(state, state.notes.rootId);
}

// function getNotePriority(state: State, noteId: NoteId) {
//     const priority = state.todoNoteIds.indexOf(noteId);
//     if (priority === -1) {
//         return undefined;
//     }

//     return priority + 1;
// }

// NOTE: depends on _filteredOut, _isSelected
function recomputeFlatNotes(state: State, flatNotes: NoteId[]) {
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

function shouldFilterOutNote(data: Note, filter: NoteFilter): boolean {
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
function recomputeState(state: State) {
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
}



function getTimeStr(note: Note) {
    const { openedAt } = note;

    const date = new Date(openedAt);
    return formatDate(date);
}

function getIndentStr(note: Note) {
    const { _depth: repeats } = note;
    return "     ".repeat(repeats);
}

function getNoteDuration(state: State, note: tree.TreeNode<Note>) {
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

function getSecondPartOfRow(state: State, note: tree.TreeNode<Note>) {
    const duration = getNoteDuration(state, note);
    const durationStr = formatDuration(duration);
    const secondPart = " " + durationStr;
    return secondPart;
}

function getRowIndentPrefix(_state: State, note: Note) {
    return `${getIndentStr(note)} ${getNoteStateString(note)}`;
}

function getFirstPartOfRow(state: State, note: tree.TreeNode<Note>) {
    const noteData = note.data;
    // const dashChar = note.data._isSelected ? ">" : "-"
    // having ">" in exported text looks ugly, so I've commented this out for now
    const dashChar = "-";

    return `${getTimeStr(noteData)} | ${getRowIndentPrefix(state, noteData)} ${dashChar} ${noteData.text || " "}`;
}

function exportAsText(state: State) {
    const header = (text: string) => `----------------${text}----------------`;

    const flatNotes: NoteId[] = [];
    recomputeFlatNotes(state, flatNotes);

    const table = [];
    for (const id of flatNotes) {
        const note = getNote(state, id);
        table.push([getFirstPartOfRow(state, note), getSecondPartOfRow(state, note)]);
    }

    function formatTable(table: string[][], gap: number) {
        const columns = [];

        for (let col = 0; col < table[0].length; col++) {
            const column = [];

            // get the width of this column
            let colWidth = 0;
            for (let row = 0; row < table.length; row++) {
                const cell = table[row][col];
                colWidth = Math.max(colWidth, cell.length);
            }

            // append cells to the column, with padding added
            for (let row = 0; row < table.length; row++) {
                const cell = table[row][col];

                let padding = colWidth - cell.length + gap;
                column.push(cell + " ".repeat(padding));
            }

            columns.push(column);
        }

        const lines = [];
        for (let i = 0; i < columns[0].length; i++) {
            const row = [];
            for (let j = 0; j < columns.length; j++) {
                row.push(columns[j][i]);
            }

            lines.push(row.join(""));
        }

        return lines.join("\n");
    }

    return [header(" Notes "), formatTable(table, 10), header(" Scratchpad "), state.scratchPad].join("\n\n");
}

function previousFilter(state: State) {
    state.currentNoteFilterIdx++;
    if (state.currentNoteFilterIdx >= ALL_FILTERS.length) {
        state.currentNoteFilterIdx = 0;
    }
}

function nextFilter(state: State) {
    state.currentNoteFilterIdx--;
    if (state.currentNoteFilterIdx < 0) {
        state.currentNoteFilterIdx = ALL_FILTERS.length - 1;
    }
}

function NoteFilters(): Renderable<AppArgs> {
    const lb = makeButton("<");
    const rb = makeButton(">");
    const currentFilterText = div({ class: "flex-1 text-align-center", style: "background:var(--bg-color)"})
    const root = div({ class: "row align-items-center", style: "width: 200px;"}, [
        lb, currentFilterText, rb
    ]);


    const component = makeComponent<AppArgs>(root, () => {
        const { state } = component.args;
        const [ name, _filter ] = ALL_FILTERS[state.currentNoteFilterIdx];
        setTextContent(currentFilterText, name);
    });

    lb.el.addEventListener("click", () => {
        const { state, rerenderApp } = component.args;

        nextFilter(state);

        rerenderApp();
    });

    rb.el.addEventListener("click", () => {
        const { state, rerenderApp } = component.args;

        previousFilter(state);

        rerenderApp();
    });

    return component;
}

type NoteLinkArgs = {
    text: string; 
    noteId?: NoteId;
    app: AppArgs;
    focusAnyway: boolean;
};

function NoteLink(): Renderable<NoteLinkArgs> {
    const root = div({ style: "padding:5px" })

    const component = makeComponent<NoteLinkArgs>(root, () => {
        const { text, noteId, app: { state }, focusAnyway }  = component.args;

        setClass(root, "hover-link", !!noteId);
        setTextContent(root, truncate(text, 500));
        root.el.style.backgroundColor = (focusAnyway || state.currentNoteId === noteId) ? (
            "var(--bg-color-focus)" 
        ) : (
            "var(--bg-color)" 
        );
    });

    root.el.addEventListener("click", () => {
        const { noteId, app: { state, rerenderApp }}  = component.args;

        if (noteId) {
            setCurrentNote(state, noteId);
            rerenderApp();
        }
    });

    return component;
}

function TodoList(): Renderable<AppArgs> {
    type TodoItemArgs = {
        app: AppArgs;
        note: tree.TreeNode<Note>;
    }

    const componentList = makeComponentList(div(), () => {
        const moveUpButton = makeButton("↑", "hover-target", "height: 20px;"); 
        const noteLink = NoteLink();

        const nestedNotesList = makeComponentList(div(), () => {
            const status = div();
            const link = NoteLink();
            const thing = div({ class: "pre" })
            const root = div({ class: "pre-wrap row align-items-center" }, [
                status, thing, link,
            ])

            type NestedNotesArgs = {
                linkedNoteArgs: Omit<NoteLinkArgs, "noteId"> & { noteId: NoteId; };
                previousNotesCount: number;
            }

            const component = makeComponent<NestedNotesArgs>(root, () => {
                const { linkedNoteArgs, previousNotesCount } = component.args;
                const { noteId, app: { state } } = linkedNoteArgs;

                const note = getNote(state, noteId);

                link.rerender(linkedNoteArgs);
                setTextContent(thing, " " + previousNotesCount +  (state.currentNoteId === noteId ? " > " : " - "));
                setTextContent(status, getNoteStateString(note.data) ?? "??");
            });

            return component;
        });

        const root = div({ 
            class: "hover-parent", 
            style: "border-bottom: 1px solid var(--fg-color); border-top: 1px solid var(--fg-color);"
        }, [
            div({ class: "row align-items-center" }, [
                noteLink,
                div({ class: "flex-1" }),
                div({ class: "row" }, [
                    moveUpButton
                ]),
            ]),
            nestedNotesList
        ]);

        const component = makeComponent<TodoItemArgs>(root, () => {
            const { note, app } = component.args;
            const { state } = app;


            moveUpButton.el.setAttribute("title", "Move this note up");

            const nestedNotes: tree.TreeNode<Note>[] = [];
            dfsPre(state, note, (n) => {
                if (n !== note && n.data._status === STATUS_IN_PROGRESS) {
                    nestedNotes.push(n);
                }
            });

            nestedNotesList.resize(nestedNotes.length);
            let focusAnyway = note.id === state.currentNoteId;
            for(let i = 0; i < nestedNotes.length; i++) {
                const note = nestedNotes[i];
                focusAnyway = focusAnyway || note.id === state.currentNoteId;

                const childCount = !note.parentId ? 0 : getNote(state, note.parentId).childIds.length;

                nestedNotesList.components[i].rerender({
                    linkedNoteArgs: {
                        app: component.args.app,
                        noteId: note.id,
                        text: note.data.text,
                        focusAnyway: false,
                    },
                    previousNotesCount: childCount,
                });
            }

            noteLink.rerender({
                app: app,
                noteId: note.id,
                text: note.data.text,
                focusAnyway,
            });
        });

        moveUpButton.el.addEventListener("click", () => {
            const { note, app: { state, rerenderApp} } = component.args;

            const idxThis = state.todoNoteIds.indexOf(note.id);
            if (idxThis === -1) {
                // this code should never run
                throw new Error("Can't move up a not that isn't in the TODO list. There is a bug in the program somewhere");
            }

            const idxSelected = state.todoNoteIds.findIndex(id => {
                const note = getNote(state, id);
                return note.data._isSelected;
            });

            // this also works when idxSelected === -1
            const insertPoint = idxThis <= idxSelected ? 0 : idxSelected + 1;

            state.todoNoteIds.splice(idxThis, 1);
            state.todoNoteIds.splice(insertPoint, 0, note.id);
            setCurrentNote(state, note.id);

            rerenderApp({ shouldScroll: false });
        });

        return component;
    });

    const component = makeComponent<AppArgs>(componentList, () => {
        const { state } = component.args;
        
        componentList.resize(state.todoNoteIds.length);
        for (let i = 0; i < componentList.components.length; i++) {
            componentList.components[i].rerender({
                app: component.args,
                note: getNote(state, state.todoNoteIds[i]),
            });
        }
    });

    return component;
}

function isEditableBreak(activity: Activity) {
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

function ActivityList(): Renderable<AppArgs> {
    function ActivityListItem(): Renderable<ActivityListItemArgs> {
        const timestamp = DateTimeInput();
        const timestampWrapper = div({ style: "width: 200px;" }, [ timestamp ]);
        const noteLink = NoteLink();
        const breakEdit = el<HTMLInputElement>(
            "INPUT", { class: "pre-wrap w-100 solid-border-sm", style: "padding-left: 5px" }
        );
        const durationText = div({ style: "padding-left: 10px" });
        const insertBreakButton = makeButton("+ Insert break here");
        const breakInsertRow = div({ class: "align-items-center justify-content-center row" }, [
            div({ class: "flex-1", style: "border-bottom: 1px solid var(--fg-color)" }),
            insertBreakButton,
            div({ class: "flex-1", style: "border-bottom: 1px solid var(--fg-color)" }),
        ]);

        const deleteButton = makeButton("x");
        const root = div({}, [
            div({class: "hover-parent", style: "min-height: 10px"}, [
                div({class: "hover-target"}, [
                    breakInsertRow
                ])
            ]),
            div({class: "hover-parent" }, [
                div({ class: "row", style: "gap: 20px" }, [
                    timestampWrapper,
                    div({ class: "flex-1 row" }, [
                        noteLink,
                        breakEdit
                    ]),
                    deleteButton,
                    durationText,
                ])
            ])
        ]);

        const component = makeComponent<ActivityListItemArgs>(root, () => {
            const { activity, nextActivity, app, showDuration, } = component.args;
            const { state } = app;

            const isEditable = isEditableBreak(activity);
            const activityText = getActivityText(state, activity);

            if (setVisible(breakEdit, isEditable)) {
                setInputValue(breakEdit, activityText);
            }

            if (setVisible(noteLink, !isEditable)) {
                noteLink.rerender({
                    app,
                    focusAnyway: false,
                    noteId: activity.nId,
                    text: activityText,
                })
                setClass(noteLink, "hover-link", !!activity.nId);
                noteLink.el.style.paddingLeft = activity.nId ? "0" : "40px";
            }

            timestamp.rerender({
                date: new Date(activity.t),
                onChange: updateActivityTime,
                readOnly: false, 
            });

            if (setVisible(durationText, showDuration)) {
                const durationStr = (isEditable ? "~" : "" ) + formatDuration(getActivityDurationMs(activity, nextActivity));
                setTextContent(durationText, durationStr);
            }

            setVisible(deleteButton, isEditable);
        });

        function updateActivityTime(date?: Date) {
            if (!date) {
                return;
            }

            const { previousActivity, activity, nextActivity, app: { showStatusText, rerenderApp, debouncedSave} } = component.args;

            if (previousActivity) {
                // don't update our date to be before the previous time
                const prevTime = new Date(previousActivity.t);
                if (prevTime.getTime() > date.getTime()) {
                    showStatusText(`Can't set time to ${formatDate(date)} as it would re-order the activities`);
                    return;
                }
            }

            let nextTime = nextActivity ? new Date(nextActivity.t) : new Date();
            if (nextTime.getTime() < date.getTime()) {
                showStatusText(`Can't set time to ${formatDate(date)} as it would re-order the activities`);
                return;
            }

            activity.t = getTimestamp(date);
            rerenderApp({ shouldScroll: false });
            debouncedSave();
        }
        
        insertBreakButton.el.addEventListener("click", () => {
            const { activity, nextActivity, app: { state, rerenderApp, debouncedSave } } = component.args;

            const idx = state.activities.indexOf(activity);
            if (idx === -1) {
                return;
            }

            const timeA = (new Date(activity.t)).getTime();
            const duration = getActivityDurationMs(activity, nextActivity);
            const midpoint = timeA + duration / 2;

            const newBreak : Activity =  {
                t: getTimestamp(new Date(midpoint)),
                breakInfo: "New break",
                nId: undefined,
                locked: undefined,
            };

            state.activities.splice(idx + 1, 0, newBreak);

            debouncedSave();
            rerenderApp({ shouldScroll: false });
        });

        deleteButton.el.addEventListener("click", () => {
            const { activity, app: { state, rerenderApp } } = component.args;

            if (!isEditableBreak(activity)) {
                // can only delete breaks
                return;
            }

            const idx = state.activities.indexOf(activity);
            if (idx === -1) {
                return;
            }

            state.activities.splice(idx, 1);
            rerenderApp({ shouldScroll: false });
        });

        noteLink.el.addEventListener("click", () => {
            const { activity, app: { state, rerenderApp }} = component.args;
            if (!activity.nId) {
                return;
            }

            setCurrentNote(state, activity.nId);
            rerenderApp();
        });

        breakEdit.el.addEventListener("keypress", (e) => {
            const { activity, app: { rerenderApp, debouncedSave }} = component.args;

            // 'prevent' clearing it out
            const val = breakEdit.el.value || activity.breakInfo;
            if (e.key === "Enter") {
                activity.breakInfo = val;
                rerenderApp({ shouldScroll: false });
                debouncedSave();
            }
        })

        return component;
    }

    const listRoot = makeComponentList(div({ style: "border-bottom: 1px solid black" }), ActivityListItem);

    const breakInput = el<HTMLInputElement>("INPUT", { class: "w-100" });
    const breakButton = makeButton("");
    const leftButton = makeButton("<");
    const leftLeftButton = makeButton("<<");
    const rightButton = makeButton(">");
    const root = div({ class: "w-100", style: "border-top: 1px solid var(--fg-color);" }, [
        div({ style: "padding: 5px;", class: "row align-items-center" }, [
            div({ class: "flex-1" }, [ breakInput ]),
            div({}, [ breakButton ]),
        ]),
        listRoot,
        div({ style: "border-top: 1px solid var(--fg-color);", class: "row"}, [
            leftLeftButton, 
            leftButton,
            rightButton
        ])
    ]);

    let page = 0;
    const pageSize = 10;

    const getMaxPages = () => Math.ceil(component.args.state.activities.length / pageSize);

    leftButton.el.addEventListener("click", () => {
        page = Math.max(page - 1, 0);

        component.rerender(component.args);
    });

    leftLeftButton.el.addEventListener("click", () => {
        page = 0;

        component.rerender(component.args);
    });

    rightButton.el.addEventListener("click", () => {
        page = Math.min(page + 1, getMaxPages());

        component.rerender(component.args);
    });

    const component = makeComponent<AppArgs>(root, () => {
        const { state } = component.args;

        const isTakingABreak = isCurrentlyTakingABreak(state);

        setTextContent(breakButton, "Take a break");
        breakInput.el.setAttribute("placeholder", isTakingABreak ? (
            "Enter resume reason (optional)"
        ): (
            "Enter break reason (optional)"
        ));


        const activities = state.activities;
        const start = Math.max(0, Math.min(page * pageSize, activities.length - 1));
        const end = Math.max(0, Math.min((page + 1) * pageSize, activities.length));
        const activitiesToRender = end - start;
        listRoot.resize(activitiesToRender);
        for (let i = 0; i < activitiesToRender; i++) {
            const idx = activities.length - end + i;
            const previousActivity = activities[idx - 1]; // JavaScript moment - you can index past an array without crashing
            const activity = activities[idx];
            const nextActivity = activities[idx + 1]; // JavaScript moment - you can index past an array without crashing

            listRoot.components[activitiesToRender - 1 - i].rerender({
                app: component.args, 
                previousActivity,
                activity, 
                nextActivity,
                showDuration: true,
            });
        }

        setVisible(leftButton, page !== 0);
        setVisible(leftLeftButton, page !== 0);
        setVisible(rightButton, page !== getMaxPages());
    });

    function addBreak() {
        const { state, rerenderApp, debouncedSave } = component.args;

        let text = breakInput.el.value ||  "Taking a break ...";

        pushBreakActivity(state, text, true);
        breakInput.el.value = "";

        debouncedSave();
        rerenderApp();
    }

    breakInput.el.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") {
            return;
        }

        addBreak();
    });

    breakButton.el.addEventListener("click", addBreak);

    return component;
}

// exposing the text area so that we can focus it, but
// really, TODO: just expose a focus() function...
function ScratchPad(): Renderable<AppArgs> & { textArea: HTMLTextAreaElement } {
    const yardStick = div({ class: "absolute", style: "width: 5px; left:-5px;top:0px" });
    const textArea = el<HTMLTextAreaElement>("TEXTAREA", { class: "scratch-pad pre-wrap h-100"});
    const root = div({ class: "relative h-100" }, [
        yardStick, textArea
    ]);

    const component = makeComponent<AppArgs>(root, () => {
        const { state } = component.args;

        if (textArea.el.value !== state.scratchPad) {
            textArea.el.value = state.scratchPad;
        }
    });

    const onEdit = () => {
        const { debouncedSave, state, rerenderApp } = component.args;

        state.scratchPad = textArea.el.value;
        rerenderApp({ shouldScroll: false });

        debouncedSave();
    };

    textArea.el.addEventListener("input", onEdit);
    textArea.el.addEventListener("change", onEdit);

    textArea.el.addEventListener("keydown", (e) => {
        if (e.key === "Tab") {
            e.preventDefault();
            // HTML doesn't like tabs, we need this additional code to be able to insert tabs.

            // inserting a tab like this should preserve undo
            // TODO: stop using deprecated API
            document.execCommand("insertText", false, "\t");
        }

        function updateScrollPosition() {
            // This function scrolls the window to the current cursor position inside the text area.
            // This code is loosely based off the solution from https://jh3y.medium.com/how-to-where-s-the-caret-getting-the-xy-position-of-the-caret-a24ba372990a
            // My version is better, obviously

            function countNewLines(str: string) {
                let count = 0;
                for (let i = 0; i < str.length; i++) {
                    if (str[i] === "\n") {
                        count++;
                    }
                }
                return count;
            }

            const selectionEnd = textArea.el.selectionEnd;
            const startToCursorText = textArea.el.value.substring(0, selectionEnd);

            // debugging
            yardStick.el.style.background = "#F00";
            yardStick.el.style.background = "transparent";
            yardStick.el.style.whiteSpace = "pre";
            yardStick.el.textContent = "\n".repeat(countNewLines(startToCursorText)) + ".";

            yardStick.el.style.height = 0 + "px";
            const height = yardStick.el.scrollHeight;
            yardStick.el.style.height = height + "px";
            yardStick.el.textContent = "";

            textArea.el.scrollTo({
                left: 0,
                top: height - textArea.el.getBoundingClientRect().height / 2,
                behavior: "instant",
            });

            // Not sure if I'll need this or what
            // window.scrollTo({
            //     left: 0,
            //     // NOTE: this is actually wrong. It scrolls way past our element, but our element
            //     // just so happens to be at the bottom of the screen
            //     top: window.scrollY + textArea.el.getBoundingClientRect().height,
            //     behavior: "instant",
            // });
     }

        // updateScrollPosition()
    });

    return {
        ...component,
        textArea: textArea.el,
    };
}

function getRealChildCount(note: tree.TreeNode<Note>): number {
    if (note.childIds.length === 0) {
        return 0;
    }

    if (note.data._status === STATUS_DONE) {
        // Don't include the DONE note at the end. This artificially increases the child count from 0 to 1.
        // This will matter in certain movement schemes where i want to move directly to notes with children for example
        return note.childIds.length - 1;
    }

    return note.childIds.length;
}

type NoteRowArgs = {
    app: AppArgs;
    note: tree.TreeNode<Note>;
    flatIndex: number;
};
function NoteRowText(): Renderable<NoteRowArgs> {
    const indent = div({ class: "pre" });
    const whenNotEditing = div({ class: "pre-wrap" });

    let isEditing = false;

    // Soon, I plan to have multiline notes
    const whenEditing = el<HTMLInputElement>("TEXTAREA", { class: "flex-1", style: "overflow-y: hidden;"});
    const root = div(
        {
            class: "pre-wrap flex-1", style:"margin-left: 10px; padding-left: 10px;border-left: 1px solid var(--fg-color);"
        },
        [div({ class: "row v-align-bottom" }, [indent, whenNotEditing, whenEditing])]
    );

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { app: { state, renderOptions }, note } = component.args;

        const dashChar = note.data._isSelected ? ">" : "-";
        const count = getRealChildCount(note)
        const childCountText = count ? ` (${count})` : "";
        setTextContent(
            indent,
            `${getIndentStr(note.data)} ${getNoteStateString(note.data)}${childCountText} ${dashChar} `
        );


        const wasEditing = isEditing;
        isEditing = state.currentNoteId === note.id;
        setVisible(whenEditing, isEditing);
        setVisible(whenNotEditing, !isEditing);
        if (isEditing && renderOptions.shouldScroll) {
            setInputValue(whenEditing, note.data.text);
            whenEditing.el.style.height = "0px";
            whenEditing.el.style.height = whenEditing.el.scrollHeight + "px"; 


            if (!wasEditing) {
                // without setTimeout here, calling focus won't work as soon as the page loads.
                setTimeout(() => {
                    whenEditing.el.focus({ preventScroll: true });

                    // scroll view into position.
                    // Right now this also runs when we click on a node instead of navigating with a keyboard, but 
                    // ideally we don't want to do this when we click on a note.
                    // I haven't worked out how to do that yet though
                    {
                        const wantedY = whenEditing.el.getBoundingClientRect().top + window.scrollY;

                        window.scrollTo({
                            left: 0,
                            top: wantedY - window.innerHeight / 2,
                            behavior: "instant"
                        });
                    }
                }, 1);
            }
        } else {
            setTextContent(whenNotEditing, note.data.text);
        }
    });

    whenEditing.el.addEventListener("input", () => {
        const { app: { state, rerenderApp, debouncedSave }, note, } = component.args;

        note.data.text = whenEditing.el.value;
        if (getLastEditedNoteId(state) !== note.id) {
            pushLastEditedNoteId(state, note.id);
        }

        const last = getLastActivity(state);
        if (last?.nId !== note.id) {
            pushActivity(state, {
                t: getTimestamp(new Date()),
                nId: note.id,
                locked: undefined,
            }, true);
        }

        debouncedSave();

        rerenderApp();
    });

    whenEditing.el.addEventListener("keydown", (e) => {
        const { app: { state, rerenderApp } } = component.args;

        if (handleNoteInputKeyDown(state, e)) {
            rerenderApp();
        }
    });

    whenEditing.el.addEventListener("blur", () => {
        isEditing = false;
    })

    return component;
}


type ActivityListItemArgs = {
    app: AppArgs;
    previousActivity: Activity | undefined;
    activity: Activity;
    nextActivity: Activity | undefined;
    showDuration: boolean;
};


// All times are in milliseconds
type Analytics = {
    breakTime: number;
    uncategorisedTime: number; 
    taskTimes: Map<TaskId, number>;
    totalTime: number;
}

function recomputeAnalytics(state: State, analytics: Analytics) {
    analytics.breakTime = 0;
    analytics.uncategorisedTime = 0;
    analytics.taskTimes.clear();
    analytics.totalTime = 0;

    // recompute which tasks each note belong to 
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


    // compute the amount of time spent in each group
    for (let i = 0; i < state.activities.length; i++) { 
        const activity = state.activities[i];
        const nextActivity  = state.activities[i + 1] as Activity | undefined;

        const duration = getActivityDurationMs(activity, nextActivity);

        if (activity.breakInfo) {
            analytics.breakTime += duration;
            continue;
        }

        if (activity.nId) { 
            const note = getNote(state, activity.nId);
            const task = note.data._task;
            if (!task) {
                analytics.uncategorisedTime += duration;
                continue;
            } 

            analytics.taskTimes.set(
                task, 
                (analytics.taskTimes.get(task) ?? 0) + duration
            );
            continue;
        }
    }

    // compute the total time
    analytics.totalTime += analytics.uncategorisedTime;
    analytics.totalTime += analytics.breakTime;
    for (const time of analytics.taskTimes.values()) {
        analytics.totalTime += time;
    }
}

type AnalyticsFilters = {
    dateFromEnabled: boolean;
    dateFrom: Date;
    dateToEnabled: boolean;
    dateTo: Date;
}

function AnalyticsFilters() : Renderable<AnalyticsFilters> {
    const dateFrom = DateTimeInput();
    const dateTo = DateTimeInput();
    const dateFromEnabled = Checkbox();
    const dateToEnabled = Checkbox();

    const width = "150px";

    const root = div({}, [
        div({ class: "row", style: "padding-bottom: 5px"}, [ 
            div({ style: "width: " + width }, [ dateFromEnabled ]),
            dateFrom
        ]),
        div({ class: "row", style: "padding-bottom: 5px"}, [ 
            div({ style: "width: " + width }, [ dateToEnabled ]),
            dateTo 
        ]),
    ]);

    function rerender() {
        component.rerender(component.args);
    }

    function updateDateFrom(date: Date) {
        const analyticsFilters = component.args;

        analyticsFilters.dateFrom = date;
        rerender();
    }

    function updateDateTo(date: Date) {
        const analyticsFilters = component.args;

        analyticsFilters.dateTo = date;
        rerender();
    }

    const component = makeComponent<AnalyticsFilters>(root, () => {
        const analyticsFilters = component.args;

        dateFromEnabled.rerender({
            checked: analyticsFilters.dateFromEnabled,
            onToggle: () => {
                analyticsFilters.dateFromEnabled = !analyticsFilters.dateFromEnabled
                rerender();
            },
            label: "From"
        });

        dateToEnabled.rerender({
            checked: analyticsFilters.dateToEnabled,
            onToggle: () => {
                analyticsFilters.dateToEnabled = !analyticsFilters.dateToEnabled
                rerender();
            },
            label: "To"
        });

        if (setVisible(dateFrom, analyticsFilters.dateFromEnabled)) {
            dateFrom.rerender({
                date: analyticsFilters.dateFrom,
                onChange: updateDateFrom,
                readOnly: false,
            });
        }

        if (setVisible(dateTo, analyticsFilters.dateToEnabled)) {
            dateTo.rerender({
                date: analyticsFilters.dateTo,
                onChange: updateDateTo,
                readOnly: false,
            });
        }

    });

    return component;
}

function ActivityAnalytics(): Renderable<AppArgs> {
    const analytics: Analytics = {
        breakTime: 0,
        uncategorisedTime: 0,
        taskTimes: new Map<TaskId, number>(),
        totalTime: 0,
    };

    const analyticsFilters : AnalyticsFilters  = {
        dateFrom: new Date(),
        dateFromEnabled: false,
        dateTo: new Date(),
        dateToEnabled: false,
    }

    const taskColWidth = "300px";
    const durationsListRoot = div({ class: "table w-100" }) 
    const analyticsFiltersEditor = AnalyticsFilters();

    type DurationListItemArgs = {
        taskName: string;
        timeMs: number;
        totalTimeMs: number;
    }

    const durationsList = makeComponentList(durationsListRoot, () => {
        const taskNameComponent = div({ style: `padding:5px;padding-bottom:0; width: ${taskColWidth}` })
        const durationBar = FractionBar();

        const root = div({}, [
            taskNameComponent, 
            div({}, [ durationBar ])
        ])
        
        const component = makeComponent<DurationListItemArgs>(root, () => {
            const { taskName, timeMs, totalTimeMs } = component.args;

            setTextContent(taskNameComponent, taskName);
            durationBar.rerender({
                fraction: timeMs / totalTimeMs,
                text: formatDuration(timeMs),
            });
        });

        return component;
    });

    const root = div({ class: "w-100 h-100 col" }, [
        el("H3", {}, [ "Timings" ]),
        div({ class: "relative", style: "overflow-y: scroll" }, [
            durationsListRoot,
        ]),
        el("H3", {}, [ "Filters" ]),
        analyticsFiltersEditor
    ])

    const component = makeComponent<AppArgs>(root, () => {
        const { state } = component.args;

        recomputeAnalytics(state, analytics);

        durationsList.resize(analytics.taskTimes.size + 2);
        durationsList.components[0].rerender({
            taskName: "Break Time",
            timeMs: analytics.breakTime,
            totalTimeMs: analytics.totalTime
        });

        durationsList.components[1].rerender({
            taskName: "Uncategorised Time",
            timeMs: analytics.uncategorisedTime,
            totalTimeMs: analytics.totalTime
        });

        const entries = [...analytics.taskTimes]; 
        for (let i = 0; i < entries.length; i++) {
            durationsList.components[i + 2].rerender({
                taskName: entries[i][0], 
                timeMs: entries[i][1], 
                totalTimeMs: analytics.totalTime,
            });
        }

        analyticsFiltersEditor.rerender(analyticsFilters);
    });

    return component;
}

function AnalyticsModal(): Renderable<AppArgs> {
    const activityAnalytics = ActivityAnalytics();
    const modalComponent = Modal(
        div({ class: "col h-100", style: "padding: 10px" }, [
            activityAnalytics
        ])
    );
    
    const component = makeComponent<AppArgs>(modalComponent, () => {
        const { setCurrentModal } = component.args;

        modalComponent.rerender({ 
            onClose: () => setCurrentModal(null) 
        });

        activityAnalytics.rerender(component.args);
    });

    return component;
}

function ScratchPadModal(): Renderable<AppArgs> {
    const scratchPad = ScratchPad();
    scratchPad.textArea.style.padding = "5px";

    const modalComponent = Modal(scratchPad);

    const component = makeComponent<AppArgs>(modalComponent, () => {
        const { setCurrentModal } = component.args;

        modalComponent.rerender({
            onClose() {
                setCurrentModal(null);
            }
        });

        scratchPad.rerender(component.args);

        setTimeout(() => {
            scratchPad.textArea.focus({ preventScroll: true });
        }, 100);
    });

    return component;
}

function NoteRowTimestamp(): Renderable<NoteRowArgs> {
    const root = div({ class: "pre-wrap" });

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { note } = component.args;
        setTextContent(root, getTimeStr(note.data));
    });

    return component;
}

function NoteRowStatistic(): Renderable<NoteRowArgs> {
    const lastTouchedFlag = div({ class: "font-weight: bold" }, [ " <-- "]);
    const root = div({ class: "row" }, [ lastTouchedFlag ]);

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { app: { state }, note } = component.args;

        const idx = state.lastEditedNoteIds.lastIndexOf(note.id);
        if (setVisible(lastTouchedFlag, idx !== -1)) {
            const percentage = (idx + 1) * 100 / state.lastEditedNoteIds.length;
            lastTouchedFlag.el.style.backgroundColor = `color-mix(in srgb, var(--bg-in-progress) ${percentage}%, transparent)`
            lastTouchedFlag.el.style.color = `color-mix(in srgb, var(--fg-color) ${percentage}%, transparent)`

            lastTouchedFlag.el.setAttribute("title", `This is the note you edited ${idx - state.lastEditedNoteIds.length + 1} notes ago`)
        }
    });

    return component;
}

function NoteRowInput(): Renderable<NoteRowArgs> {
    const timestamp = NoteRowTimestamp();
    const text = NoteRowText();
    const statistic = NoteRowStatistic();
    const root = div({ class: "row" }, [ timestamp, text, statistic ]);

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { note } = component.args;

        const textColor = note.data._isSelected
            ? "var(--fg-color)"
            : note.data._status === STATUS_IN_PROGRESS
            ? "var(--fg-color)"
            : "var(--unfocus-text-color)";

        root.el.style.color = textColor;

        timestamp.rerender(component.args);
        text.rerender(component.args);
        statistic.rerender(component.args);
    });

    root.el.addEventListener("click", () => {
        const { app: { state, rerenderApp }, note } = component.args;

        setCurrentNote(state, note.id);
        rerenderApp();
    });

    return component;
}

type NoteListInternalArgs = {
    appArgs: AppArgs;
    flatNotes: NoteId[];
}

function NoteListInternal(): Renderable<NoteListInternalArgs> {
    const root = div({ 
        class: "w-100", 
        style: "border-top: 1px solid var(--fg-color);border-bottom: 1px solid var(--fg-color);" 
    });

    const noteList = makeComponentList(root, NoteRowInput);

    const component = makeComponent<NoteListInternalArgs>(root, () => {
        const { appArgs: { state }, flatNotes } = component.args;

        noteList.resize(flatNotes.length);
        for (let i = 0; i < flatNotes.length; i++) {
            noteList.components[i].rerender({
                app: component.args.appArgs,
                flatIndex: i,
                note: getNote(state, flatNotes[i]),
            });
        }
    });

    return component;
}

function NotesList(): Renderable<AppArgs> {
    const list1 = NoteListInternal();
    const root = div({}, [ list1 ]);

    const component = makeComponent<AppArgs>(root, () => {
        const { state } = component.args;
        list1.rerender({ appArgs: component.args, flatNotes: state._flatNoteIds });
    });


    return component;
}


function makeButtonWithCallback(text: string, fn: () => void, classes: string = "") {
    const btn = makeButton(text, classes);
    btn.el.addEventListener("click", fn);
    return btn;
};

type TabRowArgs = {
    app: AppArgs;
    name: string;
}

function TreeTabsRowTab(): Renderable<TabRowArgs> {
    const btn = el("BUTTON", { type: "button", class: "tab-button pre-wrap text-align-center z-index-100" });
    const input = el<HTMLInputElement>("INPUT", { 
        class: "pre-wrap text-align-center z-index-100", 
        style: "margin-right: 20px;padding: 2px 20px; "
    });

    const closeBtn = el("BUTTON", {
        type: "button",
        class: "pre-wrap text-align-center z-index-100",
        style: "position:absolute; right: 5px; background-color:transparent;",
    }, [ " x " ]);

    // Tabs
    const root = div({ class: "relative tab" }, [ btn, input, closeBtn ]);
    const component = makeComponent<TabRowArgs>(root, () => {
        const { app: { currentTreeName }, name } = component.args;

        const isFocused = currentTreeName === name;

        setVisible(closeBtn, isFocused);
        setVisible(btn, !isFocused);
        setClass(root, "focused", isFocused);

        if (setVisible(input, isFocused)) {
            setVisible(input, true);
            setInputValueAndResize(input, name);

            root.el.style.color = "var(--fg-color)";
        } else {
            setTextContent(btn, name);

            root.el.style.color = "var(--unfocus-text-color)";
        }
    });

    btn.el.addEventListener("click", () => {
        const { app: { loadTree }, name } = component.args;

        loadTree(name);
    });

    input.el.addEventListener("change", () => {
        const { app: { renameCurrentTreeName } } = component.args;
        renameCurrentTreeName(input.el.value);
    });

    closeBtn.el.addEventListener("click", () => {
        const { app: { deleteCurrentTree } } = component.args;
        deleteCurrentTree();
    });

    return component;
}

// will be more of a tabbed view
const TreeTabsRow = () => {
    const tabsRoot = div({ class: "row pre-wrap align-items-center", });
    const tabsList = makeComponentList(tabsRoot, TreeTabsRowTab);

    const newButton = el("BUTTON", {
        type: "button",
        class: "pre-wrap text-align-center",
        style: "margin-left: 5px;",
    }, [ " + "])

    const root = div({}, [
        div({ class: "row pre-wrap align-items-center" }, [
            tabsRoot, newButton,
        ]),
        div({ style: "outline-bottom: 1px solid var(--fg-color);" })
    ])

    const outerComponent = makeComponent<AppArgs>(root, () => {
        const names = getAvailableTrees();
        tabsList.resize(names.length);
        for (let i = 0; i < names.length; i++) {
            tabsList.components[i].rerender({
                app: outerComponent.args,
                name: names[i],
            });
        }
    });

    newButton.el.addEventListener("click", () => {
        const { newTree } = outerComponent.args;
        newTree();
    })

    return outerComponent;
}

const setCssVars = (vars: [string, string][]) => {
    const cssRoot = document.querySelector(":root") as HTMLElement;
    for (const [k, v] of vars) {
        cssRoot.style.setProperty(k, v);
    }
};

type RenderOptions = {
    shouldScroll: boolean;
}

type AppArgs = {
    state: State;
    loadTree: (name: string) => void;
    rerenderApp(opts?: RenderOptions): void;
    debouncedSave(): void;
    handleErrors(fn: () => void, onError?: (err: any) => void): void;
    currentTreeName: string;
    renameCurrentTreeName(newName: string): void;
    deleteCurrentTree(): void;
    newTree(shouldRerender?: boolean): void;
    showStatusText(text: string, color?: string, timeout?: number): void;
    setCurrentModal(modal: Modal): void;
    renderOptions: RenderOptions;
};


type AppTheme = "Light" | "Dark";

const makeDarkModeToggle = () => {
    const getTheme = (): AppTheme => {
        if (localStorage.getItem("State.currentTheme") === "Dark") {
            return "Dark";
        }

        return "Light";
    };

    const setTheme = (theme: AppTheme) => {
        localStorage.setItem("State.currentTheme", theme);

        if (theme === "Light") {
            setCssVars([
                ["--bg-in-progress", "rgb(255, 0, 0, 1"],
                ["--fg-in-progress", "#FFF"],
                ["--bg-color", "#FFF"],
                ["--bg-color-focus", "#CCC"],
                ["--bg-color-focus-2", "rgb(0, 0, 0, 0.4)"],
                ["--fg-color", "#000"],
                ["--unfocus-text-color", "gray"]
            ]);
        } else {
            // assume dark theme
            setCssVars([
                ["--bg-in-progress", "rgba(255, 0, 0, 1)"],
                ["--fg-in-progress", "#FFF"],
                ["--bg-color", "#000"],
                ["--bg-color-focus", "#333"],
                ["--bg-color-focus-2", "rgba(255, 255, 255, 0.4)"],
                ["--fg-color", "#EEE"],
                ["--unfocus-text-color", "gray"]
            ]);
        }

        function getThemeText() {
            // return theme;

            if (theme === "Light") {
                return (
                    // https://www.asciiart.eu/nature/sun
`      ;   :   ;
   .   \\_,!,_/   ,
    \`.,':::::\`.,'
     /:::::::::\\
~ -- ::::::::::: -- ~
     \\:::::::::/
    ,'\`:::::::'\`.
   '   / \`!\` \\   \`
      ;   :   ;     `);

            }

            return (
                // https://www.asciiart.eu/space/moons
`
       _..._    *
  *  .::'   \`.    
    :::       :    |  
    :::       :   -+-
    \`::.     .'    |
 *    \`':..-'  .
               * .
      `);

        }

        setTextContent(button, getThemeText());
    };

    const button = makeButtonWithCallback("", () => {
        let themeName = getTheme();
        if (!themeName || themeName === "Light") {
            themeName = "Dark";
        } else {
            themeName = "Light";
        }

        setTheme(themeName);
    });

    button.el.style.whiteSpace = "pre";
    button.el.style.fontSize = "6px";
    button.el.style.fontWeight = "bold";

    setTheme(getTheme());

    return button;
};

type Modal = null | "analytics-view" | "scratch-pad";

const App = () => {
    const infoButton = el("BUTTON", { class: "info-button", title: "click for help" }, [
        "help?"
    ]);
    infoButton.el.addEventListener("click", () => {
        showInfo = !showInfo;
        rerenderApp();
    });

    function li(str: string) {
        return el("LI", {}, [ str ]);
    }

    const noteTreeHelp = div({}, [
        el("P", {}, [
            "Use this note tree to keep track of what you are currently doing, and how long you are spending on each thing."
        ]),
        el("UL", {}, [
            li(`[Enter] to create a new entry under the current one`),
            li(`[Shift] + [Enter] to create a new entry at the same level as the current one`),
            li(`[Tab] or [Shift]+[Tab] to indent/unindent a note when applicable`),
            li(`[Arrows] to move up and down visually`),
            li(`[Alt] + [Arrows] to move across the tree. [Up] and [Down] moves on the same level, [Left] and [Right] to move out of or into a note`),
            li(`[Alt] + [Backspace] to move focus back to the last note we edited`),
            li(`[Ctrl] + [Shift] + [F] to toggle filters`),
        ])
    ]);

    const statusTextIndicator = div({ class: "pre-wrap", style: "background-color: var(--bg-color)" })

    const notesList = NotesList();
    const activityList = ActivityList();
    const filters = NoteFilters();
    const treeSelector = TreeTabsRow();
    const todoNotes = TodoList();

    const scratchPadModal = ScratchPadModal();
    const analyticsModal = AnalyticsModal();

    let currentModal: Modal = null;

    const fixedButtons = div({ class: "fixed row align-items-end", style: "bottom: 5px; right: 5px; left: 5px; gap: 5px;"}, [
        div({}, [ makeDarkModeToggle() ]),
        div({ class: "flex-1" }),
        div({}, [statusTextIndicator]),
        div({ class: "flex-1" }),
        div({ class: "row" }, [
            filters,
            makeButtonWithCallback("Scratch Pad", () => {
                setCurrentModal("scratch-pad");
            }),
            makeButtonWithCallback("Analytics", () => {
                setCurrentModal("analytics-view");
            }),
            makeButtonWithCallback("Clear all", () => {
                if (!confirm("Are you sure you want to clear your note tree?")) {
                    return;
                }

                state = defaultState();
                rerenderApp();

                showStatusText("Cleared notes");
            }),
            makeButtonWithCallback("Copy as text", () => {
                handleErrors(() => {
                    navigator.clipboard.writeText(exportAsText(state));
                    showStatusText("Copied as text");
                });
            }),
            makeButtonWithCallback("Load JSON from scratch pad", () => {
                handleErrors(() => {
                    try {
                        const lsKeys = JSON.parse(state.scratchPad);
                        localStorage.clear();
                        for (const key in lsKeys) {
                            localStorage.setItem(key, lsKeys[key]);
                        }
                    } catch {
                        throw new Error("Scratch pad must contain valid JSON");
                    }

                    if (!confirm("This will erase all your current trees. Are you sure?")) {
                        return;
                    }

                    initState();
                });
            }),
            makeButtonWithCallback("Copy as JSON", () => {
                handleErrors(() => {
                    const lsKeys = {};
                    for (const [key, value] of Object.entries(localStorage)) {
                        // @ts-ignore typescript doesn't like copying keys like this
                        lsKeys[key] = value;
                    }

                    navigator.clipboard.writeText(JSON.stringify(lsKeys));
                    showStatusText("Copied JSON");
                });
            })
        ])
    ]);

    const appRoot = div({ class: "relative", style: "padding-bottom: 100px" }, [
        div({ class: "row align-items-center" }, [
            el("H2", {}, [ "Currently working on" ]),
            div({ class: "flex-1" }),
            div({}, [ infoButton ]),
        ]),
        noteTreeHelp,
        div({ class: "row align-items-end" }, [
            treeSelector
        ]),
        notesList,
        div({ class: "row", style: "gap: 10px"}, [
            div({ style: "flex:1; padding-top: 20px" }, [ 
                div({}, [
                    el("H3", {}, [ "TODO Notes"]),
                    todoNotes
                ])
            ]),
            div({ style: "flex:1; padding-top: 20px" }, [ 
                div({}, [
                    el("H3", {}, [ "Activity List"]),
                    activityList 
                ])
            ])
        ]),
        fixedButtons,
        scratchPadModal,
        analyticsModal,
    ]);

    let currentTreeName = "";
    // @ts-ignore state gets set before it is used ...
    let state: State = {};
    let saveTimeout = 0;
    const saveCurrentState = ({ debounced } = { debounced: false }) => {
        // user can switch to a different note mid-debounce, so we need to save
        // these here before the debounce

        const thisTreeName = currentTreeName;
        const thisState = state;

        const save = () => {
            // save current note
            saveState(thisState, thisTreeName);

            // save what ting we were on
            localStorage.setItem("State.currentTreeName", thisTreeName);

            // notification
            showStatusText("Saved   ", "var(--fg-color)", SAVE_DEBOUNCE);
        };

        if (!debounced) {
            save();
            return;
        }

        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }

        showStatusText("Saving...", "var(--fg-color)", -1);
        saveTimeout = setTimeout(() => {
            save();
        }, SAVE_DEBOUNCE);
    };

    const loadTree = (name: string) => {
        handleErrors(
            () => {
                state = loadState(name);
                currentTreeName = name;
                rerenderApp();
            },
            () => {
                // try to fallback to the first available tree.
                const availableTrees = getAvailableTrees();
                state = loadState(availableTrees[0]);
                currentTreeName = availableTrees[0];
                rerenderApp();

                console.log(availableTrees)
            }
        );
    };
    const newTree = (shouldRerender = true) => {
        function generateUnusedName() {
            function canUseName(name: string) {
                return !localStorage.getItem(getLocalStorageKeyForTreeName(name));
            }

            // try to name it 22 FEB 2023 or something
            const now = new Date();
            const months = [
                "JAN",
                "FEB",
                "MAR",
                "APR",
                "MAY",
                "JUN",
                "JUL",
                "AUG",
                "SEP",
                "OCT",
                "NOV",
                "DEC"
            ];
            const dayName = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
            if (canUseName(dayName)) {
                return dayName;
            }

            let i = 0;
            while (i < 100000) {
                i++;
                const name = "New " + i;
                if (canUseName(name)) {
                    return name;
                }
            }

            throw new Error("ERROR - Out of name ideas for this new note :(");
        }

        state = defaultState();
        currentTreeName = generateUnusedName();
        saveCurrentState();

        if (shouldRerender) {
            // we should think of a better way to do this next time
            rerenderApp();
        }
    };

    const renameCurrentTreeName = (newName: string) => {
        let oldName = currentTreeName;
        if (localStorage.getItem(getLocalStorageKeyForTreeName(newName))) {
            throw new Error("That name is already taken.");
        }

        currentTreeName = newName;
        localStorage.removeItem(getLocalStorageKeyForTreeName(oldName));

        saveCurrentState();

        rerenderApp();
    };

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            setCurrentModal(null);
        }

        const ctrlPressed = e.ctrlKey || e.metaKey;
        const shiftPressed = e.shiftKey;

        switch (e.key) {
            case "S":
                if (ctrlPressed && shiftPressed) {
                    e.preventDefault();
                    setCurrentModal("scratch-pad");
                }
                break;
            case "A":
                if (ctrlPressed && shiftPressed) {
                    e.preventDefault();
                    setCurrentModal("analytics-view");
                }
                break;
            case "Backspace":
                if (ctrlPressed && shiftPressed) {
                    moveToLastEditedNote(state);
                    rerenderApp();
                    return true;
                }
                break;

        }
    });

    const setCurrentModal = (modal: Modal) => {
        if (currentModal === modal) { 
            return;
        }

        currentModal = modal;
        rerenderApp({ shouldScroll: true });
    }

    const deleteCurrentTree = () => {
        handleErrors(() => {
            const availableTrees = getAvailableTrees();
            let idx = availableTrees.indexOf(currentTreeName);
            if (idx === -1) {
                throw new Error("The current tree has not yet been saved.");
            }

            if (availableTrees.length <= 1) {
                if (availableTrees.length === 0) {
                    throw new Error("There aren't any notes. How in the fuck did that happen?");
                }

                showStatusText("Can't delete the only note tree page");
                return;
            }

            if (!confirm(`Are you sure you want to delete the note tree ${currentTreeName}?`)) {
                return;
            }

            localStorage.removeItem(getLocalStorageKeyForTreeName(currentTreeName));
            const availableTrees2 = getAvailableTrees();

            if (idx >= availableTrees2.length) {
                idx = availableTrees2.length - 1;
            }

            loadTree(availableTrees2[idx]);
        });
    };

    let showInfo = false;
    let statusTextClearTimeout = 0;
    const showStatusText = (text: string, color: string = "var(--fg-color)", timeout: number = STATUS_TEXT_PERSIST_TIME) => {
        if (statusTextClearTimeout) {
            clearTimeout(statusTextClearTimeout);
        }

        statusTextIndicator.el.textContent = text;
        statusTextIndicator.el.style.color = color;

        const timeoutAmount = timeout;
        if (timeoutAmount > 0) {
            statusTextClearTimeout = setTimeout(() => {
                statusTextIndicator.el.textContent = "";
            }, timeoutAmount);
        }
    };

    const handleErrors = (fn: () => void, onError?: (err: any) => void) => {
        try {
            fn();
        } catch (err) {
            console.error(err);
            showStatusText(`${err}`, "#F00", ERROR_TIMEOUT_TIME);
            onError && onError(err);
        }
    };

    const debouncedSave = () => {
        saveCurrentState({
            debounced: true
        });
    };

    const renderOptions : RenderOptions = {
        shouldScroll: false
    };

    const rerenderApp = (opts?: RenderOptions) => {
        // there are actually very few times when we don't want to scroll to the current note
        renderOptions.shouldScroll = opts ? opts.shouldScroll : true;

        appComponent.rerender(undefined);
    }

    const appComponent = makeComponent<undefined>(appRoot, () => {
        setVisible(noteTreeHelp, showInfo);

        recomputeState(state);

        // need to know how far to offset the selected refs
        const args: AppArgs = {
            state,
            loadTree,
            rerenderApp,
            debouncedSave,
            handleErrors,
            currentTreeName,
            renameCurrentTreeName,
            deleteCurrentTree,
            newTree,
            showStatusText,
            setCurrentModal,
            renderOptions,
        };

        // rerender the things
        notesList.rerender(args);
        activityList.rerender(args);
        treeSelector.rerender(args);
        filters.rerender(args);
        todoNotes.rerender(args);

        if (setVisible(analyticsModal, currentModal === "analytics-view")) {
            analyticsModal.rerender(args);
        }

        if (setVisible(scratchPadModal, currentModal === "scratch-pad")) {
            scratchPadModal.rerender(args);
        }
    });

    const initState = () => {
        let savedCurrentTreeName = localStorage.getItem("State.currentTreeName") as string;
        const availableTrees = getAvailableTrees();
        if (!availableTrees.includes(savedCurrentTreeName)) {
            savedCurrentTreeName = availableTrees[0];
        }

        if (!savedCurrentTreeName || availableTrees.length === 0) {
            newTree(false);
            saveCurrentState();
        } else {
            loadTree(savedCurrentTreeName);
        }
    };

    initState();

    return appComponent;
};


const root: Insertable = {
    el: document.getElementById("app")!
};

const app = App();
appendChild(root, app);
app.rerender(undefined);

