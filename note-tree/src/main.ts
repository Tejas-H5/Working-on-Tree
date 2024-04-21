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
    getActivityDurationMs,
    getActivityText,
    getCurrentNote,
    getFirstPartOfRow,
    getIndentStr,
    getNote,
    getNoteDuration,
    getNoteOneDownLocally,
    getNoteOneUpLocally,
    noteStatusToString,
    getNoteNDown,
    getNoteNUp,
    getSecondPartOfRow,
    getTimeStr,
    getTodoNotePriority,
    insertChildNode,
    insertNoteAfterCurrent,
    isCurrentlyTakingABreak,
    isEditableBreak,
    loadStateFromJSON,
    moveNotePriorityIntoPriorityGroup,
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
    recomputeNoteTasks,
    getInnerNoteId,
    STATUS_ASSUMED_DONE,
    isTodoNote,
    dfsPre,
    getRootNote,
    setIsEditingCurrentNote,
    getActivityTextOrUndefined,
    isBreak,
    isMultiDay,
    pushActivity,
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
    replaceChildren,
    buildEl,
} from "./dom-utils";

import * as tree from "./tree";
import { Checkbox, DateTimeInput, DateTimeInputEx, FractionBar, Modal, TextField, makeButton } from "./generic-components";
import { addDays, floorDateLocalTime, formatDate, formatDuration, getTimestamp, parseDateSafe, truncate } from "./datetime";
import { countOccurances, filterInPlace } from "./array-utils";
import { Range, fuzzyFind, scoreFuzzyFind } from "./fuzzyfind";


const SAVE_DEBOUNCE = 1000;
const ERROR_TIMEOUT_TIME = 5000;


type NoteLinkArgs = {
    text: string;
    focusAnyway?: boolean;
    noteId?: NoteId;
    preventScroll?: boolean;
};

function NoteLink(): Renderable<NoteLinkArgs> {
    const root = div({ style: "padding:5px; word;", class: "handle-long-words" })

    const component = makeComponent<NoteLinkArgs>(root, () => {
        const { text, noteId, focusAnyway } = component.args;

        setClass(root, "hover-link", !!noteId);
        setTextContent(root, truncate(text, 500));
        root.el.style.backgroundColor = (!!focusAnyway || state.currentNoteId === noteId) ? (
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
            }

            const component = makeComponent<NestedNotesArgs>(root, () => {
                const { linkedNoteArgs } = component.args;
                const { noteId } = linkedNoteArgs;

                const note = getNote(state, noteId);
                const progressText = getNoteProgressCountText(note);

                link.render(linkedNoteArgs);
                // questionable whitespace practice tbh
                setTextContent(thing, " " + progressText + " " + (state.currentNoteId === noteId ? " > " : " - "));
                setTextContent(status, noteStatusToString(note.data._status) ?? "??");
            });

            return component;
        });

        let progressText, noteLink, moveUpButton, moveDownButton, divider;
        const root = div({}, [
            div({
                class: "hover-parent flex-1",
                style: "border-top: 1px solid var(--fg-color);" +
                    "border-left: 4px solid var(--fg-color);" +
                    "border-bottom: 1px solid var(--fg-color);" +
                    "padding-left: 3px;"
            }, [
                div({ class: "row align-items-center" }, [
                    progressText = div(),
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

                nestedNotesList.components[i].render({
                    linkedNoteArgs: {
                        noteId: note.id,
                        text: note.data.text,
                        focusAnyway: false,
                        preventScroll: true,
                    },
                });
            }

            setTextContent(progressText, getNoteProgressCountText(note));

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
        div({ style: "height: 600px; overflow-y: auto;" }, [
            listRoot,
        ]),
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

            // HTML text area doesn't like tabs, we need this additional code to be able to insert tabs.
            // inserting a tab like this should also preserve undo, unlike value setting approaches
            // TODO: stop using deprecated API 
            //      (I doubt it will be a problem though - I bet most browsers will support this for a long while, else risk breaking a LOT of websites)
            document.execCommand("insertText", false, "\t");
        }
    })

    return textArea;
}

// exposing the textArea so that we can focus it, but
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


function getNoteProgressCountText(note: TreeNote): string {
    const totalCount = note.childIds.length;
    const doneCount = countOccurances(note.childIds, (id) => {
        const note = getNote(state, id);
        return note.data._status === STATUS_DONE || note.data._status === STATUS_ASSUMED_DONE;
    });


    let progressText = "";
    if (totalCount !== 0) {
        if (!(doneCount === 1 && totalCount === 1)) {
            progressText = totalCount !== 0 ? ` (${doneCount}/${totalCount})` : "";
        }
    }

    return progressText;
}

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

        const dashChar = note.data._isSelected ? "-" : "-";
        const progressText = getNoteProgressCountText(note);

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
                        // With the note tree it's much more important for me to see what I've done, as below that isn't very important. 
                        top: wantedY - (3 * window.innerHeight / 4),
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

        // Perform a partial update on the state, to just the thing we're editing

        if (state.todoNoteIds.includes(note.id)) {
            moveNotePriorityIntoPriorityGroup(state, note.id);
        }

        onRerenderWhenEditing();

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



function activityMatchesFilters(
    state: State,
    activity: Activity,
    nextActivity: Activity | undefined,
    filter: ActivityFilters,
): boolean {
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

    if (
        filter.is.noMultiDayBreaks &&
        (isBreak(activity) && isMultiDay(activity, nextActivity))
    ) {
        return false;
    }

    // Fuzzy finding is actually very expensive, try to keep this as the last filter we do,
    // so it runs on the least number of notes.
    if (filter.text.query) {
        const noteText = getActivityTextOrUndefined(state, activity);
        if (!noteText) {
            return false;
        }

        const ranges = fuzzyFind(noteText, filter.text.query);
        const score = scoreFuzzyFind(ranges);
        if (score < getMinFuzzyFindScore(filter.text.query, true)) {
            return false;
        }
    }

    return true;
}

function filterActivities(state: State, filter: ActivityFilters, indices: number[]) {
    const activities = state.activities;
    indices.splice(0, indices.length);

    for (let i = 0; i < activities.length; i++) {
        const a = activities[i];
        const aNext: Activity | undefined = activities[i + 1];

        if (activityMatchesFilters(state, a, aNext, filter)) {
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
        noMultiDayBreaks: boolean;
    },
    text: {
        query: string;
    },
}

function resetActivityFilters(filters: ActivityFilters) {
    filters.date.from = new Date();
    filters.date.to = new Date();
    filters.is.dateFromEnabled = false;
    filters.is.dateToEnabled = false;
    filters.is.noMultiDayBreaks = true;

    // nah don't reset the query
    // filters.text.query = "";
}

type ActivityFiltersEditorArgs = {
    filter: ActivityFilters;
    onChange(): void;
}

function ActivityFiltersEditor(): Renderable<ActivityFiltersEditorArgs> {
    const dates = {
        from: DateTimeInputEx(),
        to: DateTimeInputEx(),
    } as const;

    const checkboxes = {
        dateFromEnabled: Checkbox("Date from"),
        dateToEnabled: Checkbox("Date to"),
        noMultiDayBreaks: Checkbox("No multi-day breaks"),
    } as const;

    const textFields = {
        query: buildEl(TextField("Search"), { class: " w-100" })
    } as const;

    const todayButton = makeButton("Today");
    todayButton.el.addEventListener("click", () => {
        const { filter, onChange } = component.args;

        filter.is.dateFromEnabled = true;
        filter.is.dateToEnabled = true;

        const dateFrom = new Date();
        const dateTo = new Date();
        floorDateLocalTime(dateFrom);
        floorDateLocalTime(dateTo);
        addDays(dateTo, 1);
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


    const root = div({ class: "col", style: "gap: 10px" }, [
        textFields.query,
        div({
            class: "row align-items-center",
            style: "gap: 10px; padding-bottom: 10px; padding-top: 10px;"
        }, [
            div({}, ["Presets"]),
            todayButton,
            noFiltersButton
        ]),
        checkboxes.noMultiDayBreaks,
        div({ class: "row" }, [
            checkboxes.dateFromEnabled,
            div({ class: "flex-1" }),
            dates.from,
        ]),
        div({ class: "row" }, [
            checkboxes.dateToEnabled,
            div({ class: "flex-1" }),
            dates.to,
        ]),
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

        for (const nameUntyped in textFields) {
            const name = nameUntyped as keyof ActivityFilters["text"];
            const textField = textFields[name];
            textField.render({
                value: filter.text[name],
                onChange: (val) => {
                    filter.text[name] = val;
                    onChange();
                }
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

    const pagination: Pagination = { pageSize: 50, start: 0, totalCount: 0 };
    const paginationControl = PaginationControl();
    const activityListContainer = div({ class: "flex-1", style: "overflow-y: auto" });
    const activityList = makeComponentList(activityListContainer, ActivityRow);
    const root = div({ class: "col h-100", style: "min-height: 0" }, [
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
        text: {
            query: "",
        },
        date: {
            from: new Date(),
            to: new Date(),
        },
        is: {
            dateFromEnabled: false,
            dateToEnabled: false,
            noMultiDayBreaks: true
        },
    };

    function renderLocal() {
        component.render(component.args);
    }


    let activityIndiciesGetter: (() => number[]) | undefined = undefined;
    let activityIndicesName: string | undefined = undefined;
    function setActivityIndices(name: string | undefined, indicesGetter: (() => number[]) | undefined) {
        activityIndiciesGetter = indicesGetter;
        activityIndicesName = name;
        renderLocal();
    }

    function setExpandedActivity(taskName: string) {
        setActivityIndices(`[Task=${taskName}]`, () => {
            const series = analytics.taskTimes.get(taskName);
            if (!series) {
                return [];
            }

            return series.activityIndices;
        });
    }

    const taskColWidth = "250px";
    const durationsListRoot = div({ class: "w-100" })
    const analyticsFiltersEditor = ActivityFiltersEditor();

    type DurationListItemArgs = {
        taskName: string;
        setExpandedTask(activity: string): void;
        timeMs: number;
        totalTimeMs: number;
        activityIndices?: number[];
    }

    const roActivityList = ReadonlyActivityList();
    const durationsList = makeComponentList(durationsListRoot, () => {
        const taskNameComponent = div({ style: `padding:5px;padding-bottom:0;` })
        const durationBar = FractionBar();

        const root = div({ class: "w-100 hover" }, [
            div({ class: "w-100 row align-items-center" }, [
                div({ class: "row", style: `width: ${taskColWidth}` }, [
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
            } = component.args;

            if (setVisible(root, timeMs > 0)) {
                setTextContent(taskNameComponent, taskName);
                durationBar.render({
                    fraction: timeMs / totalTimeMs,
                    text: formatDuration(timeMs),
                });
            }
        });

        root.el.addEventListener("click", () => {
            const { taskName, setExpandedTask } = component.args;
            setExpandedTask(taskName);
        });

        return component;
    });

    const activityListTitle = el("H3", {}, []);
    const root = div({ class: "w-100 h-100 row" }, [
        div({ class: "flex-1 col" }, [
            el("H3", {}, ["Filters"]),
            analyticsFiltersEditor,
            el("H3", {}, ["Timings"]),
            div({ class: "relative flex-1", style: "overflow-y: scroll" }, [
                durationsListRoot,
            ]),
        ]),
        div({ class: "flex-1 col" }, [
            activityListTitle,
            roActivityList,
        ]),
    ]);

    const component = makeComponent(root, () => {
        analyticsFiltersEditor.render({
            filter: analyticsActivityFilter,
            onChange: () => {
                component.render(component.args);
            }
        });

        recomputeNoteTasks(state);
        filterActivities(state, analyticsActivityFilter, filteredActivityIndices);
        recomputeAnalytics(state, filteredActivityIndices, analytics);

        setTextContent(activityListTitle, "Activities - " + (activityIndicesName || "All"));
        roActivityList.render({
            activityIndexes: activityIndiciesGetter ? activityIndiciesGetter() : filteredActivityIndices,
        });

        const total = analytics.totalTime;

        durationsList.resize(analytics.taskTimes.size + 3);

        durationsList.components[0].render({
            taskName: "Total Time",
            setExpandedTask: () => setActivityIndices(undefined, undefined),
            timeMs: total,
            totalTimeMs: total,
        });

        durationsList.components[1].render({
            taskName: "Multi-Day Break Time",
            setExpandedTask: () => setActivityIndices("Multi-Day Break Time", () => analytics.multiDayBreaks.activityIndices),
            timeMs: analytics.multiDayBreaks.duration,
            totalTimeMs: total,
        });

        durationsList.components[2].render({
            taskName: "Break Time",
            setExpandedTask: () => setActivityIndices("Break Time", () => analytics.breaks.activityIndices),
            timeMs: analytics.breaks.duration,
            totalTimeMs: total,
        });

        let i = 0;
        for (const [name, series] of analytics.taskTimes) {
            durationsList.components[i + 3].render({
                taskName: name,
                setExpandedTask: setExpandedActivity,
                timeMs: series.duration,
                totalTimeMs: total,
            });

            i++;
        }
    });

    return component;
}

// yep, doesnt need any info about the matches, total count, etc.
// Although, I do wonder if this is the right place for it. 
// This only works because I know the implementation of the fuzzy find scoring algo, since I wrote it
function getMinFuzzyFindScore(query: string, strict = false) {
    if (!strict) {
        return Math.pow(query.length * 0.3, 2);
    }

    return Math.pow(query.length * 0.7, 2);
}


function FuzzyFinder(): Renderable {
    const searchInput = el<HTMLInputElement>("INPUT", { class: "w-100" });
    type ResultArgs = {
        text: string;
        ranges: Range[];
        hasFocus: boolean;
    }

    const resultList = makeComponentList(div({ class: "h-100" }), () => {
        const textDiv = div();
        const cursor = div({ class: "pre" }, [" --> "]);
        const root = div({ class: "row" }, [
            cursor,
            textDiv,
        ]);
        let lastRanges: any = null;
        const component = makeComponent<ResultArgs>(root, () => {
            const { text, ranges, hasFocus } = component.args;

            // This is basically the same as the React code, to render a diff list, actually, useMemo and all
            if (ranges !== lastRanges) {
                lastRanges = ranges;

                const spans: Insertable[] = [];
                let lastRangeEnd = 0;
                for (let i = 0; i < ranges.length; i++) {
                    spans.push(el("SPAN", {}, [text.substring(lastRangeEnd, ranges[i][0])]));
                    spans.push(el("SPAN", { class: "inverted" }, [text.substring(ranges[i][0], ranges[i][1])]));
                    lastRangeEnd = ranges[i][1];
                }
                spans.push(el("SPAN", {}, [text.substring(lastRangeEnd)]));

                replaceChildren(textDiv, ...spans);
            }

            setVisible(cursor, hasFocus);
            root.el.style.backgroundColor = hasFocus ? "var(--bg-color-focus)" : "var(--bg-color)";
            root.el.style.padding = hasFocus ? "10px" : "";
        });

        return component;
    });

    type Match = {
        note: TreeNote;
        ranges: Range[];
        score: number;
    };
    const matches: Match[] = [];
    let currentSelectionIdx = 0;

    const root = div({ class: "col" }, [
        div({ class: "row align-items-center" }, [
            div({ style: "padding: 10px" }, ["Search:"]),
            searchInput,
        ]),
        div({ style: "height: 10px" }),
        div({ class: "flex-1" }, [
            resultList
        ]),
    ]);

    let timeoutId = 0;
    const DEBOUNCE_MS = 100;
    function rerenderSearch() {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            matches.splice(0, matches.length);

            const query = searchInput.el.value.toLowerCase();

            dfsPre(state, getRootNote(state), (n) => {
                if (!n.parentId) {
                    // ignore the root note
                    return;
                }
                let text = n.data.text.toLowerCase();
                let results = fuzzyFind(text, query);
                if (results.length > 0) {
                    matches.push({
                        note: n,
                        ranges: results,
                        score: scoreFuzzyFind(results),
                    });
                }
            });

            matches.sort((a, b) => {
                return b.score - a.score;
            });

            const minScore = getMinFuzzyFindScore(query);
            filterInPlace(matches, (m) => m.score > minScore);

            // console.log(matches.map(m => [scoreFuzzyFind(m.ranges), m.note.data.text]))

            const MAX_MATCHES = 20;
            if (matches.length > MAX_MATCHES) {
                matches.splice(MAX_MATCHES, matches.length - MAX_MATCHES);
            }

            if (currentSelectionIdx >= matches.length) {
                currentSelectionIdx = 0;
            }

            resultList.resize(matches.length);
            for (let i = 0; i < matches.length; i++) {
                resultList.components[i].render({
                    text: matches[i].note.data.text,
                    ranges: matches[i].ranges,
                    hasFocus: i === currentSelectionIdx,
                });
            }
        }, DEBOUNCE_MS);
    }

    function rerenderList() {
        for (let i = 0; i < matches.length; i++) {
            const c = resultList.components[i];
            c.args.hasFocus = i === currentSelectionIdx;
            c.render(c.args);
        }
    }


    const component = makeComponent(root, () => {
        searchInput.el.focus();
        rerenderSearch();
    });

    searchInput.el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const note = matches[currentSelectionIdx].note;
            setCurrentNote(state, note.id);
            setCurrentModal(null);
            rerenderApp();
            return;
        }

        let handled = true;

        // NOTE: no home, end, we need that for the search input
        if (e.key === "ArrowDown") {
            currentSelectionIdx++;
        } else if (e.key === "PageDown") {
            currentSelectionIdx += 10;
        } else if (e.key === "ArrowUp") {
            currentSelectionIdx--;
        } else if (e.key === "PageUp") {
            currentSelectionIdx -= 10;
        } else {
            handled = false;
        }

        if (handled) {
            e.preventDefault();
            currentSelectionIdx = Math.max(0, currentSelectionIdx);
            currentSelectionIdx = Math.min(currentSelectionIdx, matches.length - 1);
            rerenderList();
        }
    });
    searchInput.el.addEventListener("input", rerenderSearch);

    return component;
}

function FuzzyFindModal(): Renderable {
    const fuzzyFind = FuzzyFinder();
    const modalComponent = Modal(
        div({ class: "col h-100", style: "padding: 10px" }, [
            fuzzyFind
        ])
    );

    const component = makeComponent(modalComponent, () => {
        modalComponent.render({
            onClose: () => setCurrentModal(null)
        });

        fuzzyFind.render(undefined);
    });

    return component;
}

function AnalyticsModal(): Renderable {
    const activityAnalytics = ActivityAnalytics();
    const modalComponent = Modal(
        div({ class: "col", style: "width: calc(100% - 20px); height: calc(100% - 20px); padding: 10px;" }, [
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
    // const workdayDuration = div();
    const duration = div();
    const root = div({ class: "row", style: "padding-left: 10px; gap: 10px;" }, [
        duration,
        // div({ style: "background-color: var(--fg-color); width: 4px;"}),
        // workdayDuration,
    ]);

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { note } = component.args;

        // only doing it for 1 note for now for performance reasons.
        // In future we can use memoisation to make it faster. i.e
        // duration = sum of child durations + duration of this note, if we even care to.
        const durationMs = getNoteDuration(state, note);
        setTextContent(duration, formatDuration(durationMs, 2));
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

function exportAsText(state: State, flatNotes: NoteId[]) {
    const header = (text: string) => `----------------${text}----------------`;

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

type Modal = null | "analytics-view" | "scratch-pad" | "fuzzy-finder";
let currentModal: Modal = null;
const setCurrentModal = (modal: Modal) => {
    if (currentModal === modal) {
        return;
    }

    setIsEditingCurrentNote(state, false);

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
            `[Enter]: start editing the current note (when not editing), or create a new note under the current note (when editing)`,
            `[Shift] + [Enter]: create a new note 1 level below the current note (when not editing), or insert new lines (when editing)`,
            `[Up]/[PageUp]/[Home]/[Ctrl+Up] and [Down]/[PageDown]/[Home]/[Ctrl+Down]: Move upwards or downards on the same level (when not editing)`,
            `[Left]: Move up 1 level 'out of' the note (when not editing)`,
            `[Right]: Move down 1 level 'into' the note (when not editing)`,
            `[Alt] + [Previous movement keys]: Grab and move the current note around the tree to where you would have otherwise moved`,
            `[Ctrl] + [Shift] + [Left/Right]: to move backwards/forwards to the previous task-list you were working on. Doesn't work with [Alt]`,
        ]),
        el("H4", {}, ["Note/Task statuses"]),
        el("P", {}, ["NOTE: I will refer to a 'note' and a 'task' somewhat interchangeably"]),
        makeUnorderedList([
            noteStatusToString(STATUS_IN_PROGRESS) + `: This note is currently in progress`,
            noteStatusToString(STATUS_ASSUMED_DONE) + `: This note is assumed to be done`,
            noteStatusToString(STATUS_DONE) + `: This note is done according to the user`,
        ]),
        el("H4", {}, ["Completing tasks, and keeping tasks in progress"]),
        el("P", {}, ["Notes can be started with a specific text in order to affect their status:"]),
        makeUnorderedList([
            `TODO, Todo, todo: Keeps this note's status in progress, and places it into the Todo list, which you can use to see all your open tasks at a glance. You can use !! or ?? to increase or decrease the priority group of a TODO note. For example, TODO! has a priority of 1, TODO!! has a priority of 2, TODO? has a priority of -1, etc.`,
            `DONE, Done, done, DECLINED, MERGED: Marks a single note (and all notes assumed to be done before it) as DONE. If all notes under a note are DONE or assumed done, the note itself becomes DONE.`,
            `>: Keeps this note's status in progress, without placing it into the TODO list. I'm still not sure if this is very useful to be honest`,
        ]),
        el("H4", {}, ["The Activity List"]),
        makeUnorderedList([
            `Each time you start editing a note, the current time and the note ID gets recorded in this list`,
            `The time between this activity and the next activity will contribute towards the overal 'duration' of a note, and all of it's parent notes.`,
            `You can add or insert breaks to prevent some time from contributing towards the duration of a particular note`,
            `The only reason breaks exist is to 'delete' time from duration calculations (at least, as far as this program is concerned)`,
            `Breaks will also insert themselves automatically, if you've closed the tab or closed your laptop or something similar for over ${(CHECK_INTERVAL_MS / 1000).toFixed(2)} seconds.
            I introduced this feature because I kept forgetting to add breaks, and often had to guess when I took the break. 
            It works by running some code in a timer every 10 seconds, and if it detects that actually, a lot more than 10 seconds has elapsed, it's probably because the tab got closed, or the computer got put to sleep. 
            It is a bit of a hack, and I'm not sure that it works in all cases. Just know that this program can automatically insert breaks sometimes`,
        ]),
        el("H4", {}, ["Analytics"]),
        makeUnorderedList([
            `The analytics view can be opened by clicking the "Analytics" button, or with [Ctrl] + [Shift] + [A]`,
            `The analytics modal is where you see how long you've spent on particular high level tasks. It's supposed to be useful when you need to fill out time-sheets, (and to see where all your time went).`,
            `By default all notes will appear under "<Uncategorized>"`,
            `If you add the text "[Task=Task name here]" to any of your notes, then that note, as well as all notes under it, will get grouped into a task called 'Task name here', and the aggregated time will be displayed. 
            Notes can only have 1 task at a time, so if a parent note specifies a different task, you will be overriding it.
            This is useful for when the organisation of your tasks doesn't match the organisation of the higher level tasks, like a Jira board or something`
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

function getNextActivityInDirection(state: State, idx: number, backwards: boolean): number {
    const currentNote = getCurrentNote(state);
    const currentParentId = currentNote.parentId;

    const activities = state.activities;
    const direction = backwards ? -1 : 1;
    while (
        (direction === -1 && idx > 0) ||
        (direction === 1 && idx < activities.length - 1)
    ) {
        idx += direction;

        const noteId = activities[idx].nId
        if (noteId) {
            const note = getNote(state, noteId);

            if (
                note.parentId &&
                note.parentId !== currentParentId
            ) {
                break;
            }
        }
    }


    return idx;
}


let lastHotlistIndex = 0;
function moveInDirectonOverHotlist(backwards: boolean) {
    if (lastHotlistIndex === -1) {
        lastHotlistIndex = state.activities.length - 1;
    }

    const nextIdx = getNextActivityInDirection(state, lastHotlistIndex, backwards);
    if (nextIdx < 0 || nextIdx >= state.activities.length) {
        return;
    }


    const nId = state.activities[nextIdx].nId;
    if (!nId) {
        return;
    }

    const note = getNote(state, nId);
    if (!note.parentId) {
        return;
    }

    const parentNote = getNote(state, note.parentId);
    const jumpNoteId = parentNote.childIds[parentNote.data.lastSelectedChildIdx];
    if (!jumpNoteId) {
        return;
    }

    setCurrentNote(state, jumpNoteId);
    setIsEditingCurrentNote(state, false);
    lastHotlistIndex = nextIdx;
}


// I used to have tabs, but I literally never used then, so I've just removed those components.
// However, "Everything" is the name of my current note tree, so that is just what I've hardcoded here.
// The main benefit of having just a single tree (apart from simplicity and less code) is that
// You can track all your activities and see analytics for all of them in one place. 
const STATE_KEY = "NoteTree.Everything";
const initState = () => {
    loadState();
};

const CHECK_INTERVAL_MS = 1000 * 10;
function autoInsertBreakIfRequired() {
    // This function should get run inside of a setInterval that runs every CHECK_INTERVAL_MS,
    // as well as anywhere else that might benefit from rechecking this interval.

    const healthCheckIntervalKey = "TimeLastPolled";
    // Need to automatically add breaks if we haven't called this method in a while.
    const time = new Date();
    const lastCheckTime = parseDateSafe(localStorage.getItem(healthCheckIntervalKey) || "");

    if (
        !!lastCheckTime&&
        (time.getTime() - lastCheckTime.getTime()) > CHECK_INTERVAL_MS * 2
    ) {
        // If this javascript was running, i.e the computer was open constantly, this code should never run.
        // So, we can insert a break now, if we aren't already taking one. 
        // This should solve the problem of me constantly forgetting to add breaks...
        
        if (!isCurrentlyTakingABreak(state)) { 
            pushActivity(state, {
                t: getTimestamp(lastCheckTime),
                breakInfo: "Auto-inserted break",
                nId: undefined,
                locked: undefined,
            });

            rerenderApp();
        }
    }

    localStorage.setItem(healthCheckIntervalKey, getTimestamp(time));
}

// NOTE: We should only ever have one of these ever.
// Also, there is code here that relies on the fact that
// setInterval won't run when a computer goes to sleep, or a tab is closed, and
// auto-inserts a break. This might break automated tests, if we ever
// decide to start using those
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
    const fuzzyFindModal = FuzzyFindModal();

    const fixedButtons = div({ class: "fixed row align-items-end", style: "bottom: 5px; right: 5px; left: 5px; gap: 5px;" }, [
        div({}, [makeDarkModeToggle()]),
        div({ class: "flex-1" }),
        div({}, [statusTextIndicator]),
        div({ class: "flex-1" }),
        div({ class: "row" }, [
            makeButtonWithCallback("Search", () => {
                setCurrentModal("fuzzy-finder");
            }),
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
            makeButtonWithCallback("Copy as text (everything)", () => {
                handleErrors(() => {
                    const flatNotes: NoteId[] = [];
                    recomputeFlatNotes(state, flatNotes, true);

                    navigator.clipboard.writeText(exportAsText(state, flatNotes));
                    showStatusText("Copied all notes as text");
                });
            }),
            makeButtonWithCallback("Copy open notes text", () => {
                handleErrors(() => {
                    const flatNotes: NoteId[] = [];
                    recomputeFlatNotes(state, flatNotes, false);

                    navigator.clipboard.writeText(exportAsText(state, flatNotes));
                    showStatusText("Copied current open notes as text");
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
        fuzzyFindModal,
    ]);


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
            lastHotlistIndex = -1;
        }

        // handle modals
        if (
            e.key === "F" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            setCurrentModal("fuzzy-finder");
            return;
        } else if (
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
            e.preventDefault();
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
                    debouncedSave();
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
                    debouncedSave();
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
                    moveInDirectonOverHotlist(true);
                } else {
                    handleMovingOut(currentNote.parentId)
                }
            } else if (e.key === "ArrowRight") {
                if (ctrlPressed && shiftPressed) {
                    moveInDirectonOverHotlist(false);
                } else {
                    // move into note
                    handleMovingIn();
                }
            } else if (shiftPressed && e.key === "Enter") {
                const newNote = insertChildNode(state);
                if (newNote) {
                    setIsEditingCurrentNote(state, true);
                }
            } else if (e.key === "Enter") {
                setIsEditingCurrentNote(state, true);
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
                setIsEditingCurrentNote(state, false);
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

    // 1 minute
    setInterval(() => {
        autoInsertBreakIfRequired();
    }, CHECK_INTERVAL_MS);

    const appComponent = makeComponent(appRoot, () => {
        // if (setVisible(help, showHelpInfo === 1)) {
        //     help.render(undefined);
        // }

        if (setVisible(cheatSheet, currentHelpInfo === 2)) {
            cheatSheet.render(undefined);
        }

        recomputeState(state);
        autoInsertBreakIfRequired();

        // rerender the things
        notesList.render(undefined);
        activityList.render(undefined);
        breakInput.render(undefined);
        todoNotes.render(undefined);

        if (setVisible(fuzzyFindModal, currentModal === "fuzzy-finder")) {
            fuzzyFindModal.render(undefined);
        }

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
