import "./styles.css"
import "./style-utils.css"

import {
    ALL_FILTERS,
    Activity,
    Note,
    NoteId,
    STATUS_DONE,
    STATUS_IN_PROGRESS,
    State,
    TaskId,
    TreeNote,
    deleteNoteIfEmpty,
    dfsPre,
    getActivityDurationMs,
    getActivityText,
    getCurrentNote,
    getFinalChildNote,
    getFirstPartOfRow,
    getIndentStr,
    getLastActivity,
    getNextActivityWithNoteIdx,
    getNote,
    getNoteDuration,
    getNoteOneDownLocally,
    getNoteOneUpLocally,
    getNoteStateString,
    getNoteTag,
    getOneNoteDown,
    getOneNoteUp,
    getPreviousActivityWithNoteIdx,
    getSecondPartOfRow,
    getTimeStr,
    getTodoNotePriority,
    insertChildNode,
    insertNoteAfterCurrent,
    isCurrentlyTakingABreak,
    isEditableBreak,
    loadStateFromJSON,
    moveNotePriorityIntoPriorityGroup,
    nextFilter,
    previousFilter,
    pushActivity,
    pushBreakActivity,
    recomputeFlatNotes,
    recomputeState,
    recursiveShallowCopy,
    resetState,
    setCurrentNote,
    state
} from "./state";
import {
    Renderable,
    makeComponent,
    setClass,
    setInputValue,
    setInputValueAndResize,
    setTextContent,
    setVisible,
    makeComponentList as makeComponentList,
    div,
    el,
    InsertableGeneric,
    isEditingTextSomewhereInDocument,
} from "./dom-utils";

import * as tree from "./tree";
import { Checkbox, DateTimeInput, DateTimeInputEx, FractionBar, Modal, makeButton } from "./generic-components";
import { floorDateLocalTime, formatDate, formatDuration, getTimestamp, incrementDay, truncate } from "./datetime";

// should be the only 'circular' dependency in the project
import { app } from ".";    

function NoteFilters(): Renderable {
    const lb = makeButton("<");
    const rb = makeButton(">");
    const currentFilterText = div({ class: "flex-1 text-align-center", style: "background:var(--bg-color)"})
    const root = div({ class: "row align-items-center", style: "width: 200px;"}, [
        lb, currentFilterText, rb
    ]);


    const component = makeComponent(root, () => {
        const [ name, _filter ] = ALL_FILTERS[state.currentNoteFilterIdx];
        setTextContent(currentFilterText, name);
    });

    lb.el.addEventListener("click", () => {
        nextFilter(state);
        rerenderApp();
    });

    rb.el.addEventListener("click", () => {
        previousFilter(state);
        rerenderApp();
    });

    return component;
}

type NoteLinkArgs = {
    text: string; 
    focusAnyway: boolean;
    noteId?: NoteId;
    maxLength?: number;
    preventScroll?: boolean;
};

function NoteLink(): Renderable<NoteLinkArgs> {
    const root = div({ style: "padding:5px; word;", class: "handle-long-words" })

    const component = makeComponent<NoteLinkArgs>(root, () => {
        const { text, maxLength, noteId, focusAnyway }  = component.args;

        setClass(root, "hover-link", !!noteId);
        setTextContent(root, truncate(text, maxLength || 500));
        root.el.style.backgroundColor = (focusAnyway || state.currentNoteId === noteId) ? (
            "var(--bg-color-focus)" 
        ) : (
            "var(--bg-color)" 
        );
    });

    root.el.addEventListener("click", () => {
        const { noteId, preventScroll, }  = component.args;

        // setTimeout here because of a funny bug when clicking on a list of note links that gets inserted into 
        // while we are clicking will cause the click event to be called on both of those links. Only in HTML is
        // something like this allowed to happen. LOL.
        setTimeout(() => {
            if (noteId) {
                setCurrentNote(state, noteId);
                rerenderApp({ shouldScroll: preventScroll || false });
            }
        }, 1);
    });

    return component;
}

function TodoList(): Renderable {
    type TodoItemArgs = {
        note: tree.TreeNode<Note>;
        hasDivider: boolean;
    }

    const componentList = makeComponentList(div(), () => {
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
                const { noteId } = linkedNoteArgs;

                const note = getNote(state, noteId);

                link.render(linkedNoteArgs);
                setTextContent(thing, " " + previousNotesCount +  (state.currentNoteId === noteId ? " > " : " - "));
                setTextContent(status, getNoteStateString(note.data) ?? "??");
            });

            return component;
        });

        let noteLink, moveUpButton, moveDownButton, divider;
        const root = div({}, [
            div({ 
                class: "hover-parent flex-1", 
                style: "border-top: 1px solid var(--fg-color);" + 
                    "border-left: 4px solid var(--fg-color);" +
                    "border-bottom: 1px solid var(--fg-color);" + 
                    "padding-left: 3px;"
            }, [
                div({ class: "row align-items-center" }, [
                    noteLink = NoteLink(),
                    div({ class: "flex-1" }),
                    div({ class: "row" }, [
                        moveUpButton = makeButton("↑", "hover-target", "height: 20px;"),
                        moveDownButton = makeButton("↓", "hover-target", "height: 20px;"),
                    ]),
                ]),
                nestedNotesList,
            ]),
            divider = div({ style: "height: 20px"}),
        ]);

        const component = makeComponent<TodoItemArgs>(root, () => {
            const { note, hasDivider } = component.args;

            setVisible(divider, hasDivider);

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

                nestedNotesList.components[i].render({
                    linkedNoteArgs: {
                        noteId: note.id,
                        text: note.data.text,
                        focusAnyway: false,
                        preventScroll: true,
                    },
                    previousNotesCount: childCount,
                });
            }

            noteLink.render({
                noteId: note.id,
                text: note.data.text,
                focusAnyway,
                preventScroll: true,
            });
        });

        function moveNotePriorityUpOrDown(
            state: State, 
            noteId: NoteId,
            down: boolean,  // setting this to false moves the note's priority up (obviously)
        ) {
            const idxThis = state.todoNoteIds.indexOf(noteId);
            if (idxThis === -1) {
                // this code should never run
                throw new Error("Can't move up a not that isn't in the TODO list. There is a bug in the program somewhere");
            }

            const currentNote = getCurrentNote(state);
            const currentPriority = getTodoNotePriority(currentNote.data);

            let idx = idxThis;
            const direction = down ? 1 : -1;
            while(
                (direction === -1 && idx > 0) || 
                (direction === 1 && idx < state.todoNoteIds.length - 1)
            ) {
                idx += direction;
                
                const noteId = state.todoNoteIds[idx];
                const note = getNote(state, noteId);
                if (
                    note.id === currentNote.id ||
                    note.data._isSelected || 
                    getTodoNotePriority(note.data) !== currentPriority
                ) {
                    idx -= direction;
                    break;
                }
            }

            if (idxThis !== idx) {
                state.todoNoteIds.splice(idxThis, 1);
                state.todoNoteIds.splice(idx, 0, noteId);
            }
        }

        moveDownButton.el.addEventListener("click", () => {
            const { note } = component.args;

            setTimeout(() => {
                moveNotePriorityUpOrDown(state, note.id, true);
                setCurrentNote(state, note.id);

                rerenderApp({ shouldScroll: false });
            }, 1);
        });

        moveUpButton.el.addEventListener("click", () => {
            const { note } = component.args;

            setTimeout(() => {
                moveNotePriorityUpOrDown(state, note.id, false);
                setCurrentNote(state, note.id);

                rerenderApp({ shouldScroll: false });
            }, 1);
        });

        return component;
    });

    const component = makeComponent(componentList, () => {
        componentList.resize(state.todoNoteIds.length);
        for (let i = 0; i < componentList.components.length; i++) {
            const id = state.todoNoteIds[i];
            const nextId: NoteId | undefined = state.todoNoteIds[i + 1];

            const note = getNote(state, id);
            const nextNote = nextId ? getNote(state, nextId) : undefined;

            componentList.components[i].render({
                note: getNote(state, id),
                hasDivider: !!nextNote && getTodoNotePriority(note.data) !== getTodoNotePriority(nextNote.data),
            });
        }
    });

    return component;
}

function BreakInput(): Renderable {
    const breakInput = el<HTMLInputElement>("INPUT", { class: "w-100" });
    const breakButton = makeButton("");
    const root = div({ style: "padding: 5px;", class: "row align-items-center" }, [
        div({ class: "flex-1" }, [ breakInput ]),
        div({}, [ breakButton ]),
    ]);

    const component = makeComponent(root, () => {
        const isTakingABreak = isCurrentlyTakingABreak(state);

        setTextContent(breakButton, isTakingABreak ? "Extend break" : "Take a break");
        breakInput.el.setAttribute("placeholder", "Enter break reason (optional)");
    });

    function addBreak() {
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

        e.preventDefault();
        addBreak();
    });

    breakButton.el.addEventListener("click", (e) => {

        e.preventDefault();
        addBreak();
    });

    return component;
}

function EditableActivityList(): Renderable {
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
            const { activity, nextActivity, showDuration, } = component.args;

            const isEditable = isEditableBreak(activity);
            const activityText = getActivityText(state, activity);

            if (setVisible(breakEdit, isEditable)) {
                setInputValue(breakEdit, activityText);
            }

            if (setVisible(noteLink, !isEditable)) {
                noteLink.render({
                    focusAnyway: false,
                    noteId: activity.nId,
                    text: activityText,
                });

                setClass(noteLink, "hover-link", !!activity.nId);
                noteLink.el.style.paddingLeft = activity.nId ? "0" : "40px";
            }

            timestamp.render({
                value: new Date(activity.t),
                onChange: updateActivityTime,
                readOnly: false, 
            });

            if (setVisible(durationText, showDuration)) {
                const durationStr = (isEditable ? "~" : "" ) + formatDuration(getActivityDurationMs(activity, nextActivity));
                setTextContent(durationText, durationStr);
            }

            setVisible(deleteButton, isEditable);
        });

        function updateActivityTime(date: Date | null) {
            if (!date) {
                return;
            }

            const { previousActivity, activity, nextActivity } = component.args;

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
            const { activity, nextActivity } = component.args;

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
            const { activity } = component.args;

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
            const { activity } = component.args;
            if (!activity.nId) {
                return;
            }

            setCurrentNote(state, activity.nId);
            rerenderApp();
        });

        breakEdit.el.addEventListener("keypress", (e) => {
            const { activity } = component.args;

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
    const pagination: Pagination = { pageSize: 10, start: 0, totalCount: 0 }
    const paginationControl = PaginationControl();
    const root = div({ class: "w-100", style: "border-top: 1px solid var(--fg-color);" }, [
        listRoot,
        paginationControl,
    ]);

    function rerender() {
        component.render(component.args);
    }

    const component = makeComponent(root, () => {
        paginationControl.render({
            pagination,
            totalCount: state.activities.length,
            rerender,
        });

        const activities = state.activities;
        const start = pagination.start;
        const end = getCurrentEnd(pagination);
        const activitiesToRender = end - start; 

        listRoot.resize(activitiesToRender);
        for (let i = 0; i < activitiesToRender; i++) {
            const idx = activities.length - end + i;
            const previousActivity = activities[idx - 1]; // JavaScript moment - you can index past an array without crashing
            const activity = activities[idx];
            const nextActivity = activities[idx + 1]; // JavaScript moment - you can index past an array without crashing

            listRoot.components[activitiesToRender - 1 - i].render({
                previousActivity,
                activity, 
                nextActivity,
                showDuration: true,
            });
        }
    });

    return component;
}

function TextArea(): InsertableGeneric<HTMLTextAreaElement> {
    const textArea = el<HTMLTextAreaElement>("TEXTAREA", { class: "scratch-pad pre-wrap h-100"});

    textArea.el.addEventListener("keydown", (e) => {
        if (e.key === "Tab") {
            e.preventDefault();
            // HTML doesn't like tabs, we need this additional code to be able to insert tabs.

            // inserting a tab like this should preserve undo
            // TODO: stop using deprecated API
            document.execCommand("insertText", false, "\t");
        }
    })

    return textArea;
}

// exposing the text area so that we can focus it, but
// really, TODO: just expose a focus() function...
function ScratchPad(): Renderable & { textArea: HTMLTextAreaElement } {
    let yardStick = div({ class: "absolute", style: "width: 5px; left:-5px;top:0px" });
    let textArea = TextArea();
    const root = div({ class: "relative h-100" }, [
        yardStick, 
        textArea,
    ]);

    const component = makeComponent(root, () => {
        if (textArea.el.value !== state.scratchPad) {
            textArea.el.value = state.scratchPad;
        }
    });

    const onEdit = () => {
        state.scratchPad = textArea.el.value;
        rerenderApp({ shouldScroll: false });

        debouncedSave();
    };

    textArea.el.addEventListener("input", onEdit);
    textArea.el.addEventListener("change", onEdit);

    textArea.el.addEventListener("keydown", (e) => {
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

        updateScrollPosition();
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

type Pagination = {
    start: number;
    pageSize: number;
    totalCount: number;
}

function setTotalCount(pagination: Pagination, total: number) {
    pagination.totalCount = total;
    if (pagination.start >= total) {
        pagination.start = getMaxPages(pagination) * pagination.pageSize;
    }
}

function getPage(pagination: Pagination) {
    return idxToPage(pagination, pagination.start);
}

function setPage(pagination: Pagination, page: number) {
    pagination.start = Math.max(0, Math.min(pagination.totalCount, page * pagination.pageSize));
}

function idxToPage(pagination: Pagination, idx: number) {
    return Math.floor(idx / pagination.pageSize);
}

function getCurrentEnd(pagination: Pagination) {
    return Math.min(pagination.totalCount, pagination.start + pagination.pageSize);
}

function getMaxPages(pagination: Pagination) {
    return idxToPage(pagination, pagination.totalCount - 1);
}

type PaginationControlArgs = {
    totalCount: number;
    pagination: Pagination;
    rerender(): void;
};


function PaginationControl(): Renderable<PaginationControlArgs> {
    const leftButton = makeButton("<");
    const leftLeftButton = makeButton("<<");
    const rightButton = makeButton(">");
    const rightRightButton = makeButton(">>");
    const pageReadout = div({ style: "width: 100px"});

    const root = div({ style: "border-top: 1px solid var(--fg-color);", class: "row align-items-center"}, [
        pageReadout,
        div({style: "width: 100px", class: "row"}, [
            leftLeftButton, 
            leftButton,
        ]),
        div({style: "width: 100px", class: "row"}, [
            rightButton,
            rightRightButton,
        ]),
    ])

    const component = makeComponent<PaginationControlArgs>(root, () => {
        const { pagination, totalCount } = component.args;

        setTotalCount(pagination, totalCount);
        const page = getPage(pagination);

        setTextContent(pageReadout, "Page " + (page + 1));

        setVisible(leftButton, page !== 0);
        setVisible(leftLeftButton, page !== 0);
        setVisible(rightButton, page !== getMaxPages(pagination));
        setVisible(rightRightButton, page !== getMaxPages(pagination));
    });


    leftButton.el.addEventListener("click", () => {
        const { pagination, rerender} = component.args;
        setPage(pagination, getPage(pagination) - 1);
        rerender();
    });

    leftLeftButton.el.addEventListener("click", () => {
        const { pagination, rerender} = component.args;
        pagination.start = 0;
        rerender();
    });

    rightRightButton.el.addEventListener("click", () => {
        const { pagination, rerender} = component.args;
        pagination.start = idxToPage(pagination, pagination.totalCount) * pagination.pageSize;
        rerender();
    });


    rightButton.el.addEventListener("click", () => {
        const { pagination, rerender} = component.args;
        setPage(pagination, getPage(pagination) + 1);
        rerender();
    });

    return component;
}

type NoteRowArgs = {
    note: TreeNote;
};

function NoteRowText(): Renderable<NoteRowArgs> {
    const indent = div({ class: "pre" });
    const whenNotEditing = div({ class: "pre-wrap handle-long-words", style: "" });

    const whenEditing = TextArea();
    whenEditing.el.setAttribute("rows", "1");
    whenEditing.el.setAttribute("class", "flex-1");
    whenEditing.el.setAttribute("style", "overflow-y: hidden; padding: 0;");

    let isFocused = false;

    const root = div(
        {
            class: "pre-wrap flex-1", 
            style:"overflow-y: hidden; margin-left: 10px; padding-left: 10px;border-left: 1px solid var(--fg-color);"
        },
        [div({ class: "row v-align-bottom" }, [indent, whenNotEditing, whenEditing])]
    );

    function onRerenderWhenEditing() {
        const { note } = component.args;

        setInputValue(whenEditing, note.data.text);

        whenEditing.el.style.height = "0";
        whenEditing.el.style.height = whenEditing.el.scrollHeight + "px";
    }

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { note } = component.args;

        const dashChar = note.data._isSelected ? ">" : "-";
        const count = getRealChildCount(note)
        const childCountText = count ? ` (${count})` : "";
        setTextContent(
            indent,
            `${getIndentStr(note.data)} ${getNoteStateString(note.data)}${childCountText} ${dashChar} `
        );

        const wasFocused = isFocused;
        isFocused = state.currentNoteId === note.id;

        const isEditing = state._isEditingFocusedNote && isFocused;

        if (renderOptions.shouldScroll && !wasFocused && isFocused) {
            // without setTimeout here, calling focus won't work as soon as the page loads.
            setTimeout(() => {
                // scroll view into position.
                // Right now this also runs when we click on a node instead of navigating with a keyboard, but 
                // ideally we don't want to do this when we click on a note.
                // I haven't worked out how to do that yet though
                {
                    const wantedY = root.el.getBoundingClientRect().top + window.scrollY;

                    window.scrollTo({
                        left: 0,
                        top: wantedY - window.innerHeight / 2,
                        behavior: "instant"
                    });
                }
            }, 1);
        }

        if (setVisible(whenEditing, isEditing)) {
            whenEditing.el.focus({ preventScroll: true });
        }

        if (setVisible(whenNotEditing, !isEditing)) {
            setTextContent(whenNotEditing, note.data.text);
        }
        
        root.el.style.backgroundColor = isFocused ? "var(--bg-color-focus)" : "var(--bg-color)";

        onRerenderWhenEditing();
    });

    whenEditing.el.addEventListener("input", () => {
        const { note } = component.args;

        note.data.text = whenEditing.el.value;

        if (state.todoNoteIds.includes(note.id)) {
            moveNotePriorityIntoPriorityGroup(state, note.id);
        }

        onRerenderWhenEditing();

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
        const currentNote = getCurrentNote(state);

        const shiftPressed = e.shiftKey;

        let needsRerender = true;
        let shouldPreventDefault = true;

        if (e.key === "Enter" && !shiftPressed) {
            const oneNoteDown = getOneNoteDown(state, currentNote, true);
            if (oneNoteDown) {
                setCurrentNote(state, oneNoteDown);
            } else {
                insertNoteAfterCurrent(state);
            }

            state._isEditingFocusedNote = true;
        } else if (e.key === "Backspace") {
            deleteNoteIfEmpty(state, currentNote.id);
            shouldPreventDefault = false;
        } else {
            needsRerender = false;
        }

        if (needsRerender) {
            if (shouldPreventDefault) {
                e.preventDefault();
            }

            rerenderApp();
        }
    });

    return component;
}


type ActivityListItemArgs = {
    previousActivity: Activity | undefined;
    activity: Activity;
    nextActivity: Activity | undefined;
    showDuration: boolean;
};


type AnalyticsSeries = {
    activityIndices: number[];

    // These values can be computed off the activities in the series
    duration: number;
}

function newAnalyticsSeries(): AnalyticsSeries {
    return { activityIndices: [], duration: 0 };
}

function resetAnalyticsSeries(series: AnalyticsSeries) {
    series.activityIndices.splice(0, series.activityIndices.length);
    series.duration = 0;
}

// All times are in milliseconds
type Analytics = {
    multiDayBreaks: AnalyticsSeries;
    breaks: AnalyticsSeries;
    taskTimes: Map<TaskId, AnalyticsSeries>;
    totalTime: number;
}

function recomputeAnalyticsSeries(state: State, series: AnalyticsSeries) {
    // recompute duration

    series.duration = 0;
    for (const idx of series.activityIndices) {
        const activity = state.activities[idx];
        const nextActivity  = state.activities[idx + 1] as Activity | undefined;

        series.duration += getActivityDurationMs(activity, nextActivity);
    }
}

function recomputeAnalytics(state: State, activities: Activity[], analytics: Analytics) {
    resetAnalyticsSeries(analytics.breaks);
    resetAnalyticsSeries(analytics.multiDayBreaks);
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


    // compute which activities belong to which group
    for (let i = 0; i < activities.length; i++) { 
        const activity = activities[i];
        const nextActivity  = activities[i + 1] as Activity | undefined;

        if (activity.breakInfo) {
            // Some breaks span from end of day to start of next day. 
            // They aren't very useful for most analytics questions, like 
            //      "How long did I spent working on stuff today vs Lunch?".

            const t = new Date(activity.t);
            const t1 = nextActivity ? new Date(nextActivity.t) : new Date();

            if (
                t.getDate() === t1.getDate() &&
                t.getMonth() === t1.getMonth() &&
                t.getFullYear() === t1.getFullYear()
            ) {
                analytics.breaks.activityIndices.push(i);
                continue;
            } 


            analytics.breaks.activityIndices.push(i);
            continue;
        }

        if (activity.nId) { 
            const note = getNote(state, activity.nId);
            // has the side-effect that a user can just do [Task=<Uncategorized>], that is fine I think
            const task = note.data._task || "<Uncategorized>";

            if (!analytics.taskTimes.has(task)) {
                analytics.taskTimes.set(task, newAnalyticsSeries());
            }

            const series = analytics.taskTimes.get(task)!;
            series.activityIndices.push(i);
            continue;
        }
    }

    // recompute the numbers and aggregates
    recomputeAnalyticsSeries(state, analytics.breaks);
    analytics.totalTime += analytics.breaks.duration;

    recomputeAnalyticsSeries(state, analytics.multiDayBreaks);
    analytics.totalTime += analytics.multiDayBreaks.duration;
    for (const s of analytics.taskTimes.values()) {
        recomputeAnalyticsSeries(state, s);
        analytics.totalTime += s.duration;
    }
}


function activityMatchesFilters(activity: Activity, _nextActivity: Activity | undefined, filter: ActivityFilters): boolean {
    const t = new Date(activity.t);
    // const t1 = nextActivity ? new Date(nextActivity.t) : new Date();
    if (
        filter.is.dateFromEnabled &&
        t < filter.date.from
    ) {
        return false;
    }

    if (
        filter.is.dateToEnabled &&
        t > filter.date.to
    ) {
        return false;
    }

    return true;
}

function filterActivities(dst: Activity[], src: Activity[], filter: ActivityFilters) {
    dst.splice(0, dst.length);

    for (let i = 0; i < src.length; i++) {
        const a = src[i];
        const aNext: Activity | undefined = src[i + 1];

        if (activityMatchesFilters(a, aNext, filter)) {
            dst.push(a);
        }
    }
}


// I am grouping all variables of a particular type into their own sub-object.
// This is a certified Typescript keyof moment (see usage to understand this meme, I cant be bothered explaining it here)
type ActivityFilters = {
    date: {
        from: Date;
        to: Date;
    },
    is: {
        dateToEnabled: boolean;
        dateFromEnabled: boolean;
        // Some breaks will start on monday and end on tuesday.
        // Typically they will over-inflate the total break time, if we only care about lunch breaks and what not.
        multiDayBreakIncluded: boolean;
    }
}

function resetActivityFilters(filters: ActivityFilters) {
    filters.date.from = new Date();
    filters.date.to = new Date();
    filters.is.dateFromEnabled = false;
    filters.is.dateToEnabled = false;
    filters.is.multiDayBreakIncluded = false;
}

type ActivityFiltersEditorArgs = {
    filter: ActivityFilters;
    onChange(): void;
}

function ActivityFiltersEditor() : Renderable<ActivityFiltersEditorArgs> {
    const dates = {
        from: DateTimeInputEx("flex-1"),
        to: DateTimeInputEx("flex-1"),
    } as const;

    const checkboxes = {
        dateFromEnabled: Checkbox("Date from"),
        dateToEnabled: Checkbox("Date to"),
        multiDayBreakIncluded: Checkbox("Include multi-day breaks"),
    } as const;

    const width = 400;

    const todayButton = makeButton("Today");
    todayButton.el.addEventListener("click", () => {
        const { filter, onChange } = component.args;

        filter.is.dateFromEnabled = true;
        filter.is.dateToEnabled = true;

        const dateFrom = new Date();
        const dateTo = new Date();
        floorDateLocalTime(dateFrom);
        floorDateLocalTime(dateTo);
        incrementDay(dateTo);
        filter.date.from = dateFrom;
        filter.date.to = dateTo;

        onChange();
    });

    const noFiltersButton = makeButton("No filters");
    noFiltersButton.el.addEventListener("click", () => {
        const { filter, onChange } = component.args;

        resetActivityFilters(filter);

        onChange();
    });

    const root = div({}, [
        div({ class: "row align-items-center", style: "gap: 30px; padding-bottom: 10px; padding-top: 10px;" }, [
            div({}, ["Presets"]),
            todayButton,
            noFiltersButton
        ]),
        div({ class: "row", style: "padding-bottom: 10px; padding-top: 10px;" }, [
            div({}, [checkboxes.multiDayBreakIncluded]),
            div(),
            div()
        ]),
        div({ class: "row", style: "padding-bottom: 5px" }, [
            div({ style: "width: " + width + "px" }, [checkboxes.dateFromEnabled]),
            dates.from
        ]),
        div({ class: "row", style: "padding-bottom: 5px" }, [
            div({ style: "width: " + width + "px" }, [checkboxes.dateToEnabled]),
            dates.to
        ])
    ]);

    const component = makeComponent<ActivityFiltersEditorArgs>(root, () => {
        const { filter, onChange } = component.args;

        // I have the chance to be the 1000th person to re-invent forms from the ground up rn
        // But I failed...

        for (const nameUntyped in dates) {
            const name = nameUntyped as keyof ActivityFilters["date"];
            const date = dates[name];

            date.render({
                onChange: (val) => { 
                    if(val) {
                        filter.date[name] = val;
                        onChange();
                    }
                },
                value: filter.date[name],
                readOnly: false,
            })
        }

        for (const nameUntyped in checkboxes) {
            const name = nameUntyped as keyof ActivityFilters["is"];
            const checkbox = checkboxes[name];

            checkbox.render({
                onChange: (val) => {
                    filter.is[name] = val;
                    onChange();
                },
                value: filter.is[name],
            });
        }

        setVisible(dates.from, filter.is.dateFromEnabled);
        setVisible(dates.to, filter.is.dateToEnabled);
    });

    return component;
}

type ReadonlyActivityListArgs = {
    activityIndexes: number[];
}

function ReadonlyActivityList(): Renderable<ReadonlyActivityListArgs> {
    type ActivityRowArgs = {
        activity: Activity;
        nextActivity: Activity | undefined;
    }
    
    function ActivityRow(): Renderable<ActivityRowArgs> {
        const text = NoteLink();
        const duration = div();
        const root = div({ class: "row" }, [
            text, 
            duration
        ]);
    
        const component = makeComponent<ActivityRowArgs>(root, () => {
            const { activity, nextActivity } = component.args;

            text.render({
                text: getActivityText(state, activity),
                maxLength: 100,
                noteId: activity.nId,
                preventScroll: false,
                focusAnyway: false,
            });

            const durationMs = getActivityDurationMs(activity, nextActivity);
            setTextContent(duration, formatDuration(durationMs));
        });
    
        return component;
    }

    const pagination: Pagination = { pageSize: 10, start: 0, totalCount: 0 };
    const paginationControl = PaginationControl();
    const activityList = makeComponentList(div(), ActivityRow);
    const root = div({}, [
        paginationControl,
        activityList,
    ])
    const component = makeComponent<ReadonlyActivityListArgs>(root, () => {
        const { activityIndexes } = component.args;

        paginationControl.render({
            pagination,
            totalCount: activityIndexes.length,
            rerender: () => component.render(component.args)
        });

        const start = pagination.start;
        const end = getCurrentEnd(pagination);
        const count = end - start;
        activityList.resize(count);
        for (let i = 0; i < count; i++) {
            const idx =  activityIndexes[
                activityIndexes.length - 1 - i - start
            ];
            const activity = state.activities[idx];
            const nextActivity = state.activities[idx + 1]; 

            activityList.components[i].render({
                activity, 
                nextActivity, 
            });
        }
    });

    return component;
}

function ActivityAnalytics(): Renderable {
    const filteredActivities: Activity[] = [];
    const analytics: Analytics = {
        breaks: newAnalyticsSeries(),
        multiDayBreaks: newAnalyticsSeries(),
        taskTimes: new Map(),
        totalTime: 0,
    };

    const analyticsActivityFilter : ActivityFilters  = {
        date: {
            from: new Date(),
            to: new Date(),
        },
        is: {
            dateFromEnabled: false,
            dateToEnabled: false,
            multiDayBreakIncluded: false,
        }
    }

    const taskColWidth = "250px";
    const durationsListRoot = div({ class: "w-100" }) 
    const analyticsFiltersEditor = ActivityFiltersEditor();

    type DurationListItemArgs = {
        taskName: string;
        timeMs: number;
        totalTimeMs: number;
        setExpandedActivity?(activity: string): void;
        activityListComponent: Renderable<ReadonlyActivityListArgs> | null;
        activityIndices?: number[];
    }

    const activityListInternal = ReadonlyActivityList();
    const activityList = makeComponent<ReadonlyActivityListArgs>(
        div({ style: "padding: 20px;"}, [ activityListInternal ]), () => {
        activityListInternal.render(activityList.args);;
    });

    let expandedActivityName = ""
    function setExpandedActivity(analyticName: string) {
        expandedActivityName = analyticName;

        component.render(undefined);
    }

    const durationsList = makeComponentList(durationsListRoot, () => {
        const taskNameComponent = div({ style: `padding:5px;padding-bottom:0;` })
        const durationBar = FractionBar();
        const expandButton = makeButton(">");

        expandButton.el.addEventListener("click", () => {
            const { setExpandedActivity, activityListComponent: activityList } = component.args;

            if (!setExpandedActivity) {
                return;
            }

            if (activityList) {
                setExpandedActivity("");
            } else {
                setExpandedActivity(component.args.taskName);
            }
        });

        const root = div({ class: "w-100" }, [
            div({ class: "w-100 row align-items-center" }, [
                div({ class: "row", style: `width: ${taskColWidth}` }, [
                    expandButton,
                    taskNameComponent, 
                ]),
                div({ class: "flex-1" }, [ durationBar ])
            ])
        ]);

        const component = makeComponent<DurationListItemArgs>(root, () => {
            const {
                taskName,
                timeMs,
                totalTimeMs,
                setExpandedActivity,
                activityListComponent,
                activityIndices,
            } = component.args;

            setVisible(expandButton, !!setExpandedActivity);

            setTextContent(taskNameComponent, taskName);
            durationBar.render({
                fraction: timeMs / totalTimeMs,
                text: formatDuration(timeMs),
            });

            if (activityListComponent && activityIndices) {
                setVisible(activityListComponent, true);
                root.el.appendChild(activityListComponent.el);

                activityListComponent.render({
                    activityIndexes: activityIndices,
                });
            }
        });

        return component;
    });

    const root = div({ class: "w-100 h-100 col" }, [
        el("H3", {}, [ "Filters" ]),
        analyticsFiltersEditor,
        el("H3", {}, [ "Timings" ]),
        div({ class: "relative", style: "overflow-y: scroll" }, [
            durationsListRoot,
        ]),
    ])

    const component = makeComponent(root, () => {
        analyticsFiltersEditor.render({
            filter: analyticsActivityFilter,
            onChange: () => {
                component.render(component.args);
            }
        });

        filterActivities(filteredActivities, state.activities, analyticsActivityFilter);
        recomputeAnalytics(state, filteredActivities, analytics);

        const total = analyticsActivityFilter.is.multiDayBreakIncluded ? 
            analytics.totalTime :
            analytics.totalTime - analytics.multiDayBreaks.duration;

        durationsList.resize(analytics.taskTimes.size + 3);
        if (setVisible(durationsList.components[0], analyticsActivityFilter.is.multiDayBreakIncluded)) {
            durationsList.components[0].render({
                taskName: "Multi-Day Break Time",
                timeMs: analytics.multiDayBreaks.duration,
                totalTimeMs: total,
                activityListComponent: null,
            });
        }

        durationsList.components[1].render({
            taskName: "Break Time",
            timeMs: analytics.breaks.duration,
            totalTimeMs: total,
            activityListComponent: null,
        });

        durationsList.components[durationsList.components.length - 1].render({
            taskName: "Total time",
            timeMs: total,
            totalTimeMs: total,
            activityListComponent: null,
        });

        let i = 0;
        setVisible(activityList, false);
        for (const [name, series] of analytics.taskTimes) {
            durationsList.components[i + 2].render({
                taskName: name,
                timeMs: series.duration,
                totalTimeMs: total,
                setExpandedActivity,

                activityListComponent: expandedActivityName === name ? activityList : null,
                activityIndices: series.activityIndices,
            });

            i++;
        }

    });

    return component;
}

function AnalyticsModal(): Renderable {
    const activityAnalytics = ActivityAnalytics();
    const modalComponent = Modal(
        div({ class: "col h-100", style: "padding: 10px" }, [
            activityAnalytics
        ])
    );
    
    const component = makeComponent(modalComponent, () => {
        modalComponent.render({ 
            onClose: () => setCurrentModal(null) 
        });

        activityAnalytics.render(undefined);
    });

    return component;
}

function ScratchPadModal(): Renderable {
    const scratchPad = ScratchPad();
    scratchPad.textArea.style.padding = "5px";

    const modalComponent = Modal(scratchPad);

    const component = makeComponent(modalComponent, () => {
        modalComponent.render({
            onClose() {
                setCurrentModal(null);
            }
        });

        scratchPad.render(undefined);

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
    const duration = div();
    const root = div({ class: "row", style: "padding-left: 10px;" }, [ duration ]);

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { note } = component.args;

        const durationMs = getNoteDuration(state, note);
        setTextContent(duration, formatDuration(durationMs));
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

        timestamp.render({ note });
        text.render({ note });
        statistic.render({ note });
    });

    root.el.addEventListener("click", () => {
        const { note } = component.args;

        setCurrentNote(state, note.id);
        rerenderApp();
    });

    return component;
}

type NoteListInternalArgs = {
    flatNotes: NoteId[];
}

function NoteListInternal(): Renderable<NoteListInternalArgs> {
    const root = div({ 
        class: "w-100", 
        style: "border-top: 1px solid var(--fg-color);border-bottom: 1px solid var(--fg-color);" 
    });

    const noteList = makeComponentList(root, NoteRowInput);

    const component = makeComponent<NoteListInternalArgs>(root, () => {
        const { flatNotes } = component.args;

        noteList.resize(flatNotes.length);
        for (let i = 0; i < flatNotes.length; i++) {
            noteList.components[i].render({
                note: getNote(state, flatNotes[i]),
            });
        }
    });

    return component;
}

function NotesList(): Renderable {
    const list1 = NoteListInternal();
    const root = div({}, [ list1 ]);

    const component = makeComponent(root, () => {
        list1.render({ flatNotes: state._flatNoteIds, });
    });

    return component;
}

type TabRowArgs = {
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
        const { name } = component.args;

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
        const { name } = component.args;

        loadTree(name);
    });

    input.el.addEventListener("change", () => {
        renameCurrentTreeName(input.el.value);
    });

    closeBtn.el.addEventListener("click", () => {
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

    const outerComponent = makeComponent(root, () => {
        const names = getAvailableTrees();
        tabsList.resize(names.length);
        for (let i = 0; i < names.length; i++) {
            tabsList.components[i].render({ name: names[i] });
        }
    });

    newButton.el.addEventListener("click", () => {
        newTree();
    })

    return outerComponent;
}


const renderOptions : RenderOptions = {
    shouldScroll: false
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
                ["--unfocus-text-color", "gray"],
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


const handleErrors = (fn: () => void, onError?: (err: any) => void) => {
    try {
        fn();
    } catch (err) {
        console.error(err);
        showStatusText(`${err}`, "#F00", ERROR_TIMEOUT_TIME);
        onError && onError(err);
    }
};

const STATUS_TEXT_PERSIST_TIME = 1000;

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

type RenderOptions = {
    shouldScroll: boolean;
}

const rerenderApp = (opts?: RenderOptions) => {
    // there are actually very few times when we don't want to scroll to the current note
    renderOptions.shouldScroll = opts ? opts.shouldScroll : true;
    app.render(undefined);
}

type Modal = null | "analytics-view" | "scratch-pad";
let currentModal: Modal = null;
const setCurrentModal = (modal: Modal) => {
    if (currentModal === modal) { 
        return;
    }

    state._isEditingFocusedNote = false;
    currentModal = modal;

    rerenderApp({ shouldScroll: true });
}

const initState = () => {
    let savedCurrentTreeName = localStorage.getItem("State.currentTreeName") as string;
    const availableTrees = getAvailableTrees();
    if (!availableTrees.includes(savedCurrentTreeName)) {
        savedCurrentTreeName = availableTrees[0];
    }

    if (!savedCurrentTreeName || availableTrees.length === 0) {
        newTree();
        saveCurrentState();
    } else {
        loadTree(savedCurrentTreeName);
    }
};

export const App = () => {
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
            "Use this note tree to keep track of what you are currently doing, and how long you are spending on each thing." + 
            "NOTE: this help might be out of date, as I am currently updating this quite regularly. Right now I can't make any " + 
            "guarantees that your data will be safe or will still work in the next version of the app (this app is a static page that stores" +
            "all its data on your browser's local storage)"
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

    const notesList = NotesList();
    const activityList = EditableActivityList();
    const breakInput = BreakInput();
    const filters = NoteFilters();
    const treeSelector = TreeTabsRow();
    const todoNotes = TodoList();

    const scratchPadModal = ScratchPadModal();
    const analyticsModal = AnalyticsModal();

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

                resetState();
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
                    breakInput,
                    activityList 
                ])
            ])
        ]),
        fixedButtons,
        scratchPadModal,
        analyticsModal,
    ]);

    // I use this for the ctrl + shift + </> keybinds to move through previous activities
    let lastActivityIndex = 0;
    document.addEventListener("keydown", (e) => {
        // returns true if we need a rerender
        const ctrlPressed = e.ctrlKey || e.metaKey;
        const shiftPressed = e.shiftKey;
        const currentNote = getCurrentNote(state);

        if (
            ctrlPressed && 
            shiftPressed &&
            (e.key === "Shift" || e.key === "Control") &&
            !e.repeat
        ) {
            lastActivityIndex = state.activities.length - 1;
        }

        // handle modals
        if (
            e.key === "S" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            setCurrentModal("scratch-pad");
            return;
        } else if (
            e.key === "A" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            setCurrentModal("analytics-view");
            return;
        } else if (
            currentModal !== null &&
            e.key === "Escape"
        ) {
            setCurrentModal(null);
            return;
        }

        const isEditingSomeText = isEditingTextSomewhereInDocument();

        let shouldPreventDefault = true;
        let needsRerender = true;
        if (
            !state._isEditingFocusedNote &&
            !isEditingSomeText
        ) {
            // handle movements here

            if (e.key === "End" || e.key === "Home") {
                // Do nothing. Ignore the default behaviour of the browser as well.
            } if (ctrlPressed && e.key === "ArrowDown") {
                setCurrentNote(state, getNoteOneDownLocally(state, currentNote));
            } else if (e.key === "ArrowDown") {
                setCurrentNote(state, getOneNoteDown(state, currentNote, true));
            } else if (ctrlPressed && e.key === "ArrowUp") {
                setCurrentNote(state, getNoteOneUpLocally(state, currentNote));
            } else if (e.key === "ArrowUp") {
                setCurrentNote(state, getOneNoteUp(state, currentNote, true));
            } else if (e.key === "ArrowLeft") {
                // The browser can't detect ctrl when it's pressed on its own :((((
                // Otherwise I would have liked for this to just be ctrl
                if (ctrlPressed && shiftPressed) {
                    lastActivityIndex = getPreviousActivityWithNoteIdx(state, lastActivityIndex);
                    if (lastActivityIndex !== -1) {
                        const activity = state.activities[lastActivityIndex];
                        if (activity.nId) {
                            setCurrentNote(state, activity.nId);
                        }
                    }
                } else {
                    setCurrentNote(state, currentNote.parentId)
                }
            } else if (e.key === "ArrowRight") {
                if (ctrlPressed && shiftPressed) {
                    if (ctrlPressed && shiftPressed) {
                        lastActivityIndex = getNextActivityWithNoteIdx(state, lastActivityIndex);
                        if (lastActivityIndex !== -1) {
                            const activity = state.activities[lastActivityIndex];
                            if (activity.nId) {
                                setCurrentNote(state, activity.nId);
                            }
                        }
                    }
                } else {
                    // move into note
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
            } else if (e.key === "PageUp") {
                for (let i = 0; i < 10; i++) {
                    setCurrentNote(state, getOneNoteUp(state, getCurrentNote(state), true));
                }
            } else if (e.key === "PageDown") {
                for (let i = 0; i < 10; i++) {
                    setCurrentNote(state, getOneNoteDown(state, getCurrentNote(state), true));
                }
            } else if (shiftPressed && e.key === "Enter") {
                const newNote = insertChildNode(state);
                if (newNote) {
                    state._isEditingFocusedNote = true;
                }
            } else if (e.key === "Enter") {
                state._isEditingFocusedNote = true;
            } else {
                needsRerender = false;
            }

            if (needsRerender) {
                if (shouldPreventDefault) {
                    e.preventDefault();
                }

                rerenderApp();
            }

            return;
        }


        if (e.key === "Escape") {
            if (isEditingSomeText) {
                state._isEditingFocusedNote = false;
            } else {
                setCurrentModal(null);
                needsRerender = false;
            }
        } else if (
            e.key === "F" &&
            ctrlPressed &&
            shiftPressed
        ) {
            nextFilter(state);
        }  else {
            needsRerender = false;
        }

        if (needsRerender) {
            if (shouldPreventDefault) {
                e.preventDefault();
            }
            rerenderApp();
        }
    });

    const appComponent = makeComponent(appRoot, () => {
        setVisible(noteTreeHelp, showInfo);

        recomputeState(state);

        // rerender the things
        notesList.render(undefined);
        activityList.render(undefined);
        breakInput.render(undefined);
        treeSelector.render(undefined);
        filters.render(undefined);
        todoNotes.render(undefined);

        if (setVisible(analyticsModal, currentModal === "analytics-view")) {
            analyticsModal.render(undefined);
        }

        if (setVisible(scratchPadModal, currentModal === "scratch-pad")) {
            scratchPadModal.render(undefined);
        }
    });

    initState();

    return appComponent;
};

const setCssVars = (vars: [string, string][]) => {
    const cssRoot = document.querySelector(":root") as HTMLElement;
    for (const [k, v] of vars) {
        cssRoot.style.setProperty(k, v);
    }
};

function makeButtonWithCallback(text: string, fn: () => void, classes: string = "") {
    const btn = makeButton(text, classes);
    btn.el.addEventListener("click", fn);
    return btn;
};


let showInfo = false;
let statusTextClearTimeout = 0;
const statusTextIndicator = div({ class: "pre-wrap", style: "background-color: var(--bg-color)" })
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

const loadTree = (name: string) => {
    handleErrors(
        () => {
            loadState(name);
            currentTreeName = name;
        },
        () => {
            // try to fallback to the first available tree.
            const availableTrees = getAvailableTrees();
            loadState(availableTrees[0]);
            currentTreeName = availableTrees[0];

            console.log(availableTrees)
        }
    );
};

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

const renameCurrentTreeName = (newName: string) => {
    let oldName = currentTreeName;
    if (localStorage.getItem(getLocalStorageKeyForTreeName(newName))) {
        throw new Error("That name is already taken.");
    }

    currentTreeName = newName;
    localStorage.removeItem(getLocalStorageKeyForTreeName(oldName));

    saveCurrentState();
};

const debouncedSave = () => {
    saveCurrentState({
        debounced: true
    });
};

function loadState(name: string) {
    const savedStateJSON = localStorage.getItem(STATE_KEY_PREFIX + name);
    if (!savedStateJSON) {
        throw new Error(`Couldn't find ${name}.`);
    }

    loadStateFromJSON(savedStateJSON);
}

function saveState(state: State, name: string) {
    const nonCyclicState = recursiveShallowCopy(state);
    const serialized = JSON.stringify(nonCyclicState);
    localStorage.setItem(getLocalStorageKeyForTreeName(name), serialized);
}

// TODO: move to APP.ts
const SAVE_DEBOUNCE = 1000;
const ERROR_TIMEOUT_TIME = 5000;

let currentTreeName = "";
let saveTimeout = 0;

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

function getLocalStorageKeyForTreeName(name: string) {
    return STATE_KEY_PREFIX + name;
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

const newTree = () => {
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

    resetState();

    currentTreeName = generateUnusedName();
    saveCurrentState();
};
