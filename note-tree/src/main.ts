import "./styles.css"
import "./style-utils.css"

import {
    Activity,
    NoteId,
    STATUS_DONE,
    STATUS_IN_PROGRESS,
    State,
    TreeNote,
    deleteNoteIfEmpty,
    dfsPre,
    getActivityDurationMs,
    getActivityText,
    getCurrentNote,
    getFirstPartOfRow,
    getIndentStr,
    getLastActivity,
    getNextActivityWithNoteIdx,
    getNote,
    getNoteDuration,
    getNoteOneDownLocally,
    getNoteOneUpLocally,
    noteStatusToString,
    getNoteNDown,
    getNoteNUp,
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
    pushActivity,
    pushBreakActivity,
    recomputeFlatNotes,
    recomputeState,
    recursiveShallowCopy,
    resetState,
    setCurrentNote,
    state,
    Analytics,
    newAnalyticsSeries,
    recomputeAnalytics,
    getInnerNoteId,
    STATUS_ASSUMED_DONE,
    isTodoNote,
    getRootNote
} from "./state";
import {
    Renderable,
    makeComponent,
    setClass,
    setInputValue,
    setTextContent,
    setVisible,
    makeComponentList as makeComponentList,
    div,
    el,
    InsertableGeneric,
    isEditingTextSomewhereInDocument,
    appendChild,
    Insertable,
} from "./dom-utils";

import * as tree from "./tree";
import { Checkbox, DateTimeInput, DateTimeInputEx, FractionBar, Modal, makeButton } from "./generic-components";
import { floorDateLocalTime, formatDate, formatDuration, getTimestamp, incrementDay, truncate } from "./datetime";
import { countOccurances } from "./array-utils";


const SAVE_DEBOUNCE = 1000;
const ERROR_TIMEOUT_TIME = 5000;


type NoteLinkArgs = {
    text: string;
    focusAnyway: boolean;
    noteId?: NoteId;
    preventScroll?: boolean;
};

function NoteLink(): Renderable<NoteLinkArgs> {
    const root = div({ style: "padding:5px; word;", class: "handle-long-words" })

    const component = makeComponent<NoteLinkArgs>(root, () => {
        const { text, noteId, focusAnyway } = component.args;

        setClass(root, "hover-link", !!noteId);
        setTextContent(root, truncate(text, 500));
        root.el.style.backgroundColor = (focusAnyway || state.currentNoteId === noteId) ? (
            "var(--bg-color-focus)"
        ) : (
            "var(--bg-color)"
        );
    });

    root.el.addEventListener("click", () => {
        const { noteId, preventScroll, } = component.args;

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
        note: TreeNote;
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
                setTextContent(thing, " " + previousNotesCount + (state.currentNoteId === noteId ? " > " : " - "));
                setTextContent(status, noteStatusToString(note.data._status) ?? "??");
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
            divider = div({ style: "height: 20px" }),
        ]);

        const component = makeComponent<TodoItemArgs>(root, () => {
            const { note, hasDivider } = component.args;

            setVisible(divider, hasDivider);

            moveUpButton.el.setAttribute("title", "Move this note up");

            const nestedNotes: TreeNote[] = [];
            const dfs = (note: TreeNote, nestedNotes: TreeNote[]) => {
                for (const id of note.childIds) {
                    const note = getNote(state, id);

                    if (isTodoNote(note.data)) {
                        continue;
                    }

                    if (note.data._status === STATUS_IN_PROGRESS) {
                        nestedNotes.push(note);
                    }

                    dfs(note, nestedNotes);
                }
            }

            dfs(note, nestedNotes);

            nestedNotesList.resize(nestedNotes.length);
            let focusAnyway = note.id === state.currentNoteId;
            for (let i = 0; i < nestedNotes.length; i++) {
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
            while (
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
        div({ class: "flex-1" }, [breakInput]),
        div({}, [breakButton]),
    ]);

    const component = makeComponent(root, () => {
        const isTakingABreak = isCurrentlyTakingABreak(state);

        setTextContent(breakButton, isTakingABreak ? "Extend break" : "Take a break");
        breakInput.el.setAttribute("placeholder", "Enter break reason (optional)");
    });

    function addBreak() {
        let text = breakInput.el.value || "Taking a break ...";

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
        const timestampWrapper = div({ style: "width: 200px;" }, [timestamp]);
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
            div({ class: "hover-parent", style: "min-height: 10px" }, [
                div({ class: "hover-target" }, [
                    breakInsertRow
                ])
            ]),
            div({ class: "hover-parent" }, [
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
                const durationStr = (isEditable ? "~" : "") + formatDuration(getActivityDurationMs(activity, nextActivity));
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

            const newBreak: Activity = {
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
    const textArea = el<HTMLTextAreaElement>("TEXTAREA", { class: "scratch-pad pre-wrap h-100" });

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

    textArea.el.addEventListener("keydown", () => {
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
    return Math.max(0, idxToPage(pagination, pagination.totalCount - 1));
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
    const pageReadout = div({ style: "width: 100px" });

    const root = div({ style: "border-top: 1px solid var(--fg-color);", class: "row align-items-center" }, [
        pageReadout,
        div({ style: "width: 100px", class: "row" }, [
            leftLeftButton,
            leftButton,
        ]),
        div({ style: "width: 100px", class: "row" }, [
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
        const { pagination, rerender } = component.args;
        setPage(pagination, getPage(pagination) - 1);
        rerender();
    });

    leftLeftButton.el.addEventListener("click", () => {
        const { pagination, rerender } = component.args;
        pagination.start = 0;
        rerender();
    });

    rightRightButton.el.addEventListener("click", () => {
        const { pagination, rerender } = component.args;
        pagination.start = idxToPage(pagination, pagination.totalCount) * pagination.pageSize;
        rerender();
    });


    rightButton.el.addEventListener("click", () => {
        const { pagination, rerender } = component.args;
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
            style: "overflow-y: hidden; margin-left: 10px; padding-left: 10px;border-left: 1px solid var(--fg-color);"
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
        const totalCount = note.childIds.length;
        const doneCount = countOccurances(note.childIds, (id) => {
            const note = getNote(state, id);
            return note.data._status === STATUS_DONE;
        });


        let progressText = "";
        if (totalCount !== 0) {
            if (!(doneCount === 1 && totalCount === 1)) {
                progressText = totalCount !== 0 ? ` (${doneCount}/${totalCount})` : "";
            }
        }

        setTextContent(
            indent,
            `${getIndentStr(note.data)} ${noteStatusToString(note.data._status)}${progressText} ${dashChar} `
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
            insertNoteAfterCurrent(state);
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

function filterActivities(state: State, filter: ActivityFilters, indices: number[]) {
    const activities = state.activities;
    indices.splice(0, indices.length);

    for (let i = 0; i < activities.length; i++) {
        const a = activities[i];
        const aNext: Activity | undefined = activities[i + 1];

        if (activityMatchesFilters(a, aNext, filter)) {
            indices.push(i);
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

function ActivityFiltersEditor(): Renderable<ActivityFiltersEditorArgs> {
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
                    if (val) {
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
        const timestamp = NoteLink();
        const text = NoteLink();
        const duration = div();
        const root = div({ class: "row" }, [
            timestamp,
            text,
            div({ class: "flex-1" }),
            duration
        ]);

        const component = makeComponent<ActivityRowArgs>(root, () => {
            const { activity, nextActivity } = component.args;

            setTextContent(timestamp, formatDate(new Date(activity.t)));

            text.render({
                text: getActivityText(state, activity),
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
            const idx = activityIndexes[
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
    const filteredActivityIndices: number[] = [];
    const analytics: Analytics = {
        breaks: newAnalyticsSeries(),
        multiDayBreaks: newAnalyticsSeries(),
        taskTimes: new Map(),
        totalTime: 0,
    };

    const analyticsActivityFilter: ActivityFilters = {
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
        div({ style: "padding: 20px;" }, [activityListInternal]), () => {
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
        const expandButton = div({ class: "hover", style: "padding: 0.25em;" }, [">"]);

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
                div({ class: "flex-1" }, [durationBar])
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

            if (setVisible(expandButton, !!setExpandedActivity)) {
                setTextContent(expandButton, !!activityListComponent ? "v" : ">");
            }

            setTextContent(taskNameComponent, taskName);
            durationBar.render({
                fraction: timeMs / totalTimeMs,
                text: formatDuration(timeMs),
            });

            if (activityListComponent && activityIndices) {
                setVisible(activityListComponent, true);
                root.el.appendChild(activityListComponent.el);

                activityListComponent.render({
                    activityIndexes: activityIndices
                });
            }
        });

        return component;
    });

    const root = div({ class: "w-100 h-100 col" }, [
        el("H3", {}, ["Filters"]),
        analyticsFiltersEditor,
        el("H3", {}, ["Timings"]),
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

        filterActivities(state, analyticsActivityFilter, filteredActivityIndices);
        recomputeAnalytics(state, filteredActivityIndices, analytics);

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
    const root = div({ class: "row", style: "padding-left: 10px;" }, [duration]);

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { note } = component.args;

        // only doing it for 1 note for now for performance reasons.
        // In future we can use memoisation to make it faster. i.e
        // duration = sum of child durations + duration of this note, if we even care to.

        // if (setVisible(duration, note.id === state.currentNoteId)) {
        const durationMs = getNoteDuration(state, note);
        setTextContent(duration, formatDuration(durationMs));
        // }
    });

    return component;
}

function NoteRowInput(): Renderable<NoteRowArgs> {
    const timestamp = NoteRowTimestamp();
    const text = NoteRowText();
    const statistic = NoteRowStatistic();
    const root = div({ class: "row" }, [timestamp, text, statistic]);

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
    const root = div({}, [list1]);

    const component = makeComponent(root, () => {
        list1.render({ flatNotes: state._flatNoteIds, });
    });

    return component;
}

const renderOptions: RenderOptions = {
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
                ["--unfocus-text-color", "gray"],
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
    button.el.style.fontFamily = "Courier";
    button.el.style.fontWeight = "bold";
    button.el.style.textShadow = "2px 2px 0px var(--fg-color)";

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
    recomputeFlatNotes(state, flatNotes, true);

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

function makeUnorderedList(text: (string | Insertable)[]) {
    return el("UL", {}, text.map(s => el("LI", {}, [s])));
}

function CheatSheet(): Renderable {
    return makeComponent(div({}, [
        el("H3", {}, ["Cheatsheet"]),
        el("H4", {}, ["Movement"]),
        makeUnorderedList([
            `[Enter] to start editing a note`,
            `[Shift] + [Enter] will make a new note under the current note when not editing, or will input new lines when editing`,
            `[Up]/[PageUp]/[Home]/[Ctrl+Up] to move upwards on the same level. ([Down]/[PageDown]/[Home]/[Ctrl+Down] to move downwards, obviously) `,
            `[Left] to move 'out' of a note, or up a level. [Right] to move back 'into' a note, or down a level`,
            `[Alt] + [Any normal movement] to move the current note around the tree`,
            `[Ctrl] + [Shift] + [Left/Right] to move to the previous/next activity in the activity list. 
                Mainly Useful when you want to make some new TODOs real quick, and then go back to what you were working on.`,
        ]),
        el("H4", {}, ["Task statuses"]),
        div({}, [
            `Tasks have 3 statuses:`,
            makeUnorderedList([
                noteStatusToString(STATUS_IN_PROGRESS) + ` - "In Progress" - this note is assumed to be something you're working on`,
                noteStatusToString(STATUS_ASSUMED_DONE) + ` - "Assumed Done" - this note is assumed to be completed. You will see it if you write several entries after one another. All entries before the most recent entry are assumed to be completed.`,
                noteStatusToString(STATUS_DONE) + ` - "Done" - this note has been marked as 'Done' by the user themselves. Any note starting with the text "DONE" or "Done" will get this status, and if this note is also the final note underneath a note, that parent note gets this status as well, unless there are other tasks in progress`,
            ])
        ]),
        el("H4", {}, ["The TODO List"]),
        makeUnorderedList([
            `Notes can be kept In Progress by starting thier text with "TODO" or "Todo". 
            These notes will also get added to the TODO list for quick access from any view.`,
            `Alternatively, you can start a note with "*" to keep it open without creating a TODO entry.`,
            `These notes can also be given priorities using ! and ?. TODO! has a priority of 1, TODO!! has 2, etc. Conversely, TODO? has priority -1, TODO?? -2, etc.`
        ]),
        el("H4", {}, ["The Activity List"]),
        makeUnorderedList([
            `Each time you move to a different note (within over a minute), it gets recorded here`,
            `All times can be edited in case you forget to move to a note for some reason. However, activities can't be inserted or re-ordered.`,
            `You can also append breaks here by clicking "Take a break". Breaks are used to prevent time from contributing towards duration calculations.`,
            `If you mouse-over breaks, you will be given the option to insert breaks between two activities. This break can be edited, or removed later, and is typically what you would use to retroactively delete time from duration calculations if you forgot to add the break at the time.`,
        ]),
        el("H4", {}, ["Analytics"]),
        makeUnorderedList([
            `The analytics view can be opened by clicking the "Analytics" button, or with [Ctrl] + [Shift] + [A]`,
            `The analytics modal is where you see how long you've spent on particular high level tasks. It's supposed to be useful when you need to fill out time-sheets, (and to see where all your time went).`,
            `By default all notes will appear under "<Uncategorized>"`,
            `If you add the text "[Task=Task name here]" to any of your notes, then that note, as well as all notes under it, will get grouped into a task called 'Task name here', and the aggregated time will be displayed. Notes can only have 1 task at a time, so if a parent note specifies a different task, you will be overriding it. I am open to changing this behaviour in the future if I think of a better system.`
        ]),
        el("H4", {}, ["Scratchpad"]),
        makeUnorderedList([
            `The scratchpad can be opened by clicking the "Scratchpad" button, or with [Ctrl] + [Shift] + [S]`,
            `The scratchpad was originally used for a lot more, but it has since been replaced by the activity list and the TODO list. However, it is still somewhat important`,
            `You can copy a JSON file containing all of your data to your system clipboard by clicking "Copy as JSON". 
            (Right now, this data is stored in your browser's local storage, which is actually somewhat volatile. 
            If Github decide to change their URL, or I decide to change my GitHub user handle, the page's address will have changed, and all your data will be lost. 
            However, I would rather not make a SAAS product requiring you to log in to my server, because it removes a lot of agency from the user, and I would need to start charging you money to use my product. 
            I would recommend saving this page to your computer as a static page, and running it from there.
            It will work without an internet connection, just like any other HTML document.
            If there is demand for it then I may make a self-hostable solution in the future.)`,
            `Once you have clicked "Copy as JSON", you can save that JSON somewhere. And then if you are on another computer, you will need to paste your JSON into the scratch pad, and click "Load JSON from scratchpad" to transfer across your data.`
        ]),
    ]), () => { });
}

// function Help(): Renderable {
//     let idx = 0;

//     const title = el("h3", {}, [ "How do I use this web app?" ]);
//     const helpText = el("p", {});
//     const doneButton = makeButton("Next");
//     const backButton = makeButton("Go back");
//     const componentInsertPoint = div();
//     const noteTreeHelp = div({}, [
//         title,
//         helpText,
//         div({ class: "row justify-content-center"}, [
//             backButton,
//             doneButton, 
//         ]),
//         componentInsertPoint,
//     ]);


//     const component = makeComponent(noteTreeHelp, () => {
//         setTextContent(title, helpItems[idx].title);
//         setTextContent(helpText, helpItems[idx].text);

//         const component = helpItems[idx].component;
//         replaceChildren(componentInsertPoint, component);

//         setVisible(backButton, idx > 0);
//         setVisible(doneButton, idx < helpItems.length - 1);
//     });

//     doneButton.el.addEventListener("click", () => {
//         idx++;
//         if (idx >= helpItems.length) {
//             idx = helpItems.length - 1;
//         }

//         component.render(component.args);
//     });

//     backButton.el.addEventListener("click", () => {
//         idx--;
//         if (idx < 0) {
//             idx = 0;
//         }

//         component.render(component.args);
//     });

//     return component;
// }

// I used to have tabs, but I literally never used then, so I've just removed those components.
// However, "Everything" is the name of my current note tree, so that is just what I've hardcoded here.
// The main benefit of having just a single tree (apart from simplicity and less code) is that
// You can track all your activities and see analytics for all of them in one place. 
const STATE_KEY = "NoteTree.Everything";
const initState = () => {
    loadState();
};

export const App = () => {
    // const infoButton = el("BUTTON", { class: "info-button", title: "click for help, with developer commentary" }, [
    //     "help?"
    // ]);
    const infoButton2 = el("BUTTON", { class: "info-button", title: "click for a list of keyboard shortcuts and functionality" }, [
        "cheatsheet?"
    ]);
    let currentHelpInfo = 1;
    // infoButton.el.addEventListener("click", () => {
    //     currentHelpInfo = currentHelpInfo !== 1 ? 1 : 0;
    //     rerenderApp();
    // });
    infoButton2.el.addEventListener("click", () => {
        currentHelpInfo = currentHelpInfo !== 2 ? 2 : 0;
        rerenderApp();
    });

    // const help = Help();
    const cheatSheet = CheatSheet();
    const notesList = NotesList();
    const activityList = EditableActivityList();
    const breakInput = BreakInput();
    const todoNotes = TodoList();

    const scratchPadModal = ScratchPadModal();
    const analyticsModal = AnalyticsModal();

    const fixedButtons = div({ class: "fixed row align-items-end", style: "bottom: 5px; right: 5px; left: 5px; gap: 5px;" }, [
        div({}, [makeDarkModeToggle()]),
        div({ class: "flex-1" }),
        div({}, [statusTextIndicator]),
        div({ class: "flex-1" }),
        div({ class: "row" }, [
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
        div({ class: "row" }, [
            div({ class: "flex-1" }, [
                // help,
                cheatSheet,
                el("H2", {}, ["Currently working on"]),
            ]),
            div({}, [
                // infoButton, 
                infoButton2
            ]),
        ]),
        notesList,
        div({ class: "row", style: "gap: 10px" }, [
            div({ style: "flex:1; padding-top: 20px" }, [
                div({}, [
                    el("H3", {}, ["TODO Notes"]),
                    todoNotes
                ])
            ]),
            div({ style: "flex:1; padding-top: 20px" }, [
                div({}, [
                    el("H3", {}, ["Activity List"]),
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

            function handleUpDownMovement(nextNoteId: NoteId | null) {
                if (!nextNoteId) {
                    return;
                }

                if (!e.altKey) {
                    setCurrentNote(state, nextNoteId);
                    return;
                } 

                const nextNote = getNote(state, nextNoteId);
                if (
                    currentNote.parentId &&
                    currentNote.parentId === nextNote.parentId
                ) {
                    const parent = getNote(state, currentNote.parentId);
                    const siblings = parent.childIds;
                    const idxNext = siblings.indexOf(nextNote.id);
                    tree.insertAt(state.notes, parent, currentNote, idxNext);
                    debouncedSave();
                }
            }

            function handleMovingOut(nextNoteId: NoteId | null) {
                if (!nextNoteId) {
                    return;
                }

                if (!e.altKey) {
                    setCurrentNote(state, nextNoteId);
                    return;
                } 

                const nextNote = getNote(state, nextNoteId);
                tree.addAfter(state.notes, nextNote, currentNote);
                debouncedSave();
            }

            function handleMovingIn() {
                if (!e.altKey) {
                    // move into the current note
                    setCurrentNote(state, getInnerNoteId(currentNote));
                    return;
                } 

                if (!currentNote.parentId) {
                    return;
                }

                // move this note into the note above it
                const siblings = getNote(state, currentNote.parentId).childIds;
                const idx = siblings.indexOf(currentNote.id);
                if (idx === 0) {
                    return;
                }

                const upperNote = getNote(state, siblings[idx - 1]);
                if (upperNote.childIds.length === 0) {
                    tree.addUnder(state.notes, upperNote, currentNote);
                    debouncedSave();
                    return;
                } 

                const noteInsideUpperNoteId = getInnerNoteId(upperNote);
                if (noteInsideUpperNoteId) {
                    const noteInsideUpperNote = getNote(state, noteInsideUpperNoteId);
                    tree.addAfter(state.notes, noteInsideUpperNote, currentNote)
                    debouncedSave();
                    return;
                }
            }

            if (e.key === "End" || e.key === "Home") {
                // Do nothing. Ignore the default behaviour of the browser as well.
            } if (e.key === "ArrowDown") {
                if (ctrlPressed) {
                    handleUpDownMovement(getNoteOneDownLocally(state, currentNote));
                } else {
                    handleUpDownMovement(getNoteNDown(state, currentNote, true));
                }
            } else if (e.key === "ArrowUp") {
                if (ctrlPressed) {
                    handleUpDownMovement(getNoteOneUpLocally(state, currentNote));
                } else {
                    handleUpDownMovement(getNoteNUp(state, currentNote, true));
                }
            } else if (e.key === "PageUp") {
                handleUpDownMovement(getNoteNUp(state, currentNote, true, 10));
            } else if (currentNote.parentId && e.key === "PageDown") {
                handleUpDownMovement(getNoteNDown(state, currentNote, true, 10));
            } else if (currentNote.parentId && e.key === "End") {
                const parent = getNote(state, currentNote.parentId);
                const siblings = parent.childIds;
                handleUpDownMovement(siblings[siblings.length - 1] || null);
            } else if (currentNote.parentId && e.key === "Home") {
                const parent = getNote(state, currentNote.parentId);
                const siblings = parent.childIds;
                handleUpDownMovement(siblings[0] || null);
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
                    handleMovingOut(currentNote.parentId)
                }
            } else if (e.key === "ArrowRight") {
                if (ctrlPressed && shiftPressed) {
                    lastActivityIndex = getNextActivityWithNoteIdx(state, lastActivityIndex);
                    if (lastActivityIndex !== -1) {
                        const activity = state.activities[lastActivityIndex];
                        if (activity.nId) {
                            handleMovingOut(activity.nId);
                        }
                    }
                } else {
                    // move into note
                    handleMovingIn();
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

    const appComponent = makeComponent(appRoot, () => {
        // if (setVisible(help, showHelpInfo === 1)) {
        //     help.render(undefined);
        // }

        if (setVisible(cheatSheet, currentHelpInfo === 2)) {
            cheatSheet.render(undefined);
        }

        recomputeState(state);

        // rerender the things
        notesList.render(undefined);
        activityList.render(undefined);
        breakInput.render(undefined);
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

const saveCurrentState = ({ debounced } = { debounced: false }) => {
    // user can switch to a different note mid-debounce, so we need to save
    // these here before the debounce

    const thisState = state;

    const save = () => {
        // save current note
        saveState(thisState);

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

const debouncedSave = () => {
    saveCurrentState({
        debounced: true
    });
};

function loadState() {
    const savedStateJSON = localStorage.getItem(STATE_KEY);
    if (!savedStateJSON) {
        return;
    }

    loadStateFromJSON(savedStateJSON);
}


let saveTimeout = 0;
function saveState(state: State) {
    const nonCyclicState = recursiveShallowCopy(state);
    const serialized = JSON.stringify(nonCyclicState);
    localStorage.setItem(STATE_KEY, serialized);
}



// Entry point
const root: Insertable = {
    el: document.getElementById("app")!
};

const app = App();
appendChild(root, app);

app.render(undefined);
