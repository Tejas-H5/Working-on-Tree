/**
 * TODO:
 *
 * - add a todo list at the bottom to schedule tasks. Probably its just a freetext
 * - add statistics breakdowns
 * - add the second part at the end of the current line we're on
 * -
 *
 */

const INDENT_BASE_WIDTH = 100;
const INDENT_WIDTH_PX = 50;
const SAVE_DEBOUNCE = 500;
const STATUS_TEXT_PERSIST_TIME = 1000;

const pad2 = (num) => (num < 10 ? "0" + num : "" + num);
const repeatSafe = (str, len) => {
    const string = len <= 0 ? "" : str.repeat(Math.ceil(len / str.length));
    return string.substring(0, len);
};

const getNoteStateString = (note) => {
    if (note.isDone) {
        return " [x] ";
    } else {
        return "[...]";
    }
};

const iterateChildNotes = (state, noteIndex, fn) => {
    // process this note, and all notes underneath it with a greater indent (aka child notes)
    const currentIndent = state.notes[noteIndex].indent;
    for (let i = noteIndex; i < state.notes.length; i++) {
        if (i != noteIndex && state.notes[i].indent <= currentIndent) break;

        fn(state.notes[i]);
    }
};

const markNoteAsDone = (note) => {
    note.isDone = true;
    note.closedAt = getTimestamp(new Date());
};

const formatNoteDuration = (ms) => {
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

const getDuration = (a, b) => {
    if (b === null) {
        return "still-working";
    }

    return new Date(b).getTime() - new Date(a).getTime();
};

const moveToFirstNote = (state) => {
    state.currentNoteIndex = 0;
    return true;
};

const moveToLastNote = (state) => {
    if (state.currentNoteIndex === state.notes.length - 1) {
        return false;
    }
    state.currentNoteIndex = state.notes.length - 1;
    return true;
};

const getNextSiblingIndex = (state, noteIndex) => {
    let currentIndent = state.notes[noteIndex].indent;
    for (let i = noteIndex + 1; i < state.notes.length; i++) {
        if (state.notes[i].indent === currentIndent) {
            return i;
        }
    }

    return -1;
};

const getTimestamp = (date) => {
    return date.toISOString();
};

const createNewNote = (text, indent = 0) => {
    return {
        text: text || "",
        indent: indent,
        openedAt: getTimestamp(new Date()), // will be populated whenever text goes from empty -> not empty
        closedAt: null,

        isDone: false,  // used to display [...] or [x] next to a note.
        isSelected: false,  // used to display '>' or - in the note status
    };
};

const STATE_KEY = "NoteTree.State";
const loadState = () => {
    const savedStateJSON = localStorage.getItem(STATE_KEY);
    if (savedStateJSON) {
        const loadedState = JSON.parse(savedStateJSON);
        if (loadedState.currentNoteIndex < 0) {
            loadedState.currentNoteIndex = 0;
        }

        return loadedState;
    }

    return {
        notes: [createNewNote("First Note")],
        currentNoteIndex: 0,
        scratchPad: ""
    };
};

const saveState = (state) => {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
};

const deleteNoteIfPossible = (state) => {
    const pos = state.currentNoteIndex;
    if (state.notes[pos].text) {
        return false;
    }
    if (state.notes.length <= 1) {
        return false;
    }

    state.notes.splice(pos, 1);
    state.currentNoteIndex--;
    return true;
};

const appendNoteOrMoveDown = (state) => {
    const pos = state.currentNoteIndex;
    if (pos == state.notes.length - 1) {
        const currentNote = state.notes[pos];
        if (!currentNote.text) {
            return false;
        }

        markNoteAsDone(currentNote);

        // code used to be for inserting. we may still want that, so I haven't changed it just yet
        const newNote = createNewNote("", currentNote.indent);
        state.notes.splice(pos + 1, 0, newNote);
        state.currentNoteIndex++;
        return true;
    } else {
        return moveDown(state);
    }
};

const moveDown = (state) => {
    if (state.currentNoteIndex >= state.notes.length - 1) return false;

    state.currentNoteIndex++;
    return true;
};

const getCurrentNote = (state) => {
    return state.notes[state.currentNoteIndex];
};

const getCurrentIndent = (state) => {
    return getCurrentNote(state).indent;
};

const moveDownToNext = (state) => {
    const currentIndent = getCurrentIndent(state);
    let i = state.currentNoteIndex;
    while (i < state.notes.length - 1) {
        i++;
        if (state.notes[i].indent != currentIndent) break;
    }

    state.currentNoteIndex = i;
    return true;
};

const moveUpToNext = (state) => {
    const currentIndent = getCurrentIndent(state);
    let i = state.currentNoteIndex;
    while (i > 0) {
        i--;
        if (state.notes[i].indent != currentIndent) break;
    }

    state.currentNoteIndex = i;
    return true;
};

const moveUp = (state) => {
    if (state.currentNoteIndex <= 0) return false;

    state.currentNoteIndex--;
    return true;
};

const indentNote = (state) => {
    if (state.currentNoteIndex === 0) return false;

    const note = getCurrentNote(state);
    const prevNote = state.notes[state.currentNoteIndex - 1];

    if (note.indent > prevNote.indent) {
        return false;
    }

    note.indent += 1;
    return true;
};

const deIndentNote = (state) => {
    const note = getCurrentNote(state);

    if (note.indent == 0) {
        return false;
    }

    note.indent -= 1;
    return true;
};

const handleNoteInputKeyDown = (state, keyDownEvent) => {
    const key = keyDownEvent.key;
    if (key === "Enter") {
        return appendNoteOrMoveDown(state);
    }

    if (key === "Backspace") {
        if (deleteNoteIfPossible(state)) {
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
        if (keyDownEvent.ctrlKey) {
            return moveUpToNext(state);
        }
        return moveUp(state);
    }

    if (key === "ArrowDown") {
        keyDownEvent.preventDefault();
        if (keyDownEvent.ctrlKey) {
            return moveDownToNext(state);
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

const fixNoteTree = (state) => {
    // remove all empty notes that we aren't editing
    for (let i = 0; i < state.notes.length; i++) {
        const note = state.notes[i];
        if (i !== state.currentNoteIndex && !note.text) {
            state.notes.splice(i, 1);
            i--; // developers hate me because of this one simple trick
        }
    }

    // It is assumed that the very last note that was made is what is being currently worked on. 
    // We need to update it, and all of it's parent's isDone statues to true
    for(let i = 0; i < state.notes.length; i++) {
        state.notes[i].isDone = true;
    }
    const lastNoteIndex = state.notes.length - 1;
    iterateParentNotes(state, lastNoteIndex, (note) => {
        note.isDone = false;
    });

    // we also want to highlight all parent notes for whatever we have selected
    for(let i = 0; i < state.notes.length; i++) {
        state.notes[i].isSelected = false;
    }

    iterateParentNotes(state, state.currentNoteIndex, (note) => {
        note.isSelected = true;
    })
};

const iterateParentNotes = (state, noteIndex, fn) => {
    let currentLevel = state.notes[noteIndex].indent;
    for (let i = noteIndex; i >= 0; i--) {
        fn(state.notes[i]);

        while(i > 0 && state.notes[i - 1].indent >= currentLevel) {
            i--;
        }

        currentLevel--;
    }
}


const getIndentStr = (note) => {
    const { indent: repeats, openedAt } = note;

    const date = new Date(openedAt);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    return (
        `${pad2(((hours - 1) % 12) + 1)}:${pad2(minutes)} ${hours < 12 ? "am" : "pm"} |` +
        "     ".repeat(repeats)
    );
};

const getSecondPartOfRow = (state, i) => {
    const note = state.notes[i];
    const nextSiblingIndex = getNextSiblingIndex(state, i);

    const nextSibling = state.notes[nextSiblingIndex];
    const duration = nextSibling
        ? getDuration(note.openedAt, nextSibling.openedAt)
        : getDuration(note.openedAt, getTimestamp(new Date()));
    const durationStr = formatNoteDuration(duration);
    const secondPart = note.isDone ? ` took ${durationStr}` : ` taking ${durationStr} ...`;
    return secondPart;
};

const getRowIndentPrefix = (state, i) => {
    const note = state.notes[i];
    return `${getIndentStr(note)} ${getNoteStateString(note)}`;
}

const getFirstPartOfRow = (state, i, isSelected) => {
    const note = state.notes[i];

    const dashChar = isSelected ? ">" : "-"

    return `${getRowIndentPrefix(state, i)} ${dashChar} ${note.text || " "}`;
};

const exportAsText = (state) => {
    let maxFirstPartLength = 0;
    for (let i = 0; i < state.notes.length; i++) {
        const firstPart = getFirstPartOfRow(state, i, false);
        if (firstPart.length > maxFirstPartLength) {
            maxFirstPartLength = firstPart.length;
        }
    }

    const lines = [];
    for (let i = 0; i < state.notes.length; i++) {
        const firstPart = getFirstPartOfRow(state, i, false);
        const secondPart = getSecondPartOfRow(state, i);

        // lines.push(`${firstPart}\t\t${secondPart}`);
        lines.push(`${firstPart}${repeatSafe(" ", maxFirstPartLength - firstPart.length + 8)}${secondPart}`);
    }

    const events = lines.join("\n");

    const scratchPad = state.scratchPad;

    return events + "\n\n---------------- Notes ----------------\n" + scratchPad;
};

const ScratchPad = (mountPoint, getState) => {
    const { textInput } = createComponent(mountPoint,`
        <textarea --id="textInput"></textarea>
    `);

    const state = getState();
    textInput.value = state.scratchPad;

    // HTML doesn't like tabs, we need this additional code to be able to insert tabs.
    textInput.addEventListener("keydown", (e) => {
        if (e.keyCode !== 9) return;

        e.preventDefault();

        // inserting a tab like this should preserve undo
        // TODO: stop using deprecated API
        document.execCommand("insertText", false, "\t");

        textChanged();
    });

    textInput.addEventListener("input", () => {
        const state = getState();
        state.scratchPad = textInput.value;
    });
};

const NoteRowInput = (mountPoint) => {
    const { root, input, inputStatus, inputTimings, inputRoot, showRoot, showText, showTime } = createComponent(mountPoint,`
        <div>
            <div --id="inputRoot" class="row" style="background:#DDD">
                <div --id="inputStatus" class="pre-wrap"></div>
                <div class="flex-1">
                    <input --id="input" class="w-100"></input>
                </div>
                <div --id="inputTimings" class="pre-wrap"></div>
            </div>
            <div --id="showRoot" class="row">
                <div --id="showText" class="pre-wrap flex-1"></div>
                <div --id="showTime" class="pre-wrap"></div>
            </div>
        </div>
    `);

    const component = {
        args: {},
        update: (state, noteIndex, stickyPxRef) => {
            const note = state.notes[noteIndex];
            const isEditing = state.currentNoteIndex === noteIndex;
            const isHighlighted = !note.isDone || note.isSelected;

            if (isEditing) {
                show(inputRoot); hide(showRoot);
            } else {
                hide(inputRoot); show(showRoot);
            }
            const timingText = getSecondPartOfRow(state, noteIndex);

            if (isEditing) {
                // input

                component.args.note = note;
                component.args.state = state;
                component.args.noteIndex = noteIndex;

                input.value = note.text;
                inputStatus.textContent = `${getRowIndentPrefix(state, noteIndex)} > `;
                inputTimings.textContent = timingText;

                setTimeout(() => {
                    input.focus({ preventScroll : true });
                
                    const wantedY = root.getBoundingClientRect().height * noteIndex;
                    window.scrollTo({
                        left: 0,
                        top: wantedY - window.innerHeight / 2,
                        behavior: "instant"
                    });
                }, 1);
            } else {
                // show
                const firstPart = getFirstPartOfRow(state, noteIndex, note.isSelected);
                const secondPart = timingText;

                showRoot.style.color = isHighlighted ? "black" : "gray";
                showText.textContent = firstPart;
                showTime.textContent = secondPart;
            }

            // ensure active notes are sticky
            setTimeout(() => {
                if (isHighlighted) {
                    root.style.position = "sticky";
                    root.style.top = stickyPxRef.val + "px";
                    root.style.zIndex = 10;
                    root.style.background = "#FFF";

                    stickyPxRef.val += root.getBoundingClientRect().height;
                } else {
                    root.style.zIndex = 0;
                    root.style.position = "initial";
                    root.style.top = "none";
                    root.style.background = "#FFF";
                }
            }, 1);
        }
    };

    input.addEventListener("input", () => {
        const { note, noteIndex, state } = component.args;
        if (!note) return;

        if (note.text === "" && !!input.value && noteIndex === state.notes.length - 1) {
            // refresh this timestamp if the note was empty before
            note.openedAt = getTimestamp(new Date());
        }

        note.text = input.value;
    });

    input.addEventListener("keydown", (e) => {
        component.onKeyDown && component.onKeyDown(e);
    })

    showRoot.addEventListener("click", () => {
        component.onClick && component.onClick();
    })

    return component;
};


/**
 * list rendering
 * 
 * data = []
 * elements = []
 * components = []
 * def rerender():
 *      for i from 0 to data.length:
 *          renderComponent(i)
 *  
 * def renderComponent(i):
*       if i === data.length:
*           elements[i], components[i] = initializeComponent()
*        
        components[i].update()

    const elements = []

    rerenderComponents(mountPoint, data, (i) => {
        component = createComponent(elements, `<blah />`);

        return {
            update: () => {
                component.update();
            }
        }
    })

const elements = [];

x.forEach((data, i) => {
    if (i === elements.length) {
        // initialize
        createComponent(elements, `<div></div>`);
    }
})

**/

const App = (mountPoint) => {
    const { 
        notesMountPoint, 
        scratchPad, 
        statusTextIndicator, textCopyButton, jsonCopyButton, clearAllButton, 
        infoButton, info1, info2
    } =
        createComponent(mountPoint,`
            <div>
                <div class="row align-items-center">
                    <h2>Currently working on</h2>
                    <div class="flex-1"></div>
                    <button --id="infoButton" class="info-button" title="click for help">help?</button>
                </div>
                <div --id="info1">
                    <p>
                        Use this note tree to keep track of what you are currently doing, and how long you are spending on each thing.
                        You can only create new entries at the bottom, and the final entry is always assumed to be unfinished.
                    </p>
                    <ul>
                        <li>[Enter] to create a new entry</li>
                        <li>Arrows to move around</li>
                        <li>Tab or Shift+Tab to indent/unindent a note</li>
                        <li>Also look at the buttons in the bottom right there</li>
                    </ul>
                </div>
                <div --id="notesMountPoint" class="notes-root"></div>
                <div style="height: 20px"></div>

                <h2>Scratch Pad</h2>
                <div --id="info2">
                    <p>
                        Write down anything that can't go into a note into here. A task you need to do way later, a copy paste value, etc.
                    </p>
                </div>
                <div --id="scratchPad"></div>
                <div style="height: 300px"></div>
                <div class="fixed row gap-5 align-items-center" style="bottom: 5px; right: 5px;">
                    <div --id="statusTextIndicator" class="pre-wrap"></div>
                    <button --id="clearAllButton" type="button">Clear all</button>
                    <button --id="textCopyButton" type="button">Copy as text</button>
                    <button --id="jsonCopyButton" type="button">Copy as JSON</button>
                </div>
            </div>
        `);

    let state = loadState();

    ScratchPad(scratchPad, () => state);

    textCopyButton.addEventListener("click", () => {
        handleErrors(() => {
            navigator.clipboard.writeText(exportAsText(state));
            showStatusText("Copied as text");
        });
    });

    jsonCopyButton.addEventListener("click", () => {
        handleErrors(() => {
            navigator.clipboard.writeText(JSON.stringify(state));
            showStatusText("Copied JSON");
        });
    });

    clearAllButton.addEventListener("click", () => {
        if (!confirm("Are you sure you want to delete all your notes?")) {
            return;
        }

        localStorage.clear();
        state = loadState();
        rerender();

        showStatusText("Cleared notes");
    });

    let showInfo = false;
    const updateHelp= () => {
        if (showInfo) {
            info1.classList.remove("hidden");
            info2.classList.remove("hidden");
        } else {
            info1.classList.add("hidden");
            info2.classList.add("hidden");
        }
    }
    infoButton.addEventListener("click", () => {
        showInfo = !showInfo;
        updateHelp();    
    });
    updateHelp();

    let statusTextClearTimeout = 0;
    const showStatusText = (text, timeout) => {
        if (statusTextClearTimeout) {
            clearTimeout(statusTextClearTimeout);
        }

        statusTextIndicator.textContent = text;

        const timeoutAmount = timeout || STATUS_TEXT_PERSIST_TIME;
        if (timeoutAmount) {
            statusTextClearTimeout = setTimeout(() => {
                statusTextIndicator.textContent = "";
            }, timeoutAmount)
        }
    }

    const handleErrors = (fn) => {
        try {
            fn();
        } catch (err) {
            showStatusText(`${err}`);
        }
    }


    let saveTimeout = 0;
    const debouncedSave = () => {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        
        showStatusText("Saving...", -1);
        saveTimeout = setTimeout(() => {
            saveState(state);
            showStatusText("Saved   ", SAVE_DEBOUNCE);
        }, SAVE_DEBOUNCE);
    };
    

    const elements = [];
    const inputs = [];
    const rerender = () => {
        fixNoteTree(state);

        stickyPxRef = { val: 0 };
        
        resizeListRenderPool(state.notes, elements, inputs, () => {
            const noteRowInput = NoteRowInput(elements);
            inputs.push(noteRowInput);

            noteRowInput.onClick = () => {
                state.currentNoteIndex = i;
                rerender();
            };

            noteRowInput.onKeyDown = (e) => {
                if (handleNoteInputKeyDown(state, e)) {
                    rerender();
                }
        
                // handle saving state with a debounce
                debouncedSave();
            };
        });

        for (let i = 0; i < inputs.length; i++) {
            inputs[i].update(state, i, stickyPxRef);
        }

        replaceChildren(notesMountPoint, elements);
    };

    rerender();
};

App(document.getElementById("app"));
