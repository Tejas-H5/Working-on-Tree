import "./styles.css"

import {
    Insertable,
    Renderable,
    appendChild,
    assert,
    copyStyles,
    htmlf,
    makeComponent,
    removeChild,
    resizeComponentPool,
    setClass,
    setInputValue,
    setInputValueAndResize,
    setTextContent,
    setVisible
} from "./htmlf";

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
            return "  [ * ]";
        case STATUS_DONE:
            return "  [ x ]";
    }
}

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

function moveToFirstNote(state: State) {
    state.currentNoteId = state.noteIds[0];
    return true;
}

function moveToLastNote(state: State) {
    const lastNoteRootId = state.noteIds[state.noteIds.length - 1];
    const lastNoteInTree = getLastNote(state, getNote(state, lastNoteRootId));
    state.currentNoteId = lastNoteInTree.id;
    return true;
}

function getLastNote(state: State, lastNote: Note) {
    while (!lastNote.isCollapsed && lastNote.childrenIds.length > 0) {
        lastNote = getNote(state, lastNote.childrenIds[lastNote.childrenIds.length - 1]);
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
    childrenIds: NoteId[];
    text: string;
    openedAt: string;
    isCollapsed: boolean;

    // non-serializable fields
    _status: NoteStatus; // used to track if a note is done or not.
    _isSelected: boolean; // used to display '>' or - in the note status
    _depth: number; // used to visually indent the notes
    _parent: Note | null; // this is a reference to a parent node.
    _collapsedCount: number; // used to display a collapsed count
    _localList: NoteId[]; // the local list that this thing is in. Either some note's .childrenIds, or state.noteIds.
    _localIndex: number; // putting it here bc why not. this is useful for some ops
};

function createNewNote(state: State, text: string): Note {
    const note: Note = {
        // the following is valuable user data

        id: uuid(),
        text: text || "",
        openedAt: getTimestamp(new Date()), // will be populated whenever text goes from empty -> not empty
        childrenIds: [],
        isCollapsed: false,

        // the following is just visual flags which are frequently recomputed

        _status: STATUS_IN_PROGRESS,
        _isSelected: false, // used to display '>' or - in the note status
        _depth: 0, // used to visually indent the notes
        _parent: null, // this is a reference to a parent node.
        _collapsedCount: 0, // used to display a collapsed count
        // @ts-ignore TODO: proper tree ops instead of calculating/inferring the parent
        _localList: null, // the local list that this thing is in. Either some note's .childrenIds, or state.noteIds.
        _localIndex: 0 // putting it here bc why not. this is useful for some ops
    };

    state.notes[note.id] = note;

    return note;
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
    notes: { [key: NoteId]: Note };
    noteIds: NoteId[];
    currentNoteId: NoteId;
    scratchPad: string;

    // non-serializable fields
    _flatNotes: Note[];
};

// NOTE: all state needs to be JSON-serializable.
// NO Dates/non-plain objects
// No non-owning references, i.e a reference to a node that really lives in another array
// Typically if state will contain references, non-serializable objects, or are in some way computed from other canonical state,
// it is prepended with '_', which will cause it to be stripped before it gets serialized.
function defaultState(): State {
    const state: State = {
        _flatNotes: [], // used by the note tree view, can include collapsed subsections
        notes: {},
        noteIds: [],
        currentNoteId: "",
        scratchPad: ""
    };

    const newNote = createNewNote(state, "First Note");
    state.currentNoteId = newNote.id;
    state.noteIds.push(newNote.id);

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
    if (note.text) {
        return false;
    }

    if (!note._parent && state.noteIds.length <= 1) {
        return false;
    }

    const noteToMoveTo = getOneNoteUp(state, note) || getOneNoteDown(state, note);
    if (!noteToMoveTo) {
        // cant delete this note if there are no other notes we can move to
        return false;
    }

    // delete from the ids list, as well as the note database
    note._localList.splice(note._localList.indexOf(note.id), 1);
    delete state.notes[note.id];

    state.currentNoteId = noteToMoveTo.id;

    return true;
}

function insertNoteAfterCurrent(state: State) {
    const currentNote = getCurrentNote(state);
    if (!currentNote.text) {
        // REQ: don't insert new notes while we're editing blank notes
        return false;
    }

    const newNote = createNewNote(state, "");
    currentNote._localList.splice(currentNote._localIndex + 1, 0, newNote.id);
    state.currentNoteId = newNote.id;

    return true;
}

function insertChildNode(state: State) {
    const currentNote = getCurrentNote(state);
    if (!currentNote.text) {
        // REQ: don't insert new notes while we're editing blank notes
        return false;
    }

    const newNote = createNewNote(state, "");
    currentNote.childrenIds.unshift(newNote.id);
    currentNote.isCollapsed = false;
    state.currentNoteId = newNote.id;

    return true;
}

function deleteNote(state: State, id: NoteId) {
    delete state.notes[id];
}

function getNote(state: State, id: NoteId) {
    const note = state.notes[id];
    if (!note) {
        console.warn("couldn't find note with id", id, state);
    }
    return note;
}

function getCurrentNote(state: State) {
    return getNote(state, state.currentNoteId);
}

function getOneNoteDown(state: State, note: Note): Note | null {
    if (!note.isCollapsed && note.childrenIds.length > 0) {
        return getNote(state, note.childrenIds[0]);
    }

    let parent: Note | null = note;
    while (parent) {
        if (parent._localIndex < parent._localList.length - 1) {
            return getNote(state, parent._localList[parent._localIndex + 1]);
        }

        // check if the parent's local list has a next child in it
        parent = parent._parent;
    }

    // we couldn't find a note 'below' this one
    return null;
}

function moveDown(state: State) {
    const note = getCurrentNote(state);
    const oneNoteDown = getOneNoteDown(state, note);
    if (!oneNoteDown) {
        return false;
    }

    state.currentNoteId = oneNoteDown.id;
    return true;
}

function getOneNoteUp(state: State, note: Note) {
    if (note._localIndex == 0) {
        if (note._parent) {
            return note._parent;
        }

        // can't move up from here
        return undefined;
    }

    const prevNoteOnSameLevel = getNote(state, note._localList[note._localIndex - 1]);
    if (prevNoteOnSameLevel.isCollapsed) {
        return prevNoteOnSameLevel;
    }

    return getLastNote(state, prevNoteOnSameLevel);
}

function swapChildren(note: Note, a: number, b: number) {
    const temp = note._localList[a];
    note._localList[a] = note._localList[b];
    note._localList[b] = temp;
}

function moveNoteDown(state: State) {
    const note = getCurrentNote(state);
    if (note._localIndex >= note._localList.length - 1) {
        return false;
    }

    swapChildren(note, note._localIndex, note._localIndex + 1);
    return true;
}

function moveNoteUp(state: State) {
    const note = getCurrentNote(state);
    if (note._localIndex === 0) {
        return false;
    }

    swapChildren(note, note._localIndex, note._localIndex - 1);
    return true;
}

function moveUp(state: State) {
    const noteOneUp = getOneNoteUp(state, getCurrentNote(state));
    if (!noteOneUp) {
        return false;
    }

    state.currentNoteId = noteOneUp.id;
    return true;
}

function indentNote(state: State) {
    // Indenting means that we find the note above this one in the parent's note list,
    // and then we move it and all the notes after it to the end of that parent list.
    // Making this operation simple was the main reason why I wasn't storing the notes in a literal tree for the longest time.
    // It also made moving 'up' and 'down' in the note tree as simple as ++ing or --ing an int. The code that does that now is very complex lol. (as simple as I could keep it, however)
    // But now there are a bunch of other things that necessitate a tree structure
    const note = getCurrentNote(state);

    if (note._localIndex === 0) {
        return false;
    }

    const newParentNoteId = note._localList[note._localIndex - 1];
    const newParent = getNote(state, newParentNoteId);
    assert(!!newParentNoteId && newParent, "Error in _localIndex Calculation");

    note._localList.splice(note._localIndex, 1);
    newParent.childrenIds.push(note.id);

    return true;
}

function deIndentNote(state: State) {
    // De-indenting means doing the opposite of indentNote. Read my long ahh comment in there
    // (Oh no im writing ahh in my comments now. the brainrot is real ...)

    const note = getCurrentNote(state);

    if (!note._parent) {
        return false;
    }

    const parent = note._parent;

    note._localList.splice(note._localIndex, 1);
    parent._localList.splice(parent._localIndex + 1, 0, note.id);

    return true;
}

// returns true if the app should re-render
function handleNoteInputKeyDown(state: State, keyDownEvent: KeyboardEvent) {
    const key = keyDownEvent.key;
    if (key === "Enter") {
        if (keyDownEvent.shiftKey) {
            return insertChildNode(state);
        }
        return insertNoteAfterCurrent(state);
    }

    if (key === "Backspace") {
        if (deleteNoteIfEmpty(state, state.currentNoteId)) {
            keyDownEvent.preventDefault();
            return true;
        }

        return false;
    }

    if (key === "Tab") {
        keyDownEvent.preventDefault();

        if (keyDownEvent.shiftKey) {
            return deIndentNote(state);
        }

        return indentNote(state);
    }

    if (key === "ArrowUp") {
        keyDownEvent.preventDefault();
        if (keyDownEvent.altKey) {
            return moveNoteUp(state);
        }
        if (keyDownEvent.ctrlKey || keyDownEvent.metaKey) {
            return collapseNode(state);
        }
        return moveUp(state);
    }

    if (key === "ArrowDown") {
        keyDownEvent.preventDefault();
        if (keyDownEvent.altKey) {
            return moveNoteDown(state);
        }
        if (keyDownEvent.ctrlKey || keyDownEvent.metaKey) {
            return expandNode(state);
        }
        return moveDown(state);
    }

    if (key === "End" && keyDownEvent.ctrlKey) {
        keyDownEvent.preventDefault();
        return moveToLastNote(state);
    }

    if (key === "Home" && keyDownEvent.ctrlKey) {
        keyDownEvent.preventDefault();
        return moveToFirstNote(state);
    }

    return false;
}

function collapseNode(state: State) {
    const note = getCurrentNote(state);
    if (note.isCollapsed || note.childrenIds.length === 0) {
        return false;
    }

    note.isCollapsed = true;
    return true;
}

function expandNode(state: State) {
    const note = getCurrentNote(state);
    if (!note.isCollapsed) {
        return false;
    }

    note.isCollapsed = false;
    return true;
}

function dfsPre(state: State, note: Note, fn: (n: Note) => void) {
    fn(note);

    for (const id of note.childrenIds) {
        const note = getNote(state, id);
        dfsPre(state, note, fn);
    }
}

function dfsPost(state: State, note: Note, fn: (n: Note) => void) {
    for (const id of note.childrenIds) {
        const note = getNote(state, id);
        if (dfsPost(state, note, fn) === true) {
            return true;
        }
    }

    fn(note);
}

function copyState(state: State) {
    return JSON.parse(JSON.stringify(recursiveShallowCopy(state)));
}

function mergeState(existingState: State | undefined, incomingState: State): State {
    if (!existingState) {
        return incomingState;
    }

    const newState: State = { ...incomingState };
    for (const key in existingState) {
        // @ts-ignore
        newState[key] = existingState[key];
    }

    if (incomingState.scratchPad) {
        newState.scratchPad = incomingState.scratchPad;
    }

    function mergeChildIds<T>(a: T[], b: T[]): T[] {
        if (!a || !b) {
            throw new Error("There is a bug in the code");
        }

        return [...new Set([...a, ...b])];
    }

    // incoming notes with the same id can overwrite existing notes
    newState.notes = {};
    for (const id in existingState.notes) {
        newState.notes[id] = existingState.notes[id];
    }
    for (const id in incomingState.notes) {
        newState.notes[id] = incomingState.notes[id];
    }

    for (const id in newState.notes) {
        if (existingState.notes[id] && incomingState.notes[id]) {
            newState.notes[id].childrenIds = mergeChildIds(
                existingState.notes[id].childrenIds,
                incomingState.notes[id].childrenIds
            );

            console.log(
                "merging ",
                newState.notes[id].text,
                newState.notes[id].childrenIds.map((cid) => getNote(newState, cid)),
                existingState.notes[id].childrenIds.map((cid) => getNote(newState, cid)),
                incomingState.notes[id].childrenIds.map((cid) => getNote(newState, cid))
            );
        }
    }

    newState.noteIds = mergeChildIds(existingState.noteIds, incomingState.noteIds);

    return newState;
}

function filterNotes(state: State, predicate: (n: Note) => boolean, pruneRootNotes: boolean) {
    const dfs = (note: Note) => {
        for (let i = 0; i < note.childrenIds.length; i++) {
            const id = note.childrenIds[i];
            const child = getNote(state, id);

            dfs(child);

            if (
                predicate(child) || // doesn't meet filtering criteria
                child.childrenIds.length > 0 // has children that survived filtering
            ) {
                continue;
            }

            note.childrenIds.splice(i, 1);
            i--;
            deleteNote(state, id);
        }
    };

    for (let i = 0; i < state.noteIds.length; i++) {
        const id = state.noteIds[i];
        const note = getNote(state, id);

        const childIdsPrev = note.childrenIds.length;

        dfs(note);

        if (pruneRootNotes) {
            if (childIdsPrev !== 0 && note.childrenIds.length === 0) {
                state.noteIds.splice(i, 1);
                i--;

                deleteNote(state, id);
            }
        }
    }
}

function recomputeFlatNotes(state: State, flatNotes: Note[], collapse: boolean) {
    flatNotes.splice(0, flatNotes.length);
    const dfs = (note: Note) => {
        flatNotes.push(note);
        if (collapse && note.isCollapsed) {
            // don't render any of it's children, but calculate the number of children underneath
            let numCollapsed = 0;
            dfsPre(state, note, () => numCollapsed++);
            note._collapsedCount = numCollapsed;
            return;
        }

        for (const id of note.childrenIds) {
            const note = getNote(state, id);
            dfs(note);
        }
    };

    for (const id of state.noteIds) {
        const note = getNote(state, id);

        dfs(note);
    }
}

// called just before we render things.
// It recomputes all state that needs to be recomputed
// TODO: super inefficient, need to set up a compute graph or something more complicated
function recomputeState(state: State) {
    assert(!!state, "WTF");

    // ensure always one note
    if (state.noteIds.length === 0) {
        state.notes = {};
        const note = createNewNote(state, "First note");
        state.noteIds.push(note.id);
    }

    // fix notes with childrenIds that reference missing notes
    // TODO: figure out why they were missing in the first place
    {
        const dfs = (childrenIds: NoteId[]) => {
            for (let i = 0; i < childrenIds.length; i++) {
                const id = childrenIds[i];
                const note = getNote(state, id);
                if (note) {
                    dfs(note.childrenIds);
                    continue;
                }

                childrenIds.splice(i, 1);
                i--;
            }
        };

        dfs(state.noteIds);
    }

    // recompute _depth, _parent, _localIndex, _localList. Somewhat required for a lot of things after to work.
    // tbh a lot of these things should just be updated as we are moving the elements around, but I find it easier to write this (shit) code at the moment
    {
        const dfs = (note: Note, depth: number, parent: Note | null, localIndex: number, list: NoteId[]) => {
            note._depth = depth;
            note._parent = parent;
            note._localIndex = localIndex;
            note._localList = list;

            for (let i = 0; i < note.childrenIds.length; i++) {
                const c = getNote(state, note.childrenIds[i]);
                dfs(c, depth + 1, note, i, note.childrenIds);
            }
        };

        for (let i = 0; i < state.noteIds.length; i++) {
            const note = getNote(state, state.noteIds[i]);
            dfs(note, 0, null, i, state.noteIds);
        }
    }

    // remove all empty notes that we aren't editing
    // again, this should really just be done when we are moving around
    {
        const currentNote = getCurrentNote(state);
        const noteIdsToDelete: NoteId[] = [];

        for (const id of state.noteIds) {
            const note = getNote(state, id);
            dfsPost(state, note, (note) => {
                if (note === currentNote) {
                    return;
                }

                if (note.text.trim()) {
                    return;
                }

                if (note.childrenIds.length > 0) {
                    // we probably dont want to delete this note, because it has child notes.
                    // the actually good thing to do here would be to revert this text to what it was last
                    note.text = "<redacted>";
                } else {
                    noteIdsToDelete.push(note.id);
                }
            });
        }

        for (const id of noteIdsToDelete) {
            deleteNoteIfEmpty(state, id);
        }
    }

    // for (const id in state.notes) {
    //     state.notes[id].isCollapsed = false;
    // }

    // recompute _flatNotes (after deleting things)
    {
        if (!state._flatNotes) {
            state._flatNotes = [];
        }

        recomputeFlatNotes(state, state._flatNotes, true);
    }

    // recompute _status, do some sorting
    {
        for (const id in state.notes) {
            state.notes[id]._status = STATUS_IN_PROGRESS;
        }

        for (const id of state.noteIds) {
            const note = getNote(state, id);

            const dfs = (note: Note) => {
                if (note.childrenIds.length === 0) {
                    return;
                }

                let foundDoneNote = false;
                for (let i = note.childrenIds.length - 1; i >= 0; i--) {
                    const childId = note.childrenIds[i];
                    const child = getNote(state, childId);
                    if (child.childrenIds.length > 0) {
                        dfs(child);
                        continue;
                    }

                    if (isTodoNote(child)) {
                        child._status = STATUS_IN_PROGRESS;
                        continue;
                    }

                    if (isDoneNote(child) || foundDoneNote) {
                        child._status = STATUS_DONE;
                        foundDoneNote = true;
                        continue;
                    }

                    if (i === note.childrenIds.length - 1) {
                        child._status = STATUS_IN_PROGRESS;
                    } else {
                        child._status = STATUS_ASSUMED_DONE;
                    }
                }

                // Not enough for every child note to be done, the final note in our list should also be 'done'.
                // That way, when I decide to 'move out all the done notes', I don't accidentally move out the main note.

                const everyChildNoteIsDone = note.childrenIds.every((id) => {
                    const note = getNote(state, id);
                    return note._status === STATUS_DONE;
                });

                const finalNoteId = note.childrenIds[note.childrenIds.length - 1];
                const finalNote = getNote(state, finalNoteId);
                const finalNoteIsDoneLeafNote = isDoneNote(finalNote);

                note._status =
                    everyChildNoteIsDone && finalNoteIsDoneLeafNote ? STATUS_DONE : STATUS_IN_PROGRESS;
            };

            dfs(note);
        }
    }

    // recompute _isSelected to just be the current note + all parent notes
    {
        for (const id in state.notes) {
            const note = getNote(state, id);
            note._isSelected = false;
        }

        const current = getCurrentNote(state);
        iterateParentNotes(current, (note) => {
            note._isSelected = true;
        });
    }
}

function iterateParentNotes(note: Note | null, fn: (note: Note) => void) {
    while (note) {
        fn(note);
        note = note._parent;
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

function getNoteDuration(state: State, note: Note) {
    if (note._status === STATUS_IN_PROGRESS) {
        return getDurationMS(note.openedAt, getTimestamp(new Date()));
    }

    if (note.childrenIds.length === 0) {
        // the duration is the difference between this note and the next non-TODO note.

        let nextNoteIndex = note._localIndex + 1;
        if (nextNoteIndex < note._localList.length) {
            // skip over todo notes
            while (nextNoteIndex < note._localList.length) {
                let nextNoteId = note._localList[nextNoteIndex];
                if (isTodoNote(getNote(state, nextNoteId))) {
                    nextNoteIndex++;
                }
                break;
            }

            const nextNoteId = note._localList[nextNoteIndex];
            return getDurationMS(note.openedAt, getNote(state, nextNoteId).openedAt);
        }

        return 0;
    }

    let latestNote = note;
    dfsPre(state, note, (note) => {
        if (latestNote.openedAt < note.openedAt) {
            latestNote = note;
        }
    });

    return getDurationMS(note.openedAt, latestNote.openedAt);
}

function getSecondPartOfRow(state: State, note: Note) {
    const duration = getNoteDuration(state, note);
    const durationStr = formatDuration(duration);
    const secondPart =
        note._status !== STATUS_IN_PROGRESS ? ` took ${durationStr}` : ` ongoing ${durationStr} ...`;
    return secondPart;
}

function getRowIndentPrefix(_state: State, note: Note) {
    return `${getIndentStr(note)} ${getNoteStateString(note)}`;
}

function getFirstPartOfRow(state: State, note: Note) {
    // const dashChar = note._isSelected ? ">" : "-"
    // having ">" in exported text looks ugly, so I've commented this out for now
    const dashChar = "-";

    return `${getTimeStr(note)} | ${getRowIndentPrefix(state, note)} ${dashChar} ${note.text || " "}`;
}

function exportAsText(state: State) {
    const header = (text: string) => `----------------${text}----------------`;

    const flatNotes: Note[] = [];
    recomputeFlatNotes(state, flatNotes, false);

    const table = [];
    for (const note of flatNotes) {
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

// NOTE: the caller who is instantiating the scratch pad should have access to the text here.
// so it makes very litle sense that we are getting this text...
function ScratchPad(): Renderable<AppArgs> & { getText(): string } {
    const textArea = htmlf<HTMLTextAreaElement>(`<textarea class="scratch-pad pre-wrap"></textarea>`);
    const mirrorDiv = htmlf(`<div></div>`);
    const root = htmlf(`<div>%{textArea}%{mirrorDiv}</div>`, { textArea, mirrorDiv });

    const component = makeComponent<AppArgs>(root, () => {
        const { state } = component.args;

        if (textArea.el.value !== state.scratchPad) {
            textArea.el.value = state.scratchPad;

            setTimeout(() => {
                // automatically resize the text area to the content + some overflow
                textArea.el.style.height = "" + 0;
                textArea.el.style.height = textArea.el.scrollHeight + "px";
            }, 0);
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

    textArea.el.addEventListener("keydown", () => {
        // NOTE: unsolved problem in computer science - scroll the window to the vertical position
        // of the cursor in the text area. 
        // Now solved: 
        // 1 - Create a 'mirror div' with exactly the same styles (but we need to manually apply some of them)
        // 2 - insert text from the start of the div to the cursor position
        //         (plus some random character, so the whitespace on the end doesnt get truncated, despite your 'pre' whiteSpace style)
        // 3 - measure the height of this div. this is the vertical offset to whre our cursor is, more or less
        // 4 - scroll to this offsetTop + height. ez

        setTimeout(() => {
            let wantedScrollPos;
            {
                // Inspired by a stack overflow solution, but I actually figured it out myself :0
                // (Although they needed to find the x and y position of the user's cursor, not just the y position like me)
                //      for reference: https://jh3y.medium.com/how-to-where-s-the-caret-getting-the-xy-position-of-the-caret-a24ba372990a
                appendChild(root, mirrorDiv);

                copyStyles(textArea, mirrorDiv);
                mirrorDiv.el.style.height = "" + 0;
                mirrorDiv.el.style.whiteSpace = "pre";
                mirrorDiv.el.style.display = "block";

                const textUpToCursor = textArea.el.value.substring(0, textArea.el.selectionEnd) + ".";
                setTextContent(mirrorDiv, textUpToCursor);
                const wantedHeight = mirrorDiv.el.scrollHeight;
                wantedScrollPos = textArea.el.offsetTop + wantedHeight;

                removeChild(root, mirrorDiv);
            }

            window.scrollTo({
                left: 0,
                top: wantedScrollPos - window.innerHeight * (1 - 1 / 3),
                behavior: "instant"
            });
        }, 1);
    });

    textArea.el.addEventListener("input", () => {
        const { state } = component.args;
        state.scratchPad = textArea.el.value;
        // automatically resize the text area to the content + some overflow
        textArea.el.style.height = "" + 0;
        textArea.el.style.height = textArea.el.scrollHeight + "px";
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
    note: Note;
    flatIndex: number;
};
function NoteRowText(): Renderable<NoteRowArgs> {
    const indent = htmlf(`<div class="pre-wrap"></div>`);
    const whenNotEditing = htmlf(`<div class="pre-wrap"></div>`);
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

        const dashChar = note._isSelected ? ">" : "-";
        setTextContent(
            indent,
            `${getIndentStr(note)} ${getNoteStateString(note)} ${
                note.isCollapsed ? `(+ ${note._collapsedCount})` : ""
            } ${dashChar} `
        );

        const wasEditing = isEditing;
        isEditing = state.currentNoteId === note.id;
        setVisible(whenEditing, isEditing);
        setVisible(whenNotEditing, !isEditing);
        if (isEditing) {
            setInputValue(whenEditing, note.text);

            if (!wasEditing) {
                setTimeout(() => {
                    whenEditing.el.focus({ preventScroll: true });

                    if (shouldScroll) {
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
            setTextContent(whenNotEditing, note.text);
        }
    });

    whenEditing.el.addEventListener("input", () => {
        const { app: { rerenderApp }, note } = component.args;

        note.text = whenEditing.el.value;
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
        setInputValueAndResize(input, getTimeStr(note));
    });

    input.el.addEventListener("change", () => {
        const { app: { state, rerenderApp, handleErrors, debouncedSave }, note } = component.args;

        const prevNote = note._parent;
        let nextNote = null;
        for (const id of note.childrenIds) {
            const child = getNote(state, id);
            if (nextNote === null || child.openedAt < nextNote.openedAt) {
                nextNote = child;
            }
        }

        let previousTime: Date | null = null;
        let nextTime: Date | null = null;

        if (prevNote) {
            previousTime = new Date(prevNote.openedAt);
        }

        if (nextNote) {
            nextTime = new Date(nextNote.openedAt);
        }

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

                let newTime = new Date(note.openedAt);
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

                note.openedAt = getTimestamp(newTime);
                debouncedSave();

                rerenderApp();
            },
            () => {
                setInputValueAndResize(input, getTimeStr(note));
                rerenderApp();
            }
        );
    });

    return component;
}

function NoteRowStatistic(): Renderable<NoteRowArgs> {
    const root = htmlf(`<div class="text-align-right pre-wrap"></div>`);

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { app: { state }, note } = component.args;
        setTextContent(root, getSecondPartOfRow(state, note));
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
        const { note, app: { stickyPxRef } } = component.args;

        const textColor = note._isSelected
            ? "var(--fg-color)"
            : note._status === STATUS_IN_PROGRESS
            ? "var(--fg-color)"
            : "var(--unfocus-text-color)";

        root.el.style.color = textColor;

        timestamp.rerender(component.args);
        text.rerender(component.args);
        statistic.rerender(component.args);

        if (note._isSelected || note._status === STATUS_IN_PROGRESS) {
            setTimeout(() => {
                // make this note stick to the top of the screen so that we can see it
                let top = stickyPxRef.val;
                stickyPxRef.val += root.el.getBoundingClientRect().height;

                root.el.style.position = "sticky";
                root.el.style.top = top + "px";
            }, 1);
        } else {
            // unstick this note
            root.el.style.position = "static";
            root.el.style.top = "";
        }
    });

    root.el.addEventListener("click", () => {
        const { app: { state, rerenderApp }, note } = component.args;

        state.currentNoteId = note.id;
        rerenderApp();
    });

    return component;
}

function NotesList(): Renderable<AppArgs> {
    const pool: Renderable<NoteRowArgs>[] = [];
    const root = htmlf(
        `<div class="w-100" style="border-top: 1px solid var(--fg-color);border-bottom: 1px solid var(--fg-color);"></div>`
    );

    const component = makeComponent<AppArgs>(root, () => {
        const { state } = component.args;

        resizeComponentPool<Renderable<NoteRowArgs>>(root, pool, state._flatNotes.length, NoteRowInput);
        for (let i = 0; i < state._flatNotes.length; i++) {
            pool[i].rerender({
                app: component.args,
                flatIndex: i,
                note: state._flatNotes[i]
            });
        }
    });

    return component;
}

function Button(text: string, fn: () => void, classes: string = "") {
    const btn = htmlf(
        `<button type="button" class="solid-border ${classes}" style="padding: 3px; margin: 5px;">%{text}</button>`,
        { text }
    );

    btn.el.addEventListener("click", fn);
    return btn;
};

// will be more of a tabbed view
const CurrentTreeSelector = () => {
    const tabsRoot = htmlf(`<span class="row pre-wrap align-items-center"></span>`);
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

    type TabRow = {
        app: AppArgs;
        name: string;
    };

    const tabComponents: Renderable<TabRow>[] = [];
    const outerComponent = makeComponent<AppArgs>(root, () => {
        const names = getAvailableTrees();
        resizeComponentPool(tabsRoot, tabComponents, names.length, (): Renderable<TabRow> => {
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

            const component = makeComponent<TabRow>(root, () => {
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
        });

        for (let i = 0; i < names.length; i++) {
            tabComponents[i].rerender({ app: outerComponent.args, name: names[i] });
        }
    });

    newButton.el.addEventListener("click", () => {
        const { newTree } = outerComponent.args;
        newTree();
    });

    return outerComponent;
};

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
    stickyPxRef: { val: number };
    loadTree: (name: string, rerenderOptions?: AppRenderOptions) => void;
    rerenderApp(options?: AppRenderOptions): void;
    debouncedSave(): void;
    handleErrors(fn: () => void, onError: (err: any) => void): void;
    currentTreeName: string;
    renameCurrentTreeName(newName: string): void;
    deleteCurrentTree(): void;
    newTree(): void;
};


type AppTheme = "Light" | "Dark";

const DarkModeToggle = () => {
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
                ["--bg-color", "#FFF"],
                ["--bg-color-focus", "rgb(0, 0, 0, 0.1)"],
                ["--bg-color-focus-2", "rgb(0, 0, 0, 0.4)"],
                ["--fg-color", "#000"],
                ["--unfocus-text-color", "gray"]
            ]);
        } else {
            // assume dark theme
            setCssVars([
                ["--bg-color", "#000"],
                ["--bg-color-focus", "rgb(1, 1, 1, 0.1)"],
                ["--bg-color-focus-2", "rgb(1, 1, 1, 0.4)"],
                ["--fg-color", "#EEE"],
                ["--unfocus-text-color", "gray"]
            ]);
        }

        setTextContent(button, theme);
    };

    const button = Button("", () => {
        let themeName = getTheme();
        if (!themeName || themeName === "Light") {
            themeName = "Dark";
        } else {
            themeName = "Light";
        }

        setTheme(themeName);
    });

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

    const moveOutFinishedNotesButton = Button("Move out finished notes", () => {
        const doneTreeName = currentTreeName + " [done]";
        if (
            !confirm(
                "This will remove all 'done' nodes from this tree and move them to another tree named " +
                    doneTreeName +
                    ", are you sure?"
            )
        ) {
            return;
        }

        try {
            // high risk code, could possibly corrupt user data, so we're working with copies,
            // then assigning over the result
            const doneState = copyState(state);
            recomputeState(doneState);
            filterNotes(doneState, (note) => note._status === STATUS_DONE, true);

            const notDoneState = copyState(state);
            recomputeState(notDoneState);
            filterNotes(notDoneState, (note) => note._status !== STATUS_DONE, true);

            let existingDoneState;
            try {
                existingDoneState = loadState(doneTreeName);
            } catch {
                // no existing notes
            }
            const doneStateMerged = mergeState(existingDoneState, doneState);

            saveState(doneStateMerged, doneTreeName);

            // only mutate our current state once everything else succeeds
            for (const key in notDoneState) {
                // @ts-ignore
                state[key] = notDoneState[key];
            }
            saveState(state, currentTreeName);
        } catch (e) {
            console.error("failed\n\n", e);
        }

        // remove other stuff that we don't need to move out
        appComponent.rerender();

        showStatusText("Moved done notes");
    });

    const notesList = NotesList();
    const scratchPad = ScratchPad();
    const treeSelector = CurrentTreeSelector();

    const appRoot = htmlf(
        `<div class="relative" style="padding-bottom: 100px">
            %{titleRow}
            %{info1}
            %{treeTabs}
            %{notesList}
            %{scratchPad}

            <div>
                <div style="height: 1500px"></div>
            </div>

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
            scratchPad: htmlf(`<div>%{title}%{help}%{scratchPad}</div>`, {
                title: htmlf(`<h2 style="marginTop: 20px;">Scratch Pad</h2>`),
                help: scratchPadHelp,
                scratchPad
            }),
            fixedButtons: htmlf(
                `<div class="fixed row align-items-center" style="bottom: 5px; right: 5px; left: 5px; gap: 5px;">
                    <div>%{leftButtons}</div>
                    <span class="flex-1"></span>
                    <div>%{statusIndicator}</div>
                    <div>%{rightButtons}</div>
                </div>`,
                {
                    leftButtons: [DarkModeToggle()],
                    statusIndicator: statusTextIndicator,
                    rightButtons: [
                        moveOutFinishedNotesButton,
                        Button("Clear all", () => {
                            if (!confirm("Are you sure you want to clear your note tree?")) {
                                return;
                            }

                            state = defaultState();
                            appComponent.rerender();

                            showStatusText("Cleared notes");
                        }),
                        Button("Copy as text", () => {
                            handleErrors(() => {
                                navigator.clipboard.writeText(exportAsText(state));
                                showStatusText("Copied as text");
                            });
                        }),
                        Button("Load JSON from scratch pad", () => {
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
                        Button("Copy as JSON", () => {
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

            const isDoneNote = currentTreeName.endsWith("[done]");
            setVisible(moveOutFinishedNotesButton, !isDoneNote);

            recomputeState(state);

            // need to know how far to offset the selected refs
            const stickyPxRef = { val: 0 };
            const args: AppArgs = {
                state,
                shouldScroll: options.shouldScroll,
                stickyPxRef,
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
            treeSelector.rerender(args);
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
