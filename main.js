// TODO: reword `rerender` to `update`
const INDENT_BASE_WIDTH = 100;
const INDENT_WIDTH_PX = 50;
const SAVE_DEBOUNCE = 500;
const STATUS_TEXT_PERSIST_TIME = 1000;
const ERROR_TIMEOUT_TIME = 5000;

const pad2 = (num) => (num < 10 ? "0" + num : "" + num);
const repeatSafe = (str, len) => {
    const string = len <= 0 ? "" : str.repeat(Math.ceil(len / str.length));
    return string.substring(0, len);
};

const getNoteStateString = (note) => {
    if (note.isDone) {
        return "  [x]";
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

const startingState = () => {
    return {
        notes: [createNewNote("First Note")],
        currentNoteIndex: 0,
        scratchPad: ""
    };
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
        const mergedState = merge(loadedState, startingState());
        return mergedState;
    }

    return startingState();
};

const getLocalStorageKeyForTreeName = (name) => STATE_KEY_PREFIX + name;

const saveState = (state, name) => {
    localStorage.setItem(getLocalStorageKeyForTreeName(name), JSON.stringify(state));
}

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


const formatDate = (date) => {
    const hours = date.getHours();
    const minutes = date.getMinutes();

    return `${pad2(((hours - 1) % 12) + 1)}:${pad2(minutes)} ${hours < 12 ? "am" : "pm"}`;
}

const getTimeStr = (note) => {
    const { openedAt } = note;

    const date = new Date(openedAt);
    return formatDate(date);
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

    const notesHeading = "---------------- Notes ----------------";
    return events + "\n\n" + notesHeading + "\n" + scratchPad + "\n" + "-".repeat(notesHeading.length) + "\n";
};

const RectView = () => {
    const [root] = htmlf(
        `<div class="relative row" style="width: 100%; height: 100%; border: 1px solid var(--fg-color);"></div>`
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
    const [root, [
            [textArea],
            [mirrorDiv]
     ]] = htmlf(
        `<div>%c%c</div>`, // allows overscroll
        htmlf(`<textarea class="scratch-pad pre-wrap"></textarea>`),
        htmlf(`<div></div>`)
    );
    
    // const mirrorDiv = createMirrorDivForTextArea(textArea);
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
    ]] = htmlf(`<div class="pre-wrap flex-1" style="margin-left: 10px; padding-left: 10px;border-left: 1px solid var(--fg-color);"><div class="row v-align-bottom">%c%c%c</div></div>`,
        htmlf(`<div class="pre-wrap"></div>`),
        htmlf(`<div class="pre-wrap"></div>`),
        htmlf(`<input class="flex-1"></input>`)
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

    let isEditing = false;
    return {
        el: cell.el,
        rerender: function(argsIn, noteIndex) {
            args.val = argsIn;
            args.noteIndex = noteIndex;

            const { state, rerenderApp, shouldScroll } = args.val;
            const note = state.notes[noteIndex];

            const dashChar = note.isSelected ? ">" : "-"
            setTextContent(indent, `${getIndentStr(note)} ${getNoteStateString(note)} ${dashChar} `);

            const wasEditing = isEditing;
            isEditing = state.currentNoteIndex === noteIndex;
            setVisible(whenEditing, isEditing);
            setVisible(whenNotEditing, !isEditing);
            if (isEditing) {
                setInputValue(whenEditing, state.notes[noteIndex].text);

                if (!wasEditing) {
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
                }
            } else {
                setTextContent(whenNotEditing, state.notes[noteIndex].text);
            }
        }
    }
}

const NoteRowTimestamp = () => {
    // const [root] = htmlf(`<div class="pre-wrap table-cell-min v-align-bottom"></div>`);
    // const [root] = htmlf(`<div class="pre-wrap"></div>`);
    const [root, [
        [input]
    ]] = htmlf(`<div class="pre-wrap">%c</div>`,
        htmlf(`<input class="w-100"></input>`)
    );

    const args = {};

    eventListener(input, "change", () => {
        const { state, rerenderApp, handleErrors } = args.val;
        const noteIndex = args.noteIndex;
        const note = state.notes[noteIndex];

        let previousTime = null;
        let nextTime = null;
        if (noteIndex > 0) {
            previousTime = new Date(state.notes[noteIndex - 1].openedAt);
        }

        if (noteIndex < state.notes.length - 1) {
            nextTime = new Date(state.notes[noteIndex + 1].openedAt);
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

            note.openedAt = newTime;
            rerenderApp();
        }, () => {
            setInputValueAndResize(input, getTimeStr(note));
            rerenderApp();
        });
    });

    return {
        el: root.el,
        rerender: function(argsIn, noteIndex) {
            args.val = argsIn;
            args.noteIndex = noteIndex;

            const { state } = args.val;
            const note = state.notes[args.noteIndex];

            // setTextContent(root, timeStr);
            setInputValueAndResize(input, getTimeStr(note));
        }
    }
}

const NoteRowStatistic = () => {
    // const [root] = htmlf(`<div class="text-align-right pre-wrap table-cell-min v-align-bottom"></div>`);
    const [root] = htmlf(`<div class="text-align-right pre-wrap"></div>`);

    return {
        el: root.el,
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
        `<div class="row">
            %c
            %c
            %c
        </div>`,
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
        rerender: function(argsIn,  noteIndex) {
            args.val = argsIn;
            args.noteIndex = noteIndex;

            const { state, stickyPxRef, isRectViewOpen } = argsIn;
            const note = state.notes[noteIndex];

            const textColor = note.isSelected ? "var(--fg-color)"  : 
                (!note.isDone ? "var(--fg-color)" : "var(--unfocus-text-color)");

            root.el.style.color = textColor;

            timestamp.rerender(argsIn, noteIndex);
            text.rerender(argsIn, noteIndex);
            statistic.rerender(argsIn, noteIndex);
            if (!isRectViewOpen && (note.isSelected || !note.isDone)) {
                setTimeout(() => {
                    // sticky. do it
                    let top = stickyPxRef.val;
                    stickyPxRef.val += this.el.getBoundingClientRect().height;

                    this.el.style.position = "sticky";
                    this.el.style.top = top + "px";
                }, 1);
            } else {
                this.el.style.position = "static";
                this.el.style.top = undefined;
            }
        }
    };
};

const NotesList = () => {
    let pool = [];
    const [root] = htmlf(`<div class="w-100" style="border-top: 1px solid var(--fg-color);border-bottom: 1px solid var(--fg-color);"></div>`);

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

const Button = (text, fn, classes="") => {
    const [ btn ] = htmlf(`<button type="button" class="solid-border ${classes}" style="padding: 3px; margin: 5px;">%c</button>`, text);
    eventListener(btn, "click", fn);
    return btn;
}

const CurrentTreeNameEditor = () => {
    const [treeNameInput] = htmlf(`<input class="inline-block w-100"></input>`);

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
    const [root, [
        [tabsRoot],
        [newButton]
    ]] = htmlf(
        `<div>
            <span class="row pre-wrap align-items-center">
                %c %c
            </span>
            <div style="outline-bottom: 1px solid var(--fg-color);"></div>
        </div>`
        ,
        htmlf(`<span class="row pre-wrap align-items-center"></span>`),
        htmlf(
            `<button 
                type="button" 
                class="pre-wrap text-align-center"
                style="margin-left: 5px;"
            > + </button>`
        ),
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
            // Tabs
            const [root, [
                [btn],
                [input],
                [closeBtn]
            ]] = htmlf(
                `<div 
                    class="relative" 
                    style="margin-left:2px;outline:2px solid var(--fg-color); border-top-right-radius: 5px; border-top-left-radius: 5px;"
                >%c%c%c</div>`,
                htmlf(
                    `<button 
                        type="button" 
                        class="tab-button pre-wrap text-align-center z-index-100"
                        style="padding: 2px 20px;"
                    ></button>`
                ),
                htmlf(
                    `<input 
                        class="pre-wrap text-align-center z-index-100"
                        style="margin-right: 20px;padding: 2px 20px; "
                    ></input>`
                ),
                htmlf(
                    `<button 
                        type="button" 
                        class="pre-wrap text-align-center z-index-100"
                        style="position:absolute; right: 5px; background-color:transparent;"
                    > x </button>`
                ),
            )
            
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
        return localStorage.getItem("State.currentTheme");
    }
    const setTheme = (theme) => {
        localStorage.setItem("State.currentTheme", theme);

        const themeName = getTheme();

        if (themeName === "Light") {
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

        setTextContent(button, themeName);
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
    const [appRoot, [[
        [rectViewRoot, [
            rectView
        ]], 
        [_titleRow, [
            _title,
            [infoButton]
        ]],
        [info1], 
        [_0, [
            treeSelector,
        ]], 
        notesList,
        _1, 
        [info2], 
        scratchPad,
        _paddingForOverflow,
        [fixedButtons, [
            _2, 
            [statusTextIndicator],
            _3
        ]],
    ]]] = htmlf(
        `<div class="relative" style="padding-bottom: 100px">
            %a
        </div>`, [
            // rectViewRoot
            htmlf(`<div class="fixed z-index-100" style="top:30px;bottom:30px;left:30px;right:30px;background-color:transparent;">%c</div>`,
                RectView()
            ),
            // _titleRow
            htmlf(`<div class="row align-items-center">%c<span class="flex-1"></span>%c</div>`,
                // _title
                htmlf(`<h2>Currently working on</h2>`),
                // infoButton
                htmlf(`<button class="info-button" title="click for help">help?</button>`),
            ),
            // info1
            htmlf(
                `<div>
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
                </div>`
            ),
            // _0
            htmlf(
                `<div>
                    <div class="row align-items-end">
                        %c
                    </div>
                </div>`,
                // treeSelector
                CurrentTreeSelector(),
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
            // _paddingForOverflow
            htmlf(
                `<div>
                    <div style="height: 1500px"></div>
                    <div>
                        Something as trivial as scrolling vertically to where the cursor is in a text input is way too hard to implement in HTML.
                        I've added this padding to ensure that it works, but you aren't actually supposed to be down here
                    </div>
                </div>`
            ),
            // fixedButtons left
            htmlf(
                `<div class="fixed row align-items-center" style="bottom: 5px; right: 5px; left: 5px; gap: 5px;">
                    <div>%a</div>
                    <span class="flex-1"></span>
                    <div>%c</div>
                    <div>%a</div>
                </div>`,
                [
                    DarkModeToggle(),
                ],
                // statusTextIndicator
                htmlf(`<div class="pre-wrap"></div>`), 
                // right buttons
                [
                    Button("Area view", () => appComponent.toggleRectView()),
                    Button("Clear all", () => {
                        if (!confirm("Are you sure you want to clear your note tree?")) {
                            return;
                        }
                
                        state = startingState();
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
            ),
        ]
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
            console.log("saving", thisTreeName);

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
        let i = 0;
        let name;
        while(i < 100000) {
            i++;
            name = "New " + i;
            if (!localStorage.getItem(getLocalStorageKeyForTreeName(name))) {
                break;
            }
        }

        state = startingState();
        currentTreeName = name;
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
            fixNoteTree(state);
    
            const stickyPxRef = { val: 0 };
            const args = {
                state, 
                shouldScroll: options.shouldScroll, 
                isRectViewOpen,
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
            if (setVisible(rectViewRoot, isRectViewOpen)) {
                rectView.rerender(args);
            }
        },
        toggleRectView: function() {
            isRectViewOpen = !isRectViewOpen;
            this.rerender({shouldScroll: false});
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