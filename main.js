// TODO: reword `rerender` to `update`
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

const iterateChildNotesOneLevel = (state, noteIndex, fn) => {
    // process all notes 1 level of indent underneath this one
    const childIndent = noteIndex >= 0 ? state.notes[noteIndex].indent + 1 : 0;
    for (let i = noteIndex + 1; i < state.notes.length; i++) {
        if (state.notes[i].indent > childIndent) 
            continue;
        if (state.notes[i].indent < childIndent) 
            break;

        fn(state.notes[i], i);
    }
};

const markNoteAsDone = (note) => {
    note.isDone = true;
    note.closedAt = getTimestamp(new Date());
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

const getNextNoteOnSameOrPreviousLevelIndex = (state, noteIndex) => {
    let currentIndent = state.notes[noteIndex].indent;
    for (let i = noteIndex + 1; i < state.notes.length; i++) {
        if (state.notes[i].indent <= currentIndent) {
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
    if (key === "Enter" && !keyDownEvent.shiftKey) {
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
    assert(!!state, "WTF");

    // remove all empty notes that we aren't editing
    for (let i = 0; i < state.notes.length; i++) {
        const note = state.notes[i];
        if (i !== state.currentNoteIndex && !note.text.trim()) {
            state.notes.splice(i, 1);
            i--; // developers hate me because of this one simple trick
        }
    }

    if (state.currentNoteIndex >= state.notes.length) {
        state.currentNoteIndex = state.notes.length - 1;
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
    });
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


const getTimeStr = (note) => {
    const { openedAt } = note;

    const date = new Date(openedAt);
    const hours = date.getHours();
    const minutes = date.getMinutes();

    return `${pad2(((hours - 1) % 12) + 1)}:${pad2(minutes)} ${hours < 12 ? "am" : "pm"}`;
}

const getIndentStr = (note) => {
    const { indent: repeats } = note;
    return "     ".repeat(repeats);
};


const getNoteDuration = (state, i) => {
    if (i < 0) {
        return getDurationMS(state.notes[0].openedAt, getTimestamp(new Date()));
    }

    const note = state.notes[i];
    const nextSiblingIndex = getNextNoteOnSameOrPreviousLevelIndex(state, i);

    const nextSibling = state.notes[nextSiblingIndex];
    const duration = nextSibling
        ? getDurationMS(note.openedAt, nextSibling.openedAt)
        : getDurationMS(note.openedAt, getTimestamp(new Date()));
    return duration;
}

const getSecondPartOfRow = (state, i) => {
    const note = state.notes[i];
    const duration = getNoteDuration(state, i);
    const durationStr = formatDuration(duration);
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

    return `${getTimeStr(note)} | ${getRowIndentPrefix(state, i)} ${dashChar} ${note.text || " "}`;
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

const RectView = () => {
    const [root] = htmlf(
        `<div class="bring-to-front row" style="width: 100%; height: 100%; border: 1px solid black;"></div>`
    );

    const args = {};

    const recursiveRectPack = (mountPoint, i, thisRectSize, isParentRow) => {
        const { state, rerenderApp } = args.val;
        const duration = getNoteDuration(state, i)
        
        const tasksOnThisLevel = [];
        {
            let childDurations = 0;
            iterateChildNotesOneLevel(state, i, (note, i) => {
                const childDuration = getNoteDuration(state, i);
                childDurations += childDuration;
                tasksOnThisLevel.push({
                    text: note.text,
                    indent: note.indent,
              //       duration: childDuration,
                    duration01: childDuration / duration,
                    i: i,
                    isSelected : note.isSelected,
                });
            });
    
            if (tasksOnThisLevel.length !== 0) {
                // need to insert a task for the gap between the start of the first task, and the parent task
                tasksOnThisLevel[0].padding =  1 - (childDurations / duration);
            }
        }

        if (tasksOnThisLevel.length === 0) {
            return;
        }

        // tasksOnThisLevel.sort((t1, t2) => t2.duration01 - t1.duration01);

        for(let i = 0; i < tasksOnThisLevel.length; i++) {
            const task = tasksOnThisLevel[i];
            const isCurrentlySelectedTask = task.i === state.currentNoteIndex;
            
            const outlineColor = task.isSelected ?(
                isCurrentlySelectedTask ? `rgba(0, 0, 255, 1)` : `rgba(0,255,0, 1)`
            ) : `rgba(255,0,0, 1)`;
            
            const bgColor = task.isSelected ? (
                isCurrentlySelectedTask ? `rgba(0, 255, 0, ${0.5 / maxIndent})` : `rgba(0, 0, 255, ${0.5 / maxIndent})`
            ) : `rgba(255,0,0, ${0.5 / maxIndent})`;

            let childRectSize;
            if (isParentRow) {
                childRectSize = [thisRectSize[0] * task.duration01, thisRectSize[1]];
            } else {
                childRectSize = [thisRectSize[0], thisRectSize[1] * task.duration01];
            }
            const isRow = childRectSize[0] > childRectSize[1];
            // const isRow = task.indent % 2 === 0;

            // const outlineThickness = isCurrentlySelectedTask ? maxIndent : maxIndent - task.indent;
            const outlineThickness = isCurrentlySelectedTask ? 5 : 1;
            const zIndex = isCurrentlySelectedTask ? maxIndent + 1 : task.indent;

            if (task.padding) {
                appendChild(
                    mountPoint, 
                    htmlf(
                        `<div style="flex:${task.padding};z-index:${zIndex};user-select:none"></div>`
                    )[0]
                );
            }

            const [root] = htmlf(
                `<div 
                    class="${isRow ? "row" : "col"}" 
                    style="flex:${task.duration01}; outline: ${outlineThickness}px solid ${outlineColor};background-color:${bgColor}; z-index:${zIndex}" 
                    title="${task.text}"
                ></div>`
            )
            appendChild(mountPoint, root);
            
            if (task.i != null) {
                eventListener(root, "click", (e) => {
                    e.stopPropagation();

                    state.currentNoteIndex = task.i;
                    rerenderApp({ shouldScroll: false } );
                });
    
                recursiveRectPack(root, task.i, childRectSize, isRow);
            }
        }
    }

    const component = {
        el: root.el,
        rerender: (argsIn) => {
            args.val = argsIn;
            const { state } = argsIn;

            maxIndent = 0;
            for (let i = 0; i < state.notes.length; i++) { 
                if (maxIndent < state.notes[i].indent) {
                    maxIndent = state.notes[i].indent;
                }
            }
    
            clearChildren(root);
    
            const parentRect = root.el.getBoundingClientRect();
            const parentRectSize = [parentRect.width, parentRect.height];
            recursiveRectPack(root, -1, parentRectSize, true);
        }
    };

    return component;
}

const ScratchPad = () => {
    const [textInput] = htmlf(`<textarea class="scratch-pad"></textarea>`);

    const args = {};

    const onEdit = () => {
        const { debouncedSave } = args.val;
        debouncedSave();
    }

    // HTML doesn't like tabs, we need this additional code to be able to insert tabs.
    eventListener(textInput, "keydown", (e) => {
        if (e.keyCode !== 9) return;

        e.preventDefault();

        // inserting a tab like this should preserve undo
        // TODO: stop using deprecated API
        document.execCommand("insertText", false, "\t");

        onEdit();
    });

    eventListener(textInput, "input", () => {
        const { state } = args.val;
        state.scratchPad = textInput.el.value;
        onEdit();
    });

    return {
        el: textInput.el,
        rerender: (argsIn) => {
            args.val = argsIn;
            const { state } = argsIn;

            if (textInput.el.value !== state.scratchPad) {
                textInput.el.value = state.scratchPad;
            }
        }
    };
};

const TextArea = () => {
    const [root] = htmlf(`<textarea class="flex-1"></textarea>`);

    // https://stackoverflow.com/questions/2803880/is-there-a-way-to-get-a-textarea-to-stretch-to-fit-its-content-without-using-php
    eventListener(root, "input", () => {
        root.el.style.height = "";
        root.el.style.height = root.el.scrollHeight + "px";
    })
    return root;
}

const NoteRowText = () => {
    const [cell, [
        [indent],
        [whenNotEditing],
        [whenEditing]
    ]] = htmlf(`<div class="pre-wrap flex-1" style="padding-left: 20px;"><div class="row v-align-bottom">%c%c%c</div></div>`,
        htmlf(`<div class="pre-wrap"></div>`),
        htmlf(`<div class="pre-wrap"></div>`),
        htmlf(`<input class="flex-1" style="background-color: #DDD"></input>`)
    );

    let args = {};

    eventListener(whenEditing, "input", () => {
        if (!args.val) return;

        const { state } = args.val;
        const noteIndex = args.noteIndex;

        const note = state.notes[noteIndex];
        if (note.text === "" && 
            !!whenEditing.el.value && 
            noteIndex === state.notes.length - 1 // only allow the final note to be 'restarted'
        ) {
            // refresh this timestamp if the note was empty before
            note.openedAt = getTimestamp(new Date());
        }

        note.text = whenEditing.el.value;
    });

    eventListener(whenEditing, "keydown", (e) => {
        const { state, rerenderApp, debouncedSave } = args.val;

        if (handleNoteInputKeyDown(state, e)) {
            rerenderApp();
        }

        // handle saving state with a debounce
        debouncedSave();
    });

    return {
        el: cell.el,
        setColor: function(col) {
            this.el.style.color = col;
        },
        rerender: function(argsIn, noteIndex) {
            args.val = argsIn;
            args.noteIndex = noteIndex;

            const { state, rerenderApp, shouldScroll } = args.val;
            const note = state.notes[noteIndex];

            const dashChar = note.isSelected ? ">" : "-"
            setTextContent(indent, `${getIndentStr(note)} ${getNoteStateString(note)} ${dashChar} `);

            const isEditing = state.currentNoteIndex === noteIndex;
            setVisible(whenEditing, isEditing);
            setVisible(whenNotEditing, !isEditing);
            if (isEditing) {
                setInputValue(whenEditing, state.notes[noteIndex].text);

                setTimeout(() => {
                    whenEditing.el.focus({ preventScroll : true });
                
                    if (shouldScroll) {
                        const wantedY = whenEditing.el.getBoundingClientRect().height * noteIndex;
                        
                        window.scrollTo({
                            left: 0,
                            top: wantedY - window.innerHeight / 2,
                            behavior: "instant"
                        });
                    }
                }, 1);
            } else {
                setTextContent(whenNotEditing, state.notes[noteIndex].text);
            }
        }
    }
}

const NoteRowTimestamp = () => {
    // const [root] = htmlf(`<div class="pre-wrap table-cell-min v-align-bottom"></div>`);
    const [root] = htmlf(`<div class="pre-wrap"></div>`);

    return {
        el: root.el,
        setColor: function(col) {
            this.el.style.color = col;
        },
        rerender: function(argsIn, noteIndex) {
            const { state } = argsIn;
            setTextContent(root, getTimeStr(state.notes[noteIndex]));
        }
    }
}

const NoteRowStatistic = () => {
    // const [root] = htmlf(`<div class="text-align-right pre-wrap table-cell-min v-align-bottom"></div>`);
    const [root] = htmlf(`<div class="text-align-right pre-wrap"></div>`);

    return {
        el: root.el,
        setColor: function(col) {
            this.el.style.color = col;
        },
        rerender: function(argsIn, noteIndex) {
            const { state } = argsIn;
            ;

            setTextContent(root, getSecondPartOfRow(state, noteIndex));
        }
    }
}

const NoteRowInput = () => {
    const [root, [
        timestamp, 
        text, 
        statistic
    ]] = htmlf(
        `<div class="row">%c%c%c</div>`,
        NoteRowTimestamp(),
        NoteRowText(),
        NoteRowStatistic()
    );

    const args = {};
    eventListener(root, "click", () => {
        const { state, rerenderApp } = args.val;
        state.currentNoteIndex = args.noteIndex;
        rerenderApp();
    });

    return {
        el: root.el,
        rerender: (argsIn,  noteIndex) => {
            args.val = argsIn;
            args.noteIndex = noteIndex;

            const { state } = argsIn;
            const note = state.notes[noteIndex];
            const textColor = note.isSelected ? "black" : 
                (!note.isDone ? "red" : "gray");

            timestamp.setColor(textColor);
            text.setColor(textColor);
            statistic.setColor(textColor);

            timestamp.rerender(argsIn, noteIndex);
            text.rerender(argsIn, noteIndex);
            statistic.rerender(argsIn, noteIndex);
        }
    };
};

const NotesList = () => {
    let pool = [];
    const [root] = htmlf(`<div class="w-100"></div>`);

    return {
        el: root.el,
        rerender: function(args) {
            const { state } = args;

            resizeComponentPool(root, pool, state.notes.length, NoteRowInput);
            for(let i = 0; i < pool.length; i++) {
                pool[i].rerender(args, i);
            }
        }
    }
}

const Button = (text, fn) => {
    const [ btn ] = htmlf(`<button type="button">%c</button>`, text);
    btn.el.addEventListener("click", fn);
    return btn;
}

const App = () => {
    const [appRoot, [[
        [rectViewRoot, [rectView]], 
        [_0, [
            [infoButton]]
        ], 
        [info1], 
        notesList,
        _1, 
        [info2], 
        scratchPad,
        [fixedButtons, [
            [statusTextIndicator],
        ]]
    ]]] = htmlf(
        `<div class="relative">
            %a
        </div>`, [
            // rectViewRoot
            htmlf(`<div class="fixed" style="top:30px;bottom:30px;left:30px;right:30px;background-color:transparent;">%c</div>`,
                RectView()
            ),
            // title [infoButton]
            htmlf(
                `<div class="row align-items-center">
                    <h2>Currently working on</h2>
                    <div class="flex-1"></div>
                    %a
                </div>`,
                htmlf(`<button class="info-button" title="click for help">help?</button>`),
            ),
            // info1
            htmlf(
                `<div>
                    <p>
                        Use this note tree to keep track of what you are currently doing, and how long you are spending on each thing.
                        You can only create new entries at the bottom, and the final entry is always assumed to be unfinished.
                    </p>
                    <p>
                        In the future, I might add the ability to have multiple of these.
                    </p?
                    <ul>
                        <li>[Enter] to create a new entry</li>
                        <li>Arrows to move around</li>
                        <li>Tab or Shift+Tab to indent/unindent a note</li>
                        <li>Also look at the buttons in the bottom right there</li>
                    </ul>
                </div>`
            ),
            // notesList
            NotesList(),
            // _1
            htmlf(`<h2 style="marginTop: 20px;">Scratch Pad</h2>`),
            // info2
            htmlf(
                `<div>
                    <p>
                        Write down anything that can't go into a note into here. A task you need to do way later, a copy paste value, etc.
                    </p>
                </div>`
            ),
            // scratchPad
            ScratchPad(),
            // fixedButtons
            htmlf(
                `<div class="fixed row gap-5 align-items-center" style="bottom: 5px; right: 5px;">
                    %c %a
                </div>`,
                // statusTextIndicator
                htmlf(`<div class="pre-wrap"></div>`), 
                // the buttons
                [
                    Button("Area view", () => appComponent.toggleRectView()),
                    Button("Clear all", () => {
                        if (!confirm("Are you sure you want to delete all your notes?")) {
                            return;
                        }
                
                        localStorage.clear();
                        state = loadState();
                        appComponent.rerender();
                
                        showStatusText("Cleared notes");
                    }),
                    Button("Copy as text", () => {
                        handleErrors(() => {
                            navigator.clipboard.writeText(exportAsText(state));
                            showStatusText("Copied as text");
                        });
                    }),
                    Button("Copy as JSON", () => {
                        handleErrors(() => {
                            navigator.clipboard.writeText(JSON.stringify(state));
                            showStatusText("Copied JSON");
                        });
                    })
                ]
            ),
        ]
    );

    let state = loadState();

    
    // rect view
    let isRectViewOpen = false;
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && isRectViewOpen) {
            appComponent.toggleRectView();
        }
    });

    let showInfo = false;
    const updateHelp = () => {
        setVisible(info1, showInfo);
        setVisible(info2, showInfo);
    }
    eventListener(infoButton, "click", () => {
        showInfo = !showInfo;
        updateHelp();    
    });
    updateHelp();

    let statusTextClearTimeout = 0;
    const showStatusText = (text, timeout) => {
        if (statusTextClearTimeout) {
            clearTimeout(statusTextClearTimeout);
        }

        statusTextIndicator.el.textContent = text;

        const timeoutAmount = timeout || STATUS_TEXT_PERSIST_TIME;
        if (timeoutAmount > 0) {
            statusTextClearTimeout = setTimeout(() => {
                statusTextIndicator.el.textContent = "";
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

    const appComponent = {
        el: appRoot.el,
        rerender: function(options = { shouldScroll: true}) {
            fixNoteTree(state);
    
            const stickyPxRef = { val: 0 };
            const args = {
                state, 
                shouldScroll: options.shouldScroll, 
                isRectViewOpen,
                stickyPxRef,
                rerenderApp: appComponent.rerender,
                debouncedSave
            };
    
            // rerender the things
            notesList.rerender(args);
            scratchPad.rerender(args);
            if (setVisible(rectViewRoot, isRectViewOpen)) {
                rectView.rerender(args);
            }
        },
        toggleRectView: function() {
            isRectViewOpen = !isRectViewOpen;
            this.rerender({shouldScroll: false});
        }
    };

    return appComponent;
};

const root = {
    el: document.getElementById("app")
};

const app = App();
appendChild(root, app);
app.rerender();