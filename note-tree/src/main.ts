import "./styles.css"

import {
    Insertable,
    Renderable,
    appendChild,
    assert,
    htmlf,
    makeComponent,
    setClass,
    setInputValue,
    setInputValueAndResize,
    setTextContent,
    setVisible,
    makeComponentList
} from "./htmlf";

import * as tree from "./tree";

// const INDENT_BASE_WIDTH = 100;
// const INDENT_WIDTH_PX = 50;
const SAVE_DEBOUNCE = 1000;
const STATUS_TEXT_PERSIST_TIME = 1000;
const ERROR_TIMEOUT_TIME = 5000;

function pad2(num: number) {
    return num < 10 ? "0" + num : "" + num;
}

// function repeatSafe(str: string, len: number) {
//     const string = len <= 0 ? "" : str.repeat(Math.ceil(len / str.length));
//     return string.substring(0, len);
// }

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

function getLastNote(state: State, lastNote: tree.TreeNode<Note>) {
    while (lastNote.childIds.length > 0) {
        lastNote = getNote(state, lastNote.childIds[lastNote.childIds.length - 1]);
    }

    return lastNote;
}

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

    // non-serializable fields
    _status: NoteStatus; // used to track if a note is done or not.
    _isSelected: boolean; // used to display '>' or - in the note status
    _depth: number; // used to visually indent the notes
    _filteredOut: boolean; // Has this note been filtered out?
};

function createNewNote(text: string): tree.TreeNode<Note> {
    const note: Note = {
        // the following is valuable user data

        id: uuid(),
        text: text || "",
        openedAt: getTimestamp(new Date()), 

        // the following is just visual flags which are frequently recomputed

        _status: STATUS_IN_PROGRESS,
        _isSelected: false, 
        _depth: 0, 
        _filteredOut: false, 
    };

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

function merge(a: State, b: State) {
    for (const k in b) {
        if (a[k as keyof State] === undefined) {
            // @ts-ignore This is legit
            a[k as keyof State] = b[k as keyof State];
        }
    }

    return a;
}

type NoteId = string;
type State = {
    notes: tree.TreeStore<Note>;
    currentNoteId: NoteId;
    lastEditedNoteId: NoteId;

    currentNoteFilterIdx: number;

    scratchPad: string;

    // non-serializable fields
    _flatNoteIds: NoteId[];
};

type NoteFilter = null | {
    status: NoteStatus;
    not: boolean;
};


// NOTE: all state needs to be JSON-serializable.
// NO Dates/non-plain objects
// No non-owning references, i.e a reference to a node that really lives in another array
// Typically if state will contain references, non-serializable objects, or are in some way computed from other canonical state,
// it is prepended with '_', which will cause it to be stripped before it gets serialized.
function defaultState(): State {
    const state: State = {
        _flatNoteIds: [], // used by the note tree view, can include collapsed subsections

        notes: tree.newTreeStore<Note>({
            id: tree.ROOT_KEY,
            openedAt: getTimestamp(new Date()),
            text: "This root node should not be visible. If it is, you've encountered a bug!",

            _depth: 0,
            _isSelected: false,
            _status: STATUS_IN_PROGRESS,
            _filteredOut: false,
        }),
        currentNoteId: "",
        lastEditedNoteId: "",

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
        const loadedState = JSON.parse(savedStateJSON);

        // prevents missing item cases that may occur when trying to load an older version of the state.
        // it is our way of migrating the schema.
        const mergedState = merge(loadedState, defaultState());
        return mergedState;
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
    console.log("saved", name, state);
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

    setCurrentNote(state, newNote.id);
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
    setCurrentNote(state, newNote.id);

    return true;
}

function getNote(state: State, id: NoteId) {
    return tree.getNode(state.notes, id);
}

function getCurrentNote(state: State) {
    if (!tree.hasNode(state.notes, state.currentNoteId)) {
        // set currentNoteId to the last root note if it hasn't yet been set

        const rootChildIds = getRootNote(state).childIds;
        if (rootChildIds.length === 0) {
            // create the first note if we have no notes
            const newNote = createNewNote("First Note");
            tree.addUnder(state.notes, getRootNote(state), newNote);
        }

        setCurrentNote(state, rootChildIds[rootChildIds.length - 1]);
    }

    return getNote(state, state.currentNoteId);
}

function getOneNoteDown(state: State, note: tree.TreeNode<Note>): tree.TreeNode<Note> | null {
    if (!note.parentId) {
        return null;
    }

    const idx = state._flatNoteIds.indexOf(note.id);
    if (idx < state._flatNoteIds.length - 1) {
        return getNote(state, state._flatNoteIds[idx + 1]);
    }

    return null;
}

function getOneNoteUp(state: State, note: tree.TreeNode<Note>): tree.TreeNode<Note> | null {
    if (!note.parentId) {
        return null;
    }

    const idx = state._flatNoteIds.indexOf(note.id);
    if (idx > 0) {
        return getNote(state, state._flatNoteIds[idx - 1]);
    }

    return null;
}

function setCurrentNote(state: State, noteId: NoteId) {
    const currentNote = getCurrentNote(state);
    if (currentNote.id === noteId) {
        return;
    }

    if (!tree.hasNode(state.notes, noteId)) {
        return;
    }

    if (!currentNote.data.text) {
        tree.remove(state.notes, currentNote);
    }

    state.currentNoteId = noteId;
}

function moveToNote(state: State, note: tree.TreeNode<Note> | null | undefined) {
    if (!note || note === getRootNote(state)) {
        return false;
    }

    setCurrentNote(state, note.id);
    return true;
}

function toNextUnfilteredNote(state: State, childIds: string[], id: string) {
    let idx = childIds.indexOf(id) + 1;
    while (idx < childIds.length) {
        const note = getNote(state, childIds[idx]);
        if (!note.data._filteredOut) {
            return note;
        }

        idx++;
    }

    return null;
}

function toPreviousUnfilteredNote(state: State, childIds: string[], id: string) {
    let idx = childIds.indexOf(id) - 1;
    while (idx >= 0)  {
        const note = getNote(state, childIds[idx]);
        if (!note.data._filteredOut) {
            return note;
        }

        idx--;
    }

    return null;
}


function getNoteOneDownLocally(state: State, note: tree.TreeNode<Note>) {
    if (!note.parentId) {
        return null;
    }

    const parent = getNote(state, note.parentId);
    return toNextUnfilteredNote(state, parent.childIds, note.id);
}

function getNoteOneUpLocally(state: State, note: tree.TreeNode<Note>) {
    if (!note.parentId) {
        return null;
    }

    const parent = getNote(state, note.parentId);
    return toPreviousUnfilteredNote(state, parent.childIds, note.id);
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

// returns true if the app should re-render
function handleNoteInputKeyDown(state: State, e: KeyboardEvent) : boolean {
    const altPressed = e.altKey;
    const ctrlPressed = e.ctrlKey || e.metaKey;
    const shiftPressed = e.shiftKey;
    const currentNote = getCurrentNote(state);

    if (altPressed) {
        e.preventDefault();
    }

    switch (e.key) {
        case "Enter":
            e.preventDefault();

            if (shiftPressed) {
                insertNoteAfterCurrent(state);
            } else {
                insertChildNode(state);
            }
            break;
        case "Backspace":
            if (altPressed) {
                setCurrentNote(state, state.lastEditedNoteId);
                return true;
            }
            return deleteNoteIfEmpty(state, state.currentNoteId);
        case "Tab":
            // TODO: move between the tabs
            e.preventDefault();

            if (shiftPressed) {
                unindentCurrentNoteIfPossible(state);
            } else {
                indentCurrentNoteIfPossible(state);
            }

            break;
        case "ArrowUp":
            moveToNote(state, 
                altPressed ? getNoteOneUpLocally(state, currentNote) : 
                    getOneNoteUp(state, currentNote)
            );
            break;
        case "PageUp":
            for (let i = 0; i < 10; i++) {
                moveToNote(state, getOneNoteUp(state, getCurrentNote(state)));
            }
            break;
        case "PageDown":
            for (let i = 0; i < 10; i++) {
                moveToNote(state, getOneNoteDown(state, getCurrentNote(state)));
            }
            break;
        case "ArrowDown":
            moveToNote(state, 
                altPressed ? getNoteOneDownLocally(state, currentNote) : 
                    getOneNoteDown(state, currentNote)
            );
            break;
        case "ArrowLeft":
            if (altPressed) {
                moveToNote(state, 
                    currentNote.parentId ? getNote(state, currentNote.parentId) : null
                );
            }
            break;
        case "ArrowRight":
            if (altPressed) {
                moveToNote(state, getFinalChildNote(state, currentNote));
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

function getFinalChildNote(state: State, note: tree.TreeNode<Note>): tree.TreeNode<Note> | null {
    let finalNoteIdx = note.childIds.length - 1;
    while (finalNoteIdx >= 0) {
        const childNote = getNote(state, note.childIds[finalNoteIdx]);
        if (!childNote.data._filteredOut) {
            return childNote;
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

function dfsPost(state: State, note: tree.TreeNode<Note>, fn: (n: tree.TreeNode<Note>) => void) {
    for (const id of note.childIds) {
        const note = getNote(state, id);
        dfsPost(state, note, fn);
    }

    fn(note);
}

function copyState(state: State) {
    return JSON.parse(JSON.stringify(recursiveShallowCopy(state)));
}

function getRootNote(state: State) {
    return getNote(state, state.notes.rootId);
}

// NOTE: depends on _filteredOut and _isSelected
function recomputeFlatNotes(state: State, flatNotes: NoteId[]) {
    flatNotes.splice(0, flatNotes.length);

    const dfs = (note: tree.TreeNode<Note>) => {
        for (const id of note.childIds) {
            const note = getNote(state, id);
            if (
                note.data._filteredOut &&
                !note.data._isSelected      // don't remove the path we are currently on from the flat notes.
            ) {
                continue;
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

            // Not enough for every child note to be done, the final note in our list should also be 'done'.
            // That way, when I decide to 'move out all the done notes', I don't accidentally move out the main note.

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
}


function formatDate(date: Date) {
    const dd = date.getDate();
    const mm = date.getMonth() + 1;
    const yyyy = date.getFullYear();
    const hours = date.getHours();
    const minutes = date.getMinutes();

    return `${pad2(dd)}/${pad2(mm)}/${yyyy} ${pad2(((hours - 1) % 12) + 1)}:${pad2(minutes)} ${
        hours < 12 ? "am" : "pm"
    }`;
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
    const currentFilterText = htmlf(`<div class="flex-1 text-align-center"></div>`);
    const root = htmlf(`<div class="row align-items-center" style="width:200px;">%{lb}%{currentFilter}%{rb}</div>`, { 
        lb, rb, currentFilter: currentFilterText
    });


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

// function BreakList(): Renderable<AppArgs> {
//     const pool: Renderable<AppArgs>[] = [];
//     const root = htmlf(
//         `<div class="w-100" style="border-top: 1px solid var(--fg-color);border-bottom: 1px solid var(--fg-color);"></div>`
//     );

//     const component = makeComponent<NoteListInternalArgs>(root, () => {
//         const { appArgs: { state }, flatNotes } = component.args;

//         resizeComponentPool(root, pool, flatNotes.length, function BreakListInput(): Renderable<AppArgs> {
//             const root = htmlf(`<div></div>`);
//         });

//         for (let i = 0; i < flatNotes.length; i++) {
//             pool[i].rerender({
//                 app: component.args.appArgs,
//                 flatIndex: i,
//                 note: getNote(state, flatNotes[i]),
//             });
//         }
//     });

//     return component;
// }

// NOTE: the caller who is instantiating the scratch pad should have access to the text here.
// so it makes very litle sense that we are getting this text...
function ScratchPad(): Renderable<AppArgs> & { getText(): string } {
    const textArea = htmlf<HTMLTextAreaElement>(`<textarea class="scratch-pad pre-wrap" style="height: 400px"></textarea>`);
    const root = htmlf(`<div class="relative">%{textArea}</div>`, { textArea });

    const component = makeComponent<AppArgs>(root, () => {
        const { state } = component.args;

        if (textArea.el.value !== state.scratchPad) {
            textArea.el.value = state.scratchPad;
        }
    });

    const onEdit = () => {
        const { debouncedSave } = component.args;
        debouncedSave();
    };

    // HTML doesn't like tabs, we need this additional code to be able to insert tabs.
    textArea.el.addEventListener("keydown", (e) => {
        if (e.key !== "Tab") return;

        e.preventDefault();

        // inserting a tab like this should preserve undo
        // TODO: stop using deprecated API
        document.execCommand("insertText", false, "\t");

        onEdit();
    });

    return {
        ...component,
        getText: () => {
            return textArea.el.value;
        }
    };
}

type NoteRowArgs = {
    app: AppArgs;
    note: tree.TreeNode<Note>;
    flatIndex: number;
};
function NoteRowText(): Renderable<NoteRowArgs> {
    const indent = htmlf(`<div class="pre"></div>`);
    const whenNotEditing = htmlf(`<div class="pre-wrap"></div>`);

    // NOTE: Not using a textArea, because we don't want our notes to have multiple lines for now. [Enter] is being used for something else at the moment.
    // Also it is tempting to navigate the text area with [up] [down] which we are also using to move between notes
    const whenEditing = htmlf<HTMLInputElement>(`<input class="flex-1"></input>`);

    const style = "margin-left: 10px; padding-left: 10px;border-left: 1px solid var(--fg-color);";
    const style2 = "row v-align-bottom";
    const root = htmlf(
        `<div class="pre-wrap flex-1" style="${style}">` +
            `<div class="${style2}">` +
            "%{indent}" +
            "%{whenNotEditing}" +
            "%{whenEditing}" +
            "</div>" +
            "</div>",
        { indent, whenNotEditing, whenEditing }
    );

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { app: { state, shouldScroll }, note, flatIndex } = component.args;

        const dashChar = note.data._isSelected ? ">" : "-";
        setTextContent(
            indent,
            `${getIndentStr(note.data)} ${getNoteStateString(note.data)} ${dashChar} `
        );

        const wasEditing = isEditing;
        isEditing = state.currentNoteId === note.id;
        setVisible(whenEditing, isEditing);
        setVisible(whenNotEditing, !isEditing);
        if (isEditing) {
            setInputValue(whenEditing, note.data.text);

            

            if (!wasEditing) {
                setTimeout(() => {
                    whenEditing.el.focus({ preventScroll: true });

                    if (shouldScroll) {
                        // TODO: calculate this properly, this kinda wrong ngl
                        const wantedY = whenEditing.el.getBoundingClientRect().height * flatIndex;

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
        const { app: { state, rerenderApp }, note, } = component.args;

        note.data.text = whenEditing.el.value;
        state.lastEditedNoteId = note.id;

        rerenderApp();
    });

    whenEditing.el.addEventListener("keydown", (e) => {
        const { app: { state, rerenderApp, debouncedSave } } = component.args;

        if (handleNoteInputKeyDown(state, e)) {
            rerenderApp();
        }

        // handle saving state with a debounce
        debouncedSave();
    });

    let isEditing = false;
    return component;
}

function NoteRowTimestamp(): Renderable<NoteRowArgs> {
    const input = htmlf<HTMLInputElement>(`<input class="w-100"></input>`);
    const root = htmlf(`<div class="pre-wrap">%{input}</div>`, { input });

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { note } = component.args;
        setInputValueAndResize(input, getTimeStr(note.data));
    });

    input.el.addEventListener("change", () => {
        const { app: { rerenderApp, handleErrors, debouncedSave }, note } = component.args;

        // TODO: get this validation working

        // const prevNote = note._parent;
        // let nextNote = null;
        // for (const id of note.childIds) {
        //     const child = getNote(state, id);
        //     if (nextNote === null || child.openedAt < nextNote.openedAt) {
        //         nextNote = child;
        //     }
        // }

        let previousTime: Date | null = null;
        let nextTime: Date | null = null;

        // if (prevNote) {
        //     previousTime = new Date(prevNote.openedAt);
        // }

        // if (nextNote) {
        //     nextTime = new Date(nextNote.openedAt);
        // }

        handleErrors(
            () => {
                // editing the time was a lot more code than I thought it would be, smh

                const [hStr, mmStr] = input.el.value.split(":");
                if (!mmStr) {
                    throw new Error("Times must be in the format hh:mm[am|pm]");
                }

                const mStr = mmStr.substring(0, 2);
                const amPmStr = mmStr.substring(2).trim();
                if (!amPmStr || !mStr) {
                    throw new Error("Times must be in the format hh:mm[am|pm]");
                }

                if (!["am", "pm"].includes(amPmStr.toLowerCase())) {
                    throw new Error(`Invalid am/pm - ${amPmStr}`);
                }

                let hours = parseInt(hStr, 10);
                if (isNaN(hours) || hours < 0 || hours > 12) {
                    throw new Error(`Invalid hours - ${hours}`);
                }

                const minutes = parseInt(mStr);
                if (isNaN(minutes) || minutes < 0 || minutes >= 60) {
                    throw new Error(`Invalid minutes - ${minutes}`);
                }

                if (amPmStr == "pm" && hours !== 12) {
                    hours += 12;
                }

                let newTime = new Date(note.data.openedAt);
                if (isNaN(newTime.getTime())) {
                    newTime = new Date();
                }
                newTime.setHours(hours);
                newTime.setMinutes(minutes);
                newTime.setSeconds(0);
                newTime.setMilliseconds(0);

                if (nextTime !== null && newTime >= nextTime) {
                    // decrement the day by 1. if it's 9:00 am now, and we type 7:00pm, we probably mean yesterday
                    const day = 1000 * 60 * 60 * 24;
                    newTime.setTime(newTime.getTime() - 1 * day);
                }

                if (previousTime != null && newTime <= previousTime) {
                    throw new Error(
                        `Can't set this task's time to be before the previous task's time (${formatDate(
                            previousTime
                        )})`
                    );
                }

                if (nextTime != null && newTime >= nextTime) {
                    throw new Error(
                        `Can't set this task's time to be after the next task's time (${formatDate(
                            nextTime
                        )})`
                    );
                }

                const now = new Date();
                if (nextTime == null && newTime > now) {
                    throw new Error(
                        `Can't set this task's time to be after the current time (${formatDate(now)})`
                    );
                }

                note.data.openedAt = getTimestamp(newTime);
                debouncedSave();

                rerenderApp();
            },
            () => {
                setInputValueAndResize(input, getTimeStr(note.data));
                rerenderApp();
            }
        );
    });

    return component;
}

function NoteRowStatistic(): Renderable<NoteRowArgs> {
    const progressText = htmlf(`<div class="text-align-right pre-wrap"></div>`);
    const lastTouchedFlag = htmlf(`<div style="color: var(--fg-in-progress); font-weight: bold" title="This is the note you edited last"> &lt;-- </div>`);
    const root = htmlf(`<div class="row">%{lastTouchedFlag}%{progressText}</div>`, {
        progressText, 
        lastTouchedFlag
    });

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { app: { state }, note } = component.args;
        setTextContent(progressText, getSecondPartOfRow(state, note));
        setVisible(lastTouchedFlag, state.lastEditedNoteId === note.id);
    });

    return component;
}

function NoteRowInput(): Renderable<NoteRowArgs> {
    const timestamp = NoteRowTimestamp();
    const text = NoteRowText();
    const statistic = NoteRowStatistic();
    const root = htmlf(`<div class="row">` + "%{timestamp}" + "%{text}" + "%{statistic}" + "</div>", {
        timestamp,
        text,
        statistic
    });

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
    const root = htmlf(
        `<div class="w-100" style="border-top: 1px solid var(--fg-color);border-bottom: 1px solid var(--fg-color);"></div>`
    );

    const noteList = makeComponentList(root, NoteRowInput);

    const component = makeComponent<NoteListInternalArgs>(root, () => {
        const { appArgs: { state }, flatNotes } = component.args;

        noteList.rerender(flatNotes.length, (c, i) => {
            c.rerender({
                app: component.args.appArgs,
                flatIndex: i,
                note: getNote(state, flatNotes[i]),
            });
        });
    });

    return component;
}

function NotesList(): Renderable<AppArgs> {
    const list1 = NoteListInternal();
    const root = htmlf(`<div>%{list1}</div>`, { list1 });

    const component = makeComponent<AppArgs>(root, () => {
        const { state } = component.args;
        list1.rerender({ appArgs: component.args, flatNotes: state._flatNoteIds });
    });


    return component;
}

function makeButton(text: string, classes: string = "") {
    return htmlf(
        `<button type="button" class="solid-border ${classes}" style="padding: 3px; margin: 5px;">%{text}</button>`,
        { text }
    );
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

// TF is a tab row? the fuck
function TabRow(): Renderable<TabRowArgs> {
    const btn = htmlf(
        `<button 
            type="button" 
            class="tab-button pre-wrap text-align-center z-index-100"
            style="padding: 2px 20px;"
        ></button>`
    );
    const input = htmlf<HTMLInputElement>(
        `<input 
            class="pre-wrap text-align-center z-index-100"
            style="margin-right: 20px;padding: 2px 20px; "
        ></input>`
    );

    const closeBtn = htmlf(
        `<button 
            type="button" 
            class="pre-wrap text-align-center z-index-100"
            style="position:absolute; right: 5px; background-color:transparent;"
        > x </button>`
    );

    // Tabs
    const root = htmlf(
        `<div 
            class="relative" 
            style="margin-left:2px;outline:2px solid var(--fg-color); border-top-right-radius: 5px; border-top-left-radius: 5px;"
        >%{btn}%{input}%{closeBtn}</div>`,
        { btn, input, closeBtn }
    );

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

        loadTree(name, { shouldScroll: false });
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
const CurrentTreeSelector = () => {
    const tabsRoot = htmlf(`<span class="row pre-wrap align-items-center"></span>`);
    const tabsList = makeComponentList(tabsRoot, TabRow);

    const newButton = htmlf(
        `<button 
            type="button" 
            class="pre-wrap text-align-center"
            style="margin-left: 5px;"
        > + </button>`
    );

    const root = htmlf(
        `<div>
            <span class="row pre-wrap align-items-center">
                %{tabsRoot}
                %{newButton}
            </span>
            <div style="outline-bottom: 1px solid var(--fg-color);"></div>
        </div>`,
        { tabsRoot, newButton }
    );

    const outerComponent = makeComponent<AppArgs>(root, () => {
        const names = getAvailableTrees();
        tabsList.rerender(names.length, (c, i) => {
            c.rerender({
                app: outerComponent.args,
                name: names[i],
            })
        })
    });

    return outerComponent;
}

const setCssVars = (vars: [string, string][]) => {
    const cssRoot = document.querySelector(":root") as HTMLElement;
    for (const [k, v] of vars) {
        cssRoot.style.setProperty(k, v);
    }
};

type AppRenderOptions = {
    shouldScroll: boolean;
}

type AppArgs = {
    state: State;
    shouldScroll: boolean;
    loadTree: (name: string, rerenderOptions?: AppRenderOptions) => void;
    rerenderApp(options?: AppRenderOptions): void;
    debouncedSave(): void;
    handleErrors(fn: () => void, onError: (err: any) => void): void;
    currentTreeName: string;
    renameCurrentTreeName(newName: string): void;
    deleteCurrentTree(): void;
    newTree(shouldRerender?: boolean): void;
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
                ["--fg-in-progress", "rgb(255, 0, 0, 1"],
                ["--bg-color", "#FFF"],
                ["--bg-color-focus", "rgb(0, 0, 0, 0.1)"],
                ["--bg-color-focus-2", "rgb(0, 0, 0, 0.4)"],
                ["--fg-color", "#000"],
                ["--unfocus-text-color", "gray"]
            ]);
        } else {
            // assume dark theme
            setCssVars([
                ["--fg-in-progress", "rgba(255, 0, 0, 1"],
                ["--bg-color", "#000"],
                ["--bg-color-focus", "rgba(255, 255, 255, 0.2)"],
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

const App = () => {
    const infoButton = htmlf(`<button class="info-button" title="click for help">help?</button>`);
    infoButton.el.addEventListener("click", () => {
        showInfo = !showInfo;
        appComponent.rerender();
    });

    const noteTreeHelp = htmlf(
        `<div>
            <p>
                Use this note tree to keep track of what you are currently doing, and how long you are spending on each thing.
            </p>
            <ul>
                <li>[Enter] to create a new entry</li>
                <li>Arrows to move around</li>
                <li>Tab or Shift+Tab to indent/unindent a note</li>
                <li>Also look at the buttons in the bottom right there</li>
            </ul>
        </div>`
    );

    const scratchPadHelp = htmlf(
        `<div>
            <p>
                Write down anything that can't go into a note into here. A task you need to do way later, a copy paste value, etc.
            </p>
        </div>`
    );

    const statusTextIndicator = htmlf(`<div class="pre-wrap"></div>`);

    const notesList = NotesList();
    const scratchPad = ScratchPad();
    const breakList: Insertable[] = []; //BreakList();
    const filters = NoteFilters();
    const treeSelector = CurrentTreeSelector();

    const appRoot = htmlf(
        `<div class="relative" style="padding-bottom: 100px">
            %{titleRow}
            %{info1}
            %{treeTabs}
            %{notesList}
            %{scratchPad}
            %{fixedButtons}
        </div>`,
        {
            titleRow: htmlf(
                `<div class="row align-items-center">%{title}<span class="flex-1"></span>%{infoButton}</div>`,
                {
                    title: htmlf(`<h2>Currently working on</h2>`),
                    infoButton
                }
            ),
            info1: noteTreeHelp,
            treeTabs: htmlf(
                `<div>
                    <div class="row align-items-end">
                        %{treeSelector}
                    </div>
                </div>`,
                { treeSelector }
            ),
            notesList: notesList,
            filters,
            scratchPad: htmlf(`<div>%{title}%{help}%{scratchPad}</div>`, {
                title: htmlf(`<h2 style="marginTop: 20px;">Scratch Pad</h2>`),
                help: scratchPadHelp,
                scratchPad
            }),
            breakList: htmlf(`<div>%{title}%{breakList}</div>`, {
                title: htmlf(`<h2 style="marginTop: 20px;">Break List</h2>`),
                breakList, 
            }),
            fixedButtons: htmlf(
                `<div class="fixed row align-items-center" style="bottom: 5px; right: 5px; left: 5px; gap: 5px;">
                    <div>%{leftButtons}</div>
                    <span class="flex-1"></span>
                    %{filters}
                    <span class="flex-1"></span>
                    <div>%{statusIndicator}</div>
                    <div>%{rightButtons}</div>
                </div>`,
                {
                    filters,
                    leftButtons: [makeDarkModeToggle()],
                    statusIndicator: statusTextIndicator,
                    rightButtons: [
                        makeButtonWithCallback("Clear all", () => {
                            if (!confirm("Are you sure you want to clear your note tree?")) {
                                return;
                            }

                            state = defaultState();
                            appComponent.rerender();

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
                                    const lsKeys = JSON.parse(scratchPad.getText());
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
                    ]
                }
            )
        }
    );

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

    const loadTree = (name: string, renderOptions?: AppRenderOptions) => {
        handleErrors(
            () => {
                state = loadState(name);
                currentTreeName = name;
                appComponent.rerender(renderOptions);
            },
            () => {
                // try to fallback to the first available tree.
                const availableTrees = getAvailableTrees();
                state = loadState(availableTrees[0]);
                currentTreeName = availableTrees[0];
                appComponent.rerender(renderOptions);
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
            appComponent.rerender();
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

        appComponent.rerender();
    };

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

    const appComponent = {
        el: appRoot.el,
        rerender: function (options = { shouldScroll: true }) {
            setVisible(noteTreeHelp, showInfo);
            setVisible(scratchPadHelp, showInfo);

            recomputeState(state);

            // need to know how far to offset the selected refs
            const args: AppArgs = {
                state,
                shouldScroll: options.shouldScroll,
                loadTree,
                rerenderApp: appComponent.rerender,
                debouncedSave,
                handleErrors,
                currentTreeName,
                renameCurrentTreeName,
                deleteCurrentTree,
                newTree
            };

            // rerender the things
            notesList.rerender(args);
            scratchPad.rerender(args);
            // breakList.rerender(args);
            treeSelector.rerender(args);
            filters.rerender(args);
        }
    };

    const initState = () => {
        const savedCurrentTreeName = localStorage.getItem("State.currentTreeName");
        const availableTrees = getAvailableTrees();

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
app.rerender();

