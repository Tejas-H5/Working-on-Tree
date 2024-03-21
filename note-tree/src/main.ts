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
    openedAt: string;

    // non-serializable fields
    _status: NoteStatus; // used to track if a note is done or not.
    _isSelected: boolean; // used to display '>' or - in the note status
    _depth: number; // used to visually indent the notes
};

function createNewNote(text: string): tree.TreeNode<Note> {
    const note: Note = {
        // the following is valuable user data

        id: uuid(),
        text: text || "",
        openedAt: getTimestamp(new Date()), // will be populated whenever text goes from empty -> not empty

        // the following is just visual flags which are frequently recomputed

        _status: STATUS_IN_PROGRESS,
        _isSelected: false, // used to display '>' or - in the note status
        _depth: 0, // used to visually indent the notes
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
    scratchPad: string;

    // non-serializable fields
    _flatNotes: NoteId[];
};

// NOTE: all state needs to be JSON-serializable.
// NO Dates/non-plain objects
// No non-owning references, i.e a reference to a node that really lives in another array
// Typically if state will contain references, non-serializable objects, or are in some way computed from other canonical state,
// it is prepended with '_', which will cause it to be stripped before it gets serialized.
function defaultState(): State {
    const state: State = {
        _flatNotes: [], // used by the note tree view, can include collapsed subsections

        notes: tree.newTreeStore<Note>({
            id: tree.ROOT_KEY,
            openedAt: getTimestamp(new Date()),
            text: "This root node should not be visible. If it is, you've encountered a bug!",
            _depth: 0,
            _isSelected: false,
            _status: STATUS_IN_PROGRESS,
        }),
        currentNoteId: "",
        scratchPad: ""
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
    const idx = parent.childIds.indexOf(currentNote.id);
    if (idx === parent.childIds.length - 1) {
        tree.addAfter(state.notes, currentNote, newNote)
    }  else {
        tree.addUnder(state.notes, currentNote, newNote);
    }

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

        state.currentNoteId = rootChildIds[rootChildIds.length - 1];
    }

    return getNote(state, state.currentNoteId);
}

function getOneNoteDown(state: State, note: tree.TreeNode<Note>): tree.TreeNode<Note> | null {
    if (!note.parentId) {
        return null;
    }

    if (note.childIds.length > 0) {
        return getNote(state, note.childIds[0]);
    }

    while (note.parentId) {
        const parent = getNote(state, note.parentId);
        const idx = parent.childIds.indexOf(note.id);
        if (idx !== parent.childIds.length - 1) {
            return getNote(state, parent.childIds[idx + 1]);
        }

        // this is the final note. check if the parent has a note after it
        note = getNote(state, note.parentId)
    }

    return null;
}

function getOneNoteUp(state: State, note: tree.TreeNode<Note>): tree.TreeNode<Note> | null {
    if (!note.parentId) {
        return null;
    }

    const parent = getNote(state, note.parentId);
    if (parent.childIds[0] === note.id) {
        return parent;
    }

    const idx = parent.childIds.indexOf(note.id);
    assert(idx !== -1, "Possible data corruption");
    const oneUp = getNote(state, parent.childIds[idx - 1]);
    return getLastNote(state, oneUp);
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


function getNoteOneDownLocally(state: State, note: tree.TreeNode<Note>) {
    if (!note.parentId) {
        return null;
    }

    const parent = getNote(state, note.parentId);
    const idx = parent.childIds.indexOf(note.id);
    if (idx < parent.childIds.length - 1) {
        return getNote(state, parent.childIds[idx + 1]);
    }

    return null;
}

function getNoteOneUpLocally(state: State, note: tree.TreeNode<Note>) {
    if (!note.parentId) {
        return null;
    }

    const parent = getNote(state, note.parentId);
    const idx = parent.childIds.indexOf(note.id);
    if (idx > 0) {
        return getNote(state, parent.childIds[idx - 1]);
    }

    return null;
}

// returns true if the app should re-render
function handleNoteInputKeyDown(state: State, e: KeyboardEvent) {
    const ctrlPressed = e.ctrlKey || e.metaKey;
    const currentNote = getCurrentNote(state);

    switch (e.key) {
        case "Enter":
            if (e.shiftKey) {
                insertChildNode(state);
            } else {
                insertNoteAfterCurrent(state);
            }
            break;
        case "Backspace":
            deleteNoteIfEmpty(state, state.currentNoteId);
            break;
        case "Tab":
            // TODO: move between the tabs
            break;
        case "ArrowUp":
            moveToNote(state, 
                ctrlPressed ? getNoteOneUpLocally(state, currentNote) : 
                    getOneNoteUp(state, currentNote)
            );
            break;
        case "ArrowDown":
            moveToNote(state, 
                ctrlPressed ? getNoteOneDownLocally(state, currentNote) : 
                    getOneNoteDown(state, currentNote)
            );
            break;
        case "ArrowLeft":
            moveToNote(state, 
                currentNote.parentId ? getNote(state, currentNote.parentId) : null
            );
            break;
        case "ArrowRight":
            moveToNote(
                state,
                currentNote.childIds.length > 0 ? (
                    getNote(state, currentNote.childIds[currentNote.childIds.length - 1])
                ) : null
            );
            break;
        default:
            return false;
    }

    return true;
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


function filterNotes(state: State, predicate: (n: tree.TreeNode<Note>) => boolean) {
    const dfs = (note: tree.TreeNode<Note>) => {
        for (let i = 0; i < note.childIds.length; i++) {
            const id = note.childIds[i];
            const child = getNote(state, id);

            dfs(child);

            if (
                predicate(child) ||         // should keep this note
                child.childIds.length > 0   // has children that should be kept
            ) {
                continue;
            }


            tree.remove(state.notes, child);
            i--;
        }
    };

    dfs(getRootNote(state));
}

function getRootNote(state: State) {
    return getNote(state, state.notes.rootId);
}

function recomputeFlatNotes(state: State, flatNotes: NoteId[]) {
    flatNotes.splice(0, flatNotes.length);

    const dfs = (note: tree.TreeNode<Note>) => {
        for (const id of note.childIds) {
            const note = getNote(state, id);
            flatNotes.push(note.id);

            dfs(note);
        }
    };

    dfs(getRootNote(state));
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

    // recompute _flatNotes (after deleting things)
    {
        if (!state._flatNotes) {
            state._flatNotes = [];
        }

        recomputeFlatNotes(state, state._flatNotes);
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

    // recompute _isSelected to just be the current note + all parent notes
    {
        tree.forEachNode(state.notes, (id) => {
            const note = getNote(state, id);
            note.data._isSelected = false;
        });

        const current = getCurrentNote(state);
        tree.forEachParent(state.notes, current, (note) => {
            note.data._isSelected = true;
        });
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
        if (idx + 1 < parent.childIds.length) {
            // skip over todo notes
            let nextNoteIdx = idx + 1;
            while (nextNoteIdx < parent.childIds.length) {
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
    const secondPart =
        note.data._status !== STATUS_IN_PROGRESS ? ` took ${durationStr}` : ` ongoing ${durationStr} ...`;
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
    note: tree.TreeNode<Note>;
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
        const { app: { rerenderApp }, note } = component.args;

        note.data.text = whenEditing.el.value;
        rerenderApp();
    });

    whenEditing.el.addEventListener("keydown", (e) => {
        const { app: { state, rerenderApp, debouncedSave } } = component.args;

        if (handleNoteInputKeyDown(state, e)) {
            e.preventDefault();
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
        const { app: { state, rerenderApp, handleErrors, debouncedSave }, note } = component.args;

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

        const textColor = note.data._isSelected
            ? "var(--fg-color)"
            : note.data._status === STATUS_IN_PROGRESS
            ? "var(--fg-color)"
            : "var(--unfocus-text-color)";

        root.el.style.color = textColor;

        timestamp.rerender(component.args);
        text.rerender(component.args);
        statistic.rerender(component.args);

        if (note.data._isSelected || note.data._status === STATUS_IN_PROGRESS) {
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

        setCurrentNote(state, note.id);
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
                note: getNote(state, state._flatNotes[i]),
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
