import "src/styles.css"
import "src/style-utils.css"
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
    getNote,
    getNoteDuration,
    getNoteOneDownLocally,
    getNoteOneUpLocally,
    noteStatusToString,
    getNoteNDown,
    getNoteNUp,
    getSecondPartOfRow,
    getTodoNotePriority,
    insertChildNote,
    insertNoteAfterCurrent,
    isCurrentlyTakingABreak,
    isEditableBreak,
    pushBreakActivity,
    recomputeFlatNotes,
    recomputeState,
    resetState,
    setCurrentNote,
    state,
    STATUS_ASSUMED_DONE,
    dfsPre,
    getRootNote,
    setIsEditingCurrentNote,
    isBreak,
    getLastActivity,
    getLastActivityWithNoteIdx,
    isCurrentNoteOnOrInsideNote,
    getLastSelectedNote,
    isDoneNoteWithExtraInfo,
    setActivityRangeToday,
    getMostRecentlyWorkedOnChildActivityIdx,
    deleteDoneNote,
    setCurrentActivityIdxToCurrentNote,
    DockableMenu,
    newBreakActivity,
    getActivityTime,
    setActivityTime,
    getLastActivityWithNote,
    hasNote,
    AppTheme,
    toggleCurrentNoteSticky,
    getNoteEstimate,
    findNextActiviyIndex,
    findPreviousActiviyIndex,
    getCurrentStateAsJSON,
    loadStateFromBackup,
    saveState,
    loadState,
    getAllNoteIdsInTreeOrder,
    getHigherLevelTask,
    getNoteTextWithoutPriority,
    setStateFromJSON,
} from "./state";
import {
    Renderable,
    newComponent,
    setClass,
    setInputValue,
    setText,
    setVisible,
    newListRenderer as newListRenderer,
    div,
    el,
    InsertableGeneric,
    isEditingTextSomewhereInDocument,
    appendChild,
    Insertable,
    replaceChildren,
    setStyle,
    assert,
    ChildList,
    scrollIntoViewV,
    setCssVars,
    isEditingInput,
    initEl,
} from "src/utils/dom-utils";
import * as tree from "src/utils/tree";
import { ScrollContainerV, Checkbox, DateTimeInput,  Modal, PaginationControl, makeButton } from "src/components";
import { addDays, formatDate, formatDuration, formatDurationAsHours, getTimestamp, parseDateSafe, truncate } from "src/utils/datetime";
import { countOccurances, filterInPlace } from "src/utils/array-utils";
import { Range, fuzzyFind, scoreFuzzyFind } from "src/utils/fuzzyfind";
import { loadFile, saveText } from "src/utils/file-download";
import { ASCII_MOON_STARS, ASCII_SUN, AsciiIconData } from "src/icons";
import { AsciiCanvas, AsciiCanvasArgs } from "src/canvas";
import { copyToClipboard } from "src/utils/clipboard";
import { forEachUrlPosition, openUrlInNewTab } from "src/utils/url";
import { newWebWorker } from "src/utils/web-workers";
import { Pagination, getCurrentEnd, getStart, idxToPage, setPage } from "src/utils/pagination";
import { utf8ByteLength } from "src/utils/utf8";

const SAVE_DEBOUNCE = 1500;
const ERROR_TIMEOUT_TIME = 5000;
// Doesn't really follow any convention. I bump it up by however big I feel the change I made was.
// This will need to change if this number ever starts mattering more than "Is the one I have now the same as latest?"
// 'X' will also denote an unstable/experimental build. I never push anything up if I think it will break things, but still
const VERSION_NUMBER = "v1.1.5003X";

// Used by webworker and normal code
export const CHECK_INTERVAL_MS = 1000 * 10;

type NoteLinkArgs = {
    text: string;
    focusAnyway?: boolean;
    noteId?: NoteId;
    preventScroll?: boolean;
};

function NoteLink() {
    const root = div({ style: "padding:5px; ", class: "handle-long-words" })

    function renderNoteLink() {
        const { text, noteId, focusAnyway } = component.args;

        setClass(root, "hover-link", !!noteId);
        setText(root, truncate(text, 500));
        root.el.style.backgroundColor = (!!focusAnyway || state.currentNoteId === noteId) ? (
            "var(--bg-color-focus)"
        ) : (
            "var(--bg-color)"
        );
    }

    root.el.addEventListener("click", () => {
        const { noteId, preventScroll, } = component.args;

        // setTimeout here because of a funny bug when clicking on a list of note links that gets inserted into 
        // while we are clicking will cause the click event to be called on both of those links. Only in HTML is
        // something like this allowed to happen. LOL.
        setTimeout(() => {
            if (noteId) {
                setCurrentNote(state, noteId);
                rerenderApp(preventScroll || false);
            }
        }, 1);
    });

    const component = newComponent<NoteLinkArgs>(root, renderNoteLink);
    return component;
}

type TodoListInternalArgs = {
    priorityLevel: number;
    heading: string;
    setScrollEl?(c: Insertable): void;
    cursorNoteId?: NoteId;
};

function scrollNavItem(children?: ChildList) {
    // HACK: (only kind of a hack) the cursor isn't actually bg-color-focus, it is transparent, and it just pushes the row to the side. 
    // The row has bg-color, whereas the root div behind it has --bg-color-focus
    const cursor = div({ class: "pre", }, [" --> "]);

    const root = div({
        class: "row align-items-center",
        style: "background-color: var(--bg-color-focus);"
    }, [
        cursor,
        div({
            class: "hover-parent flex-1 handle-long-words",
            style: "border-top: 1px solid var(--fg-color);" +
                "border-left: 4px solid var(--fg-color);" +
                "border-right: 1px solid var(--fg-color);" +
                "border-bottom: 1px solid var(--fg-color);" +
                "padding-left: 3px;" +
                "background-color: var(--bg-color);"
        }, children)
    ]);

    return [root, cursor] as const;
}

function isNoteInSameGroupForTodoList(currentNote: TreeNote, other: TreeNote) {
    const currentHigherLevelTask = getHigherLevelTask(state, currentNote);
    let focusAnyway = false;
    if (currentHigherLevelTask) {
        const noteHigherLevelTask = getHigherLevelTask(state, other);
        focusAnyway = noteHigherLevelTask?.id === currentHigherLevelTask.id;
    }
    return focusAnyway;
}


function TodoListInternal() {
    type TodoItemArgs = {
        note: TreeNote;
        focusAnyway: boolean;
        cursorNoteId: NoteId | undefined;
    }

    function TodoListItem() {
        const noteLink = NoteLink();
        const lastEditedNoteLink = NoteLink();
        const progressText = div();
        const [root, cursor] = scrollNavItem([
            div({ class: "flex-1 row align-items-center" }, [
                progressText,
                div({ class: "flex-1" }, [
                    noteLink,
                    div({ style: "padding-left: 60px" }, [
                        lastEditedNoteLink,
                    ]),
                ]),
            ]),
        ]);

        const component = newComponent<TodoItemArgs>(root, renderTodoItem);

        function renderTodoItem() {
            const { note, focusAnyway, cursorNoteId } = component.args;

            const higherLevelTask = getHigherLevelTask(state, note);

            setText(progressText, getNoteProgressCountText(note));
            setVisible(cursor, !!cursorNoteId && cursorNoteId === note.id);

            setClass(root, "strikethrough", note.data._status === STATUS_DONE);

            let text = note.data.text;
            if (higherLevelTask) {
                const higherLevelText = getNoteTextWithoutPriority(higherLevelTask.data);
                const lowerLevelText = getNoteTextWithoutPriority(note.data);
                text = "[" + higherLevelText + "] >> " + lowerLevelText
            }

            noteLink.render({
                noteId: note.id,
                text,
                preventScroll: true,
                focusAnyway,
            });

            setVisible(lastEditedNoteLink, false);
            const lastEditedChildId = note.childIds[note.data.lastSelectedChildIdx];
            if (!!lastEditedChildId) {
                const note = getNote(state, lastEditedChildId);

                setVisible(lastEditedNoteLink, true);
                lastEditedNoteLink.render({
                    noteId: lastEditedChildId,
                    text: note.data.text,
                    preventScroll: true,
                    focusAnyway,
                });
            }
        }

        return component;
    }

    const componentList = newListRenderer(div(), TodoListItem);
    const headingEl = el("H3", {});
    const root = div({}, [
        headingEl,
        componentList,
    ])

    const component = newComponent<TodoListInternalArgs>(root, renderTodoListInternal);

    function renderTodoListInternal() {
        const { heading, priorityLevel, setScrollEl, cursorNoteId } = component.args;

        if (setVisible(headingEl, !!heading)) {
            setText(headingEl, heading);
        }

        let count = 0;
        let alreadyScrolled = false;

        componentList.render(() => {
            for (let i = 0; i < state._todoNoteIds.length; i++) {
                const id = state._todoNoteIds[i];
                // const nextId: NoteId | undefined = state.todoNoteIds[i + 1];

                const note = getNote(state, id);
                // const nextNote = nextId ? getNote(state, nextId) : undefined;

                // if (getTodoNotePriority(note.data) !== priorityLevel) {
                //     continue;
                // }

                count++;

                // const focusAnyway = isCurrentNoteOnOrInsideNote(state, note)
                const focusAnyway = isNoteInSameGroupForTodoList(getCurrentNote(state), note);
                const c = componentList.getNext();
                c.render({
                    note: note,
                    focusAnyway,
                    cursorNoteId
                });

                if (setScrollEl && !alreadyScrolled) {
                    if (
                        (cursorNoteId && note.id === cursorNoteId) ||
                        (!cursorNoteId && focusAnyway)
                    ) {
                        setScrollEl(c);
                        alreadyScrolled = true;
                    }
                }
            }
        });

        setVisible(root, count > 0);
    }

    return component;
}

type TodoListArgs = {
    cursorNoteId?: NoteId;
}

function TodoList() {
    const heading = el("H3", { style: "user-select: none; padding-left: 10px;" }, ["TODO Lists"]);
    // const inProgress = TodoListInternal();
    // const todo = TodoListInternal();
    const backlog = TodoListInternal();
    // const empty = div({}, ["Notes starting with '>', '>>', or '>>>' will end up in 1 of three lists. Try it out!"]);
    const empty = div({}, ["Notes starting with '>' get put into the TODO list! You can navigate the todo list with [Ctrl] + [Shift] + [Up/Down]. You can only see other TODO notes underneath the current TODO parent note."]);
    const root = initEl(ScrollContainerV(), { class: "flex-1 col" }, [ 
        heading,
        empty,
        // inProgress,
        // todo,
        backlog,
    ]);

    const comopnent = newComponent<TodoListArgs>(root, renderTodoList);

    function renderTodoList() {
        const { cursorNoteId } = comopnent.args;

        setVisible(empty, state._todoNoteIds.length === 0);

        const leftArrow = isInTodoList ? "<- "  : "";
        const rightArrow = isInTodoList ? " ->"  : "";

        let headingText = leftArrow + "Everything in progress" + rightArrow;
        if (state._todoNoteFilters === -1) {
            const note = getCurrentNote(state);
            const hlt = getHigherLevelTask(state, note);
            const hltText = hlt ? hlt.data.text : "[Nothing]";
            headingText = "Everything in progress under [" + hltText + "]" + rightArrow;
        } else if (state._todoNoteFilters === 1) {
            headingText = leftArrow + "Most recent In-progress items from everything";
        }
        setText(heading, headingText);

        let scrollEl: Insertable | null = null;

        function setScrollEl(el: Insertable) {
            if (!scrollEl) {
                scrollEl = el;
            }
        }

        // inProgress.render({
        //     priorityLevel: 3,
        //     heading: "In Progress",
        //     cursorNoteId,
        //     setScrollEl,
        // });
        //
        // todo.render({
        //     priorityLevel: 2,
        //     heading: "TODO",
        //     setScrollEl,
        //     cursorNoteId,
        // });

        backlog.render({
            priorityLevel: 1,
            heading: "",
            setScrollEl,
            cursorNoteId,
        });

        root.render({
            scrollEl,
            rescrollMs: 5000,
        });
    }

    return comopnent;
}


function BreakInput() {
    const breakInput = el<HTMLInputElement>("INPUT", { class: "w-100" });
    const breakButton = makeButton("");
    const root = div({ style: "padding: 5px;", class: "row align-items-center" }, [
        div({ class: "flex-1" }, [breakInput]),
        div({}, [breakButton]),
    ]);

    function renderBreakInput() {
        const isTakingABreak = isCurrentlyTakingABreak(state);

        setText(breakButton, isTakingABreak ? "Extend break" : "Take a break");
        breakInput.el.setAttribute("placeholder", "Enter break reason (optional)");
    }

    function addBreak() {
        let text = breakInput.el.value || "Taking a break ...";

        // When we add a break, we don't want to clear whatever state was preventing us from pressing 'enter' to start editing a note
        // Hence, the timeout
        setTimeout(() => {

            pushBreakActivity(state, newBreakActivity(text, new Date(), true));
            breakInput.el.value = "";

            debouncedSave();
            rerenderApp();
        }, 1);

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

    return newComponent(root, renderBreakInput);
}


function ActivityListItem() {
    const breakEdit = el<HTMLInputElement>(
        "INPUT", { class: "pre-wrap w-100 solid-border-sm-rounded", style: "padding-left: 5px" }
    );

    const insertBreakButton = makeButton("+ Insert break here");
    const breakInsertRow = div({ class: "align-items-center justify-content-center row" }, [
        div({ class: "flex-1", style: "border-bottom: 1px solid var(--fg-color)" }),
        insertBreakButton,
        div({ class: "flex-1", style: "border-bottom: 1px solid var(--fg-color)" }),
    ]);

    const deleteButton = makeButton("x");
    const noteLink = NoteLink();
    const durationEl = div({ style: "padding-left: 10px; padding-right: 10px;" });
    const timestamp = DateTimeInput();
    const timestampWrapper = div({ style: "" }, [timestamp]);
    const visibleRow = div({ class: "hover-parent" }, [
        div({ class: "row", style: "gap: 20px" }, [
            div({ class: "flex-1" }, [
                timestampWrapper,
                div({ class: "row align-items-center", style: "padding-left: 20px" }, [
                    noteLink,
                    breakEdit,
                    deleteButton,
                ]),
            ]),
            durationEl,
        ])
    ])

    const root = div({}, [
        div({ class: "hover-parent", style: "min-height: 10px" }, [
            div({ class: "hover-target" }, [
                breakInsertRow
            ])
        ]),
        visibleRow,
    ]);

    const component = newComponent<ActivityListItemArgs>(root, renderActivityListItem);

    function renderActivityListItem() {
        const { activity, nextActivity, showDuration, greyedOut, focus } = component.args;

        setStyle(visibleRow, "color", greyedOut ? "var(--unfocus-text-color)" : "");
        setStyle(root, "backgroundColor", focus ? "var(--bg-color-focus)" : "");

        const isEditable = !greyedOut && isEditableBreak(activity);
        // I think all break text should just be editable...
        // I'm thinking we should be able to categorize breaks somehow, so we can filter out the ones we dont care about...
        const canEditBreakText = !greyedOut && isBreak(activity);

        const activityText = getActivityText(state, activity);

        if (setVisible(
            breakEdit,
            canEditBreakText,
        )) {
            if (!isEditingInput(breakEdit)) {
                setInputValue(breakEdit, activity.breakInfo!);
            }
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
            value: getActivityTime(activity),
            onChange: updateActivityTime,
            readOnly: false,
            nullable: false,
        });

        if (setVisible(durationEl, showDuration)) {
            const durationStr = (isEditable ? "~" : "") + formatDurationAsHours(getActivityDurationMs(activity, nextActivity));
            setText(durationEl, durationStr);
        }

        setVisible(deleteButton, isEditable);
    }

    function updateActivityTime(date: Date | null) {
        if (!date) {
            return;
        }

        const { previousActivity, activity, nextActivity } = component.args;

        if (previousActivity) {
            // don't update our date to be before the previous time
            const prevTime = getActivityTime(previousActivity);
            if (prevTime.getTime() > date.getTime()) {
                showStatusText(`Can't set time to ${formatDate(date)} as it would re-order the activities`);
                return;
            }
        }

        let nextTime = nextActivity ? getActivityTime(nextActivity) : new Date();
        if (nextTime.getTime() < date.getTime()) {
            showStatusText(`Can't set time to ${formatDate(date)} as it would re-order the activities`);
            return;
        }

        setActivityTime(activity, date);
        rerenderApp(false);
        debouncedSave();
    }

    insertBreakButton.el.addEventListener("click", () => {
        const { activity, nextActivity } = component.args;

        const idx = state.activities.indexOf(activity);
        if (idx === -1) {
            return;
        }

        const timeA = getActivityTime(activity).getTime();
        const duration = getActivityDurationMs(activity, nextActivity);
        const midpoint = timeA + duration / 2;

        const newBreak = newBreakActivity("New break", new Date(midpoint), false);
        state.activities.splice(idx + 1, 0, newBreak);

        debouncedSave();
        rerenderApp(false);
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
        rerenderApp(false);
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
        rerenderApp(false);
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

function ExportModal() {
    const root = Modal(div({ class: "col", style: "align-items: stretch" }, [
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
                const flatNotes: NoteId[] = getAllNoteIdsInTreeOrder(state);
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
                recomputeFlatNotes(state, flatNotes);

                copyToClipboard(exportAsText(state, flatNotes));
                showStatusText("Copied current open notes as text");
            });
        }),
        makeButtonWithCallback("Download JSON", () => {
            handleErrors(() => {
                saveText(getCurrentStateAsJSON(), `Note-Tree Backup - ${formatDate(new Date(), "-")}.json`);
            });
        }),
    ]));

    const component = newComponent(root, renderExportModal)

    function renderExportModal() {
        root.render({
            onClose: () => setCurrentModal(null)
        });
    };

    return component;
}

function DeleteModal(): Renderable {
    const heading = el("H2", { style: "text-align: center" }, [ "Delete current note" ]);
    const textEl = div();
    const countEl = div();
    const timeEl = div();
    const recentEl = div();
    const deleteButton = makeButton("Delete Note");
    const cantDelete = div({}, [ "Can't delete notes that are still in progress..." ]);
    const root = Modal(div({ style: modalPaddingStyles(10, 70, 50) }, [
        heading,
        textEl,
        div({ style: "height: 20px" }),
        countEl,
        timeEl,
        recentEl,
        div({ style: "height: 20px" }),
        div({ class: "row justify-content-center" }, [
            deleteButton,
            cantDelete,
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

    const component = newComponent(root, renderDeleteModal);

    function renderDeleteModal() {
        const currentNote = getCurrentNote(state);

        root.render({
            onClose: () => setCurrentModal(null),
        });

        setText(textEl, currentNote.data.text);

        let count = 0;
        dfsPre(state, currentNote, () => count++);
        setText(countEl, count + " notes in total");

        let totalTimeMs = getNoteDuration(state, currentNote, false);
        setText(timeEl, formatDuration(totalTimeMs) + " in total");

        const idx = getMostRecentlyWorkedOnChildActivityIdx(state, currentNote);
        setVisible(recentEl, !!idx)
        if (idx !== undefined) {
            const activity = state.activities[idx];
            setText(recentEl, "The last activity under this note was on " + formatDate(getActivityTime(activity), undefined, true));
        }

        const canDelete = currentNote.data._status === STATUS_DONE;
        setVisible(deleteButton, canDelete);
        setVisible(cantDelete, !canDelete);
    }

    return component;
}

function LinkNavModal(): Renderable {
    function LinkItem() {
        type LinkItemArgs = {
            noteId: NoteId;
            text: string;
            range: Range;
            url: string;
            isFocused: boolean;
        };
        
        const textEl = HighlightedText();
        const [root, cursor] = scrollNavItem([ textEl ]);

        const component = newComponent<LinkItemArgs>(root, renderLinkItem);

        function renderLinkItem() {
            const { text, range, isFocused, noteId } = component.args;

            textEl.render({
                text, 
                highlightedRanges: [ range ]
            });
            setVisible(cursor, isFocused);
            setStyle(root, "backgroundColor", noteId === state.currentNoteId ? "var(--bg-color-focus)" : "");
        }

        return component;
    }

    const linkList = newListRenderer(div(), LinkItem);
    const content = div({ style: "padding: 20px" }, [
        el("H2", {}, ["URLs above or under the current note"]),
        linkList,
    ]);
    const empty = div({ style: "padding: 40px" }, ["Couldn't find any URLs above or below the current note."]);
    const root = Modal(
        div({}, [
            content, 
            empty,
        ])
    );

    let idx = 0;
    let lastNote: TreeNote | undefined;
    const component = newComponent(root, renderLinkNavModal);

    function renderLinkNavModal() {
        const currentNote = getCurrentNote(state);
        if (lastNote === currentNote) {
            return;
        }

        lastNote = currentNote;

        root.render({
            onClose: () => setCurrentModal(null)
        });


        idx = 0;
        linkList.render(() => {

            function renderLink(note: TreeNote) {
                let urlCount = 0;

                forEachUrlPosition(note.data.text, (start, end) => {
                    const url = note.data.text.substring(start, end);
                    linkList.getNext().render({
                        url,
                        text: note.data.text,
                        range: [start, end],
                        isFocused: false,
                        noteId: note.id,
                    });

                    urlCount++;
                });

                return urlCount;
            }


            let notes: TreeNote[] = [];
            tree.forEachParent(state.notes, currentNote, (note) => {
                if (note !== currentNote) {
                    notes.push(note);
                }

                return false;
            });

            idx = 0;
            for (let i = notes.length - 1; i >= 0; i--) {
                idx += renderLink(notes[i]);
            }

            // Dont even need to collect these into an array before rendering them. lmao. 
            dfsPre(state, currentNote, (note) => {
                renderLink(note);
            });
        });

        rerenderItems();

        setVisible(content, linkList.components.length > 0);
        setVisible(empty, linkList.components.length === 0);
    }

    function rerenderItems() {
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
            e.stopImmediatePropagation();

            if (e.shiftKey) {

                if (noteId !== state.currentNoteId) {
                    setCurrentNote(state, noteId, true);
                    rerenderApp();
                }
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
};

function EditableActivityList() {
    const pagination: Pagination = { pageSize: 10, start: 0, totalCount: 0 }
    const paginationControl = PaginationControl();

    const listRoot = newListRenderer(div({ style: "border-bottom: 1px solid var(--fg-color);" }), ActivityListItem);
    const listScrollContainer = initEl(ScrollContainerV(), { class: "flex-1" }, [
        listRoot,
    ]);
    const statusTextEl = div({ class: "text-align-center" }, [  ]);
    const root = div({ class: "w-100 flex-1 col", style: "border-top: 1px solid var(--fg-color);" }, [
        statusTextEl,
        listScrollContainer,
        paginationControl,
    ]);

    let lastIdx = -1;
    const component = newComponent<EditableActivityListArgs>(root, rerenderActivityList);


    function rerenderActivityList() {
        const { pageSize, activityIndexes } = component.args;

        pagination.pageSize = pageSize || 10;
        if (lastIdx !== state._currentlyViewingActivityIdx) {
            lastIdx = state._currentlyViewingActivityIdx;
            setPage(pagination, idxToPage(pagination, state.activities.length - 1 - lastIdx));
        }
        paginationControl.render({
            pagination,
            totalCount: activityIndexes ? activityIndexes.length : state.activities.length,
            rerender: rerenderActivityList,
        });

        const activities = state.activities;
        const start = getStart(pagination);
        const end = getCurrentEnd(pagination);
        const activitiesToRender = end - start;

        let scrollEl: Insertable | null = null;
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

                // If there was a discontinuity in the activities/indicies, we want to render the next activity.
                // This gives us more peace of mind in terms of where the duration came from
                const hasDiscontinuity = idx !== -1 && 
                    idx + 1 < activities.length - 1 && 
                    lastRenderedIdx !== idx + 1;
                lastRenderedIdx = idx;

                if (hasDiscontinuity) {
                    const nextNextActivity = activities[idx + 2];
                    listRoot.getNext().render({
                        previousActivity: activity,
                        activity: nextActivity,
                        nextActivity: nextNextActivity,
                        showDuration: true,
                        focus: false,
                        greyedOut: true,
                    });
                }

                const c = listRoot.getNext();
                c.render({
                    previousActivity,
                    activity,
                    nextActivity,
                    showDuration: true,
                    focus: activity.nId === state.currentNoteId,
                });
                if (idx === state._currentlyViewingActivityIdx) {
                    scrollEl = c;
                }

                if (
                    i + 1 === activitiesToRender && 
                    idx - 2 >= 0
                ) {
                    const previousPreviousActivity = activities[idx - 2];
                    // Also render the activity before this list. so we can see the 1 activity before the ones in the lsit
                    listRoot.getNext().render({
                        previousActivity: previousPreviousActivity,
                        activity: previousActivity,
                        nextActivity: activity,
                        showDuration: true,
                        focus: false,
                        greyedOut: true,
                    });
                }
            }
        });

        listScrollContainer.render({
            scrollEl,
            rescrollMs: 5000,
        });

        let statusText = "";
        if (activityIndexes) {
            if (lastIdx === activities.length - 1) {
                statusText = "Reached most recent activity";
            } else if (activityIndexes.length === 0) {
                if (state._durationsOnlyUnderSelected) {
                    statusText = "0 results under the selected note";
                } else {
                    statusText = "0 results in this date range";
                }
            }
        }

        if (setVisible(statusTextEl, !!statusText)) {
            setText(statusTextEl, statusText);
        }
    }

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

    return textArea
}


type NoteRowArgs = {
    note: TreeNote;
    stickyOffset?: number;
    duration: number;
    totalDuration: number;
    hasDivider: boolean;
    scrollParent: HTMLElement | null;
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

function NoteRowText(): Renderable<NoteRowArgs> {
    const indentWidthEl = div({ class: "pre", style: "padding-right: 5px" });
    const indentEl = div({ class: "pre sb1l h-100", style: "padding-left: 5px; "});

    const whenNotEditing = div({ class: "handle-long-words", style: "" });
    const whenEditing = TextArea();
    whenEditing.el.setAttribute("rows", "1");
    whenEditing.el.setAttribute("class", "flex-1");
    whenEditing.el.setAttribute("style", "overflow-y: hidden; padding: 0;");

    const root = div({ class: "flex-1", style: "overflow-y: hidden;" }, [
        div({ class: "row h-100" }, [
            indentWidthEl, indentEl, whenNotEditing, whenEditing
        ])
    ]);

    let lastNote: TreeNote | undefined = undefined;
    let isFocused = false;
    let isEditing = false;
    const component = newComponent<NoteRowArgs>(root, renderNoteRow);

    function updateTextContentAndSize() {
        const { note } = component.args;

        setInputValue(whenEditing, note.data.text);
        lastNote = note;

        whenEditing.el.style.height = "0";
        whenEditing.el.style.height = whenEditing.el.scrollHeight + "px";
    }

    function renderNoteRow() {
        const { note } = component.args;

        const currentNote = getCurrentNote(state);
        const isOnSameLevel = currentNote.parentId === note.parentId;

        // This is mainly so that multi-line notes won't take up so much space as a parent note
        setStyle(root, "whiteSpace", isOnSameLevel ? "pre-wrap" : "nowrap" );

        const indentText = noteStatusToString(note.data._status);
        setText(indentEl, indentText + getNoteProgressCountText(note) +  " - ");
        const INDENT = 1;
        const INDENT2 = 4;
        const indent1 = INDENT * note.data._depth;
        const depth = isOnSameLevel ? (
            // the current level gets indented a bit more, for visual clarity,
            // and the parent notes won't get indented as much so that we aren't wasting space
            indent1 - INDENT + INDENT2
        ) : indent1;
        setStyle(indentWidthEl, "minWidth", depth + "ch");

        isFocused = state.currentNoteId === note.id;
        const wasEditing = isEditing;
        isEditing = isFocused && state._isEditingFocusedNote;
        if (lastNote !== note || !isEditing) {
            isFocused = false;
        }

        if (setVisible(whenEditing, isEditing)) {
            if (!wasEditing) {
                if (!renderOptions.isTimer) {
                    whenEditing.el.focus({ preventScroll: true });
                }
            }
        }

        if (setVisible(whenNotEditing, !isEditing)) {
            setText(whenNotEditing, note.data.text);
        }

        // Actually quite important that this runs even when we aren't editing, because when we eventually
        // set the input visible, it needs to auto-size to the correct height, and it won't do so otherwise
        updateTextContentAndSize();
    }

    whenEditing.el.addEventListener("input", () => {
        const { note } = component.args;

        // Perform a partial update on the state, to just the thing we're editing

        note.data.text = whenEditing.el.value;

        updateTextContentAndSize();

        debouncedSave();

        rerenderApp();
    });

    whenEditing.el.addEventListener("keydown", (e) => {
        const currentNote = getCurrentNote(state);

        const shiftPressed = e.shiftKey;
        const ctrlPressed = e.ctrlKey || e.metaKey;

        let needsRerender = true;
        let shouldPreventDefault = true;

        if (e.key === "Enter" && handleEnterPress(ctrlPressed, shiftPressed)) {
            // it was handled
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
    focus: boolean;
    greyedOut?: boolean;
};

function ActivityFiltersEditor(): Renderable {
    function onChange() {
        rerenderApp(false);
    }

    const todayButton = makeButton("Today");
    todayButton.el.addEventListener("click", () => {
        setActivityRangeToday(state);
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
    const dateFrom = DateTimeInput("from");
    const dateTo = DateTimeInput("to");
    const onlyUnderCurrentNote = Checkbox("Under selected?");
    const root = div({ class: "row", style: "white-space: nowrap" }, [
        div({ style: "width: 20px" }),
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
        div({ class: "row", style: "padding-left: 10px; padding-right: 10px" }, [dateFrom]),
        div(blockStyle, [dateTo]),
        onlyUnderCurrentNote,
    ]);

    const component = newComponent(root, () => {
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

        onlyUnderCurrentNote.render({
            value: state._durationsOnlyUnderSelected,
            onChange: (val) => {
                state._durationsOnlyUnderSelected = val;
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

function HighlightedText() {
    function Span() {
        const root = el("SPAN", { class: "" })

        type Args = { 
            highlighted: boolean; 
            text: string; 
        };

        const component = newComponent<Args>(root, renderSpan);

        function renderSpan() {
            setText(root, component.args.text);
            setClass(root, "unfocused-text-color", !component.args.highlighted);
        }

        return component;
    }

    const root = div({});
    const list = newListRenderer(root, Span);

    type Args = {
        text: string;
        highlightedRanges: Range[];
    }
    const component = newComponent<Args>(root, renderHighlightedText);

    function renderHighlightedText() {
        const { highlightedRanges: ranges, text } = component.args;

        list.render(() => {
            let last = 0;
            for (const [start, end] of ranges) {
                const part1 = text.substring(last, start);
                if (part1) {
                    list.getNext().render({ text: part1, highlighted: false });
                }

                const part2 = text.substring(start, end);
                if (part2) {
                    list.getNext().render({ text: part2, highlighted: true});
                }

                last = end;
            }

            const lastPart = text.substring(last);
            if (lastPart) {
                list.getNext().render({ text: lastPart, highlighted: false });
            }
        });
    }

    return component;
}

function FuzzyFinder(): Renderable {
    type ResultArgs = {
        text: string;
        ranges: Range[];
        hasFocus: boolean;
    }

    function FindResultItem() {
        const textDiv = HighlightedText();
        const [root, cursor] = scrollNavItem([ textDiv ]);
        let lastRanges: any = null;

        const component = newComponent<ResultArgs>(root, renderFindResultItem);

        function renderFindResultItem() {
            const { text, ranges, hasFocus } = component.args;

            // This is basically the same as the React code, to render a diff list, actually, useMemo and all
            if (ranges !== lastRanges) {
                textDiv.render({ text: text, highlightedRanges: ranges });
            }

            setVisible(cursor, hasFocus);
            root.el.style.backgroundColor = hasFocus ? "var(--bg-color-focus)" : "var(--bg-color)";
            textDiv.el.style.padding = hasFocus ? "20px" : "10px";

            if (hasFocus) {
                const scrollParent = root.el.parentElement!;
                scrollIntoViewV(scrollParent, root, 0.5);
            }
        }

        return component;
    };

    const resultList = newListRenderer(div({ class: "h-100 overflow-y-auto" }), FindResultItem);

    type Match = {
        note: TreeNote;
        ranges: Range[];
        score: number;
    };
    const matches: Match[] = [];
    let currentSelectionIdx = 0;

    const searchInput = el<HTMLInputElement>("INPUT", { class: "w-100" });
    const root = div({ class: "flex-1 col" }, [
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
    const DEBOUNCE_MS = 10;
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


    const component = newComponent(root, () => {
        searchInput.el.focus();
        rerenderSearch();
    });

    searchInput.el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const note = matches[currentSelectionIdx].note;
            setCurrentNote(state, note.id, true);
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
        div({ class: "col h-100", style: modalPaddingStyles(10) }, [
            fuzzyFind
        ])
    );

    const component = newComponent(modalComponent, () => {
        modalComponent.render({
            onClose: () => setCurrentModal(null)
        });

        fuzzyFind.render(undefined);
    });

    return component;
}

function modalPaddingStyles(paddingPx: number, width = 94, height = 90) {
    return `width: ${width}vw; height: ${height}vh; padding: ${paddingPx}px`;
}

function LoadBackupModal() {
    const fileNameDiv = el("H3");
    const infoDiv = div();
    const loadBackupButton = makeButton("Load this backup");
    const modal = Modal(
        div({ class: "col", style: modalPaddingStyles(10, 40, 40) }, [
            fileNameDiv,
            infoDiv,
            loadBackupButton,
        ]),
    );

    let canLoad = false;
    
    type LoadBackupModalArgs = {
        fileName: string;
        text: string;
    };
    const component = newComponent<LoadBackupModalArgs>(modal, () => {
        modal.render({
            onClose: () => setCurrentModal(null)
        });

        const { text, fileName } = component.args;

        setText(fileNameDiv, "Load backup - " + fileName);
        setVisible(loadBackupButton, false);
        canLoad = false;

        try {
            const backupState = loadStateFromBackup(text);
            if (!backupState) {
                throw new Error("No existing state to back up");
            }

            const lastOnline = parseDateSafe(backupState?.breakAutoInsertLastPolledTime);
            const theme = backupState.currentTheme;

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

    loadBackupButton.el.addEventListener("click", () => {
        if (!canLoad || !component.args.text) {
            return;
        }

        if (confirm("Are you really sure you want to load this backup? Your current state will be wiped")) {
            const { text } = component.args;

            setStateFromJSON(text);

            saveCurrentState({ debounced: false });

            initState(() => {
                setCurrentModal(null);
            });
        }
    });

    return component;
}

function AsciiCanvasModal() {
    const asciiCanvas = AsciiCanvas();
    const modalComponent = Modal(
        div({ style: modalPaddingStyles(10) }, [
            asciiCanvas
        ])
    );

    const component = newComponent<AsciiCanvasArgs>(modalComponent, () => {
        modalComponent.render({
            onClose() {
                setCurrentModal(null);
            }
        });

        asciiCanvas.render(component.args);
    });

    return component;
}

function NoteRowDurationInfo() {
    const durationEl = div();
    const estimateEl = div();
    const root = div({ style: "text-align: right;" }, [
        durationEl,
        estimateEl,
    ]);

    const component = newComponent<{ note: TreeNote; duration: number; }>(root, renderNoteRowDurationInfo);

    function renderNoteRowDurationInfo() {
        const { note, duration } = component.args;

        // render task duration/estimate info right here itself.
        const estimate = getNoteEstimate(state, note);

        const hasDuration = duration > 0;
        const hasEstimate = estimate > 0;

        if (setVisible(durationEl, hasDuration)) {
            setText(durationEl, formatDurationAsHours(duration));
        }

        if (setVisible(estimateEl, hasEstimate)) {
            const durationNoRange = getNoteDuration(state, note, false);
            setStyle(estimateEl, "color", durationNoRange < estimate ? "" : "#F00");
            setText(estimateEl, formatDurationAsHours(durationNoRange) + "/" + formatDurationAsHours(estimate));
        }
    }

    return component;
}

function NoteRowInput() {
    const noteRowText = NoteRowText();

    const sticky = div({ class: "row align-items-center", style: "background-color: #0A0; color: #FFF" }, [" ! "]);
    const noteDuration = NoteRowDurationInfo();
    const cursorEl = div({ style: "width: 10px;" });
    const inProgressBar = div({ class: "row align-items-center", style: "padding-right: 4px" }, [
        noteDuration
    ]);

    const progressBar = div({ class: "inverted", style: "height: 4px;" });

    const root = div({ class: "row pre", style: "background-color: var(--bg-color)" }, [
        div({ class: "flex-1" }, [
            div({ class: "row align-items-stretch", style: "" }, [
                cursorEl,
                noteRowText, 
                sticky,
                inProgressBar, 
            ]),
            progressBar,
        ]),
    ]);

    function setStickyOffset() {
        const { stickyOffset } = component.args;

        if (stickyOffset !== undefined) {
            root.el.style.position = "sticky";
            root.el.style.top = stickyOffset + "px";
            return;
        } 

        clearStickyOffset();
    }

    function clearStickyOffset() {
        root.el.style.position = "";
        root.el.style.top = "";
    }

    function scrollComponentToView() {
        const { scrollParent } = component.args;

        if (!scrollParent) {
            return;
        }

        // Clearing and setting the sticky style allows for scrolling to work.
        
        clearStickyOffset();

        // We can completely obscure the activity and todo lists, now that we have the right-dock
        scrollIntoViewV(scrollParent, root, 0.5);

        setStickyOffset();
    }

    let isFocused = false;
    let isShowingDurations = false;

    const component = newComponent<NoteRowArgs>(root, renderNoteRowInput);

    function renderNoteRowInput() {
        const { note, duration, totalDuration, hasDivider } = component.args;
        const currentNote = getCurrentNote(state);

        const wasFocused = isFocused;
        isFocused = state.currentNoteId === note.id;
        const wasShowingDurations = isShowingDurations;
        isShowingDurations = state._isShowingDurations;
        
        // render cursor 
        {
            const lastActivity = getLastActivityWithNote(state);
            const isLastEditedNote = lastActivity?.nId === note.id;
            let isFocusedAndEditing = isLastEditedNote && !isCurrentlyTakingABreak(state);

            let col = "";
            if (isFocusedAndEditing) {
                col = "#F00";
            } else if (isFocused) {
                col = "var(--fg-color)";
            } else if (isLastEditedNote) {
                col = "#00F";
            }

            setStyle(cursorEl, "backgroundColor", col);
        }
        

        // render progress text
        {
            noteDuration.render({ note, duration });
        }

        // render the sticky indicator
        {
            setVisible(sticky, note.data.isSticky);
            setStickyOffset();
        }


        // add some root styling
        {
            root.el.style.color = (note.data._isSelected || note.data._status === STATUS_IN_PROGRESS || note.data.isSticky) ? 
                "var(--fg-color)" : "var(--unfocus-text-color)";

            // Dividing line between different levels
            setStyle(root, "borderBottom", !hasDivider ? "" : "1px solid var(--fg-color)");
            setStyle(root, "backgroundColor", isFocused ? "var(--bg-color-focus)" : "var(--bg-color)");
        }


        // render the progress bar if needed
        if (setVisible(progressBar, isShowingDurations)) {
            const isOnCurrentLevel = note.parentId === currentNote.parentId;
            let percent = totalDuration < 0.000001 ? 0 : 100 * duration! / totalDuration!;

            setStyle(progressBar, "width", percent + "%")
            setStyle(progressBar, "backgroundColor", isOnCurrentLevel ? "var(--fg-color)" : "var(--unfocus-text-color)");
        }
        
        // render the text input
        noteRowText.render(component.args);

        // do auto-scrolling
        {
            if (renderOptions.shouldScroll && isFocused && (!wasFocused || (wasShowingDurations !== isShowingDurations))) {
                if (renderOptions.shouldScroll) {
                    // without setTimeout here, calling focus won't work as soon as the page loads.
                    setTimeout(() => {
                        scrollComponentToView();
                    }, 1);
                }
            }
        }
    }


    root.el.addEventListener("click", () => {
        const { note } = component.args;

        setCurrentNote(state, note.id);
        rerenderApp();
    });

    return component;
}

function NoteListInternal() {
    const root = div({
        class: "w-100 sb1b sb1t",
    });
    const noteList = newListRenderer(root, NoteRowInput);
    const durations = new Map<NoteId, number>();

    type Args = {
        flatNotes: NoteId[];
        scrollParent: HTMLElement | null;
    }
    const component = newComponent<Args>(root, renderNoteListInteral);

    function renderNoteListInteral() {
        const { flatNotes, scrollParent } = component.args;

        noteList.render(() => {
            let stickyOffset = 0;

            durations.clear();
            const currentNote = getCurrentNote(state);

            for (let i = 0; i < flatNotes.length; i++) {
                const id = flatNotes[i];
                const note = getNote(state, id);
                const component = noteList.getNext();

                const isOnCurrentLevel = currentNote.parentId === note.parentId;
                let isSticky = note.data._isSelected ||
                    (isOnCurrentLevel && (
                        note.data.isSticky || 
                        getLastActivityWithNote(state)?.nId === note.id
                    ));
                    
                const durationMs = getNoteDuration(state, note, true);
                durations.set(note.id, durationMs);

                assert(note.parentId);
                const parentNote = getNote(state, note.parentId);
                const parentDurationMs = durations.get(parentNote.id) || getNoteDuration(state, parentNote, true);
                durations.set(parentNote.id, parentDurationMs);

                component.render({
                    note,
                    stickyOffset: isSticky ? stickyOffset : undefined,
                    duration: durationMs,
                    hasDivider: !isOnCurrentLevel,
                    totalDuration: parentDurationMs,
                    scrollParent,
                });

                // I have no idea how I would do this in React, tbh.
                // But it was really damn easy here lol.
                if (isSticky) {
                    stickyOffset += component.el.getBoundingClientRect().height;
                }
            }
        });
    }

    return component;
}

function NotesList(): Renderable {
    const list1 = NoteListInternal(); 
    const root = div({}, [
        list1,
    ]);

    const component = newComponent(root, () => {
        list1.render({ 
            flatNotes: state._flatNoteIds, 
            scrollParent: root.el.parentElement,
        });
    });

    return component;
}

const renderOptions: RenderOptions = {
    shouldScroll: false,
    isTimer: false,
};

function getTheme(): AppTheme {
    if (state.currentTheme === "Dark") {
        return "Dark";
    }

    return "Light";
};

function setTheme(theme: AppTheme) {
    state.currentTheme = theme;

    if (theme === "Light") {
        setCssVars([
            ["--bg-in-progress", "rgb(255, 0, 0, 1"],
            ["--fg-in-progress", "#FFF"],
            ["--bg-color", "#FFF"],
            ["--bg-color-focus", "#CCC"],
            ["--bg-color-focus-2", "rgb(0, 0, 0, 0.4)"],
            ["--fg-color", "#000"],
            ["--unfocus-text-color", "#A0A0A0"],
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
            ["--unfocus-text-color", "#707070"],
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

    const component = newComponent<AsciiIconData>(icon, () => {
        const { data } = component.args;
        setText(icon, data);
    });

    return component;
}

function DarkModeToggle() {
    const button = makeButton("");
    const iconEl = AsciiIcon();
    replaceChildren(button, [
        iconEl,
    ]);

    const component = newComponent(button, renderButton);

    function getIcon(theme: AppTheme) {
        if (theme === "Light") return ASCII_SUN;
        if (theme === "Dark") return ASCII_MOON_STARS;
        return ASCII_MOON_STARS;
    }

    function renderButton() {
        iconEl.render(getIcon(getTheme()));
    }

    button.el.addEventListener("click", () => {
        let theme = getTheme();
        if (!theme || theme === "Light") {
            theme = "Dark";
        } else {
            theme = "Light";
        }

        setTheme(theme);
        rerenderApp();
    });

    return component;
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
    // We want to detect certain bugs that the timer is hiding, so we use this to prevent rerendering in those cases
    isTimer: boolean;
}

let currentModal: Insertable | null = null;
const setCurrentModal = (modal: Insertable | null) => {
    if (currentModal === modal) {
        return;
    }

    setIsEditingCurrentNote(state, false);

    currentModal = modal;

    rerenderApp();
}

function toggleCurrentDockedMenu(menu: DockableMenu) {
    if (state.dockedMenu !== menu) {
        state.showDockedMenu = true;
        state.dockedMenu = menu;
    } else {
        state.showDockedMenu = !state.showDockedMenu;
    }

    rerenderApp();
}

function setCurrentDockedMenu(menu: DockableMenu | null) {
    if (menu === null) {
        state.showDockedMenu = false;
    } else {
        state.showDockedMenu = true;
        state.dockedMenu = menu;
    }

    rerenderApp();
}

function ActivityListContainer() {
    const scrollActivitiesToTop = makeButton("Top");
    const scrollActivitiesToMostRecent = makeButton("Most Recent");
    const nextActivity = makeButton("<-");
    const prevActivity = makeButton("->");
    const activityList = EditableActivityList();
    const breakInput = BreakInput();
    const root = div({ class: "flex-1 col" }, [
        div({ class: "flex row align-items-center", style: "user-select: none; padding-left: 10px;" }, [
            el("H3", { style: "" }, ["Activity List"]),
            div({ class: "flex-1" }),
            scrollActivitiesToTop,
            scrollActivitiesToMostRecent,
            div({ style: "width: 10px" }),
            div({ style: "width: 50px" }, [nextActivity]),
            div({ style: "width: 50px" }, [prevActivity]),
        ]),
        breakInput,
        activityList,
    ]);

    const component = newComponent<{ docked: boolean }>(root, render);

    function getNextIdx() {
        return findNextActiviyIndex(state, state.currentNoteId, state._currentlyViewingActivityIdx);
    }

    function getPrevIdx() {
        return findPreviousActiviyIndex(state, state.currentNoteId, state._currentlyViewingActivityIdx);
    }

    function getMostRecentIdx() {
        return findPreviousActiviyIndex(state, state.currentNoteId, state.activities.length - 1);
    }


    function render() {
        breakInput.render(undefined);

        if (component.args.docked) {
            activityList.render({
                pageSize: 20,
                activityIndexes: state._useActivityIndices ? state._activityIndices : undefined,
            });

        } else {
            activityList.render({
                pageSize: 20,
                activityIndexes: state._useActivityIndices ? state._activityIndices : undefined,
            });
        }

        setVisible(scrollActivitiesToTop, state._currentlyViewingActivityIdx !== state.activities.length - 1);
        setVisible(scrollActivitiesToMostRecent, state._currentlyViewingActivityIdx !== getMostRecentIdx());
        setVisible(prevActivity, getPrevIdx() !== -1);
        setVisible(nextActivity, getNextIdx() !== -1);
    }

    scrollActivitiesToTop.el.addEventListener("click", () => {
        state._currentlyViewingActivityIdx = state.activities.length - 1;
        rerenderApp();
    });

    scrollActivitiesToMostRecent.el.addEventListener("click", () => {
        state._currentlyViewingActivityIdx = getMostRecentIdx();
        rerenderApp();
    });

    prevActivity.el.addEventListener("click", () => {
        const idx = getPrevIdx();
        if (idx !== -1) {
            state._currentlyViewingActivityIdx = idx;
            rerenderApp();
        }
    });

    nextActivity.el.addEventListener("click", () => {
        const idx = getNextIdx();
        if (idx !== -1) {
            state._currentlyViewingActivityIdx = idx;
            rerenderApp();
        }
    });


    return component;
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
    return newComponent(div({ style: "padding: 10px" }, [
        el("H3", {}, ["Cheatsheet"]),
        el("H4", {}, ["Offline use"]),
        isRunningFromFile() ? (
            div({}, [ 
                "The 'Download this page!' button is gone, now that you've downloaded the page." ,
                ` Moving or renaming this file will result in all your data being lost, so make sure you download a copy of your JSON before you do that.`,
                ` The same is true if I or my hosting provider decided to change the URL of this page - but you have far less control over that.`,
            ])
        ) : (
            div({}, [
                div({ class: "row align-items-center", style: "gap: 30px" }, [
                    ` This web page can be saved to your computer and ran offline!`,
                    makeDownloadThisPageButton(),
                ]),
                `You will need to download the json here and load the json there if you've already been using it online for a while.`,
                ` I would recommend this, because if I, or my hosting provider, decided to change the URL of this page (lets say I don't like Tejas-H5 as a github username, and I change it to Tejas-H6 for example) - all your data will be lost.`,
            ])
        ),
        div({}, [
            "I will be frequently updating the app (https://tejas-h5.github.io/Working-on-Tree/) whenever I find bugs or think of improvements, so you might be interested in checking there for updates every now and then"
        ]),
        el("H4", {}, ["Basic functionality, and shortcut keys"]),
        div({}),
        makeUnorderedList([
            keymapDivs(`[Enter], while not editing`, `start editing the current note`),
            keymapDivs(`[Enter], while editing`, `create a new note after the current note`),
            keymapDivs(`[Ctrl] + [Enter]`, `create a new note 1 level below the current note`),
            keymapDivs(`[Shift] + [Enter], while editing`, `insert new lines in the note text. Unless the note starts with --- in which case [Shift] + [Enter] adds a new note after this one, and [Enter] adds new lines.`),
            keymapDivs(`[Esc], when editing`, `Stop editing`),
            keymapDivs(`[Up]/[PageUp]/[Home]/[Ctrl+Up], not editing`, `Move upwards various amounts`),
            keymapDivs(`[Down]/[PageDown]/[Home]/[Ctrl+Down], not editing`, `Move downwards various amounts`),
            keymapDivs(`[Left], not editing`, `Move up 1 level 'out of' the note`),
            keymapDivs(`[Right], not editing`, `Move down 1 level 'into' the note`),
            keymapDivs(`[Alt] + [Previous movement keys], not editing`, `Grab and move the current note around the tree to where you would have otherwise moved normally`),
        ]),
        div({}),
        makeUnorderedList([
            keymapDivs(`[Ctrl] + [Shift] + [A]`, `Toggle between docking the Activity list and the TODO list on the right`),
            keymapDivs(`[Ctrl] + [Shift] + [Space]`, `Toggle the dock on/off`),
            keymapDivs(`[Ctrl] + [Shift] + [F]`, `Open the search modal`),
            keymapDivs(`[Ctrl] + [Shift] + [S]`, `Open the scratch pad`),
            keymapDivs(`[Ctrl] + [/]`, `Find and open URLs above or below a note`),
            keymapDivs(`[Ctrl] + [Shift] + [1]`, `Make this note sticky. It will still be visible when youve scrolled down a lot.`),
            keymapDivs(`[Ctrl] + [Shift] + [Left/Right]`, `Move back and forth between sequences of notes in the activity list, i.e if you wrote several notes one after the other, the previous notes in the sequence get skipped and you're taken straight to the end of the previous sequence. Some actions will save the previous note, which will be used before looking in the activity list.`),
            keymapDivs(`[Ctrl] + [Shift] + [Up/Down]`, `Move up and down the TODO list. PageUp/PageDown won't work here due to web/browser reasons...`),
        ]),
        el("H4", {}, ["Note statuses"]),
        makeUnorderedList([
            noteStatusToString(STATUS_IN_PROGRESS) + ` - This note is currently in progress`,
            noteStatusToString(STATUS_ASSUMED_DONE) + ` - This note is assumed to be done`,
            noteStatusToString(STATUS_DONE) + ` - This note has been manually marked as done by you`,
        ]),
        el("H4", {}, ["TODO notes"]),
        el("P", {}, ["Using specific text at the very start of a note can affect it's status:"]),
        makeUnorderedList([
            `Starting a note with >, >> or >>> will create a 'TODO note', and place it into the Backlog, Todo and In-Progress list respectively`,
            `If you are underneath a TODO note, you can only see other notes under that TODO note, and you can't see TODO notes under those notes. 
                This is a deliberate design decision, which allows you to effectively have >, >> ,>>> tasks within each other, while avoiding
                flooding the TODO list with hundreds of tasks.`,
            `Starting a note with DONE, Done, done, will mark a particular note and every note above it under the same note as DONE. 
             A note can also be marked as DONE if every note under it has been marked as DONE.`,
            `Move between TODO notes with [Ctrl] + [Shift] + [Up/Down]`,
        ]),
        el("H4", {}, ["The Activity List"]),
        makeUnorderedList([
            `Each time you start editing a note, the current note and time are recorded in the activity list.`,
            `The time between this activity and the next activity will contribute towards the overal 'duration' of a note, and all of it's parent notes.`,
            `You can add or insert breaks to prevent some time from contributing towards the duration of a particular note`,
            `The only reason breaks exist is to 'delete' time from duration calculations (at least, as far as this program is concerned)`,
            `Breaks will also insert themselves automatically, if you've closed the tab or put your computer to sleep for over ${(CHECK_INTERVAL_MS / 1000).toFixed(2)} seconds.
            I introduced this feature because I kept forgetting to add breaks, and often had to guess when I took the break.`,
            `Move through the activity list with [Ctrl] + [Shift] + [Left/Right]`,
        ]),
        el("H4", {}, ["Analytics"]),
        makeUnorderedList([
            `Press [Ctrl + Shift + D] to toggle 'duration mode'. You can now see a bunch of solid bars below each activity that lets you see which tasks you worked on today.`,
            `You can also change or disable the date range that is being used to calculate the duration next to each note, and filter the activity list`,
        ]),
        el("H4", {}, ["Estimates"]),
        makeUnorderedList([
            `You can add estimates to a particular note. Type E=<n>h where <n> is some number of hours (for now, you can only estimate in exact hours - it' a fairly new feature so I don't support 
                proper duration input like other time-tracking apps. This will pin the total duration of a particular note to the status, and this will go red if you're over your estimate. 
                This estimate will also contribute to the estimate of it's parent note, which is where the usefulness comes in - you won't have to do a bunch of adding by hand to get the total estimate.
                Estimation is kinda a pain, so I don't expect you to religiously use this feature.`,
            `You can also change or disable the date range that is being used to calculate the duration next to each note, and filter the activity list`,
        ]),
        el("H4", {}, ["Scratchpad"]),
        makeUnorderedList([
            `The scratchpad can be opened by clicking the "Scratchpad" button, or with [Ctrl] + [Shift] + [S]`,
            `You would use this to make diagrams or ascii art that you can then paste into your notes`,
            `There are also a few key shortcuts to be aware of:`,
            `Holding down [Alt] lets you move the selection`,
            `[Ctrl] + [Q] or [E] can move between the different selection tools`,
            `[Ctrl] + [Shift] + [V] and [Ctrl] + [V] can paste things with/without treating whitespace as transparency`,
        ]),
        el("H4", {}, ["Loading and saving"]),
        makeUnorderedList([
            `Your stuff is auto-saved 1 second after you finish typing. 
            You can download a copy of your data, and then reload it later/elsewhere with the "Download JSON" and "Load JSON" buttons.`,
        ]),
    ]), () => { });
}

function getNextHotlistActivityInDirection(state: State, idx: number, backwards: boolean, stepOver: boolean): number {
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
            // This method is for navigating backwards through the activity list to what you were working on before (or forwards, if you've navigated too far backwards).
            // But if I've made 20 notes one after the other in sequence, I don't want to go back up those notes typically. 
            // Rather, I want to skip those notes, and go to the discontinuity in activities.
            // That being said, if I make a note, then I step down 10 notes and write something, I want to go back up, even though it's under the same parent note
            //      (so I can't just skip over all notes with the same parent as the previous, like I was doing before).
            // That's the problem that this somewhat complex looking code is trying to solve

            // Due to recent overlap with the TODO list requirement, I'm temporarliy scrapping this code. I might delete this for good later
            break;

            // const lastNote = getNote(state, lastNoteId);
            // if (lastNote.parentId) {
            //     const parent = getNote(state, lastNote.parentId);
            //     const siblings = parent.childIds;
            //     const noteSiblingIdx = siblings.indexOf(lastNote.id);
            //     const prevSiblingId = siblings[noteSiblingIdx + direction];
            //
            //     if (activity.nId !== prevSiblingId) {
            //         // we have finally reached the discontinuity
            //         if (!stepOver) {
            //             idx--;
            //         }
            //         break;
            //     }
            //
            //     lastNoteId = prevSiblingId;
            // }
        }
    }


    return idx;
}

function moveToLastNote(): boolean{
    const lastNoteId = state._lastNoteId;
    
    if (!lastNoteId) {
        return false;
    }

    if (!hasNote(state, lastNoteId)) {
        return false;
    }

    const note = getNote(state, lastNoteId);
    const currentNote = getCurrentNote(state);

    // Don't bother moving to the last note if that note is literally just the one above/below
    if (currentNote.parentId === note.parentId) {
        const siblings = getNote(state, currentNote.parentId!).childIds;
        const currentIdx = siblings.indexOf(currentNote.id);
        if (siblings[currentIdx-1] === lastNoteId || siblings[currentIdx+1] === lastNoteId) {
            return false;
        }
    }

    setCurrentNote(state, lastNoteId);

    return true;
}

function moveInDirectonOverHotlist(backwards: boolean) {
    if (backwards) {
        if (moveToLastNote()) {
            return;
        }
    }

    if (!isInHotlist) {
        isInHotlist = true;

        state._currentlyViewingActivityIdx = getLastActivityWithNoteIdx(state);
        if (state._currentlyViewingActivityIdx === -1) {
            return;
        }

        const nId = state.activities[state._currentlyViewingActivityIdx].nId;
        if (state.currentNoteId !== nId) {
            setCurrentNote(state, nId!);
            setIsEditingCurrentNote(state, false);
            return;
        }
    }

    let nextIdx = state._currentlyViewingActivityIdx;
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
    state._currentlyViewingActivityIdx = nextIdx; // not necesssarily the most recent note
}

let lateralMovementStartingNote: NoteId | undefined = undefined;
let isInHotlist = false;
let isInTodoList = false;
function getCurrentTodoListIdx() {
    let currentIdx = -1;
    for (let i = state._todoNoteIds.length - 1; i >= 0; i--) {
        const id = state._todoNoteIds[i];
        const note = getNote(state, id);
        if (note.data._isSelected) {
            currentIdx = i;
            break;
        }
    }

    if (currentIdx === -1) {
        currentIdx = state._todoNoteIds.findIndex(id => {
            const note = getNote(state, id);
            return isNoteInSameGroupForTodoList(getCurrentNote(state), note);
        });
    }

    if (currentIdx === -1) {
        currentIdx = 0;
    }

    return currentIdx;
}
function moveInDirectionOverTodoList(amount: number) {
    const todoNoteIds = state._todoNoteIds;

    let wantedIdx = getCurrentTodoListIdx();
    if (!isInTodoList) {
        isInTodoList = true;
    } else {
        wantedIdx = Math.max(0, Math.min(todoNoteIds.length - 1, wantedIdx + amount));
    }

    // Move to the most recent note in this subtree.
    setCurrentNote(state, state._todoNoteIds[wantedIdx]);
    setIsEditingCurrentNote(state, false);
}

function autoInsertBreakIfRequired() {
    // This function is run inside of a setInterval that runs every CHECK_INTERVAL_MS, and when the 
    // webpage opens for the first time.
    // It may or may not need to be called more or less often, depending on what we add.

    // Need to automatically add breaks if we haven't called this method in a while.
    const time = new Date();
    const lastCheckTime = parseDateSafe(state.breakAutoInsertLastPolledTime);

    if (
        !!lastCheckTime &&
        (time.getTime() - lastCheckTime.getTime()) > CHECK_INTERVAL_MS * 2
    ) {
        // If this javascript was running, i.e the computer was open constantly, this code should never run.
        // So, we can insert a break now, if we aren't already taking one. 
        // This should solve the problem of me constantly forgetting to add breaks...
        const lastActivity = getLastActivity(state);
        const time = !lastActivity ? lastCheckTime.getTime() :
            Math.max(lastCheckTime.getTime(), getActivityTime(lastActivity).getTime());

        pushBreakActivity(state, newBreakActivity("Auto-inserted break", new Date(time), false));
        rerenderApp();
        debouncedSave();
    }

    state.breakAutoInsertLastPolledTime = getTimestamp(time);
}


const initState = (then: () => void) => {
    loadState(() => {
        setTheme(getTheme());
        then();
    });
};


function isRunningFromFile(): boolean {
    return window.location.protocol.startsWith("file");
}

function makeDownloadThisPageButton() {
    return makeButtonWithCallback("Download this page!", () => {
        const linkEl = el<HTMLAnchorElement>("A", { download: "note-tree.html", "href": window.location.href });
        linkEl.el.click();
    })
}

function handleEnterPress(ctrlPressed: boolean, shiftPressed: boolean): boolean {
    const currentNote = getCurrentNote(state);

    if (ctrlPressed) {
        insertChildNote(state);
        return true;
    }

    if (!state._isEditingFocusedNote) {
        setIsEditingCurrentNote(state, true);
        debouncedSave();
        return true;
    }

    const text = currentNote.data.text;
    // Yeah, not sure why I didn't start with ``` tbh. That is what I'm used to in every other textfield
    // TODO: Not just starts with, but if this occurs anywhere before the current cursor position
    // TODO-TODO: not just anywhere after ```, but ignore if another ``` closes the previous ```
    const shiftMakesNewNote = text.startsWith("---") || text.startsWith("```");
    if (shiftMakesNewNote === shiftPressed) {
        insertNoteAfterCurrent(state);
        return true;
    }

    return false;
}

// NOTE: We should only ever have one of these ever.
// Also, there is code here that relies on the fact that
// setInterval in a webworker won't run when a computer goes to sleep, or a tab is closed, and
// auto-inserts a break. This might break automated tests, if we ever
// decide to start using those
export function App() {
    const header = el("H2", {}, ["Currently working on"]);
    const cheatSheetButton = el("BUTTON", { class: "info-button", title: "click for a list of keyboard shortcuts and functionality" }, [
        "cheatsheet?"
    ]);
    const darkModeToggle = DarkModeToggle();
    let currentHelpInfo = 1;
    cheatSheetButton.el.addEventListener("click", () => {
        currentHelpInfo = currentHelpInfo !== 2 ? 2 : 0;
        rerenderApp();
    });

    const cheatSheet = CheatSheet();

    const filterEditor = ActivityFiltersEditor();
    const filterEditorRow = div({ class: "row", style: "" }, [
        filterEditor,
    ]);
    const notesList = NotesList();
    const todoList = TodoList();
    const rightPanelArea = div({ style: "width: 30%", class: "col sb1l" });
    const bottomLeftArea = div({ class: "flex-1 col", style: "padding: 0 5px" });
    const bottomRightArea = div({ class: "flex-1 col sb1l", style: "padding: 5px;" })
 
    const activityListContainer = ActivityListContainer();
    const todoListContainer = div({ class: "flex-1 col" }, [
        todoList
    ]);

    const asciiCanvasModal = AsciiCanvasModal();
    const fuzzyFindModal = FuzzyFindModal();
    const deleteModal = DeleteModal();
    const loadBackupModal = LoadBackupModal();
    const linkNavModal = LinkNavModal();
    const exportModal = ExportModal();

    function setShowingDurations(enabled: boolean) {
        state._isShowingDurations = enabled;
    }

    const durationsButton = makeButtonWithCallback("Durations", () => {
        setShowingDurations(!state._isShowingDurations);
        rerenderApp();
    });
    const todoNotesButton = makeButtonWithCallback("Todo Notes", () => {
        toggleCurrentDockedMenu("todoLists");
    });
    const activitiesButton = makeButtonWithCallback("Activities", () => {
        toggleCurrentDockedMenu("activities");
    });

    let backupText = "";
    let backupFilename = "";
    const bottomButtons = div({ class: "row align-items-end sb1t" }, [
        div({ class: "row align-items-end" }, [
            makeButtonWithCallback("Scratch Pad", () => {
                setCurrentModal(asciiCanvasModal);
            }),
        ]),
        div({ class: "flex-1 text-align-center"}, [statusTextIndicator]),
        div({ style: "width: 100px" }, [VERSION_NUMBER]),
        div({ class: "row" }, [
            isRunningFromFile() ? (
                div() 
            ) : (
                makeDownloadThisPageButton()
            ),
            makeButtonWithCallback("Delete current", () => {
                setCurrentModal(deleteModal);
            }),
            todoNotesButton,
            activitiesButton,
            durationsButton,
            makeButtonWithCallback("Search", () => {
                setCurrentModal(fuzzyFindModal);
            }),
            makeButtonWithCallback("Export", () => {
                handleErrors(() => {
                    setCurrentModal(exportModal);
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
        ])
    ]);

    const appRoot = div({ class: "relative", style: "padding-bottom: 100px" }, [
        div({ class: "col", style: "position: fixed; top: 0; bottom: 0px; left: 0; right: 0;" }, [
            div({ class: "row flex-1" } , [
                div({ class: "col flex-1 overflow-y-auto" }, [
                    cheatSheet,
                    div({ class: "row align-items-center", style: "padding: 10px;" }, [
                        header,
                        div({ class: "flex-1" }),
                        cheatSheetButton,
                        darkModeToggle,
                    ]),
                    notesList,
                    div({ class: "row ", style: "" }, [
                        bottomLeftArea, 
                        bottomRightArea,
                    ]),
                ]),
                rightPanelArea,
            ]),
            bottomButtons,
            filterEditorRow,
        ]),
        asciiCanvasModal,
        fuzzyFindModal,
        deleteModal,
        loadBackupModal,
        linkNavModal,
        exportModal,
    ]);


    document.addEventListener("keyup", (e) => {
        // returns true if we need a rerender
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && isInHotlist) {
            isInHotlist = false;
            state._lastNoteId = lateralMovementStartingNote;
            setCurrentActivityIdxToCurrentNote(state);
            rerenderApp();
        }

        // returns true if we need a rerender
        if (
            e.key !== "ArrowUp" && 
            e.key !== "ArrowDown" && 
            e.key !== "ArrowLeft" && 
            e.key !== "ArrowRight" && 
            isInTodoList
        ) {
            isInTodoList = false;
            state._lastNoteId = lateralMovementStartingNote;
            rerenderApp();
        }
    });
    
    document.addEventListener("keydown", (e) => {
        // returns true if we need a rerender
        const ctrlPressed = e.ctrlKey || e.metaKey;
        const shiftPressed = e.shiftKey;
        const currentNote = getCurrentNote(state);

        if (currentModal !== null) {
            if (e.key === "Escape") {
                e.preventDefault();
                setCurrentModal(null);
            }

            // Don't need to do anything here if a modal is open.
            return;
        }

        if (
            ctrlPressed &&
            shiftPressed &&
            (e.key === "Shift" || e.key === "Control") &&
            !e.repeat
        ) {
            isInHotlist = false;
            isInTodoList = false;
            lateralMovementStartingNote = state.currentNoteId;
        }

        // handle modals or gloabl key shortcuts
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
            if (state.dockedMenu !== "activities") {
                setCurrentDockedMenu("activities")
            } else  {
                setCurrentDockedMenu("todoLists")
            }
            return;
        } else if (
            e.key === " " &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            state.showDockedMenu = !state.showDockedMenu;
            rerenderApp();
            return;
        }  else if (
            e.key === "D" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            setShowingDurations(!state._isShowingDurations);
            rerenderApp();
            return;
        } else if (
            (e.key === "?" || e.key === "/") &&
            ctrlPressed 
        ) {
            e.preventDefault();
            setCurrentModal(linkNavModal);
            return;
        } else if (
            ctrlPressed &&
            shiftPressed &&
            (e.key === "1" || e.key === "!")
        ) {
            toggleCurrentNoteSticky(state);
            rerenderApp();
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

            function handleUpDownMovement(nextNoteId: NoteId | undefined) {
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

            if (e.key === "Enter" && !isEditingSomeText && handleEnterPress(ctrlPressed, shiftPressed)) {
                // Do nothing - it was handled. else handleEnterPressed returned false and we keep going down this list
            } else if (e.key === "ArrowDown") {
                if (ctrlPressed && shiftPressed) {
                    shouldPreventDefault = true;
                    moveInDirectionOverTodoList(1);
                } else if (ctrlPressed) {
                    handleUpDownMovement(getNoteOneDownLocally(state, currentNote));
                } else {
                    handleUpDownMovement(getNoteNDown(state, currentNote, true));
                }
            } else if (e.key === "ArrowUp") {
                if (ctrlPressed && shiftPressed) {
                    shouldPreventDefault = true;
                    moveInDirectionOverTodoList(-1);
                } else if (ctrlPressed) {
                    handleUpDownMovement(getNoteOneUpLocally(state, currentNote));
                } else {
                    handleUpDownMovement(getNoteNUp(state, currentNote, true));
                }
            } else if (e.key === "PageUp") {
                shouldPreventDefault = true;
                handleUpDownMovement(getNoteNUp(state, currentNote, true, 10));
            } else if (currentNote.parentId && e.key === "PageDown") {
                shouldPreventDefault = true;
                handleUpDownMovement(getNoteNDown(state, currentNote, true, 10));
            } else if (currentNote.parentId && e.key === "End") {
                const parent = getNote(state, currentNote.parentId);
                const siblings = parent.childIds;
                handleUpDownMovement(siblings[siblings.length - 1] || undefined);
            } else if (currentNote.parentId && e.key === "Home") {
                const parent = getNote(state, currentNote.parentId);
                const siblings = parent.childIds;
                handleUpDownMovement(siblings[0] || undefined);
            } else if (e.key === "ArrowLeft") {
                // The browser can't detect ctrl when it's pressed on its own :((((  (well like this anyway)
                // Otherwise I would have liked for this to just be ctrl
                if (ctrlPressed && shiftPressed) {
                    if (isInTodoList) {
                        state._todoNoteFilters = Math.max(-1, state._todoNoteFilters - 1);
                    } else {
                        shouldPreventDefault = true;
                        moveInDirectonOverHotlist(true);
                    }
                } else {
                    handleMovingOut(currentNote.parentId)
                }
            } else if (e.key === "ArrowRight") {
                if (ctrlPressed && shiftPressed) {
                    if (isInTodoList) {
                        state._todoNoteFilters = Math.min(1, state._todoNoteFilters + 1);
                    } else {
                        shouldPreventDefault = true;
                        moveInDirectonOverHotlist(false);
                    }
                } else {
                    // move into note
                    handleMovingIn();
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

    // NOTE: Running this setInterval in a web worker is far more reliable that running it in a normal setInterval, which is frequently 
    // throttled in the browser for many random reasons in my experience. However, web workers seem to only stop when a user closes their computer, or 
    // closes the tab, which is what we want here
    const worker = newWebWorker([ CHECK_INTERVAL_MS ], (checkIntervalMs: number) => {
        let started = false;
        setInterval(() => { 
            postMessage("is-open-check");
            
            if (!started) {
                started = true;
                console.log("Web worker successfuly started! This page can now auto-insert breaks if you've closed this tab for extended periods of time");
            }
        }, checkIntervalMs);
    });
    worker.onmessage = () => {
        autoInsertBreakIfRequired();
    };
    worker.onerror = (e) => {
        console.error("Webworker error: " , e);
    }

    const appComponent = newComponent(appRoot, rerenderAppComponent);

    function rerenderAppComponent() {
        if (setVisible(cheatSheet, currentHelpInfo === 2)) {
            cheatSheet.render(undefined);
        }

        darkModeToggle.render(undefined);

        setText(header, "Currently working on - " + formatDate(new Date(), undefined, true, true));

        recomputeState(state);

        // Rerender interactive components _after_ recomputing the state above

        setClass(durationsButton, "inverted", state._isShowingDurations);
        setClass(todoNotesButton, "inverted", state.dockedMenu === "todoLists" && state.showDockedMenu);
        setClass(activitiesButton, "inverted", state.dockedMenu === "activities" && state.showDockedMenu);

        if (setVisible(filterEditorRow, state._isShowingDurations)) {
            filterEditor.render(undefined);
        }

        let currentDockedMenu: DockableMenu | null = state.dockedMenu;
         
        if (isInHotlist) {
            currentDockedMenu = "activities";
        } else if (isInTodoList) {
            currentDockedMenu = "todoLists";
        } else if (!state.showDockedMenu) {
            currentDockedMenu = null;
        }

        setVisible(rightPanelArea, currentDockedMenu !== null);

        // Render the list after rendering the right dock, so that the sticky offsets have the correct heights.
        // The right panel can cause lines to wrap when they otherwise wouldn't have, resulting in incorrect heights
        notesList.render(undefined);

        if (setVisible(bottomRightArea, currentDockedMenu !== "activities")) {
            // Render activities in their normal spot
            appendChild(bottomRightArea, activityListContainer);
            activityListContainer.render({ docked: false });
        } else {
            // Render activities in the side panel
            appendChild(rightPanelArea, activityListContainer);
            activityListContainer.render({ docked: true });
        }

        if (setVisible(bottomLeftArea, currentDockedMenu !== "todoLists")) {
            // Render todo list in their normal spot
            appendChild(bottomLeftArea, todoListContainer);
        } else {
            // Render todo list in the right panel
            appendChild(rightPanelArea, todoListContainer);
        }
        todoList.render({ 
            cursorNoteId: isInTodoList ? state._todoNoteIds[getCurrentTodoListIdx()] : undefined,
        });

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

        if (setVisible(exportModal, currentModal === exportModal)) {
            exportModal.render(undefined);
        }

        if (setVisible(asciiCanvasModal, currentModal === asciiCanvasModal)) {
            asciiCanvasModal.render({
                outputLayers: state.scratchPadCanvasLayers,
                onInput: () => {
                    debouncedSave();
                }
            });
        }
    }

    return appComponent;
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

let saveTimeout = 0;
const saveCurrentState = ({ debounced } = { debounced: false }) => {
    // user can switch to a different note mid-debounce, so we need to save
    // these here before the debounce

    const thisState = state;

    const save = () => {
        // save current note
        saveState(thisState, (serialized) => {
            // notification

            // JavaScript strings are UTF-16 encoded
            const bytes = utf8ByteLength(serialized);
            const mb = bytes / 1000000;
            showStatusText("Saved (" + mb.toFixed(2) + "mb)", "var(--fg-color)", SAVE_DEBOUNCE);
        });
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



// Entry point
const root: Insertable = {
    _isInserted: true,
    el: document.getElementById("app")!
};

const app = App();
appendChild(root, app);

const rerenderApp = (shouldScroll = true, isTimer = false) => {
    // there are actually very few times when we don't want to scroll to the current note
    renderOptions.shouldScroll = shouldScroll;
    renderOptions.isTimer = isTimer;
    app.render(undefined);
}


initState(() => {
    autoInsertBreakIfRequired();

    setInterval(() => {
        // We need our clock to tick exactly every second, otherwise it looks strange. 
        // For this reason, we will just rerender our entire app every second.
        // This might seem a bit silly, but it's unearthed numerous bugs and improvements.
        // It's actually a bit of a double-sided sword. It will unearth bugs related to excessive renders/background rerenders 
        // being handled incorrectly, and will mask bugs related to too few renders.
        rerenderApp(false, true);
    }, 1000);

    rerenderApp();
});
