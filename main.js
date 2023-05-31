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

const RectView = (mountPoint, getState) => {
    const { root } = createComponent(mountPoint, `
        <div class="bring-to-front row" style="width: 100%; height: 100%; border: 1px solid black;"></div>
    `);
    
    const component = {
        onSelectNote: (i) => {},
        rerender: () => {}
    };

    let maxIndent = 0;

    const rerender = () => {
        const state = getState();

        maxIndent = 0;
        for (let i = 0; i < state.notes.length; i++) { 
            if (maxIndent < state.notes[i].indent) {
                maxIndent = state.notes[i].indent;
            }
        }

        clearChildren(root);
        const parentRect = root.getBoundingClientRect();
        recursiveRectPack(root, -1, [parentRect.width, parentRect.height], true);
    }
    component.rerender = rerender;
    
    component.rerender = () => {
        setTimeout(() => {
            rerender();
        }, 0);
    }
    
    const recursiveRectPack = (mountPoint, i, thisRectSize, isParentRow) => {
        const state = getState();
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
            // createComponent(mountPoint, 
            //     // center a text vertically and horizontally. challenge level: impossible
            //     `<div class="col align-items-center w-100 h-100">
            //         <div class="text-align-center">${formatDuration(duration)}</div>
            //     </div>`
            // );
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

            const outline = isCurrentlySelectedTask ? maxIndent : maxIndent - task.indent;
            const zIndex = isCurrentlySelectedTask ? maxIndent + 1 : task.indent;

            if (task.padding) {
                createComponent(mountPoint, 
                    `<div style="flex:${task.padding};z-index:${zIndex};user-select:none"></div>`
                );      
            }
            const { root } = createComponent(mountPoint, 
                `<div 
                    class="${isRow ? "row" : "col"}" 
                    style="flex:${task.duration01}; outline: ${outline}px solid ${outlineColor};background-color:${bgColor}; z-index:${zIndex}" 
                    title="${task.text}"
                ></div>`
            );
            
            if (task.i != null) {
                root.addEventListener("click", (e) => {
                    e.stopPropagation();
                    component.onSelectNote(task.i);
                    rerender();
                })
    

                recursiveRectPack(root, task.i, childRectSize, isRow);
            }
        }
    }

    rerender();

    return component;
}

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
            <div --id="inputRoot" class="row" style="background-color:#DDD">
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
        update: (state, noteIndex, stickyPxRef, shouldSroll, isRectViewOpen) => {
            const note = state.notes[noteIndex];
            const isEditing = state.currentNoteIndex === noteIndex;
            const isHighlighted = !note.isDone || note.isSelected;

            setVisible(inputRoot, isEditing);
            setVisible(showRoot, !isEditing);
            
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
                
                    if (shouldSroll) {
                        const wantedY = root.getBoundingClientRect().height * noteIndex;
                        window.scrollTo({
                            left: 0,
                            top: wantedY - window.innerHeight / 2,
                            behavior: "instant"
                        });
                    }
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
                if (isHighlighted && !isRectViewOpen) {
                    root.style.position = "sticky";
                    root.style.top = stickyPxRef.val + "px";
                    root.style.zIndex = 10;
                    root.style.backgroundColor = "#FFF";

                    stickyPxRef.val += root.getBoundingClientRect().height;
                } else {
                    root.style.zIndex = 0;
                    root.style.position = "initial";
                    root.style.top = "none";
                    root.style.backgroundColor = "#FFF";
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

const button = (text, fn) => {
    const btn = printf(`<button type="button">${text}</button>`);
    btn.el.addEventListener("click", fn);
    return btn;
}

const App = (mountPoint) => {
    const areaView = areaView();

    let isHelpVisible = false;
    let info1, info2, notesMountPoint, scratchPad, rectViewRoot;
    const toggleHelp = () => {
        isHelpVisible = !isHelpVisible;
        setVisible(info1.el, isHelpVisible);
        setVisible(info2.el, isHelpVisible);
    }
    const parent = printf(`<div>%a</div>`, [
        // rect view modal
        printf(`<div class="fixed" style="top:30px;bottom:30px;left:30px;right:30px;background-color:transparent;">%c</div>`, areaView),
        // title
        printf(
            `<div class="row align-items-center">
                <h2>Currently working on</h2>
                <div class="flex-1"></div>
                %c
            </div>`,
            (() => {
                const helpButton = printf(`<button class="info-button" title="click for help">help?</button>`)
                helpButton.el.addEventListener("click", () => {
                    toggleHelp();
                })
                return helpButton;
            })()
        ),
        (() => {
            info1 = printf(
                `<div --id="info1">
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
            );
            return info1;
        })(),
        // notes
        (() => {
            notesMountPoint = printf(`<div class="notes-root"></div>`);
            return notesMountPoint;
        })(),
        printf(`<div style="height: 20px"></div>`), // seperator
        printf(`<h2>Scratch Pad</h2>`),
        (() => {
            info2 = printf(
                `<div --id="info2">
                    <p>
                        Write down anything that can't go into a note into here. A task you need to do way later, a copy paste value, etc.
                    </p>
                </div>`
            );
            return info2;
        })(),
        (() => {
            scratchPad = printf(`<div></div>`);
            return scratchPad;
        })(),
        printf(`<div style="height: 300px"></div>`),     // allows overscroll
        (() => {
            fixedButtonsMountPoint = printf(`<div></div>`)
            return fixedButtonsMountPoint;
        })(),
    ])

    const { 
        fixedButtonsMountPoint,
        notesMountPoint, 
        scratchPad, 
        rectViewRoot,
        infoButton, info1, info2,
        parent
    } =
        createComponent(mountPoint,`
            <div class="relative" --id="parent">
                
                
                
                
                

                
                
                
                
                
            </div>
        `);

    let state = loadState();

    const statusTextIndicator = printf(`<div class="pre-wrap"></div>`)
    const fixedButtons = printf(
        `<div class="fixed row gap-5 align-items-center" style="bottom: 5px; right: 5px;">
            %c %a
        </div>`,
        statusTextIndicator, [
            button("Area view", () => toggleRectView()),
            button("Clear all", () => {
                if (!confirm("Are you sure you want to delete all your notes?")) {
                    return;
                }
        
                localStorage.clear();
                state = loadState();
                rerender();
        
                showStatusText("Cleared notes");
            }),
            button("Copy as text", () => {
                handleErrors(() => {
                    navigator.clipboard.writeText(exportAsText(state));
                    showStatusText("Copied as text");
                });
            }),
            button("Copy as JSON", () => {
                handleErrors(() => {
                    navigator.clipboard.writeText(JSON.stringify(state));
                    showStatusText("Copied JSON");
                });
            })
        ]
    );

    parent.replaceChild(fixedButtons.el, fixedButtonsMountPoint);

    // scratch pad
    {
        ScratchPad(scratchPad, () => state);
    }

    
    // rect view
    let isRectViewOpen = false;
    const rectViewComponent = RectView(rectViewRoot, () => state);
    const toggleRectView = () => {
        isRectViewOpen = !isRectViewOpen;
        rerender({shouldScroll: false});
    }
    
    {
        rectViewComponent.onSelectNote = (i) => {
            state.currentNoteIndex = i;
            rerender({shouldScroll: false});
        }
        
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && isRectViewOpen) {
                toggleRectView();
            }
        })
    }

    let showInfo = false;
    const updateHelp = () => {
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

        statusTextIndicator.el.textContent = text;

        const timeoutAmount = timeout || STATUS_TEXT_PERSIST_TIME;
        if (timeoutAmount) {
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
    

    const elements = [];
    const inputs = [];
    const rerender = (options = { shouldScroll: true}) => {
        fixNoteTree(state);

        stickyPxRef = { val: 0 };

        resizeListRenderPool(state.notes, elements, inputs, (i) => {
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
            inputs[i].update(state, i, stickyPxRef, options.shouldScroll, isRectViewOpen);
        }

        replaceChildren(notesMountPoint, elements);

        // handle rendering 'child' components
        rectViewComponent.rerender();
        setVisible(rectViewRoot, isRectViewOpen);
    };

    rerender();
};

App(document.getElementById("app"));
