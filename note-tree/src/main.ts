import "./styles.css"
import "./style-utils.css"

import {
    Activity,
    NoteId,
    STATUS_DONE,
    STATUS_IN_PROGRESS,
    State,
    TreeNote,
    deleteNote,
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
    pushBreakActivity,
    recomputeFlatNotes,
    recomputeState,
    recursiveShallowCopy,
    resetState,
    setCurrentNote,
    state,
    STATUS_ASSUMED_DONE,
    dfsPre,
    getRootNote,
    setIsEditingCurrentNote,
    isBreak,
    pushActivity,
    getLastActivity,
    getLastActivityWithNoteIdx,
    setStateFromJSON,
    isTodoNote,
    isCurrentNoteOnOrInsideNote,
    getMostRecentlyWorkedOnChild,
    getLastSelectedNote,
    isDoneNoteWithExtraInfo,
    setActivityRangeToady,
    isActivityInRange,
    getMostRecentlyWorkedOnChildActivityIdx,
    deleteDoneNote,
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
    setStyle,
    ComponentList,
    assert,
} from "./dom-utils";

import * as tree from "./tree";
import { DateTimeInput,  Modal,  makeButton } from "./generic-components";
import { addDays, formatDate, formatDuration, getTimestamp, parseDateSafe, truncate } from "./datetime";
import { countOccurances, filterInPlace } from "./array-utils";
import { Range, fuzzyFind, scoreFuzzyFind } from "./fuzzyfind";
import { CHECK_INTERVAL_MS } from "./activitycheckconstants";

import CustomWorker from './activitycheck?worker';
import { loadFile, saveText } from "./file-download";
import { ASCII_MOON_STARS, ASCII_SUN, AsciiIconData } from "./icons";
import { AsciiCanvas, AsciiCanvasArgs } from "./canvas";
import { copyToClipboard } from "./clipboard";
import { getUrls, openUrlInNewTab } from "./url";

const SAVE_DEBOUNCE = 1500;
const ERROR_TIMEOUT_TIME = 5000;


type NoteLinkArgs = {
    text: string;
    focusAnyway?: boolean;
    noteId?: NoteId;
    preventScroll?: boolean;
};

function NoteLink(): Renderable<NoteLinkArgs> {
    const root = div({ style: "padding:5px; ", class: "handle-long-words" })

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

type TodoListInternalArgs = {
    priorityLevel: number;
    heading: string;
    scrollRoot?: Insertable;
    onScroll?(): void;
    cursorNoteId?: NoteId;
};

function TodoListInternal(): Renderable<TodoListInternalArgs> {
    type TodoItemArgs = {
        note: TreeNote;
        focusAnyway: boolean;
        cursorNoteId: NoteId | undefined;
    }

    const componentList = makeComponentList(div(), () => {
        // HACK: the cursor isn't actually bg-color-focus, it is transparent, and it just pushes the row to the side. 
        // The row has bg-color, whereas the root div behind it has --bg-color-focus
        const cursor = div({ class: "pre", }, [" --> "]);
        const noteLink = NoteLink();
        const lastEditedNoteLink = NoteLink();
        let progressText;
        const root = div({
            class: "row align-items-center",
            style: "background-color: var(--bg-color-focus);"
        }, [
            cursor,
            div({
                class: "hover-parent flex-1",
                style: "border-top: 1px solid var(--fg-color);" +
                    "border-left: 4px solid var(--fg-color);" +
                    "border-bottom: 1px solid var(--fg-color);" +
                    "padding-left: 3px;" +
                    "background-color: var(--bg-color);"
            }, [
                div({ class: "row align-items-center" }, [
                    progressText = div(),
                    div({}, [
                        noteLink,
                        div({ style: "padding-left: 60px" }, [
                            lastEditedNoteLink,
                        ]),
                    ]),
                ]),
            ]),
        ]);

        const component = makeComponent<TodoItemArgs>(root, () => {
            const { note, focusAnyway, cursorNoteId } = component.args;

            setTextContent(progressText, getNoteProgressCountText(note));

            setVisible(cursor, !!cursorNoteId && cursorNoteId === note.id);

            noteLink.render({
                noteId: note.id,
                text: note.data.text,
                preventScroll: true,
                focusAnyway,
            });

            setVisible(lastEditedNoteLink, false);
            const lastEditedChildId = note.childIds[note.data.lastSelectedChildIdx];
            if (!!lastEditedChildId) {
                const note = getNote(state, lastEditedChildId);

                // We only want to render our current progress for a particular note,
                // not any of the tasks under it
                if (!isTodoNote(note.data)) {
                    setVisible(lastEditedNoteLink, true);
                    lastEditedNoteLink.render({
                        noteId: lastEditedChildId,
                        text: note.data.text,
                        preventScroll: true,
                        focusAnyway,
                    });
                }
            }
        });

        return component;
    });

    const headingEl = el("H3", {});
    const root = div({}, [
        headingEl,
        componentList,
    ])

    const component = makeComponent<TodoListInternalArgs>(root, () => {
        const { heading, priorityLevel, scrollRoot, onScroll, cursorNoteId } = component.args;
        setTextContent(headingEl, heading);
        let count = 0;
        let alreadyScrolled = false;

        componentList.render(() => {
            for (let i = 0; i < state._todoNoteIds.length; i++) {
                const id = state._todoNoteIds[i];
                // const nextId: NoteId | undefined = state.todoNoteIds[i + 1];

                const note = getNote(state, id);
                // const nextNote = nextId ? getNote(state, nextId) : undefined;

                if (getTodoNotePriority(note.data) !== priorityLevel) {
                    continue;
                }

                count++;

                const currentlyOnOrInsideNote = isCurrentNoteOnOrInsideNote(state, note)

                const c = componentList.getNext();
                c.render({
                    note: note,
                    focusAnyway: currentlyOnOrInsideNote,
                    cursorNoteId
                });

                if (scrollRoot && onScroll && !alreadyScrolled) {
                    if (
                        (cursorNoteId && note.id === cursorNoteId) ||
                        (!cursorNoteId && currentlyOnOrInsideNote)
                    ) {
                        scrollRoot.el.scrollTop = c.el.offsetTop - 0.5 * scrollRoot.el.offsetHeight;
                        alreadyScrolled = true;
                        onScroll();
                    }
                }
            }
        });

        setVisible(root, count > 0);
    });

    return component;
}

type TodoListArgs = {
    shouldScroll: boolean;
    cursorNoteId?: NoteId;
}

function TodoList(): Renderable<TodoListArgs> {
    const inProgress = TodoListInternal();
    const todo = TodoListInternal();
    const backlog = TodoListInternal();
    const empty = div({}, ["Notes starting with '>', '>>', or '>>>' will end up in 1 of three lists. Try it out!"]);
    const root = div({ style: "overflow-y: auto" }, [
        empty,
        inProgress,
        todo,
        backlog,
    ]);

    const comopnent = makeComponent<TodoListArgs>(root, () => {
        const { shouldScroll, cursorNoteId } = comopnent.args;

        setVisible(empty, state._todoNoteIds.length === 0);

        let alreadyScrolled = false;

        inProgress.render({
            priorityLevel: 3,
            heading: "In Progress",
            scrollRoot: (!shouldScroll || alreadyScrolled) ? undefined : root,
            onScroll: () => alreadyScrolled = true,
            cursorNoteId,
        });

        todo.render({
            priorityLevel: 2,
            heading: "TODO",
            scrollRoot: (!shouldScroll || alreadyScrolled) ? undefined : root,
            onScroll: () => alreadyScrolled = true,
            cursorNoteId,
        });

        backlog.render({
            priorityLevel: 1,
            heading: "Backlog",
            scrollRoot: (!shouldScroll || alreadyScrolled) ? undefined : root,
            onScroll: () => alreadyScrolled = true,
            cursorNoteId,
        });
    });

    return comopnent;
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


function ActivityListItem(): Renderable<ActivityListItemArgs> {
    const timestamp = DateTimeInput();
    const timestampWrapper = div({ style: "width: 230px;" }, [timestamp]);
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
    let visibleRow;
    const root = div({}, [
        div({ class: "hover-parent", style: "min-height: 10px" }, [
            div({ class: "hover-target" }, [
                breakInsertRow
            ])
        ]),
        visibleRow = div({ class: "hover-parent" }, [
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
        const { activity, nextActivity, showDuration, greyedOut } = component.args;

        setStyle(visibleRow, "color", greyedOut ? "var(--unfocus-text-color)" : "");

        const isEditable = isEditableBreak(activity);
        // I think all break text should just be editable...
        // I'm thinking we should be able to categorize breaks somehow, so we can filter out the ones we dont care about...
        const canEditBreakText = isBreak(activity);

        const activityText = getActivityText(state, activity);

        if (setVisible(
            breakEdit,
            canEditBreakText,
        )) {
            setInputValue(breakEdit, activity.breakInfo!);
        }

        if (setVisible(noteLink, !canEditBreakText)) {
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
            nullable: false,
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

    function handleBreakTextEdit() {
        const { activity } = component.args;

        // 'prevent' clearing it out
        const val = breakEdit.el.value || activity.breakInfo;

        activity.breakInfo = val;
        rerenderApp({ shouldScroll: false });
        debouncedSave();
    }

    breakEdit.el.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            handleBreakTextEdit();
        }
    })

    breakEdit.el.addEventListener("blur", () => {
        handleBreakTextEdit();
    });

    return component;
}

function DeleteModal(): Renderable {
    let heading, textEl, countEl, timeEl, recentEl, deleteButton, cantDelete;
    const root = Modal(div({ style: "padding: 10px" }, [
        heading = el("H2", { style: "text-align: center" }, [ "Delete current note" ]),
        textEl = div(),
        div({ style: "height: 20px" }),
        countEl = div(),
        timeEl = div(),
        recentEl = div(),
        div({ style: "height: 20px" }),
        div({ class: "row justify-content-center" }, [
            deleteButton = makeButton("Delete Note"),
            cantDelete = div({}, [ "Can't delete notes that are still in progress..." ])
        ]),
        div({ style: "height: 20px" }),
        div({ style: "text-align: center" }, [ 
            "NOTE: I only added the ability to delete notes as a way to improve performance, if typing were to start lagging all of a sudden. You may not need to delete notes for quite some time, although more testing on my end is still required." 
        ])
    ]));

    deleteButton.el.addEventListener("click", (e) => {
        e.preventDefault();

        const currentNote = getCurrentNote(state);
        if (currentNote.data._status !== STATUS_DONE) {
            return;
        }

        deleteDoneNote(state, currentNote);
        setCurrentModal(null);
        showStatusText(
            "Deleted!" + 
            (Math.random() < 0.05 ? " - Good riddance..." : "")
        );
    });

    const component = makeComponent(root, () => {
        const currentNote = getCurrentNote(state);

        root.render({
            onClose: () => setCurrentModal(null),
        });

        setTextContent(textEl, currentNote.data.text);

        let count = 0;
        dfsPre(state, currentNote, () => count++);
        setTextContent(countEl, count + " notes in total");

        let totalTimeMs = getNoteDuration(state, currentNote);
        setTextContent(timeEl, formatDuration(totalTimeMs) + " in total");

        const idx = getMostRecentlyWorkedOnChildActivityIdx(state, currentNote);
        const activity = state.activities[idx];
        setTextContent(recentEl, "The last activity under this note was on " + formatDate(new Date(activity.t), undefined, true));

        const canDelete = currentNote.data._status === STATUS_DONE;
        setVisible(deleteButton, canDelete);
        setVisible(cantDelete, !canDelete);
    });

    return component;
}

function LinkNavModal(): Renderable {
    type LinkItemArgs = {
        noteId: NoteId;
        text: string;
        url: string;
        isFocused: boolean;
    };

    let content;
    let linkList: ComponentList<Renderable<LinkItemArgs>> | undefined;
    let empty;
    const root = Modal(
        div({}, [
            content = div({ style: "padding: 20px" }, [
                el("H2", {}, ["URLs on or under the current note"]),
                linkList = makeComponentList(div(), () => {
                    let cursor, textEl;
                    const root = div({ class: "row", style: "" }, [
                        cursor = div({ class: "pre" }, [" --> "]),
                        textEl = div(),
                    ]);

                    const component = makeComponent<LinkItemArgs>(root, () => {
                        const { text, isFocused, noteId } = component.args;

                        setTextContent(textEl, text);
                        setVisible(cursor, isFocused);
                        setStyle(root, "backgroundColor", noteId === state.currentNoteId ? "var(--bg-color-focus)" : "");
                    });

                    return component;
                }),
            ]),
            empty = div({ style: "padding: 40px" }, ["Couldn't find any URLs on or below the current note."]),
        ])
    );

    let idx = 0;

    const component = makeComponent(root, () => {
        const currentNote = getCurrentNote(state);

        idx = 0;
        linkList.render(() => {
            // Dont even need to collect these into an array before rendering them. lmao. 
            dfsPre(state, currentNote, (note) => {
                const urls = getUrls(note.data.text);
                for (const url of urls) {
                    linkList.getNext().render({
                        url,
                        text: url,
                        isFocused: false,
                        noteId: note.id,
                    });
                }
            });
        });

        rerenderItems();

        setVisible(content, linkList.components.length > 0);
        setVisible(empty, linkList.components.length === 0);
    });

    function rerenderItems() {
        if (!linkList) return;

        for (let i = 0; i < linkList.components.length; i++) {
            linkList.components[i].args.isFocused = i === idx;
            linkList.components[i].render(linkList.components[i].args);
        }
    }

    document.addEventListener("keydown", (e) => {
        if (currentModal !== component) {
            // Don't let this code execute  when this modal is closed...
            return;
        }


        if (e.key === "ArrowUp") {
            e.preventDefault();

            idx = Math.max(0, idx - 1);
            rerenderItems();
        } else if (e.key === "ArrowDown") {
            e.preventDefault();

            idx = Math.min(linkList.components.length - 1, idx + 1);
            rerenderItems();
        } else if (e.key === "Enter") {
            e.preventDefault();

            const { url, noteId } = linkList.components[idx].args;

            const currentNote = getCurrentNote(state);
            if (noteId !== currentNote.id) {
                setCurrentNote(state, noteId);
                rerenderItems();
            } else {
                openUrlInNewTab(url);
                setCurrentModal(null);
            }
        }
    });

    return component;
}


type EditableActivityListArgs = {
    activityIndexes: number[] | undefined;
    pageSize?: number;
    height: number | undefined;
};

function EditableActivityList(): Renderable<EditableActivityListArgs> {
    const listRoot = makeComponentList(div({ style: "border-bottom: 1px solid black" }), ActivityListItem);
    const pagination: Pagination = { pageSize: 10, start: 0, totalCount: 0 }
    const paginationControl = PaginationControl();
    const breakInput = BreakInput();

    const listContainer = div({ class: "flex-1", style: "overflow-y: auto;" }, [
        listRoot,
    ]);
    const root = div({ class: "w-100 flex-1 col", style: "border-top: 1px solid var(--fg-color);" }, [
        breakInput,
        listContainer,
        paginationControl,
    ]);

    function rerender() {
        component.render(component.args);
    }

    const component = makeComponent<EditableActivityListArgs>(root, () => {
        const { pageSize, height, activityIndexes } = component.args;
        pagination.pageSize = pageSize || 10;
        paginationControl.render({
            pagination,
            totalCount: activityIndexes ? activityIndexes.length : state.activities.length,
            rerender,
        });

        const activities = state.activities;
        const start = pagination.start;
        const end = getCurrentEnd(pagination);
        const activitiesToRender = end - start;

        breakInput.render(undefined);

        listContainer.el.style.height = height ? height + "px" : "";
        setClass(listContainer, "flex-1", !height);

        listRoot.render(() => {
            let lastRenderedIdx = -1;

            // make the elements, so we can render them backwards
            for (let i = 0; i < activitiesToRender; i++) {
                const iFromTheEnd = activitiesToRender - 1 - i;
                const idxIntoArray = (activityIndexes ? activityIndexes.length : activities.length) - end + iFromTheEnd;
                const idx = activityIndexes ? activityIndexes[idxIntoArray] : idxIntoArray;

                const previousActivity = activities[idx - 1];
                const activity = activities[idx];
                const nextActivity = activities[idx + 1];

                if (
                    idx + 1 < activities.length - 1 &&
                    lastRenderedIdx !== idx + 1
                ) {
                    // If there was a discontinuity in the activities/indicies, we want to render the next activity.
                    // This gives us more peace of mind in terms of where the duration came from

                    const nextNextActivity = activities[idx + 2];
                    listRoot.getNext().render({
                        previousActivity: activity,
                        activity: nextActivity,
                        nextActivity: nextNextActivity,
                        showDuration: true,
                        greyedOut: true,
                    });
                }

                lastRenderedIdx = idx;

                listRoot.getNext().render({
                    previousActivity,
                    activity,
                    nextActivity,
                    showDuration: true,
                });
            }
        });
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
    const pageReadout = div({ style: "" });

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
        const start = pagination.start + 1;
        const end = getCurrentEnd(pagination);
        setTextContent(pageReadout, "Page " + (page + 1) + " (" + start + " - " + end + " / " + pagination.totalCount + ")");

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
    stickyOffset?: number;
    analyticsMode: boolean;
    duration: number;
    totalDuration: number;
    focusedDepth: number;
};


function getNoteProgressCountText(note: TreeNote): string {
    const totalCount = note.childIds.length;
    const doneCount = countOccurances(note.childIds, (id) => {
        const note = getNote(state, id);
        return note.data._status === STATUS_DONE || note.data._status === STATUS_ASSUMED_DONE;
    });


    let progressText = "";
    if (totalCount !== 0) {
        // We want to ignore notes 1 just 1 note, and that note is just something like DONE.
        // Otherwise there will just be too much noise.

        let shouldIgnore = false;
        if (doneCount === 1 && totalCount === 1) {
            const child = getNote(state, note.childIds[0]);
            if (!isDoneNoteWithExtraInfo(child.data)) {
                shouldIgnore = true;
            }
        }

        if (!shouldIgnore) {
            progressText = ` (${doneCount}/${totalCount})`;
        }
    }

    return progressText;
}

function getIndentText(note: TreeNote) {
    const dashChar = note.data._isSelected ? "-" : "-";
    const progressText = getNoteProgressCountText(note);
    return `${getIndentStr(note.data)} ${noteStatusToString(note.data._status)}${progressText} ${dashChar} `;
}

function NoteRowText(): Renderable<NoteRowArgs> {
    const indent = div({ class: "pre" });

    const whenNotEditing = div({ class: "pre-wrap handle-long-words", style: "" });
    const whenEditing = TextArea();
    whenEditing.el.setAttribute("rows", "1");
    whenEditing.el.setAttribute("class", "flex-1");
    whenEditing.el.setAttribute("style", "overflow-y: hidden; padding: 0;");

    const root = div(
        {
            class: "pre-wrap flex-1",
            style: "overflow-y: hidden; padding-left: 10px;"
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

        const indentText = getIndentText(note);
        setTextContent(indent, indentText);

        const isFocused = state.currentNoteId === note.id;
        const isEditing = state._isEditingFocusedNote && isFocused;

        if (setVisible(whenEditing, isEditing)) {
            whenEditing.el.focus({ preventScroll: true });
        }

        if (setVisible(whenNotEditing, !isEditing)) {
            setTextContent(whenNotEditing, note.data.text);
        }

        root.el.style.backgroundColor = isFocused ? "var(--bg-color-focus)" : "var(--bg-color)";

        // Actually quite important that this runs even when we aren't editing, because when we eventually
        // set the input visible, it needs to auto-size to the correct height, and it won't do so otherwise
        onRerenderWhenEditing();
    });

    whenEditing.el.addEventListener("input", () => {
        const { note } = component.args;

        note.data.text = whenEditing.el.value;

        state._debounceNewNoteActivity = false;

        // Perform a partial update on the state, to just the thing we're editing

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
            deleteNote(state, currentNote.id);
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
    greyedOut?: boolean;
};

function ActivityFiltersEditor(): Renderable {
    function onChange() {
        rerenderApp({ shouldScroll: false });
    }

    const todayButton = makeButton("Today");
    todayButton.el.addEventListener("click", () => {
        setActivityRangeToady(state);
        onChange();
    });

    function updateDate(updateFn: (d: Date) => void) {
        let updated = false;

        if (state._activitiesFrom) {
            updateFn(state._activitiesFrom);
            updated=true;
        }

        if (state._activitiesTo) {
            updateFn(state._activitiesTo);
            updated=true;
        }

        if (updated) {
            onChange();
        }
    }

    let incrDay = makeButtonWithCallback("+1d", () => updateDate((d) => addDays(d, 1))),
        decrDay = makeButtonWithCallback("-1d", () => updateDate((d) => addDays(d, -1))),
        incrWeek = makeButtonWithCallback("+7d", () => updateDate((d) => addDays(d, 7))),
        decrWeek = makeButtonWithCallback("-7d", () => updateDate((d) => addDays(d, -7))),
        incrMonth = makeButtonWithCallback("+30d",() => updateDate((d) => addDays(d, 30))),
        decrMonth = makeButtonWithCallback("-30d", () => updateDate((d) => addDays(d, -30)));

    const blockStyle = { class: "row", style: "padding-left: 10px; padding-right: 10px" };
    let fromDateBlock, toDateBlock, dateFrom, dateTo;
    const root = div({ class: "row", style: "white-space: nowrap" }, [
        div(blockStyle, [
            todayButton,
            div({ style: "width: 10px" }),
            incrDay,
            decrDay,
            incrWeek,
            decrWeek,
            incrMonth,
            decrMonth,
        ]),
        fromDateBlock = div({ class: "row", style: "padding-left: 10px; padding-right: 10px" }, [
            dateFrom = DateTimeInput("from"),
        ]),
        toDateBlock = div(blockStyle, [
            dateTo = DateTimeInput("to"),
        ]),
    ]);

    const component = makeComponent(root, () => {
        dateFrom.render({
            value: state._activitiesFrom,
            readOnly: false,
            nullable: true,
            onChange: (val) => {
                state._activitiesFrom = val;
                onChange();
            }
        });

        dateTo.render({
            value: state._activitiesTo,
            readOnly: false,
            nullable: true,
            onChange: (val) => {
                state._activitiesTo = val;
                onChange();
            }
        });
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

                replaceChildren(textDiv, spans);
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

            const MAX_MATCHES = 20;
            if (matches.length > MAX_MATCHES) {
                matches.splice(MAX_MATCHES, matches.length - MAX_MATCHES);
            }

            if (currentSelectionIdx >= matches.length) {
                currentSelectionIdx = 0;
            }

            resultList.render(() => {
                for (const m of matches) {
                    resultList.getNext().render({
                        text: m.note.data.text,
                        ranges: m.ranges,
                        hasFocus: resultList.getIdx() === currentSelectionIdx,
                    });
                }
            });
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

function TodoListModal(): Renderable {
    const todoList = TodoList();
    const modalComponent = Modal(
        div({ class: "col", style: modalPaddingStyles(10) }, [
            todoList
        ])
    );

    let idx = 0;
    const todoNotesSorted: TreeNote[] = [];

    function rerenderTodoList() {
        todoList.render({
            shouldScroll: true,
            cursorNoteId: idx === -1 ? undefined : todoNotesSorted[idx].id,
        });
    }

    const component = makeComponent(modalComponent, () => {
        todoNotesSorted.splice(0, todoNotesSorted.length);
        function pushNotes(p: number) {
            for (const id of state._todoNoteIds) {
                const note = getNote(state, id);
                if (getTodoNotePriority(note.data) === p) {
                    todoNotesSorted.push(note);
                }
            }
        }
        pushNotes(3);
        pushNotes(2);
        pushNotes(1);

        idx = -1;
        for (let i = 0; i < todoNotesSorted.length; i++) {
            const note = todoNotesSorted[i];

            if (isCurrentNoteOnOrInsideNote(state, note)) {
                idx = i;
                break;
            }
        }

        rerenderTodoList();
    });

    document.addEventListener("keydown", (e) => {
        if (currentModal !== component) {
            // I could try to add a moun/unmount system. Or I could do this....
            return;
        }

        if (
            e.key === "PageUp" ||
            e.key === "PageDown" ||
            e.key === "ArrowUp" ||
            e.key === "ArrowDown" ||
            e.key === "Enter"
        ) {
            e.preventDefault();

            let needsRerender = true;
            let needsGlobalRerender = false;
            if (idx === -1) {
                idx = 0;
            } else if (e.key === "ArrowUp") {
                idx = Math.max(idx - 1, 0);
            } else if (e.key === "ArrowDown") {
                idx = Math.min(idx + 1, todoNotesSorted.length - 1);
            } else if (e.key === "PageUp") {
                idx = Math.max(idx - 10, 0);
            } else if (e.key === "PageDown") {
                idx = Math.min(idx + 10, todoNotesSorted.length - 1);
            } else if (e.key === "Enter") {
                // Move to the most recent note in this subtree.
                const note = todoNotesSorted[idx];
                const mostRecent = getMostRecentlyWorkedOnChild(state, note);
                setCurrentModal(null);
                setCurrentNote(state, mostRecent.id);
                setIsEditingCurrentNote(state, false);
                needsGlobalRerender = true;
            } else {
                needsRerender = false;
            }

            if (needsRerender) {
                e.stopImmediatePropagation();

                if (needsGlobalRerender) {
                    rerenderApp();
                } else {
                    rerenderTodoList();
                }
            }
        }
    });

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

function modalPaddingStyles(paddingPx: number) {
    return `width: calc(100% - ${paddingPx * 2}px); height: calc(100% - ${paddingPx * 2}px); padding: ${paddingPx}px;`;
}

type LoadBackupModalArgs = {
    fileName: string;
    text: string;
};
function LoadBackupModal(): Renderable<LoadBackupModalArgs> {
    const fileNameDiv = el("H3");
    const infoDiv = div();
    const loadBackupButton = makeButton("Load this backup");
    loadBackupButton.el.addEventListener("click", () => {
        if (!canLoad || !component.args.text) {
            return;
        }

        if (confirm("Are you really sure you want to load this backup? Your current state will be wiped")) {
            const lsKeys = JSON.parse(component.args.text);
            localStorage.clear();
            for (const k in lsKeys) {
                localStorage.setItem(k, lsKeys[k]);
            }

            initState();
            setCurrentModal(null);
        }
    });
    const modal = Modal(
        div({ class: "col", style: modalPaddingStyles(10) }, [
            fileNameDiv,
            infoDiv,
            loadBackupButton,
        ])
    );

    let canLoad = false;
    const component = makeComponent<LoadBackupModalArgs>(modal, () => {
        modal.render({
            onClose: () => setCurrentModal(null)
        });

        const { text, fileName } = component.args;

        setTextContent(fileNameDiv, "Load backup - " + fileName);
        setVisible(loadBackupButton, false);
        canLoad = false;

        try {
            const lsKeys = JSON.parse(text);
            const lastOnline = parseDateSafe(lsKeys[LOCAL_STORAGE_KEYS.TIME_LAST_POLLED]);
            const backupState = loadStateFromJSON(lsKeys[LOCAL_STORAGE_KEYS.STATE]);
            if (!backupState) {
                throw "bruh";
            }
            const theme = lsKeys[LOCAL_STORAGE_KEYS.CURRENT_THEME];

            replaceChildren(infoDiv, [
                div({}, ["Make sure this looks reasonable before you load the backup:"]),
                div({}, ["Notes: ", tree.getSize(backupState.notes).toString()]),
                div({}, ["Activities: ", backupState.activities.length.toString()]),
                div({}, ["Last Online: ", !lastOnline ? "No idea" : formatDate(lastOnline)]),
                div({}, ["Last Theme: ", theme]),
            ]);

            setVisible(loadBackupButton, true);
            canLoad = true;
        } catch {
            replaceChildren(infoDiv, [
                div({}, ["This JSON cannot be loaded"])
            ]);
        }
    });

    return component;
}

function AsciiCanvasModal(): Renderable<AsciiCanvasArgs> {
    const asciiCanvas = AsciiCanvas();
    const modalComponent = Modal(
        div({ style: modalPaddingStyles(10) }, [
            asciiCanvas
        ])
    );

    const component = makeComponent<AsciiCanvasArgs>(modalComponent, () => {
        modalComponent.render({
            onClose() {
                setCurrentModal(null);
            }
        });

        asciiCanvas.render(component.args);
    });

    return component;
}

function NoteRowTimestamp(): Renderable<NoteRowArgs> {
    const root = div({ class: "pre-wrap", style: "white-space: nowrap; border-right: 1px solid var(--fg-color); padding-right: 10px;" });

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { note } = component.args;
        setTextContent(root, getTimeStr(note.data));
    });

    return component;
}


function NoteRowInput(): Renderable<NoteRowArgs> {
    const timestamp = NoteRowTimestamp();

    const text = NoteRowText();
    const inProgress = div({ class: "row align-items-center" }, [""]);

    const durationEl = div({ class: "row align-items-center", style: "padding-left: 10px; text-align: right;" });
    // const progressBar = initEl(FractionBar(), { style: "; flex: 1;" });
    const progressBar = div({ class: "inverted", style: "height: 4px;" });

    const root = div({ class: "row pre", style: "background-color: var(--bg-color)" }, [
        timestamp, 
        div({ class: "flex-1" }, [
            div({ class: "row" }, [
                text, 
                inProgress, 
                durationEl
            ]),
            progressBar,
        ]),
    ]);


    let isFocused = false;
    let isInAnalyticsMode = false;

    const component = makeComponent<NoteRowArgs>(root, () => {
        const { note, stickyOffset, analyticsMode, duration, totalDuration, focusedDepth } = component.args;

        const wasInAnalyticsMode = isInAnalyticsMode;
        isInAnalyticsMode = !!analyticsMode && !!duration && !!totalDuration;
        const lastActivity = getLastActivity(state);
        const isInProgress = lastActivity?.nId === note.id;
        if (setVisible(inProgress, isInProgress || note.id === state.currentNoteId)) {
            if (isInProgress) {
                setTextContent(inProgress, " [In Progress] ");
                inProgress.el.style.color = "#FFF";
                inProgress.el.style.backgroundColor = "#F00";
            } else {
                setTextContent(inProgress, " [Not in progress] ");
                inProgress.el.style.color = "#FFF";
                inProgress.el.style.backgroundColor = "#00F";
            }
        }

        let textColor = (note.data._isSelected || note.data._status === STATUS_IN_PROGRESS) ? "var(--fg-color)" : "var(--unfocus-text-color)";
        const isOnCurrentLevel = note.data._depth === focusedDepth;

        root.el.style.color = textColor;
        if (stickyOffset !== undefined) {
            root.el.style.position = "sticky";
            root.el.style.top = stickyOffset + "px";
        } else {
            root.el.style.position = "";
            root.el.style.top = stickyOffset + "";
        }


        timestamp.render(component.args);

        setTextContent(durationEl, formatDuration(duration!, 2));
        if (setVisible(progressBar, isInAnalyticsMode)) {
            setStyle(progressBar, "width", (100 * duration! / totalDuration!) + "%")
            setStyle(progressBar, "backgroundColor", isOnCurrentLevel ? "var(--fg-color)" : "var(--unfocus-text-color)");
        }
        
        text.render(component.args);

        const wasFocused = isFocused;
        isFocused = state.currentNoteId === note.id;
        if (renderOptions.shouldScroll && isFocused && (!wasFocused || (wasInAnalyticsMode !== isInAnalyticsMode))) {
            // without setTimeout here, calling focus won't work as soon as the page loads.
            function scrollComponentToView() {
                setTimeout(() => {
                    // scroll view into position.
                    // Right now this also runs when we click on a node instead of navigating with a keyboard, but 
                    // ideally we don't want to do this when we click on a note.
                    // I haven't worked out how to do that yet though
                    {
                        // NOTE: This actually doesn't work if our list of tasks is so big that the note isn't even on the screen at first, it seems...

                        const rootRect = root.el.getBoundingClientRect();
                        const wantedY = rootRect.top + window.scrollY;

                        window.scrollTo({
                            left: 0,
                            top: wantedY - 0.5 * window.innerHeight + 0.5 * rootRect.height,
                            behavior: "instant"
                        });
                    }
                }, 1);
            }

            if (renderOptions.shouldScroll) {
                scrollComponentToView();
            }
        }
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

    const durations = new Map<NoteId, number>();


    function activityFilterFn(idx: number) : boolean {
        const activity = state.activities[idx];
        if (!activity.nId) {
            return false;
        }

        return isActivityInRange(state, activity);
    }

    const component = makeComponent<NoteListInternalArgs>(root, () => {
        const { flatNotes } = component.args;

        let focusedDepth = -1;
        for (let i = 0; i < state._flatNoteIds.length; i++) {
            const note = getNote(state, state._flatNoteIds[i]);
            focusedDepth = Math.max(focusedDepth, note.data._depth);
        }

        noteList.render(() => {
            let stickyOffset = 0;

            durations.clear();

            for (let i = 0; i < flatNotes.length; i++) {
                const id = flatNotes[i];
                const note = getNote(state, id);
                const component = noteList.getNext();

                let isSticky = note.data._isSelected;

                const durationMs = getNoteDuration(state, note, activityFilterFn);
                durations.set(note.id, durationMs);
                
                assert(note.parentId);
                const parentNote = getNote(state, note.parentId);
                const parentDurationMs = durations.get(parentNote.id) || getNoteDuration(state, parentNote, activityFilterFn);
                durations.set(parentNote.id, parentDurationMs);

                component.render({
                    note,
                    stickyOffset: isSticky ? stickyOffset : undefined,
                    analyticsMode: state._isInAnalyticsMode,
                    duration: durationMs,
                    totalDuration: parentDurationMs,
                    focusedDepth: focusedDepth,
                });

                // I have no idea how I would do this in React, tbh.
                // But it was really damn easy here lol.
                if (isSticky) {
                    stickyOffset += component.el.getBoundingClientRect().height;
                }
            }
        });
    });

    return component;
}

function NotesList(): Renderable {
    let list1, filterEditor, filterEditorRow;
    const root = div({}, [
        filterEditorRow = div({ class: "row", style: "padding-top: 10px; padding-bottom: 10px" }, [
            div({ class: "flex-1" }),
            filterEditor = ActivityFiltersEditor(),
        ]),
        list1 = NoteListInternal(),
    ]);

    const component = makeComponent(root, () => {
        list1.render({ flatNotes: state._flatNoteIds, });

        if (setVisible(filterEditorRow, state._isInAnalyticsMode)) {
            filterEditor.render(undefined);
        }
    });

    return component;
}

const renderOptions: RenderOptions = {
    shouldScroll: false
};

type AppTheme = "Light" | "Dark";

function getTheme(): AppTheme {
    if (localStorage.getItem(LOCAL_STORAGE_KEYS.CURRENT_THEME) === "Dark") {
        return "Dark";
    }

    return "Light";
};

function setTheme(theme: AppTheme) {
    localStorage.setItem(LOCAL_STORAGE_KEYS.CURRENT_THEME, theme);

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


};


function AsciiIcon(): Renderable<AsciiIconData> {
    const icon = div();

    icon.el.style.userSelect = "none";
    icon.el.style.whiteSpace = "pre";
    icon.el.style.fontSize = "6px";
    icon.el.style.fontFamily = "Courier";
    icon.el.style.fontWeight = "bold";
    icon.el.style.textShadow = "1px 1px 0px var(--fg-color)";

    const component = makeComponent<AsciiIconData>(icon, () => {
        const { data } = component.args;
        setTextContent(icon, data);
    });

    return component;
}

const makeDarkModeToggle = () => {
    function getThemeAsciiIcon() {
        const theme = getTheme();
        if (theme === "Light") {
            return ASCII_SUN;
        }

        return ASCII_MOON_STARS;
    };

    const icon = AsciiIcon();
    const button = makeButtonWithCallback("", () => {
        let themeName = getTheme();
        if (!themeName || themeName === "Light") {
            themeName = "Dark";
        } else {
            themeName = "Light";
        }

        setTheme(themeName);
        icon.render(getThemeAsciiIcon());
    });

    replaceChildren(button, [icon]);
    icon.render(getThemeAsciiIcon());

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

    // TODO: Scratch pad
    return [
        header(" Notes "),
        formatTable(table, 10),
        header(" Scratchpad "),
    ].join("\n\n");
}

type RenderOptions = {
    shouldScroll: boolean;
}

const rerenderApp = (opts?: RenderOptions) => {
    // there are actually very few times when we don't want to scroll to the current note
    renderOptions.shouldScroll = opts ? opts.shouldScroll : true;
    app.render(undefined);
}

let currentModal: Insertable | null = null;
const setCurrentModal = (modal: Insertable | null) => {
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
    function keymapDivs(keymap: string, desc: string) {
        return div({ class: "row" }, [
            div({ style: "width: 500px" }, [keymap]),
            div({ class: "flex-1" }, [desc]),
        ])
    }
    return makeComponent(div({}, [
        el("H3", {}, ["Cheatsheet"]),
        el("H4", {}, ["Basic functionality, and shortcut keys"]),
        div({}),
        makeUnorderedList([
            keymapDivs(`[Enter], while not editing`, `start editing the current note`),
            keymapDivs(`[Enter], while editing`, `create a new note under the current note`),
            keymapDivs(`[Shift] + [Enter], while not editing`, `create a new note 1 level below the current note`),
            keymapDivs(`[Shift] + [Enter], while editing`, `insert new lines`),
            keymapDivs(`[Esc], when editing`, `Stop editing`),
            keymapDivs(`[Up]/[PageUp]/[Home]/[Ctrl+Up], not editing`, `Move upwards various amounts`),
            keymapDivs(`[Down]/[PageDown]/[Home]/[Ctrl+Down], not editing`, `Move downwards various amounts`),
            keymapDivs(`[Left], not editing`, `Move up 1 level 'out of' the note`),
            keymapDivs(`[Right], not editing`, `Move down 1 level 'into' the note`),
            keymapDivs(`[Alt] + [Previous movement keys], not editing`, `Grab and move the current note around the tree to where you would have otherwise moved normally`),
        ]),
        div({}),
        makeUnorderedList([
            keymapDivs(`[Ctrl] + [Enter]`, `Find and open URLs in a note`),
        ]),
        div({}),
        makeUnorderedList([
            keymapDivs(`[Ctrl] + [Shift] + [A]`, `Open the analytics modal`),
            keymapDivs(`[Ctrl] + [Shift] + [F]`, `Open the finder modal`),
            keymapDivs(`[Ctrl] + [Shift] + [T]`, `Open the TODO notes list`),
            keymapDivs(`[Ctrl] + [Shift] + [S]`, `Open the scratch pad`),
        ]),
        el("H4", {}, ["Note statuses"]),
        makeUnorderedList([
            noteStatusToString(STATUS_IN_PROGRESS) + ` - This note is currently in progress`,
            noteStatusToString(STATUS_ASSUMED_DONE) + ` - This note is assumed to be done`,
            noteStatusToString(STATUS_DONE) + ` - This note has been manually marked as done by you`,
        ]),
        el("H4", {}, ["Completing tasks, and keeping tasks in progress"]),
        el("P", {}, ["Using specific text at the very start of a note can affect it's status:"]),
        makeUnorderedList([
            `Starting a note with >, >> or >>> will place it into the Backlog, Todo and In-Progress list respectively. 
             Additionally, this will also hide all of the notes under that notes from all lists - this is mainly a way to declutter the lists which can otherwise have hundreds of tasks.`,
            `Starting a note with DONE, Done, done, DECLINED, MERGED will mark a particular note and every note above it under the same note as DONE. 
             A note can also be marked as DONE if every note under it has been marked as DONE.`,
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
            `Press [Ctrl + Shift + A] to toggle 'analytics mode'. You can now see a bunch of percentage bars below each activity that lets you see which tasks you worked on today.`,
            `You can also change or disable the date range that is being used to calculate the duration next to each note, and filter the activity list`,
        ]),
        el("H4", {}, ["Scratchpad"]),
        makeUnorderedList([
            `The scratchpad can be opened by clicking the "Scratchpad" button, or with [Ctrl] + [Shift] + [S]`,
            `You would use this to make diagrams or ascii art that you can then paste into your notes`,
        ]),
        el("H4", {}, ["Loading and saving"]),
        makeUnorderedList([
            `Your stuff is auto-saved 1 second after you finish typing. 
            You can download a copy of your data, and then reload it later/elsewhere with the "Download JSON" and "Load JSON" buttons.`,
        ]),
    ]), () => { });
}

function getNextHotlistActivityInDirection(state: State, idx: number, backwards: boolean, stepOver: boolean): number {
    // This method is for navigating backwards through the activity list to what you were working on before (or forwards, if you've navigated too far backwards).
    // But if I've made 20 notes one after the other in sequence, I don't want to go back up those notes typically. 
    // Rather, I want to skip those notes, and go to the discontinuity in activities.
    // That being said, if I make a note, then I step down 10 notes and write something, I want to go back up, even though it's under the same parent note
    //      (so I can't just skip over all notes with the same parent as the previous, like I was doing before).
    // That's the problem that this somewhat complex looking code is trying to solve

    const activities = state.activities;
    const direction = backwards ? -1 : 1;
    let lastNoteId = activities[idx].nId;
    if (!lastNoteId) {
        // Only works if we're currently on an activity. sorry
        return idx;
    }

    while (
        (direction === -1 && idx > 0) ||
        (direction === 1 && idx < activities.length - 1)
    ) {
        idx += direction;

        const activity = activities[idx];
        if (activity.nId) {
            const lastNote = getNote(state, lastNoteId);
            if (lastNote.parentId) {
                const parent = getNote(state, lastNote.parentId);
                const siblings = parent.childIds;
                const noteSiblingIdx = siblings.indexOf(lastNote.id);
                const prevSiblingId = siblings[noteSiblingIdx + direction];

                if (activity.nId !== prevSiblingId) {
                    // we have finally reached the discontinuity
                    if (!stepOver) {
                        idx--;
                    }
                    break;
                }

                lastNoteId = prevSiblingId;
            }
        }
    }


    return idx;
}


let lastHotlistIndex = 0;
function moveInDirectonOverHotlist(backwards: boolean) {
    if (lastHotlistIndex === -1) {
        lastHotlistIndex = getLastActivityWithNoteIdx(state);
        if (lastHotlistIndex === -1) {
            return;
        }

        const nId = state.activities[lastHotlistIndex].nId;
        if (state.currentNoteId !== nId) {
            setCurrentNote(state, nId!);
            setIsEditingCurrentNote(state, false);
            return;
        }
    }

    let nextIdx = lastHotlistIndex;
    nextIdx = getNextHotlistActivityInDirection(state, nextIdx, backwards, true);

    if (nextIdx < 0 || nextIdx >= state.activities.length) {
        return;
    }


    const nId = state.activities[nextIdx].nId;
    if (!nId) {
        return;
    }

    setCurrentNote(state, nId);
    setIsEditingCurrentNote(state, false);
    lastHotlistIndex = nextIdx;
}


// I used to have tabs, but I literally never used then, so I've just removed those components.
// However, "Everything" is the name of my current note tree, so that is just what I've hardcoded here.
// The main benefit of having just a single tree (apart from simplicity and less code) is that
// You can track all your activities and see analytics for all of them in one place. 
const LOCAL_STORAGE_KEYS = {
    STATE: "NoteTree.Everything",
    // Actually quite useful to back this up with a user's data.
    // If they ever need to revert to a backed up version of their state, 
    // this will cause our thing to auto-insert a break corresponding to all the data they lost
    TIME_LAST_POLLED: "TimeLastPolled",
    CURRENT_THEME: "State.currentTheme",
} as const;

const initState = () => {
    loadState();
    setTheme(getTheme());
};

function autoInsertBreakIfRequired() {
    // This function should get run inside of a setInterval that runs every CHECK_INTERVAL_MS,
    // as well as anywhere else that might benefit from rechecking this interval.

    // Need to automatically add breaks if we haven't called this method in a while.
    const time = new Date();
    const lastCheckTime = parseDateSafe(localStorage.getItem(LOCAL_STORAGE_KEYS.TIME_LAST_POLLED) || "");

    if (
        !!lastCheckTime &&
        (time.getTime() - lastCheckTime.getTime()) > CHECK_INTERVAL_MS * 2
    ) {
        // If this javascript was running, i.e the computer was open constantly, this code should never run.
        // So, we can insert a break now, if we aren't already taking one. 
        // This should solve the problem of me constantly forgetting to add breaks...
        const lastActivity = getLastActivity(state);
        const time = !lastActivity ? lastCheckTime.getTime() :
            Math.max(lastCheckTime.getTime(), new Date(lastActivity.t).getTime());

        if (!isCurrentlyTakingABreak(state)) {
            pushActivity(state, {
                t: getTimestamp(new Date(time)),
                breakInfo: "Auto-inserted break",
                nId: undefined,
                locked: undefined,
            });

            rerenderApp();
        }
    }

    localStorage.setItem(LOCAL_STORAGE_KEYS.TIME_LAST_POLLED, getTimestamp(time));
}

function getStateAsJSON() {
    const lsKeys: any = {};
    for (const key of Object.values(LOCAL_STORAGE_KEYS)) {
        lsKeys[key] = localStorage.getItem(key);
    }

    return JSON.stringify(lsKeys);
}

// NOTE: We should only ever have one of these ever.
// Also, there is code here that relies on the fact that
// setInterval in a webworker won't run when a computer goes to sleep, or a tab is closed, and
// auto-inserts a break. This might break automated tests, if we ever
// decide to start using those
export function App() {
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
    const todoNotes = TodoList();

    const asciiCanvasModal = AsciiCanvasModal();
    const fuzzyFindModal = FuzzyFindModal();
    const todoListModal = TodoListModal();
    const deleteModal = DeleteModal();
    const loadBackupModal = LoadBackupModal();
    const linkNavModal = LinkNavModal();
    let backupText = "";
    let backupFilename = "";

    function setAnalyticsEnabled(enabled: boolean) {
        state._isInAnalyticsMode = enabled;

        setClass(analyticsButton, "inverted", enabled);
    }

    const analyticsButton = makeButtonWithCallback("Analytics", () => {
        setAnalyticsEnabled(!state._isInAnalyticsMode);
        rerenderApp();
    });

    const fixedButtons = div({ class: "fixed row align-items-end", style: "bottom: 5px; right: 5px; left: 5px; gap: 5px;" }, [
        div({ class: "row align-items-end" }, [
            makeDarkModeToggle(),
            makeButtonWithCallback("Scratch Pad", () => {
                setCurrentModal(asciiCanvasModal);
            }),
        ]),
        div({ class: "flex-1" }),
        div({}, [statusTextIndicator]),
        div({ class: "flex-1" }),
        div({ class: "row" }, [
            makeButtonWithCallback("Delete current", () => {
                setCurrentModal(deleteModal);
            }),
            makeButtonWithCallback("Todo Notes", () => {
                setCurrentModal(fuzzyFindModal);
            }),
            makeButtonWithCallback("Search", () => {
                setCurrentModal(fuzzyFindModal);
            }),
            analyticsButton,
            makeButtonWithCallback("Clear all", () => {
                if (!confirm("Are you sure you want to clear your note tree?")) {
                    return;
                }

                resetState();
                rerenderApp();

                showStatusText("Cleared notes");
            }),
            makeButtonWithCallback("Download TXT", () => {
                handleErrors(() => {
                    const flatNotes: NoteId[] = [];
                    recomputeFlatNotes(state, flatNotes, true);
                    const text = exportAsText(state, flatNotes);
                    handleErrors(() => {
                        saveText(text, `Note-Tree Text Export - ${formatDate(new Date(), "-")}.txt`);
                    });

                    showStatusText("Download TXT");
                });
            }),
            makeButtonWithCallback("Copy open notes", () => {
                handleErrors(() => {
                    const flatNotes: NoteId[] = [];
                    recomputeFlatNotes(state, flatNotes, false);

                    copyToClipboard(exportAsText(state, flatNotes));
                    showStatusText("Copied current open notes as text");
                });
            }),
            makeButtonWithCallback("Load JSON", () => {
                loadFile((file) => {
                    if (!file) {
                        return;
                    }

                    file.text().then((text) => {
                        backupFilename = file.name;
                        backupText = text;
                        setCurrentModal(loadBackupModal);
                    });
                });
            }),
            makeButtonWithCallback("Download JSON", () => {
                handleErrors(() => {
                    saveText(getStateAsJSON(), `Note-Tree Backup - ${formatDate(new Date(), "-")}.json`);
                });
            }),
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
                    el("H3", {}, ["TODO Notes [Ctrl + Shift + T]"]),
                    todoNotes
                ])
            ]),
            div({ style: "flex:1; padding-top: 20px" }, [
                div({}, [
                    el("H3", {}, ["Activity List"]),
                    activityList
                ])
            ]),
        ]),
        fixedButtons,
        asciiCanvasModal,
        fuzzyFindModal,
        todoListModal,
        deleteModal,
        loadBackupModal,
        linkNavModal,
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
        if (e.key === "Delete") {
            e.preventDefault();
            setCurrentModal(deleteModal);
            return;
        } else if (
            e.key === "F" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            setCurrentModal(fuzzyFindModal);
            return;
        } if (
            e.key === "T" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            setCurrentModal(todoListModal);
            return;
        } else if (
            e.key === "S" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            setCurrentModal(asciiCanvasModal);
            return;
        } else if (
            e.key === "A" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            setAnalyticsEnabled(!state._isInAnalyticsMode);
            rerenderApp();
            return;
        } else if (
            e.key === "Enter" &&
            ctrlPressed
        ) {
            e.preventDefault();
            setCurrentModal(linkNavModal);
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
            !isEditingSomeText &&
            currentModal === null
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
                    const lastSelected = getLastSelectedNote(state, currentNote);
                    setCurrentNote(state, lastSelected ? lastSelected.id : null);
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

                const noteInsideUpperNote = getLastSelectedNote(state, upperNote);
                if (noteInsideUpperNote) {
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

                debouncedSave();
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

    const worker = new CustomWorker();
    worker.onmessage = () => {
        autoInsertBreakIfRequired();
    };

    const appComponent = makeComponent(appRoot, () => {
        if (setVisible(cheatSheet, currentHelpInfo === 2)) {
            cheatSheet.render(undefined);
        }

        recomputeState(state);
        autoInsertBreakIfRequired();

        // rerender the things
        notesList.render(undefined);
        activityList.render({
            pageSize: 10,
            height: 600,
            activityIndexes: state._useActivityIndices ? state._activityIndices : undefined,
        });
        todoNotes.render({ shouldScroll: false });

        if (setVisible(loadBackupModal, currentModal === loadBackupModal)) {
            loadBackupModal.render({
                text: backupText,
                fileName: backupFilename,
            });
        } else {
            backupText = "";
        }

        if (setVisible(linkNavModal, currentModal === linkNavModal)) {
            linkNavModal.render(undefined);
        }

        if (setVisible(fuzzyFindModal, currentModal === fuzzyFindModal)) {
            fuzzyFindModal.render(undefined);
        }

        if (setVisible(deleteModal, currentModal === deleteModal)) {
            deleteModal.render(undefined);
        }

        if (setVisible(asciiCanvasModal, currentModal === asciiCanvasModal)) {
            asciiCanvasModal.render({
                outputLayers: state.scratchPadCanvasLayers,
                onInput: () => {
                    debouncedSave();
                }
            });
        }

        if (setVisible(todoListModal, currentModal === todoListModal)) {
            todoListModal.render(undefined);
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
    const savedStateJSON = localStorage.getItem(LOCAL_STORAGE_KEYS.STATE);
    if (!savedStateJSON) {
        return;
    }

    setStateFromJSON(savedStateJSON);
}


let saveTimeout = 0;
function saveState(state: State) {
    const nonCyclicState = recursiveShallowCopy(state);
    const serialized = JSON.stringify(nonCyclicState);
    localStorage.setItem(LOCAL_STORAGE_KEYS.STATE, serialized);
}



// Entry point
const root: Insertable = {
    _isInserted: true,
    el: document.getElementById("app")!
};

const app = App();
appendChild(root, app);

app.render(undefined);
