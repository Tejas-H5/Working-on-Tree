const INDENT_BASE_WIDTH = 100;
const INDENT_WIDTH_PX = 50;
const SAVE_DEBOUNCE = 2000;
const STATUS_TEXT_PERSIST_TIME = 1000;
const ERROR_TIMEOUT_TIME = 5000;

const pad2 = (num) => (num < 10 ? "0" + num : "" + num);
const repeatSafe = (str, len) => {
    const string = len <= 0 ? "" : str.repeat(Math.ceil(len / str.length));
    return string.substring(0, len);
};

const getNoteStateString = (note) => {
    if (note._isDone) {
        return "  [x]";
    } else {
        return "[...]";
    }
};

const formatDuration = (ms) => {
    if (ms === "still-working") {
        return "...";
    }

    const milliseconds = ms;
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / 1000 / 60) % 60;
    const hours = Math.floor(ms / 1000 / 60 / 60) % 24;
    const days = Math.floor(ms / 1000 / 60 / 60 / 24);

    if (ms < 1000) {
        // return `${ms} milliseconds`;
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
};

const getDurationMS = (a, b) => {
    if (b === null) {
        return "still-working";
    }

    return new Date(b).getTime() - new Date(a).getTime();
};

const moveToFirstNote = (state) => {
    state.currentNoteId = state.noteIds[0];
    return true;
};

const moveToLastNote = (state) => {
    const lastNoteRootId = state.noteIds[state.noteIds.length - 1]
    const lastNoteInTree = getLastNote(state, getNote(state, lastNoteRootId));
    state.currentNoteId = lastNoteInTree.id;
    return true;
};

const getLastNote = (state, lastNote) => {
    while (!lastNote.isCollapsed && lastNote.childrenIds.length > 0) {
        lastNote = getNote(
            state, 
            lastNote.childrenIds[lastNote.childrenIds.length - 1]
        );
    }

    return lastNote;
}

const getTimestamp = (date) => {
    return date.toISOString();
};

// https://stackoverflow.com/questions/105034/how-do-i-create-a-guid-uuid
function uuid() {
    function S4() {
       return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
    };
    return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}

const createNewNote = (state, text) => {
    const note = {
        // the following is valuable user data

        id: uuid(),
        text: text || "",
        openedAt: getTimestamp(new Date()), // will be populated whenever text goes from empty -> not empty
        childrenIds: [],
        isCollapsed: false,

        // TODO: deprecate and remove all references to this
        closedAt: null, 

        // the following is just visual flags which are frequently recomputed

        _isDone: false,                 // used to display [...] or [x] next to a note.
        _isSelected: false,             // used to display '>' or - in the note status
        _depth: 0,                      // used to visually indent the notes
        _parent: null,                  // this is a reference to a parent node.
        _collapsedCount: 0,             // used to display a collapsed count
        _localList: null,               // the local list that this thing is in. Either some note's .childrenIds, or state.noteIds.
        _localIndex: 0,                 // putting it here bc why not. this is useful for some ops
    };

    state.lastNoteId += 1;

    if (getNote(state, note.id)) {
        console.warn("Note wasnt deleted when it was supposed to be:", getNote(state, note.id))
    }

    state.notes[note.id] = note;

    return note;
};


const STATE_KEY_PREFIX = "NoteTree.";
const getAvailableTrees = () => {
    return Object.keys(localStorage).map((key) => {
        if (!key.startsWith(STATE_KEY_PREFIX)) {
            return undefined;
        }
        
        const name = key.substring(STATE_KEY_PREFIX.length);
        if (!name) {
            return undefined;
        }

        return name;
    }).filter((key) => !!key).sort();
}

const merge = (a, b) => {
    for(k in b) {
        if (a[k] === undefined) {
            a[k] = b[k];
        }
    }

    return a;
}

// NOTE: all state needs to be JSON-serializable. 
// NO Dates/non-plain objects
// No non-owning references, i.e a reference to a node that really lives in another array
// Typically if state will contain references, non-serializable objects, or are in some way computed from other canonical state, 
// it is prepended with '_', which will cause it to be stripped before it gets serialized.
const defaultState = () => {
    const state = {
        _flatNotes: [],     // used by the note tree view, can include collapsed subsections
        notes: {},
        noteIds: [],
        currentNoteId: 0,
        scratchPad: "",
    };

    const newNote = createNewNote(state, "First Note");
    state.currentNoteId = newNote.id;
    state.noteIds.push(newNote.id);

    return state;
}


const loadState = (name) => {
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
};

const getLocalStorageKeyForTreeName = (name) => STATE_KEY_PREFIX + name;

// currently:
//  - drops all properties with '_' 
// NOTE: the state shouldn't be cyclic. do not attempt to make this resistant to cycles,
// it is _supposed_ to throw that too much recursion exception
const recursiveShallowCopy = (obj) => {
    if (Array.isArray(obj)) {
        return obj.map(x => recursiveShallowCopy(x));
    }

    if (typeof obj === "object" && obj !== null) {
        const clone = {};
        for (const key in obj) {
            if (key[0] === "_") {
                continue;
            }

            clone[key] = recursiveShallowCopy(obj[key]);
        }
        return clone;
    }

    return obj;
}

const saveState = (state, name) => {
    const nonCyclicState = recursiveShallowCopy(state);
    const serialized = JSON.stringify(nonCyclicState);
    localStorage.setItem(getLocalStorageKeyForTreeName(name), serialized);
    console.log("saved", name, state)
}

const deleteNoteIfEmpty = (state, id) => {
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
    note._localList.splice(note._localList.indexOf(note.id), 1)
    delete state.notes[note.id];

    state.currentNoteId = noteToMoveTo.id;
    
    return true;
};

const insertNoteAfterCurrent = (state) => {
    const currentNote = getCurrentNote(state);
    if (!currentNote.text) {
        // REQ: don't insert new notes while we're editing blank notes
        return false;
    }

    const newNote = createNewNote(state, "");
    currentNote._localList.splice(currentNote._localIndex + 1, 0, newNote.id);
    state.currentNoteId = newNote.id;

    return true;
};


const insertChildNode = (state) => {
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
};

const deleteNote = (state, id) => {
    delete state.notes[id];
}

const getNote = (state, id)  => {
    const note = state.notes[id];
    if (!note) {
        console.warn("couldn't find note with id", id, state);
    }
    return note;
}

const getCurrentNote = (state) => {
    return getNote(state, state.currentNoteId);
};

const getOneNoteDown = (state, note) => {
    if (!note.isCollapsed && note.childrenIds.length > 0) {
        return getNote(state, note.childrenIds[0]);
    }

    while (note) {
        if (note._localIndex < note._localList.length - 1) {
            return getNote(state, note._localList[note._localIndex + 1]);
        }

        // check if the parent's local list has a next child in it
        note = note._parent;
    }

    // we couldn't find a note 'below' this one
    return undefined;
}

const moveDown = (state) => {
    const note = getCurrentNote(state);
    const oneNoteDown = getOneNoteDown(state, note);
    if (!oneNoteDown) {
        return false;
    }

    state.currentNoteId = oneNoteDown.id;
    return true;
};

const getOneNoteUp = (state, note) => {
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

const swapChildren = (note, a, b) => {
    const temp = note._localList[a];
    note._localList[a] = note._localList[b]
    note._localList[b] = temp;
}

const moveNoteDown = (state) => {
    const note = getCurrentNote(state);
    if (note._localIndex >= note._localList.length - 1) {
        return false;
    }

    swapChildren(note, note._localIndex, note._localIndex + 1)
    return true;
}

const moveNoteUp = (state) => {
    const note = getCurrentNote(state);
    if (note._localIndex === 0) {
        return false;
    }

    swapChildren(note, note._localIndex, note._localIndex - 1)
    return true;
}

const moveUp = (state) => {
    const noteOneUp = getOneNoteUp(state, getCurrentNote(state));
    if (!noteOneUp) {
        return false;
    }

    state.currentNoteId = noteOneUp.id;
    return true;
};

const indentNote = (state) => {
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
};

const deIndentNote = (state) => {
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
};


// returns true if the app should re-render
const handleNoteInputKeyDown = (state, keyDownEvent) => {
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
};

const collapseNode = (state) => {
    const note = getCurrentNote(state);
    if (note.isCollapsed || note.childrenIds.length === 0) {
        return false;
    }

    note.isCollapsed = true;
    return true;
}

const expandNode = (state) => {
    const note = getCurrentNote(state);
    if (!note.isCollapsed) {
        return false;
    }

    note.isCollapsed = false;
    return true;
}

const dfsPre = (state, note, fn) => {
    fn(note);

    for(const id of note.childrenIds) {
        const note = getNote(state, id);
        dfsPre(state, note, fn)
    }
}

const dfsPost = (state, note, fn) => {
    for(const id of note.childrenIds) {
        const note = getNote(state, id);
        if (dfsPost(state, note, fn) === true) {
            return true;
        }
    }

    if (fn(note) === true) {
        return true;
    }
}

const copyState = (state) => {
    return JSON.parse(JSON.stringify(recursiveShallowCopy(state)));
}

const mergeState = (existingState, incomingState) => {
    if (!existingState) {
        return incomingState;
    }

    const newState = {};
    for (const key in existingState) {
        newState[key] = incomingState[key] || existingState[key];
    }

    if (incomingState.scratchPad) {
        newState.scratchPad = incomingState.scratchPad;
    }

    function mergeChildIds(a, b) {
        if (!a || !b) {
            throw new Error("There is a bug in the code")
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
                incomingState.notes[id].childrenIds,
            );


            console.log("merging ", newState.notes[id].text, 
                newState.notes[id].childrenIds.map(cid => getNote(newState, cid)),
                existingState.notes[id].childrenIds.map(cid => getNote(newState, cid)),
                incomingState.notes[id].childrenIds.map(cid => getNote(newState, cid)),
            );
        }
    }

    newState.noteIds = mergeChildIds(existingState.noteIds, incomingState.noteIds);

    return newState;
}

const filterNotes = (state, predicate, pruneRootNotes) => {
    const dfs = (note) => {
        for (let i = 0; i < note.childrenIds.length; i++) {
            const id = note.childrenIds[i];
            const child = getNote(state, id);

            dfs(child);

            if (
                predicate(child) ||             // doesn't meet filtering criteria
                child.childrenIds.length > 0    // has children that survived filtering
            ) {
                continue;
            }

            note.childrenIds.splice(i, 1);
            i--;
            deleteNote(state, id);
        }
    }

    for(let i = 0; i < state.noteIds.length; i++) {
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


const recomputeFlatNotes = (state, flatNotes, collapse) => {
    flatNotes.splice(0, flatNotes.length);
    const dfs = (note) => {
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
    }

    for(const id of state.noteIds) {
        const note = getNote(state, id);

        dfs(note);
    }
}

// called just before we render things.
// It recomputes all state that needs to be recomputed
// TODO: super inefficient, need to set up a compute graph or something more complicated
const recomputeState = (state) => {
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
        const dfs = (childrenIds) => {
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
        }

        dfs(state.noteIds);
    }

    // recompute _depth, _parent, _localIndex, _localList. Somewhat required for a lot of things after to work.
    // tbh a lot of these things should just be updated as we are moving the elements around, but I find it easier to write this (shit) code at the moment
    {
        const dfs = (note, depth, parent, localIndex, list) => {
            note._depth = depth;
            note._parent = parent;
            note._localIndex = localIndex;
            note._localList = list;

            for(let i = 0; i < note.childrenIds.length; i++) {
                const c = getNote(state, note.childrenIds[i]);
                dfs(c, depth + 1, note, i, note.childrenIds);
            }
        }

        for(let i = 0; i < state.noteIds.length; i++) {
            const note = getNote(state, state.noteIds[i]);
            dfs(note, 0, null, i, state.noteIds);
        }
    }

    // remove all empty notes that we aren't editing
    // again, this should really just be done when we are moving around
    {
        const currentNote = getCurrentNote(state);
        const noteIdsToDelete = [];

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
            })
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

    // recompute _isDone, do some sorting
    {

        for (const id in state.notes) {
            state.notes[id]._isDone = false;
        }

        for(const id of state.noteIds) {
            const note = getNote(state, id);
            dfsPost(state, note, (note) => {
                const isDoneLeafNote = (note) => {
                    return note.text.startsWith("DONE") || note.text.startsWith("Done") || note.text.startsWith("done");
                };
                const isTodoNote = (note) => {
                    return note.text.startsWith("TODO") || note.text.startsWith("Todo") || note.text.startsWith("todo");
                };

                if (note.childrenIds.length === 0) {
                    if (
                        note._parent !== null && 
                        note._localIndex !== note._localList.length - 1
                    ) {
                        note._isDone = !isTodoNote(note);
                    } else {
                        note._isDone = !isTodoNote(note) && isDoneLeafNote(note);
                    }

                    return;
                }

                const everyChildNoteIsDone = note.childrenIds.every((id) => {
                    const note = getNote(state, id);
                    return note._isDone;
                });

                const finalNoteId = note.childrenIds[note.childrenIds.length - 1];
                const finalNote = getNote(state, finalNoteId);
                const finalNoteIsDoneLeafNote = isDoneLeafNote(finalNote);

                note._isDone = everyChildNoteIsDone && finalNoteIsDoneLeafNote;
            });
        }
    }

    // recompute _isSelected to just be the current note + all parent notes
    {
        for(const id in state.notes) {
            const note = getNote(state, id);
            note._isSelected = false;
        }

        const current = getCurrentNote(state);
        iterateParentNotes(current, (note) => {
            note._isSelected = true;
        });
    }
};

const iterateParentNotes = (note, fn) => {
    while (note) {
        fn(note);
        note = note._parent;
    }
}

const formatDate = (date) => {
    const dd = date.getDate();
    const mm = date.getMonth() + 1;
    const yyyy = date.getFullYear();
    const hours = date.getHours();
    const minutes = date.getMinutes();

    return `${pad2(dd)}/${pad2(mm)}/${yyyy} ${pad2(((hours - 1) % 12) + 1)}:${pad2(minutes)} ${hours < 12 ? "am" : "pm"}`;
}

const getTimeStr = (note) => {
    const { openedAt } = note;

    const date = new Date(openedAt);
    return formatDate(date);
}

const getIndentStr = (note) => {
    const { _depth: repeats } = note;
    return "     ".repeat(repeats);
};


const getNoteDuration = (state, note) => {
    if (!note._isDone) {
        return  getDurationMS(note.openedAt, getTimestamp(new Date()));
    }

    if (note.childrenIds.length === 0) {
        if (note._localIndex + 1 < note._localList.length - 1) {
            return getDurationMS(note.openedAt, note._localList[note._localIndex + 1]);
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

const getSecondPartOfRow = (state, note) => {
    const duration = getNoteDuration(state, note);
    const durationStr = formatDuration(duration);
    const secondPart = note._isDone ? ` took ${durationStr}` : ` ongoing ${durationStr} ...`;
    return secondPart;
};

const getRowIndentPrefix = (state, note) => {
    return `${getIndentStr(note)} ${getNoteStateString(note)}`;
}

const getFirstPartOfRow = (state, note) => {
    // const dashChar = note._isSelected ? ">" : "-"
    // having ">" in exported text looks ugly, so I've commented this out for now
    const dashChar = "-";

    return `${getTimeStr(note)} | ${getRowIndentPrefix(state, note)} ${dashChar} ${note.text || " "}`;
};


const exportAsText = (state) => {
    const header = (text) => `----------------${text}----------------`;

    const flatNotes = [];
    recomputeFlatNotes(state, flatNotes, false);

    const table = [];
    for (const note of flatNotes) {
        table.push([
            getFirstPartOfRow(state, note),
            getSecondPartOfRow(state, note),
        ])
    }

    function formatTable(table, gap) {
        const columns = [];

        for(let col = 0; col < table[0].length; col++) {
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

    return [
        header(" Notes "),
        formatTable(table, 10),
        header(" Scratchpad "),
        state.scratchPad
    ].join("\n\n");
};


const ScratchPad = () => {
    const textArea = htmlf(`<textarea class="scratch-pad pre-wrap"></textarea>`)
    const mirrorDiv = htmlf(`<div></div>`);
    const root = htmlf(
        `<div>%{textArea}%{mirrorDiv}</div>`,
        { textArea, mirrorDiv }
    );
    
    const args = {};

    const onEdit = () => {
        const { debouncedSave } = args.val;
        debouncedSave();
    }

    // HTML doesn't like tabs, we need this additional code to be able to insert tabs.
    eventListener(textArea, "keydown", (e) => {
        if (e.keyCode !== 9) return;

        e.preventDefault();

        // inserting a tab like this should preserve undo
        // TODO: stop using deprecated API
        document.execCommand("insertText", false, "\t");

        onEdit();
    });

    eventListener(textArea, "keydown", () => {
        // NOTE: unsolved problem in computer science - scroll the window to the vertical position
        // of the cursor in the text area. Damn. (Now solved)

        setTimeout(() => {
            let wantedScrollPos; {
                // Inspired by a stack overflow solution, but I actually figured it out myself :0
                // (Although they needed to find the x and y position of the user's cursor, not just the y position like me)
                //      for reference: https://jh3y.medium.com/how-to-where-s-the-caret-getting-the-xy-position-of-the-caret-a24ba372990a
                appendChild(root, mirrorDiv);
    
                copyStyles(textArea, mirrorDiv);
                mirrorDiv.el.style.height = 0;
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
            })
        }, 1)
    })

    eventListener(textArea, "input", () => {
        const { state } = args.val;
        state.scratchPad = textArea.el.value;
        // automatically resize the text area to the content + some overflow
        textArea.el.style.height = 0;
        textArea.el.style.height = (textArea.el.scrollHeight) + "px"
        onEdit();
    });

    return {
        el: root.el,
        rerender: (argsIn) => {
            args.val = argsIn;
            const { state } = argsIn;

            if (textArea.el.value !== state.scratchPad) {
                textArea.el.value = state.scratchPad;

                setTimeout(() => {
                    // automatically resize the text area to the content + some overflow
                    textArea.el.style.height = 0;
                    textArea.el.style.height = (textArea.el.scrollHeight) + "px"
                }, 0)
            }
        },
        getText: () => {
            return textArea.el.value;
        }
    };
};


const NoteRowText = () => {
    const indent = htmlf(`<div class="pre-wrap"></div>`);
    const whenNotEditing = htmlf(`<div class="pre-wrap"></div>`);
    const whenEditing = htmlf(`<input class="flex-1"></input>`);

    const style = "margin-left: 10px; padding-left: 10px;border-left: 1px solid var(--fg-color);";
    const style2 = "row v-align-bottom";
    const root = htmlf(
        `<div class="pre-wrap flex-1" style="${style}">` +
            `<div class="${style2}">`+
                "%{indent}" + 
                "%{whenNotEditing}" + 
                "%{whenEditing}" + 
            "</div>" +
        "</div>",
        { indent, whenNotEditing, whenEditing }
    );

    let args = {};

    eventListener(whenEditing, "input", () => {
        if (!args.val) return;

        const { state, rerenderApp } = args.val;

        args.note.text = whenEditing.el.value;
        rerenderApp();
    });

    eventListener(whenEditing, "keydown", (e) => {
        const { state, rerenderApp, debouncedSave } = args.val;

        if (handleNoteInputKeyDown(state, e)) {
            rerenderApp();
        }

        // handle saving state with a debounce
        debouncedSave();
    });

    let isEditing = false;
    return {
        el: root.el,
        rerender: function(argsIn, note, noteFlatIndex) {
            args.val = argsIn;
            args.note = note;

            const { state, rerenderApp, shouldScroll } = args.val;

            const dashChar = note._isSelected ? ">" : "-"
            setTextContent(indent, `${getIndentStr(note)} ${getNoteStateString(note)} ${note.isCollapsed ? `(+ ${note._collapsedCount})` : ""} ${dashChar} `);

            const wasEditing = isEditing;
            isEditing = state.currentNoteId === note.id;
            setVisible(whenEditing, isEditing);
            setVisible(whenNotEditing, !isEditing);
            if (isEditing) {
                setInputValue(whenEditing, note.text);

                if (!wasEditing) {
                    setTimeout(() => {
                        whenEditing.el.focus({ preventScroll : true });
                    
                        if (shouldScroll) {
                            const wantedY = whenEditing.el.getBoundingClientRect().height * noteFlatIndex;
                            
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
        }
    }
}

const NoteRowTimestamp = () => {
    const input = htmlf(`<input class="w-100"></input>`);
    const root = htmlf(
        `<div class="pre-wrap">%{input}</div>`,
        { input }
    )

    const args = {};

    eventListener(input, "change", () => {
        const { state, rerenderApp, handleErrors, debouncedSave } = args.val;
        const note = args.note;
        const prevNote = note._parent;
        let nextNote = null;
        for (const id of note.childrenIds) {
            const child = getNote(state, id);
            if (nextNote === null || child.openedAt < nextNote.openedAt) {
                nextNote = child;
            }
        }

        let previousTime = null;
        let nextTime = null;

        if (prevNote) {
            previousTime = new Date(prevNote.openedAt);
        }

        if (nextNote) {
            nextTime = new Date(nextNote.openedAt);
        }

        handleErrors(() => {
            // editing the time was a lot more code than I thought it would be, smh

            const [hStr, mmStr] = input.el.value.split(':');
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
            if (isNaN(newTime)) {
                newTime = new Date();
            }
            newTime.setHours(hours);
            newTime.setMinutes(minutes);
            newTime.setSeconds(0);
            newTime.setMilliseconds(0);

            if(nextTime !== null && newTime >= nextTime) {
                // decrement the day by 1. if it's 9:00 am now, and we type 7:00pm, we probably mean yesterday
                const day = 1000 * 60 * 60 * 24; 
                newTime -= 1 * day;
            }


            if (previousTime != null && newTime <= previousTime) {
                throw new Error(`Can't set this task's time to be before the previous task's time (${formatDate(previousTime)})`);
            }

            if (nextTime != null && newTime >= nextTime) {
                throw new Error(`Can't set this task's time to be after the next task's time (${formatDate(nextTime)})`);
            }

            const now = new Date();
            if (nextTime == null && newTime > now) {
                throw new Error(`Can't set this task's time to be after the current time (${formatDate(now)})`);
            }

            note.openedAt = getTimestamp(newTime);
            debouncedSave();

            rerenderApp();
        }, () => {
            setInputValueAndResize(input, getTimeStr(note));
            rerenderApp();
        });
    });

    return {
        el: root.el,
        rerender: function(argsIn, note) {
            args.val = argsIn;
            args.note = note;

            // setTextContent(root, timeStr);
            setInputValueAndResize(input, getTimeStr(note));
        }
    }
}

const NoteRowStatistic = () => {
    // const [root] = htmlf(`<div class="text-align-right pre-wrap table-cell-min v-align-bottom"></div>`);
    const root = htmlf(`<div class="text-align-right pre-wrap"></div>`);

    return {
        el: root.el,
        rerender: function(argsIn, note) {
            const { state } = argsIn;
            ;

            setTextContent(root, getSecondPartOfRow(state, note));
        }
    }
}


const NoteRowInput = () => {
    const timestamp = NoteRowTimestamp();
    const text = NoteRowText();
    const statistic = NoteRowStatistic();
    const root = htmlf(
        `<div class="row">` + 
            "%{timestamp}" + 
            "%{text}" + 
            "%{statistic}" + 
        "</div>",
        { timestamp, text, statistic },
    );

    const args = {};
    eventListener(root, "click", () => {
        const { state, rerenderApp } = args.val;

        state.currentNoteId = args.note.id;
        rerenderApp();
    });

    const el = root.el;

    const rerender = (argsIn, note, noteFlatIndex) => {
        args.val = argsIn;
        args.note = note;

        const { state, stickyPxRef, } = argsIn;
        const textColor = note._isSelected ? "var(--fg-color)"  : (!note._isDone ? "var(--fg-color)" : "var(--unfocus-text-color)");

        root.el.style.color = textColor;

        timestamp.rerender(argsIn, note);
        text.rerender(argsIn, note, noteFlatIndex);
        statistic.rerender(argsIn, note);

        if (note._isSelected || !note._isDone) {
            setTimeout(() => {
                // make this note stick to the top of the screen so that we can see it
                let top = stickyPxRef.val;
                stickyPxRef.val += el.getBoundingClientRect().height;

                el.style.position = "sticky";
                el.style.top = top + "px";
            }, 1);
        } else {
            // unstick this note
            el.style.position = "static";
            el.style.top = undefined;
        }
    }

    return { el, rerender };
};

const NotesList = () => {
    let pool = [];
    const root = htmlf(
        `<div class="w-100" style="border-top: 1px solid var(--fg-color);border-bottom: 1px solid var(--fg-color);"></div>`
    );

    return {
        el: root.el,
        rerender: function(args) {
            const { state } = args;

            resizeComponentPool(root, pool, state._flatNotes.length, NoteRowInput);
            for(let i = 0; i < state._flatNotes.length; i++) {
                pool[i].rerender(args, state._flatNotes[i], i);
            }
        }
    }
}

const Button = (text, fn, classes="") => {
    const  btn = htmlf(
        `<button type="button" class="solid-border ${classes}" style="padding: 3px; margin: 5px;">%{text}</button>`, 
        { text },
    );

    eventListener(btn, "click", fn);
    return btn;
}

const CurrentTreeNameEditor = () => {
    const treeNameInput = htmlf(`<input class="inline-block w-100"></input>`);

    eventListener(treeNameInput, "input", () => {
        resizeInputToValue(treeNameInput);
    })

    const args = {};
    eventListener(treeNameInput, "change", () => {
        const { renameCurrentTreeName } = args.val;

        const newName = treeNameInput.el.value;
        renameCurrentTreeName(newName);
    });

    return {
        el: treeNameInput.el,
        rerender: (argsIn) => {
            args.val = argsIn;

            const { currentTreeName } = args.val;
            setInputValueAndResize(treeNameInput, currentTreeName);
        }
    }
}

// will be more of a tabbed view
const CurrentTreeSelector = () =>{
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

    const args = {
        val: null,
    };

    eventListener(newButton, "click", () => {
        const { newTree } = args.val;
        newTree();
    })

    const tabComponents = [];
    const updateTabsList = () => {
        const names = getAvailableTrees();
        resizeComponentPool(tabsRoot, tabComponents, names.length, () => {
            const btn = htmlf(
                `<button 
                    type="button" 
                    class="tab-button pre-wrap text-align-center z-index-100"
                    style="padding: 2px 20px;"
                ></button>`
            );
            const input = htmlf(
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
                { btn, input, closeBtn },
            );
            
            let argsThis = {};
            eventListener(btn, "click", () => {
                const { loadTree } = args.val;
                const { name } = argsThis;

                loadTree(name, {
                    shouldScroll: false
                });
            });

            eventListener(input, "change", () => {
                const { renameCurrentTreeName } = args.val;
                renameCurrentTreeName(input.el.value);
            })

            eventListener(closeBtn, "click", () => {
                const { deleteCurrentTree } = args.val;
                deleteCurrentTree();
            })

            return {
                el: root.el,
                rerender: (name) => {
                    argsThis.name = name;

                    const { currentTreeName } = args.val;

                    const isFocused = currentTreeName === name;
                    setVisible(input, isFocused);
                    setVisible(closeBtn, isFocused);
                    setVisible(btn, !isFocused);

                    if (setClass(root, "focused", isFocused)) {
                        setVisible(input, true)
                        setInputValueAndResize(input, name);

                        root.el.style.color = "var(--fg-color)";
                    } else {
                        setTextContent(btn, name);

                        root.el.style.color = "var(--unfocus-text-color)";
                    }
                }
            }
        });

        for(let i = 0; i < names.length; i++) {
            tabComponents[i].rerender(names[i]);
        }
    }

    return {
        el: root.el,
        rerender: (argsIn) => {
            args.val = argsIn;
            updateTabsList();
        }
    }
}

const cssRoot = document.querySelector(':root');
const setCssVars = (vars) => {
    for(const [k, v] of vars) {
        cssRoot.style.setProperty(k, v);
    }
}

const DarkModeToggle = () => {
    const getTheme = () => {
        return localStorage.getItem("State.currentTheme") || "Light";
    }
    const setTheme = (theme) => {
        localStorage.setItem("State.currentTheme", theme);

        if (theme === "Light") {
            setCssVars([
                ["--bg-color", "#FFF"],
                ["--bg-color-focus", "rgb(0, 0, 0, 0.1)"],
                ["--bg-color-focus-2", "rgb(0, 0, 0, 0.4)"],
                ["--fg-color", "#000"],
                ["--unfocus-text-color", "gray"],
            ]);
        } else {
            // assume dark theme
            setCssVars([
                ["--bg-color", "#000"],
                ["--bg-color-focus", "rgb(1, 1, 1, 0.1)"],
                ["--bg-color-focus-2", "rgb(1, 1, 1, 0.4)"],
                ["--fg-color", "#EEE"],
                ["--unfocus-text-color", "gray"],
            ]);
        }

        setTextContent(button, theme);
    }

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
}


const App = () => {
    const infoButton = htmlf(`<button class="info-button" title="click for help">help?</button>`);
    eventListener(infoButton, "click", () => {
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
        if (!confirm("This will remove all 'done' nodes from this tree and move them to another tree named " + doneTreeName + ", are you sure?")) {
            return;
        }


        try {
            // high risk code, could possibly corrupt user data, so we're working with copies,
            // then assigning over the result
            const doneState = copyState(state);
            recomputeState(doneState);
            filterNotes(doneState, (note) => note._isDone, true);

            const notDoneState = copyState(state);
            recomputeState(notDoneState);
            filterNotes(notDoneState, (note) => !note._isDone, false);

            let existingDoneState;
            try {
                existingDoneState = loadState(doneTreeName);
            } catch {
                // no existing notes
            }
            const doneStateMerged = mergeState(existingDoneState, doneState);

            recomputeState(doneStateMerged);
            recomputeState(notDoneState);
            recomputeState(doneStateMerged);

            saveState(doneStateMerged, doneTreeName);

            // only mutate our current state once everything else succeeds 
            for (const key in notDoneState) {
                state[key] = notDoneState[key];
            }
            saveState(state, currentTreeName);
        } catch(e) {
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
                    infoButton,
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
            scratchPad: htmlf(
                `<div>%{title}%{help}%{scratchPad}</div>`,
                {
                    title: htmlf(`<h2 style="marginTop: 20px;">Scratch Pad</h2>`),
                    help: scratchPadHelp,
                    scratchPad,
                }
            ),
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
                                    for(const key in lsKeys) {
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
                                    lsKeys[key] = value;
                                }
                                
                                navigator.clipboard.writeText(JSON.stringify(lsKeys));
                                showStatusText("Copied JSON");
                            });
                        })
                    ]
                }
            ),
        }
    );

    
    let currentTreeName = "";
    let state = {};
    let saveTimeout = 0;
    const saveCurrentState = ({
        debounced
    } = { debounced: false }) => {
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
            showStatusText("Saved   ", "var(--fg-color)",  SAVE_DEBOUNCE);
        }

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
    }
    const loadTree = (name, renderOptions, onError) => {
        handleErrors(() => {
            state = loadState(name);
            currentTreeName = name;
            appComponent.rerender(renderOptions);
        }, () => {
            handleErrors(() => {
                // try to fallback to the first available tree.
                const availableTrees = getAvailableTrees();
                state = loadState(availableTrees[0]);
                currentTreeName = availableTrees[0];
                appComponent.rerender(renderOptions);
            }, onError)
        });
    };
    const newTree = (shouldRerender=true) => {
        function generateUnusedName() {
            function canUseName(name) {
                return !localStorage.getItem(getLocalStorageKeyForTreeName(name));
            }

            // try to name it 22 FEB 2023 or something
            const now = new Date();
            const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
            const dayName = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`
            if (canUseName(dayName)) {
                return dayName;
            }

            while(i < 100000) {
                i++;
                const name = "New " + i;
                if (canUseName(name)) {
                    return name;
                }
            }

            throw new Error("ERROR - Out of name ideas for this new note :(")
        }

        state = defaultState();
        currentTreeName = generateUnusedName();
        saveCurrentState();
        
        if (shouldRerender) {   // we should think of a better way to do this next time
            appComponent.rerender();
        }
    }

    const renameCurrentTreeName = (newName, onError) => {
        handleErrors(() => {
            let oldName = currentTreeName;
            if (localStorage.getItem(getLocalStorageKeyForTreeName(newName))) {
                throw new Error("That name is already taken.")
            }
            
            currentTreeName = newName;
            localStorage.removeItem(getLocalStorageKeyForTreeName(oldName));

            saveCurrentState();
        }, onError);

        appComponent.rerender();
    }

    const deleteCurrentTree =  () => {
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
                idx = availableTrees2.length-1;
            }
            
            loadTree(availableTrees2[idx]);
        })
    }
    
    let showInfo = false;
    let statusTextClearTimeout = 0;
    const showStatusText = (text, color = "var(--fg-color)", timeout = STATUS_TEXT_PERSIST_TIME) => {
        if (statusTextClearTimeout) {
            clearTimeout(statusTextClearTimeout);
        }

        statusTextIndicator.el.textContent = text;
        statusTextIndicator.el.style.color = color;

        const timeoutAmount = timeout;
        if (timeoutAmount > 0) {
            statusTextClearTimeout = setTimeout(() => {
                statusTextIndicator.el.textContent = "";
            }, timeoutAmount)
        }
    }

    const handleErrors = (fn, onError) => {
        try {
            fn();
        } catch (err) {
            console.error(err);
            showStatusText(`${err}`, "#F00", ERROR_TIMEOUT_TIME);
            onError && onError(err);
        }
    }

    const debouncedSave = () => {
        saveCurrentState({
            debounced: true
        });
    };

    const appComponent = {
        el: appRoot.el,
        rerender: function(options = { shouldScroll: true}) {
            setVisible(noteTreeHelp, showInfo);
            setVisible(scratchPadHelp, showInfo);

            const isDoneNote = currentTreeName.endsWith("[done]");
            setVisible(moveOutFinishedNotesButton, !isDoneNote);

            recomputeState(state);
    
            // need to know how far to offset the selected refs
            const stickyPxRef = { val: 0 };
            const args = {
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
        },
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
    }

    initState();

    return appComponent;
};

const root = {
    el: document.getElementById("app")
};

const app = App();
appendChild(root, app);
app.rerender();