import "src/css/colours.css";
import "src/css/layout.css";
import "src/css/ui.css";

import { AsciiCanvas, AsciiCanvasArgs, getLayersString, resetCanvas, } from "src/canvas";
import { Button, Checkbox, DateTimeInput, Modal, PaginationControl, ScrollContainer } from "src/components";
import { ASCII_MOON_STARS, ASCII_SUN, AsciiIconData } from "src/icons";
import { countOccurances, filterInPlace, findLastIndex } from "src/utils/array-utils";
import { copyToClipboard } from "src/utils/clipboard";
import { addDays, formatDate, formatDuration, formatDurationAsHours, getTimestamp, parseDateSafe, truncate } from "src/utils/datetime";
import {
    Insertable,
    RenderGroup,
    State,
    addChildren,
    appendChild,
    div,
    el,
    isEditingInput,
    isEditingTextSomewhereInDocument,
    newComponent,
    newComponent2,
    newInsertable,
    newListRenderer,
    newStyleGenerator,
    replaceChildren,
    scrollIntoView,
    setAttr,
    setAttrs,
    setClass,
    setCssVars,
    setInputValue,
    setStyle,
    setText,
    setVisible,
    span
} from "src/utils/dom-utils";
import { loadFile, saveText } from "src/utils/file-download";
import { Range, fuzzyFind, scoreFuzzyFind } from "src/utils/fuzzyfind";
import { Pagination, getCurrentEnd, getStart, idxToPage, setPage } from "src/utils/pagination";
import * as tree from "src/utils/tree";
import { forEachUrlPosition, openUrlInNewTab } from "src/utils/url";
import { bytesToMegabytes, utf8ByteLength } from "src/utils/utf8";
import { newWebWorker } from "src/utils/web-workers";
import { TextArea } from "./components/text-area";
import { InteractiveGraph } from "./interactive-graph";
import { initKeyboardListeners } from "./keyboard-input";
import {
    Activity,
    AppTheme,
    DockableMenu,
    NoteId,
    NoteTreeGlobalState,
    STATUS_ASSUMED_DONE,
    STATUS_DONE,
    STATUS_IN_PROGRESS,
    TreeNote,
    deleteDoneNote,
    deleteNoteIfEmpty,
    dfsPre,
    findNextActiviyIndex,
    findPreviousActiviyIndex,
    getActivityDurationMs,
    getActivityText,
    getActivityTime,
    getAllNoteIdsInTreeOrder,
    getCurrentNote,
    getCurrentStateAsJSON,
    getFirstPartOfRow,
    getHigherLevelTask,
    getHltHeader,
    getLastActivity,
    getLastActivityWithNote,
    getLastActivityWithNoteIdx,
    getLastSelectedNote,
    getMostRecentlyWorkedOnChildActivityIdx,
    getNote,
    getNoteChildEstimates,
    getNoteDurationUsingCurrentRange,
    getNoteDurationWithoutRange,
    getNoteEstimate,
    getNoteNDown,
    getNoteNUp,
    getNoteOneDownLocally,
    getNoteOneUpLocally,
    getNoteOrUndefined,
    getNoteTextWithoutPriority,
    getParentNoteWithEstimate,
    getRootNote,
    getSecondPartOfRow,
    hasNote,
    insertChildNote,
    insertNoteAfterCurrent,
    isBreak,
    isCurrentlyTakingABreak,
    isDoneNoteWithExtraInfo,
    isEditableBreak,
    isNoteUnderParent,
    loadState,
    loadStateFromBackup,
    newBreakActivity,
    noteStatusToString,
    pushBreakActivity,
    recomputeFlatNotes,
    recomputeState,
    resetState,
    saveState,
    setActivityRangeToday,
    setActivityTime,
    setCurrentActivityIdxToCurrentNote,
    setCurrentNote,
    setIsEditingCurrentNote,
    setStateFromJSON,
    state,
    toggleCurrentNoteSticky,
    tryForceIndexedDBCompaction
} from "./state";
import { assert } from "./utils/assert";


const SAVE_DEBOUNCE = 1500;
const ERROR_TIMEOUT_TIME = 5000;
// Doesn't really follow any convention. I bump it up by however big I feel the change I made was.
// This will need to change if this number ever starts mattering more than "Is the one I have now the same as latest?"
// 'X' will also denote an unstable/experimental build. I never push anything up if I think it will break things, but still
const VERSION_NUMBER = "v1.1.99";

// Used by webworker and normal code
export const CHECK_INTERVAL_MS = 1000 * 10;

const sg = newStyleGenerator();

const cnHoverLink = sg.makeClass("hover-link", [
    `:hover{ cursor: pointer; }`,
    `:hover::after { content: " -->"; }`,
]);

function NoteLink(rg: RenderGroup, s: State<{
    text: string;
    focusAnyway?: boolean;
    noteId?: NoteId;
    preventScroll?: boolean;
}>) {
    let linkText: string = "";
    const root = div({ style: "padding:5px; ", class: "handle-long-words" }, [
        rg.text(() => linkText)
    ])

    rg.renderFn(root, () => {
        const { text, noteId, focusAnyway } = s.args;

        setClass(root, cnHoverLink, !!noteId);
        linkText = truncate(text, 500);

        root.el.style.backgroundColor = (!!focusAnyway || state.currentNoteId === noteId) ? (
            "var(--bg-color-focus)"
        ) : (
            "var(--bg-color)"
        );
    });

    root.el.addEventListener("click", () => {
        const { noteId, preventScroll, } = s.args;

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

    return root;
}

function ScrollNavItem(rg: RenderGroup, s: State<{ 
    isCursorVisible: boolean; 
    isCursorActive: boolean;
    isGreyedOut?: boolean;
    isFocused: boolean;
    children: Insertable[];
}>) {
    return div({ class: "row align-items-stretch" }, [
        rg.style("backgroundColor", () => s.args.isFocused ? "var(--bg-color-focus)" : ""),
        rg.style("color", () => s.args.isGreyedOut ? "var(--unfocus-text-color)" : ""),
        rg.if(
            () => s.args.isCursorVisible,
            rg => div({ style: "min-width: 5px;" }, [
                rg.style("backgroundColor", () => {
                    return s.args.isCursorActive ? "var(--fg-color)" : "var(--bg-color-focus-2)"
                }),
            ])
        ),
        div({ class: "flex-1 handle-long-words" }, [
            rg.functionality((el) => {
                replaceChildren(el, s.args.children);
            })
        ])
    ]);
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

const NIL_HLT_HEADING = "<No higher level task>";

function TodoListInternal(rg: RenderGroup, s: State<{
    setScrollEl?(c: Insertable): void;
    cursorNoteId?: NoteId;
    disableHeaders: boolean;
}>) {
    function TodoListItem(rg: RenderGroup, s: State<{
        heading: string | undefined;
        strikethrough: boolean;
        hasCursor: boolean;
        text: string;
        noteId: string;
        focusAnyway: boolean;
        cursorNoteId: NoteId | undefined;
    }>) {
        const children = [
            div({ class: "flex-1", style: "padding-bottom: 10px" }, [
                rg.cArgs(NoteLink, (noteLink) => {
                    const { text, focusAnyway, noteId } = s.args;

                    noteLink.render({
                        noteId,
                        text,
                        preventScroll: true,
                        focusAnyway,
                    });
                }),
            ])
        ];

        const navRoot = rg.cArgs(ScrollNavItem, (c) => {
            c.render({
                isCursorVisible: s.args.hasCursor,
                isFocused: s.args.focusAnyway,
                isCursorActive: isInTodoList,
                children: children,
            })

            setClass(navRoot, "strikethrough", s.args.strikethrough)
        });

        return div({}, [
            rg.with(
                () => s.args.heading,
                (rg, s) => {
                    return el("H3", { style: "text-align: center; margin: 0; padding: 1em 0;" }, [
                        rg.text(() => s.args)
                    ])
                }
            ),
            navRoot,
        ]);
    }

    const root = div();
    const todoItemsList = newListRenderer(root, () => newComponent(TodoListItem));

    rg.renderFn(root, () => {
        const { setScrollEl, cursorNoteId, disableHeaders } = s.args;
        let alreadyScrolled = false;

        todoItemsList.render((getNext) => {
            let lastHlt: TreeNote | undefined;

            for (const id of state._todoNoteIds) {
                const note = getNote(state, id);
                const focusAnyway = isNoteInSameGroupForTodoList(getCurrentNote(state), note);

                let text = note.data.text;
                const higherLevelTask = getHigherLevelTask(state, note);
                let hltHeading: string | undefined;
                if (lastHlt !== higherLevelTask && !disableHeaders) {
                    lastHlt = higherLevelTask;

                    if (higherLevelTask) {
                        hltHeading = getHltHeader(state, higherLevelTask);
                    } else {
                        hltHeading = NIL_HLT_HEADING;
                    }
                }

                const progressCountText = getNoteProgressCountText(note);

                const lc = getNext();
                lc.render({
                    heading: hltHeading,
                    noteId: note.id,
                    text: (progressCountText ? getNoteProgressCountText(note) + " - " : "") + text,
                    strikethrough: note.data._status === STATUS_DONE,
                    hasCursor: cursorNoteId === note.id,
                    focusAnyway,
                    cursorNoteId
                });

                if (setScrollEl && !alreadyScrolled) {
                    if (
                        (cursorNoteId && note.id === cursorNoteId) ||
                        (!cursorNoteId && focusAnyway)
                    ) {
                        setScrollEl(lc);
                        alreadyScrolled = true;
                    }
                }
            }
        });
    });

    return root;
}

function TodoList(rg: RenderGroup, s: State<{ cursorNoteId?: NoteId; }>) {
    const heading = el("H3", { style: "user-select: none; padding-left: 10px; text-align: center;" }, ["TODO Lists"]);
    const listInternal = newComponent(TodoListInternal);
    const empty = div({}, [
        `Notes starting with '>' get put into the TODO list! 
        You can navigate the todo list with [Ctrl] + [Shift] + [Up/Down]. 
        You can only see other TODO notes underneath the current TODO parent note.`
    ]);
    const scrollContainer = newComponent(ScrollContainer);
    const root = div({ class: "flex-1 col" }, [
        heading,
        div({ style: "border-bottom: 1px solid var(--bg-color-focus-2)" }),
        addChildren(setAttrs(scrollContainer, { class: "flex-1 col" }, true), [
            empty,
            listInternal,
        ])
    ]);

    rg.renderFn(root, () => {
        const { cursorNoteId } = s.args;

        setVisible(empty, state._todoNoteIds.length === 0);

        const leftArrow = isInTodoList ? "<- " : "";
        const rightArrow = isInTodoList ? " ->" : "";

        let count = " (" + state._todoNoteIds.length + ") ";

        let headingText;
        if (state._todoNoteFilters === -1) {
            const note = getCurrentNote(state);
            const hlt = getHigherLevelTask(state, note);
            const hltText = hlt ? getHltHeader(state, hlt) : NIL_HLT_HEADING;
            headingText = "Everything in progress for specific task [" + hltText + "]" + count + rightArrow;
        } else if (state._todoNoteFilters === 0) {
            headingText = leftArrow + "Everything in progress for every task" + count + rightArrow;
        } else if (state._todoNoteFilters === 1) {
            headingText = leftArrow + "Most recent thing in progress for every task" + count + rightArrow;
        } else {
            headingText = leftArrow + "Most recent thing in progress for every task that has an estimate" + count;
        }
        setText(heading, headingText);

        let scrollEl: Insertable | null = null;

        function setScrollEl(el: Insertable) {
            if (!scrollEl) {
                scrollEl = el;
            }
        }

        listInternal.render({
            setScrollEl,
            cursorNoteId,
            disableHeaders: state._todoNoteFilters === -1,
        });

        scrollContainer.render({
            scrollEl,
            rescrollMs: 5000,
        });
    });

    return root;
}

function BreakInput(rg: RenderGroup) {
    const breakInput = el<HTMLInputElement>("INPUT", { class: "w-100" });
    const breakButton = newComponent(Button);
    const root = div({ style: "padding: 5px;", class: "row align-items-center" }, [
        div({ class: "flex-1" }, [breakInput]),
        div({}, [breakButton]),
    ]);

    rg.renderFn(root, function renderBreakInput() {
        const isTakingABreak = isCurrentlyTakingABreak(state);

        breakButton.render({
            label: isTakingABreak ? "Extend break" : "Take a break",
            onClick: addBreak,
        });

        setAttr(breakInput, "placeholder", "Enter break reason (optional)");
    });

    function addBreak(e: Event) {
        e.preventDefault();
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

        addBreak(e);
    });

    return root;
}

function ActivityListItem(rg: RenderGroup, s: State<{
    previousActivity: Activity | undefined;
    activity: Activity;
    nextActivity: Activity | undefined;
    showDuration: boolean;
    focus: boolean;
    greyedOut?: boolean;
    hasCursor: boolean;
}>) {
    const breakEdit = el<HTMLInputElement>(
        "INPUT", { class: "pre-wrap w-100 solid-border-sm-rounded", style: "padding-left: 5px" }
    );

    function deleteBreak() {
        const { activity } = s.args;

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
    };

    function insertBreak() {
        const { activity, nextActivity } = s.args;

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
    };

    const breakInsertRow = newComponent((rg) => {
        return div({ class: "align-items-center justify-content-center row" }, [
            div({ class: "flex-1", style: "border-bottom: 1px solid var(--fg-color)" }),
            rg.cArgs(Button, c => c.render({
                label: "+ Insert break here",
                onClick: insertBreak,
            })),
            div({ class: "flex-1", style: "border-bottom: 1px solid var(--fg-color)" }),
        ]);
    });

    // TODO: CSS for this plz
    let isInsertBreakRowOpen = false;
    const breakInsertRowHitbox = div({ class: "hover-parent", style: "min-height: 10px" }, [
        (parent) => {
            parent.el.addEventListener("mouseenter", () => {
                isInsertBreakRowOpen = true;
                rg.render();
            });
            parent.el.addEventListener("mouseleave", () => {
                isInsertBreakRowOpen = false;
                rg.render();
            });
        }
    ]);


    const noteLink = newComponent(NoteLink);
    const durationEl = div({ style: "padding-left: 10px; padding-right: 10px;" });
    const timestamp = newComponent(DateTimeInput);
    const timestampWrapper = div({ style: "" }, [timestamp]);
    const cursorRow = newComponent(ScrollNavItem);

    const cursorRowContents = [
        breakInsertRowHitbox,
        div({ class: "row", style: "gap: 20px; padding: 5px 0;" }, [
            div({ class: "flex-1" }, [
                timestampWrapper,
                div({ class: "row align-items-center", style: "padding-left: 20px" }, [
                    noteLink,
                    breakEdit,
                    rg.if(
                        isEditable, 
                        rg => rg.cArgs(Button, c => c.render({
                            label: "x",
                            onClick: deleteBreak,
                        }))
                    ),
                ]),
            ]),
            durationEl,
        ])
    ];

    const root = div({}, [
        cursorRow,
    ]);

    function isEditable() {
        const { activity, greyedOut } = s.args;
        return !greyedOut && isEditableBreak(activity);
    }

    function renderDuration() {
        const { activity, nextActivity, showDuration, } = s.args;

        // The idea is that only breaks we insert ourselves retroactively are editable, as these times
        // did not come from the computer's sytem time but our own subjective memory
        const isAnApproximation = isEditable();

        if (setVisible(durationEl, showDuration)) {
            const durationStr = (isAnApproximation ? "~" : "") + formatDurationAsHours(getActivityDurationMs(activity, nextActivity));
            setText(durationEl, durationStr);
        }
    }

    rg.renderFn(root, function renderActivityListItem() {
        const { activity, greyedOut, focus, hasCursor } = s.args;

        cursorRow.render({
            isCursorVisible: hasCursor,
            isCursorActive: isInHotlist,
            isFocused: focus,
            isGreyedOut: greyedOut,
            children: cursorRowContents
        });

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
                focusAnyway: focus,
                noteId: activity.nId,
                text: activityText,
            });

            setClass(noteLink, cnHoverLink, !!activity.nId);
            noteLink.el.style.paddingLeft = activity.nId ? "0" : "40px";
        }

        timestamp.render({
            label: "",
            value: getActivityTime(activity),
            onChange: updateActivityTime,
            readOnly: false,
            nullable: false,
        });

        renderDuration();

        if (!!breakInsertRow.el.parentNode && !breakInsertRow.el.matches(":hover")) {
            isInsertBreakRowOpen = false;
        }

        if (isInsertBreakRowOpen && !breakInsertRow.el.parentNode) {
            root.el.prepend(breakInsertRow.el);
            breakInsertRow.render(undefined);
        } else if (!isInsertBreakRowOpen && !!breakInsertRow.el.parentNode) {
            breakInsertRow.el.remove();
        }
    });

    function updateActivityTime(date: Date | null) {
        if (!date) {
            return;
        }

        const { previousActivity, activity, nextActivity } = s.args;

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

    noteLink.el.addEventListener("click", () => {
        const { activity } = s.args;
        if (!activity.nId) {
            return;
        }

        setCurrentNote(state, activity.nId);
        rerenderApp();
    });

    function handleBreakTextEdit() {
        const { activity } = s.args;

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

    return root;
}

function ExportModal(rg: RenderGroup) {
    const modalContent = div({ class: "col", style: "align-items: stretch" }, [
        rg.cArgs(Button, c => c.render({
            label: "Clear all",
            onClick: () => {
                if (!confirm("Are you sure you want to clear your note tree?")) {
                    return;
                }

                resetState();
                rerenderApp();

                showStatusText("Cleared notes");
            }
        })),
        rg.cArgs(Button, c => c.render({
            label: "Download TXT",
            onClick: () => {
                handleErrors(() => {
                    const flatNotes: NoteId[] = getAllNoteIdsInTreeOrder(state);
                    const text = exportAsText(state, flatNotes);
                    handleErrors(() => {
                        saveText(text, `Note-Tree Text Export - ${formatDate(new Date(), "-")}.txt`);
                    });

                    showStatusText("Download TXT");
                });
            }
        })),
        rg.cArgs(Button, c => c.render({
            label: "Copy open notes",
            onClick: () => {
                handleErrors(() => {
                    const flatNotes: NoteId[] = [];
                    recomputeFlatNotes(state, flatNotes);

                    copyToClipboard(exportAsText(state, flatNotes));
                    showStatusText("Copied current open notes as text");
                });
            }
        })),
        rg.cArgs(Button, c => c.render({
            label: "Download JSON",
            onClick: () => {
                handleErrors(() => {
                    saveText(getCurrentStateAsJSON(), `Note-Tree Backup - ${formatDate(new Date(), "-")}.json`);
                });
            }
        }))
    ]);

    return rg.cArgs(Modal, c => c.render({
        onClose: () => setCurrentModal(null),
        content: modalContent,
    }));
}

function DeleteModal(rg: RenderGroup) {
    const heading = el("H2", { style: "text-align: center" }, ["Delete current note"]);
    const textEl = div();
    const countEl = div();
    const timeEl = div();
    const recentEl = div();
    const deleteButton = newComponent(Button);
    const cantDelete = div({}, ["Can't delete notes that are still in progress..."]);
    const root = newComponent(Modal);
    const modalContent = div({ style: modalPaddingStyles(10, 70, 50) }, [
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
    ]);

    function deleteNote(e: MouseEvent) {
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
    };

    rg.renderFn(root, function renderDeleteModal() {
        const currentNote = getCurrentNote(state);

        root.render({
            onClose: () => setCurrentModal(null),
            content: modalContent,
        });

        setText(textEl, currentNote.data.text);

        let count = 0;
        dfsPre(state, currentNote, () => count++);
        setText(countEl, count + " notes in total");

        let totalTimeMs = getNoteDurationWithoutRange(state, currentNote);
        setText(timeEl, formatDuration(totalTimeMs) + " in total");

        const idx = getMostRecentlyWorkedOnChildActivityIdx(state, currentNote);
        setVisible(recentEl, !!idx)
        if (idx !== undefined) {
            const activity = state.activities[idx];
            setText(recentEl, "The last activity under this note was on " + formatDate(getActivityTime(activity), undefined, true));
        }

        const canDelete = currentNote.data._status === STATUS_DONE;
        if (setVisible(deleteButton, canDelete)) {
            deleteButton.render({
                label: "Delete Note",
                onClick: deleteNote
            });
        }
        setVisible(cantDelete, !canDelete);
    });

    return root;
}

function LinkNavModal(rg: RenderGroup) {
    function LinkItem(rg: RenderGroup, s: State<{
        noteId: NoteId;
        text: string;
        range: Range;
        url: string;
        isFocused: boolean;
    }>) {
        const textEl = newComponent(HighlightedText);
        const children = [ textEl ];
        const root = newComponent(ScrollNavItem);

        rg.renderFn(root, function renderLinkItem() {
            const { text, range, isFocused } = s.args;

            textEl.render({
                text,
                highlightedRanges: [range]
            });

            root.render({
                isCursorVisible: isFocused,
                isCursorActive: true,
                isFocused: isFocused, 
                children: children,
            });
        });

        return root;
    }

    const linkList = newListRenderer(div(), () => newComponent(LinkItem));
    const content = div({ style: "padding: 20px" }, [
        el("H2", {}, ["URLs above or under the current note"]),
        linkList,
    ]);
    const empty = div({ style: "padding: 40px" }, ["Couldn't find any URLs above or below the current note."]);
    const root = newComponent(Modal);
    const modalContent = div({}, [
        content,
        empty,
    ]);

    let idx = 0;
    let lastNote: TreeNote | undefined;

    rg.renderFn(root, function renderLinkNavModal() {
        const currentNote = getCurrentNote(state);
        if (lastNote === currentNote) {
            return;
        }

        lastNote = currentNote;

        root.render({
            onClose: () => setCurrentModal(null),
            content: modalContent,
        });


        idx = 0;
        linkList.render((getNext) => {

            function renderLinks(note: TreeNote) {
                let urlCount = 0;

                forEachUrlPosition(note.data.text, (start, end) => {
                    const url = note.data.text.substring(start, end);
                    getNext().render({
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
            let lastNote: TreeNote | undefined;
            tree.forEachParent(state.notes, currentNote, (note) => {
                if (note === currentNote) {
                    lastNote = note;
                    return;
                }

                notes.push(note);
                // Also search children 1 level underneath parents. This is very very helpful.
                for (let id of note.childIds) {
                    const note = getNote(state, id);
                    if (note === lastNote) {
                        // don't collect urls from the same note twice.
                        continue;
                    }

                    notes.push(note);
                }

                lastNote = note;
            });

            // we want the urls to appear highest to lowest.
            idx = 0;
            for (let i = notes.length - 1; i >= 0; i--) {
                idx += renderLinks(notes[i]);
            }

            // Dont even need to collect these into an array before rendering them. lmao. 
            dfsPre(state, currentNote, (note) => {
                renderLinks(note);
            });
        });

        rerenderItems();

        setVisible(content, linkList.components.length > 0);
        setVisible(empty, linkList.components.length === 0);
    });

    function rerenderItems() {
        for (let i = 0; i < linkList.components.length; i++) {
            linkList.components[i].state.args.isFocused = i === idx;
            linkList.components[i].render(linkList.components[i].state.args);
        }
    }

    document.addEventListener("keydown", (e) => {
        if (currentModal?.el !== root.el) {
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

            const { url, noteId } = linkList.components[idx].state.args;
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

    return root;
}


function EditableActivityList(rg: RenderGroup, s: State<{
    activityIndexes: number[] | undefined;
    pageSize?: number;
}>) {
    const pagination: Pagination = { pageSize: 10, start: 0, totalCount: 0 }
    const paginationControl = newComponent(PaginationControl);

    const listRoot = newListRenderer(div({ style: "" }), () => newComponent(ActivityListItem));
    const listScrollContainer = newComponent(ScrollContainer);
    addChildren(setAttrs(listScrollContainer, { class: "flex-1" }, true), [
        listRoot,
    ]);
    const statusTextEl = div({ class: "text-align-center" }, []);
    const root = div({ class: "w-100 flex-1 col", style: "" }, [
        statusTextEl,
        listScrollContainer,
        paginationControl,
    ]);

    let lastIdx = -1;

    rg.renderFn(root, function rerenderActivityList() {
        const { pageSize, activityIndexes } = s.args;

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
        listRoot.render((getNext) => {
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
                    getNext().render({
                        previousActivity: activity,
                        activity: nextActivity,
                        nextActivity: nextNextActivity,
                        showDuration: true,
                        focus: false,
                        greyedOut: true,
                        hasCursor: false,
                    });
                }

                const activityNote = getNoteOrUndefined(state, activity.nId);

                const hasCursor = idx === state._currentlyViewingActivityIdx;

                const c = getNext();
                c.render({
                    previousActivity,
                    activity,
                    nextActivity,
                    showDuration: true,
                    // focus: activity.nId === state.currentNoteId,
                    focus: !!activityNote && isNoteUnderParent(state, state.currentNoteId, activityNote),
                    hasCursor,
                });

                if (hasCursor) {
                    scrollEl = c;
                }

                if (
                    i + 1 === activitiesToRender &&
                    idx - 2 >= 0
                ) {
                    const previousPreviousActivity = activities[idx - 2];
                    // Also render the activity before this list. so we can see the 1 activity before the ones in the lsit
                    getNext().render({
                        previousActivity: previousPreviousActivity,
                        activity: previousActivity,
                        nextActivity: activity,
                        showDuration: true,
                        focus: false,
                        greyedOut: true,
                        hasCursor: false,
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
    });

    return root;
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

function NoteRowText(rg: RenderGroup, s: State<NoteRowArgs>) {
    const indentWidthEl = div({ class: "pre", style: "padding-right: 5px" });
    const indentEl = div({ class: "pre sb1l h-100", style: "padding-left: 5px; " });

    const whenNotEditing = div({ class: "handle-long-words", style: "" });
    const whenEditing = TextArea();
    setAttr(whenEditing, "rows", "1");
    setAttr(whenEditing, "class", "flex-1");
    setAttr(whenEditing, "style", "overflow-y: hidden; padding: 0;");

    const root = div({ class: "flex-1", style: "overflow-y: hidden;" }, [
        div({ class: "row h-100" }, [
            indentWidthEl, indentEl, whenNotEditing, whenEditing
        ])
    ]);

    let lastNote: TreeNote | undefined = undefined;
    let isFocused = false;
    let isEditing = false;

    function updateTextContentAndSize() {
        const { note } = s.args;

        setInputValue(whenEditing, note.data.text);
        lastNote = note;

        whenEditing.el.style.height = "0";
        whenEditing.el.style.height = whenEditing.el.scrollHeight + "px";
    }

    rg.renderFn(root, function renderNoteRowText() {
        const { note } = s.args;

        const currentNote = getCurrentNote(state);
        const isOnSameLevel = currentNote.parentId === note.parentId;

        // This is mainly so that multi-line notes won't take up so much space as a parent note
        setStyle(root, "whiteSpace", isOnSameLevel ? "pre-wrap" : "nowrap");

        const indentText = noteStatusToString(note.data._status);
        setText(indentEl, indentText + getNoteProgressCountText(note) + " - ");
        const INDENT = 1;
        const INDENT2 = 4;
        const indent1 = INDENT * note.data._depth;
        const depth = isOnSameLevel ? (
            // the current level gets indented a bit more, for visual clarity,
            // and the parent notes won't get indented as much so that we aren't wasting space
            indent1 - INDENT + INDENT2
        ) : indent1;
        setStyle(indentWidthEl, "minWidth", depth + "ch");

        isFocused = state.currentNoteId === note.id && currentModal === null;

        const wasEditing = isEditing;
        isEditing = isFocused && state._isEditingFocusedNote;
        if (lastNote !== note || !isEditing) {
            isFocused = false;
        }

        if (setVisible(whenEditing, isEditing)) {
            if (!wasEditing) {
                whenEditing.el.focus({ preventScroll: true });
            }
        }

        if (setVisible(whenNotEditing, !isEditing)) {
            setText(whenNotEditing, note.data.text);
        }

        // Actually quite important that this runs even when we aren't editing, because when we eventually
        // set the input visible, it needs to auto-size to the correct height, and it won't do so otherwise
        updateTextContentAndSize();
    });

    whenEditing.el.addEventListener("input", () => {
        const { note } = s.args;

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

    return root;
}


function ActivityFiltersEditor(rg: RenderGroup) {
    function onChange() {
        rerenderApp(false);
    }

    const todayButton = newComponent(Button);
    todayButton.render({
        label: "Today",
        onClick: () => {
            setActivityRangeToday(state);
            onChange();
        }
    })

    function updateDate(updateFn: (d: Date) => void) {
        let updated = false;

        if (state._activitiesFrom) {
            updateFn(state._activitiesFrom);
            updated = true;
        }

        if (state._activitiesTo) {
            updateFn(state._activitiesTo);
            updated = true;
        }

        if (updated) {
            onChange();
        }
    }

    const incrDay = newComponent(Button);
    incrDay.render({ label: "+1d", onClick : () => updateDate((d) => addDays(d, 1)) });
    const decrDay = newComponent(Button);
    decrDay.render({ label: "-1d", onClick: () => updateDate((d) => addDays(d, -1)) });
    const incrWeek = newComponent(Button);
    incrWeek.render({ label: "+7d", onClick: () => updateDate((d) => addDays(d, 7)) });
    const decrWeek = newComponent(Button);
    decrWeek.render({ label: "-7d", onClick: () => updateDate((d) => addDays(d, -7)) });
    const incrMonth = newComponent(Button);
    incrMonth.render({ label: "+30d", onClick: () => updateDate((d) => addDays(d, 30)) });
    const decrMonth = newComponent(Button);
    decrMonth.render({ label: "-30d", onClick: () => updateDate((d) => addDays(d, -30)) });

    const blockStyle = { class: "row", style: "padding-left: 10px; padding-right: 10px" };
    const dateFrom = newComponent(DateTimeInput);
    const dateTo = newComponent(DateTimeInput);
    const onlyUnderCurrentNote = newComponent(Checkbox)
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

    rg.renderFn(root, function renderActivityFiltersEditor() {
        dateFrom.render({
            label: "from",
            value: state._activitiesFrom,
            readOnly: false,
            nullable: true,
            onChange: (val) => {
                state._activitiesFrom = val;
                onChange();
            }
        });

        dateTo.render({
            label: "to",
            value: state._activitiesTo,
            readOnly: false,
            nullable: true,
            onChange: (val) => {
                state._activitiesTo = val;
                onChange();
            }
        });

        onlyUnderCurrentNote.render({
            label: "Under selected?",
            value: state._durationsOnlyUnderSelected,
            onChange: (val) => {
                state._durationsOnlyUnderSelected = val;
                onChange();
            }
        });
    });

    return root;
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

function HighlightedText(rg: RenderGroup, s: State<{
    text: string;
    highlightedRanges: Range[];
}>) {
    function Span(rg: RenderGroup, s: State<{
        highlighted: boolean;
        text: string;
    }>) {
        return span({}, [
            rg.text(() => s.args.text),
            rg.class("unfocused-text-color", () => !s.args.highlighted),
        ]);
    }

    const root = div({});
    const list = newListRenderer(root, () => newComponent(Span));

    rg.renderFn(root, function renderHighlightedText() {
        const { highlightedRanges: ranges, text } = s.args;

        list.render((getNext) => {
            let last = 0;
            for (const [start, end] of ranges) {
                const part1 = text.substring(last, start);
                if (part1) {
                    getNext().render({ text: part1, highlighted: false });
                }

                const part2 = text.substring(start, end);
                if (part2) {
                    getNext().render({ text: part2, highlighted: true });
                }

                last = end;
            }

            const lastPart = text.substring(last);
            if (lastPart) {
                getNext().render({ text: lastPart, highlighted: false });
            }
        });
    });

    return root;
}

function FuzzyFinder(rg: RenderGroup) {
    function FindResultItem(rg: RenderGroup, s: State<{
        text: string;
        ranges: Range[];
        hasFocus: boolean;
    }>) {
        const textDiv = newComponent(HighlightedText);
        const children = [textDiv];
        const root = newComponent(ScrollNavItem);
        let lastRanges: any = null;

        rg.renderFn(root, function renderFindResultItem() {
            const { text, ranges, hasFocus } = s.args;

            // This is basically the same as the React code, to render a diff list, actually, useMemo and all
            if (ranges !== lastRanges) {
                textDiv.render({ text: text, highlightedRanges: ranges });
            }

            root.render({
                isFocused: hasFocus,
                isCursorVisible: hasFocus,
                isCursorActive: true,
                children,
            });

            textDiv.el.style.padding = hasFocus ? "20px" : "10px";

            if (hasFocus) {
                const scrollParent = root.el.parentElement!;
                scrollIntoView(scrollParent, root, 0.5);
            }
        });

        return root;
    };

    const resultList = newListRenderer(div({ class: "h-100 overflow-y-auto" }), () => newComponent(FindResultItem));

    type Match = {
        note: TreeNote;
        ranges: Range[];
        score: number;
    };
    const matches: Match[] = [];
    let currentSelectionIdx = 0;

    let scopedToCurrentNote = false;

    const searchInput = el<HTMLInputElement>("INPUT", { class: "w-100" });
    const searchLabel = div({ style: "padding: 10px", class: "nowrap" }, ["Search:"]);
    const root = div({ class: "flex-1 col" }, [
        div({ class: "row align-items-center",  }, [
            searchLabel,
            searchInput,
            div({ style: "width: 10px" }),
        ]),
        div({ style: "height: 10px" }),
        div({ class: "flex-1" }, [
            resultList
        ]),
    ]);

    let timeoutId = 0;
    const DEBOUNCE_MS = 10;
    function rerenderSearch() {
        setText(searchLabel, scopedToCurrentNote ? "Search (Current note):" : "Search (Everywhere):");

        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            matches.splice(0, matches.length);

            const query = searchInput.el.value.toLowerCase();

            const rootNote = scopedToCurrentNote ? getCurrentNote(state)
                : getRootNote(state);

            dfsPre(state, rootNote, (n) => {
                if (!n.parentId) {
                    // ignore the root note
                    return;
                }
                let text = n.data.text.toLowerCase();
                let results = fuzzyFind(text, query);
                if (results.length > 0) {
                    let score = scoreFuzzyFind(results);
                    if (n.data._status === STATUS_IN_PROGRESS) {
                        score *= 2;
                    }

                    matches.push({
                        note: n,
                        ranges: results,
                        score,
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

            resultList.render((getNext) => {
                for (const m of matches) {
                    getNext().render({
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
            c.state.args.hasFocus = i === currentSelectionIdx;
            c.render(c.state.args);
        }
    }

    rg.renderFn(root, function renderFuzzyFinder() {
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

        if (
            (e.ctrlKey || e.metaKey)
            && e.shiftKey
            && e.key === "F"
        ) {
            scopedToCurrentNote = !scopedToCurrentNote;
            rerenderSearch();
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

    return root;
}

function FuzzyFindModal(rg: RenderGroup) {
    const modalContent = div({ class: "col h-100", style: modalPaddingStyles(0) }, [
        rg.c(FuzzyFinder),
    ]);
    return rg.cArgs(Modal, c => c.render({
        onClose: () => setCurrentModal(null),
        content: modalContent,
    }));
}

function modalPaddingStyles(paddingPx: number = 0, width = 94, height = 90) {
    return `width: ${width}vw; height: ${height}vh; padding: ${paddingPx}px`;
}

function LoadBackupModal(rg: RenderGroup, s: State<{
    fileName: string;
    text: string;
}>) {
    const fileNameDiv = el("H3");
    const infoDiv = div();
    const loadBackupButton = newComponent(Button);
    loadBackupButton.render({
        label: "Load this backup",
        onClick: () => {
            if (!canLoad || !s.args.text) {
                return;
            }

            if (confirm("Are you really sure you want to load this backup? Your current state will be wiped")) {
                const { text } = s.args;

                setStateFromJSON(text);

                saveCurrentState({ debounced: false });

                initState(() => {
                    setCurrentModal(null);
                });
            }
        }
    });
    const modal = newComponent(Modal);
    const modalContent = div({ class: "col", style: modalPaddingStyles(10, 40, 40) }, [
        fileNameDiv,
        infoDiv,
        loadBackupButton,
    ]);

    let canLoad = false;

    rg.renderFn(modal, function renderBackupModal() {
        modal.render({
            onClose: () => setCurrentModal(null),
            content: modalContent,
        });

        const { text, fileName } = s.args;

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

    return modal;
}


function InteractiveGraphModal(rg: RenderGroup) {
    function onClose() {
        setCurrentModal(null);
        debouncedSave();
    }

    const modalContent = div({ style: modalPaddingStyles(10) }, [
        rg.cArgs(InteractiveGraph, (c) => c.render({
            onClose,
            graphData: state.mainGraphData,
            onInput() {
                debouncedSave();
            }
        }))
    ]);

    return rg.cArgs(Modal, c => c.render({
        onClose,
        content: modalContent, 
    }));
}

function SettingsModal(rg: RenderGroup) {
    function onClose() {
        setCurrentModal(null);
        debouncedSave();
    }

    const modalContent = div({ class: "col", style: "align-items: stretch; padding: 10px;" }, [
        el("H3", { class: "text-align-center" }, "Settings"),
        div({ class: "row" }, [
            // Add and then remove feature flags here as we need to
            div({}, [`No settings are available in the ${VERSION_NUMBER} version of this web-app. Come back later!`]),
        ])
    ]);

    return rg.cArgs(Modal, c => c.render({
        onClose,
        content: modalContent,
    }));
}

function ScratchPadModal(rg: RenderGroup, s: State<{
    open: boolean;
    canvasArgs: AsciiCanvasArgs;
}>) {
    const [asciiCanvas, canvasState] = newComponent2(AsciiCanvas);
    const modalComponent = newComponent(Modal);
    const modalContent = (
        div({ style: modalPaddingStyles(10) }, [
            asciiCanvas
        ])
    );

    let wasVisible = false;
    function renderCanvas() {
        const { open } = s.args;
        setVisible(modalComponent, open);

        if (!wasVisible && open) {
            if (!state._isEditingFocusedNote) {
                setIsEditingCurrentNote(state, true);
                rerenderApp();
                return;
            }

            wasVisible = true;

            const note = getCurrentNote(state);
            asciiCanvas.render(s.args.canvasArgs);

            // needs to happen after we render the canvas, since we will be swapping out the output buffer
            resetCanvas(canvasState, false, note.data.text);
        } else if (wasVisible && !open) {
            wasVisible = false;

            // if this modal is closed, try applying the current canvas state to the current note.
            // Hopefully this should handle both the cases:
            // - Finished editing and I've closed the scratch pad
            // - Refreshed the browser while in the scratch pad, so we only have the last debounce-saved layers
            if (state.scratchPadCanvasLayers.length > 0) {
                const text = getLayersString(state.scratchPadCanvasLayers);
                const currentNote = getNoteOrUndefined(state, state.currentNoteId);
                if (currentNote && !!text.trim()) {
                    currentNote.data.text = text;
                }

                // Either way, we have to clear it so that we don't overwrite some other note
                state.scratchPadCanvasLayers = [];
            }
        }
    }

    rg.renderFn(modalComponent, function renderAsciiCanvasModal() {
        renderCanvas();

        modalComponent.render({
            onClose() {
                setCurrentModal(null);
            },
            content: modalContent,
        });
    });

    return modalComponent;
}

function NoteRowDurationInfo(rg: RenderGroup, s: State<{ note: TreeNote; duration: number; }>) {
    const durationEl = span();
    const divider = span({}, ", ");
    const estimateContainer = span();
    const estimateEl = span();
    const root = div({
        class: "row",
        style: "text-align: right; gap: 5px; padding-left: 10px;"
    }, [
        durationEl,
        divider,
        addChildren(estimateContainer, [
            estimateEl,
        ])
    ]);

    rg.renderFn(root, function renderNoteRowDurationInfo() {
        const { note, duration } = s.args;

        const hasDuration = duration > 0;
        if (setVisible(durationEl, hasDuration)) {
            setText(durationEl, formatDurationAsHours(duration));
        }

        const parentWithEstimate = getParentNoteWithEstimate(state, note);
        if (setVisible(estimateContainer, !!parentWithEstimate) && !!parentWithEstimate) {
            const parentEstimate = getNoteEstimate(parentWithEstimate);
            const childEstimates = getNoteChildEstimates(state, parentWithEstimate);

            const duration = getNoteDurationWithoutRange(state, note);
            const noteIsEstimateParent = parentWithEstimate.id === note.id;

            let estimatElText = "";
            let total = parentEstimate;
            let isOnTrack = true;

            if (!noteIsEstimateParent) {
                total = parentEstimate - childEstimates;
            }

            const delta = total - duration;
            isOnTrack = delta >= 0 && total > 0;

            const hideTotal = (
                note.data._status === STATUS_DONE
                || note.data._status === STATUS_ASSUMED_DONE
            )
            if (hideTotal) {
                estimatElText = formatDurationAsHours(duration) + " total"
            } else {
                estimatElText = formatDurationAsHours(duration)
                    + "/"
                    + formatDurationAsHours(Math.max(0, total));
            }

            if (noteIsEstimateParent && childEstimates > parentEstimate) {
                // If the sum of the child estimates is greater than what we've put down, let the user know, so they 
                // can update their prior assumptions and update the real estimate themselves.
                // The reason why I no longer automate this is because the benefits of estimating a task
                // come almost entirely from the side-effects of computing the number yourself, and
                // the final estimate actually has no real value by itself
                isOnTrack = false;
                estimatElText += ` (estimates below add to E=${formatDurationAsHours(childEstimates)}!)`;
            }

            setStyle(estimateEl, "color", isOnTrack ? "" : "#F00");
            setText(estimateEl, estimatElText);
        }

        setVisible(divider, hasDuration && !!parentWithEstimate);
    });

    return root;
}

function NoteRowInput(rg: RenderGroup, s: State<NoteRowArgs>) {
    const noteRowText = newComponent(NoteRowText);

    const sticky = div({ class: "row align-items-center", style: "background-color: #0A0; color: #FFF" }, [" ! "]);
    const noteDuration = newComponent(NoteRowDurationInfo);
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
        const { stickyOffset } = s.args;

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
        const { scrollParent } = s.args;

        if (!scrollParent) {
            return;
        }

        // Clearing and setting the sticky style allows for scrolling to work.

        clearStickyOffset();

        // We can completely obscure the activity and todo lists, now that we have the right-dock
        scrollIntoView(scrollParent, root, 0.5);

        setStickyOffset();
    }

    let isFocused = false;
    let isShowingDurations = false;

    rg.renderFn(root, function renderNoteRowInput() {
        const { note, duration, totalDuration, hasDivider } = s.args;
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
                if (!isInTodoList && !isInHotlist) {
                    col = "var(--fg-color)";
                } else {
                    col = "var(--bg-color-focus-2)";
                }
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
        noteRowText.render(s.args);

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
    });

    root.el.addEventListener("click", () => {
        const { note } = s.args;

        setCurrentNote(state, note.id);
        rerenderApp();
    });

    return root;
}

function NoteListInternal(rg: RenderGroup, s: State<{
    flatNotes: NoteId[];
    scrollParent: HTMLElement | null;
}>) {
    const root = div({
        class: "w-100 sb1b sb1t",
    });
    const noteList = newListRenderer(root, () => newComponent(NoteRowInput));

    rg.renderFn(root, function renderNoteListInteral() {
        const { flatNotes, scrollParent } = s.args;

        noteList.render((getNext) => {
            let stickyOffset = 0;

            const currentNote = getCurrentNote(state);

            for (let i = 0; i < flatNotes.length; i++) {
                const id = flatNotes[i];
                const note = getNote(state, id);
                const component = getNext();

                const isOnCurrentLevel = currentNote.parentId === note.parentId;
                let isSticky = (note.id !== currentNote.id && note.data._isSelected) || (
                    isOnCurrentLevel &&
                    note.data.isSticky
                );

                const durationMs = getNoteDurationUsingCurrentRange(state, note);

                assert(note.parentId, "Note didn't have a parent!");
                const parentNote = getNote(state, note.parentId);
                const parentDurationMs = getNoteDurationUsingCurrentRange(state, parentNote);

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
    })

    return root;
}

function NotesList(rg: RenderGroup) {
    const list1 = newComponent(NoteListInternal);
    const root = div({}, [
        list1,
    ]);

    rg.renderFn(root, function renderNotesList() {
        list1.render({
            flatNotes: state._flatNoteIds,
            scrollParent: root.el.parentElement,
        });
    });

    return root;
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


function AsciiIcon(rg: RenderGroup, s: State<AsciiIconData>) {
    const icon = div();

    icon.el.style.userSelect = "none";
    icon.el.style.whiteSpace = "pre";
    icon.el.style.fontSize = "6px";
    icon.el.style.fontFamily = "Courier";
    icon.el.style.fontWeight = "bold";
    icon.el.style.textShadow = "1px 1px 0px var(--fg-color)";

    rg.renderFn(icon, function renderAsciiIcon() {
        const { data } = s.args;
        setText(icon, data);
    });

    return icon;
}

function DarkModeToggle(rg: RenderGroup) {
    const button = newComponent(Button);
    button.render({
        label: "",
        onClick: () => {
            let theme = getTheme();
            if (!theme || theme === "Light") {
                theme = "Dark";
            } else {
                theme = "Light";
            }

            setTheme(theme);
            rerenderApp();
        }
    });
    const iconEl = newComponent(AsciiIcon);
    replaceChildren(button, [
        iconEl,
    ]);

    function getIcon(theme: AppTheme) {
        if (theme === "Light") return ASCII_SUN;
        if (theme === "Dark") return ASCII_MOON_STARS;
        return ASCII_MOON_STARS;
    }

    rg.renderFn(button, function renderButton() {
        iconEl.render(getIcon(getTheme()));
    });

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

function exportAsText(state: NoteTreeGlobalState, flatNotes: NoteId[]) {
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

function ActivityListContainer(rg: RenderGroup, s: State<{ docked: boolean }>) {
    const scrollActivitiesToTop = newComponent(Button);
    scrollActivitiesToTop.render({
        label: "Top", 
        onClick: () => {
            state._currentlyViewingActivityIdx = state.activities.length - 1;
            rerenderApp();
        },
    });
    const scrollActivitiesToMostRecent = newComponent(Button);
    scrollActivitiesToMostRecent.render({
        label: "Most Recent",
        onClick: () => {
            state._currentlyViewingActivityIdx = getMostRecentIdx();
            rerenderApp();
        }
    });
    const prevActivity = newComponent(Button);
    prevActivity.render({
        label: "<-",
        onClick: () => {
            const idx = getNextIdx();
            if (idx !== -1) {
                state._currentlyViewingActivityIdx = idx;
                rerenderApp();
            }
        }
    });
    const nextActivity = newComponent(Button);
    nextActivity.render({
        label: "->",
        onClick: () => {
        const idx = getPrevIdx();
        if (idx !== -1) {
            state._currentlyViewingActivityIdx = idx;
            rerenderApp();
        }
    }});

    const activityList = newComponent(EditableActivityList);
    const breakInput = newComponent(BreakInput);
    const root = div({ class: "flex-1 col" }, [
        div({ class: "flex row align-items-center", style: "user-select: none; padding-left: 10px;" }, [
            el("H3", { style: "margin: 0; padding: 1em 0;", }, ["Activity List"]),
            div({ class: "flex-1" }),
            scrollActivitiesToTop,
            scrollActivitiesToMostRecent,
            div({ style: "width: 10px" }),
            div({ style: "width: 50px" }, [nextActivity]),
            div({ style: "width: 50px" }, [prevActivity]),
        ]),
        div({ style: "border-bottom: 1px solid var(--bg-color-focus-2)" }),
        breakInput,
        activityList,
    ]);

    function getNextIdx() {
        return findNextActiviyIndex(state, state.currentNoteId, state._currentlyViewingActivityIdx);
    }

    function getPrevIdx() {
        return findPreviousActiviyIndex(state, state.currentNoteId, state._currentlyViewingActivityIdx);
    }

    function getMostRecentIdx() {
        return findPreviousActiviyIndex(state, state.currentNoteId, state.activities.length - 1);
    }

    rg.renderFn(root, function renderActivityListContainer() {
        breakInput.render(undefined);

        if (s.args.docked) {
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
    });

    return root;
}

function makeUnorderedList(text: (string | Insertable)[]) {
    return el("UL", {}, text.map(s => el("LI", {}, [s])));
}

function CheatSheet(_rg: RenderGroup) {
    function keymapDivs(keymap: string, desc: string) {
        return div({ class: "row" }, [
            div({ style: "width: 500px; padding-right: 50px;" }, [keymap]),
            div({ class: "flex-1" }, [desc]),
        ])
    }

    const root = div({ style: "padding: 10px" }, [
        el("H3", {}, ["Cheatsheet"]),
        el("H4", {}, ["Offline use"]),
        isRunningFromFile() ? (
            div({}, [
                "The 'Download this page!' button is gone, now that you've downloaded the page.",
                ` Moving or renaming this file will result in all your data being lost, so make sure you download a copy of your JSON before you do that.`,
                ` The same is true if I or my hosting provider decided to change the URL of this page - not something you need to worry about anymore, now that you've downloaded this page.`,
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
            keymapDivs(`[Enter], while not editing`, `Start editing the current note`),
            keymapDivs(`[Enter], while editing`, `Create a new note after the current note. Unless the note starts with \`\`\` in which case [Enter] will just create new lines`),
            keymapDivs(`[Shift] + [Enter], while editing`, `Insert new lines in the note text. Unless the note starts with \`\`\` in which case [Shift] + [Enter] adds a new note after this one`),
            keymapDivs(`[Ctrl] + [Enter]`, `Create a new note 1 level below the current note`),
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
            keymapDivs(`[Ctrl] + [Shift] + [D]`, `Enter 'duration mode'`),
            keymapDivs(`[Ctrl] + [/]`, `Find and open URLs above or below a note`),
            keymapDivs(`[Ctrl] + [Shift] + [1]`, `Make this note sticky. It will still be visible when youve scrolled down a lot.`),
            keymapDivs(`[Ctrl] + [Shift] + [Left/Right], when not in the TODO list`, `Move up and down the activity list 1 activity at a time`),
            keymapDivs(`[Ctrl] + [Shift] + [Up/Down], when not in the TODO list`, `Enter the TODO List`),
            keymapDivs(`[Ctrl] + [Shift] + [Up/Down], when in the TODO list`, `Move up and down the TODO list`),
            keymapDivs(`[Ctrl] + [Shift] + [Left/Right], when in the TODO list`, `Change the scope of the TODO list. There are three scopes: Rightmost = Everything in progress under a specific high level task, Center = Every note in progress, Leftmost = The first note from every high level task that is in progress. I've found these really useful to get a handle on and move between everything I'm working on, or every individual task underneath one higher level task`),
        ]),
        el("H4", {}, ["Note statuses"]),
        makeUnorderedList([
            noteStatusToString(STATUS_IN_PROGRESS) + ` - This note is currently in progress`,
            noteStatusToString(STATUS_ASSUMED_DONE) + ` - This note is assumed to be done`,
            noteStatusToString(STATUS_DONE) + ` - This note has been manually marked as done by you`,
        ]),
        el("H4", {}, ["The TODO List"]),
        makeUnorderedList([
            `Every note without sub-notes that is in progress will appear in the TODO list, which can be entered with [Ctrl+Shift+Up/Down] and then traversed with Up/Down/Left/Right (more details above).`,
            `Starting a note with > will keep it in progress even after moving on from it.`,
            `Starting a note with >> will turn it into a 'higher level task'. Every in-progress note will be grouped under the higher level task that is any number of levels above it. This will become more obvious when you're traversing the TODO list, or when you are looking at the table of note durations.`,
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
            `You can also change or disable the date range that is being used to calculate the duration next to each note`,
            `You should also see a table with rows for all the higher level tasks, and the time spent on them`,
        ]),
        el("H4", {}, ["Estimates"]),
        makeUnorderedList([
            `You can add estimates to a particular note. Type E=<n> where <n> is some number of hours and minutes, e.g E=1.5h or E=1h30m. This will pin the total duration of a particular note to the status, and this will go red if you're over your estimate.`,
            `Estimates do not contribute to the parent estimate. Instead, if the sum of the child estimates is greater than the parent estimate, you will be warned of this, so that you can update the estimate yourself. Most of the value of estimates comes from the planning/thinking side-effects, so I am no longer automating this calculation.`,
            `If a note underneath an estimated note doesn't have it's own estimate, it will be 'allocated' the estimated time remaining, which is calculated using some logic like [Parent estimate] - [total duration of all notes under Parent which are no longer in progress] - [total estimate of all notes under Parent which are currently in progress].`,
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
    ])

    return root;
}

function getNextHotlistActivityInDirection(state: NoteTreeGlobalState, idx: number, backwards: boolean): number {
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

        // Only stepping one activity at a time. not doing anything fancy any more.

        const activity = activities[idx];
        if (activity.nId) {
            break;
        }
    }


    return idx;
}

function moveToLastNote(): boolean {
    const lastNoteId = state._lastNoteId;

    if (!lastNoteId) {
        return false;
    }

    if (!hasNote(state, lastNoteId)) {
        return false;
    }

    if (state.currentNoteId === lastNoteId) {
        return false;
    }

    const note = getNote(state, lastNoteId);
    const currentNote = getCurrentNote(state);

    // Don't bother moving to the last note if that note is literally just the one above/below
    if (currentNote.parentId === note.parentId) {
        const siblings = getNote(state, currentNote.parentId!).childIds;
        const currentIdx = siblings.indexOf(currentNote.id);
        if (siblings[currentIdx - 1] === lastNoteId || siblings[currentIdx + 1] === lastNoteId) {
            return false;
        }
    }

    setCurrentNote(state, lastNoteId);

    return true;
}

function moveInDirectonOverHotlist(backwards: boolean) {
    if (backwards) {
        // NOTE: there is currently no UI that says that we will go back to the previous note :(
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
    nextIdx = getNextHotlistActivityInDirection(state, nextIdx, backwards);

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
let todoListIndex = 0;

function getCurrentTodoNoteIdx(fromTheTop = true): number {
    // Get the index of the current note, if it's in the TODO list
    const todoNoteIds = state._todoNoteIds;
    let idx = todoNoteIds.indexOf(state.currentNoteId);
    if (idx !== -1) {
        return idx
    }

    // If not, get the first (or last) note in the todo list under the current higher level task.
    // This really helps for the use-case where I just want to quickly review everything under a particcular task.
    // Might not be very useful, considering we can just filter by ever note under the current HLT...
    const currentNote = getCurrentNote(state);
    const currentHlt = getHigherLevelTask(state, currentNote);
    if (currentHlt) {
        const predicate = (id: NoteId) => {
            const todoNote = getNote(state, id);
            return todoNote.data._higherLevelTaskId === currentHlt.id;
        }
        if (fromTheTop) {
            idx = todoNoteIds.findIndex(predicate);
        } else {
            idx = findLastIndex(todoNoteIds, predicate);
        }
        if (idx !== -1) {
            return idx
        }
    }

    // If not, get the first (or last) ntoe in the todo list.

    if (fromTheTop) {
        return 0;
    }

    return todoNoteIds.length - 1;
}

function moveInDirectionOverTodoList(amount: number) {
    const todoNoteIds = state._todoNoteIds;

    let wantedIdx = -1;
    if (!isInTodoList) {
        isInTodoList = true;
        wantedIdx = getCurrentTodoNoteIdx(
            amount === 1
        );
    } else {
        wantedIdx = Math.max(0, Math.min(todoNoteIds.length - 1, todoListIndex + amount));
    }

    if (
        wantedIdx === -1 ||
        wantedIdx >= todoNoteIds.length
    ) {
        // Would rather just not move into the todo list than 
        // try to do something 'smart' like finding the closest TODO note
        showStatusText("Couldn't find this note in the TODO list");
        isInTodoList = false;
        return;
    }

    setTodoListIndex(wantedIdx);
}

function setTodoListIndex(idx: number) {
    if (idx === -1) {
        return;
    }

    todoListIndex = idx;

    // Move to the most recent note in this subtree.
    setCurrentNote(state, state._todoNoteIds[todoListIndex]);
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
    console.log("init state!");
    loadState(() => {
        setTheme(getTheme());
        then();
    });
};


function isRunningFromFile(): boolean {
    return window.location.protocol.startsWith("file");
}

function makeDownloadThisPageButton() {
    const button = newComponent(Button);
    button.render({ 
        label: "Download this page!",
        onClick: () => {
            const linkEl = el<HTMLAnchorElement>("A", { download: "note-tree.html", "href": window.location.href });
            linkEl.el.click();
        },
    });
    return button;
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

    const text = getNoteTextWithoutPriority(currentNote.data);
    // TODO: Not just starts with, but if this occurs anywhere before the current cursor position
    // TODO-TODO: not just anywhere after ```, but ignore if another ``` closes the previous ```
    const shiftMakesNewNote = text.startsWith("```");
    if (shiftMakesNewNote === shiftPressed) {
        insertNoteAfterCurrent(state);
        return true;
    }

    return false;
}

function HighLevelTaskDurations(rg: RenderGroup) {
    function Row(rg: RenderGroup, s: State<{
        name: string;
        durationMs: number, nId: NoteId | undefined
    }>) {
        return div({ class: "row sb1b" }, [
            div({}, [
                rg.cArgs(NoteLink, (nl) => {
                    nl.render({
                        preventScroll: true,
                        text: s.args.name,
                        focusAnyway: false,
                        noteId: s.args.nId,
                    });
                })
            ]),
            div({ class: "flex-1", style: "min-width: 100px" }),
            div({}, [rg.text(() => formatDuration(s.args.durationMs))]),
        ]);
    }

    const list = newListRenderer(div(), () => newComponent(Row));
    const renderBreaksCheckbox = newComponent(Checkbox);
    const root = div({ class: "sb1b col align-items-center", style: "padding: 10px" }, [
        el("H3", {}, [
            rg.text(() => {
                if (state._activitiesFrom && state._activitiesTo) {
                    return "Tasks from " + formatDate(state._activitiesFrom, undefined, true) + " to " + formatDate(state._activitiesTo, undefined, true);
                }
                if (state._activitiesFrom) {
                    return "Tasks from " + formatDate(state._activitiesFrom, undefined, true);
                }
                if (state._activitiesTo) {
                    return "Tasks to " + formatDate(state._activitiesTo, undefined, true);
                }
                return "High level task durations";
            })
        ]),
        div({ style: "padding-bottom: 10px" }, [
            renderBreaksCheckbox,
        ]),
        list,
    ]);

    let hideBreaks = false;
    const hltMap = new Map<string, { nId: NoteId | undefined, time: number }>();

    function renderHltList() {
        hltMap.clear();

        for (let i = state._activitiesFromIdx; i <= state._activitiesToIdx; i++) {
            const activity = state.activities[i];
            const nextActivity = state.activities[i + 1];
            const durationMs = getActivityDurationMs(activity, nextActivity);

            if (isBreak(activity) && hideBreaks) {
                continue;
            }

            let hltText = "??";
            let hltNId: NoteId | undefined;

            const nId = activity.nId;
            if (nId) {
                hltText = NIL_HLT_HEADING;

                const note = getNote(state, nId);
                const hlt = getHigherLevelTask(state, note);
                if (hlt) {
                    hltText = getNoteTextWithoutPriority(hlt.data);
                    hltNId = hlt.id;
                }
            } else if (isBreak(activity)) {
                hltText = "[Break]: " + activity.breakInfo;
            }

            const block = hltMap.get(hltText) ?? { time: 0, nId: hltNId };
            block.time += durationMs;
            hltMap.set(hltText, block);
        }

        if (!setVisible(list, hltMap.size > 0)) {
            return;
        }

        // render hlt map
        list.render((getNext) => {
            const hltSorted = [...hltMap.entries()].sort((a, b) => b[1].time - a[1].time);

            for (const [hltName, { time, nId }] of hltSorted) {
                getNext().render({
                    name: hltName,
                    durationMs: time,
                    nId,
                });
            }
        });
    }

    rg.renderFn(root, function renderHighlevelTaskDurations() {
        renderBreaksCheckbox.render({
            label: "Hide breaks",
            value: hideBreaks,
            onChange: (val) => {
                hideBreaks = val;
                rg.render();
            }
        });

        renderHltList();
    })

    return root;
}

const cnInfoButton = sg.makeClass("info-button", [` { 
    display: inline-block;
    text-align: center;
    font-style: italic;
    margin: 10px;
    padding: 10px;
    border-radius: 10px;
}`,
    `:hover { background-color: #AAF; }`,
    `:active { background-color: #00F; color: var(--bg-color); }`
]);

// NOTE: We should only ever have one of these ever.
// Also, there is code here that relies on the fact that
// setInterval in a webworker won't run when a computer goes to sleep, or a tab is closed, and
// auto-inserts a break. This might break automated tests, if we ever
// decide to start using those
export function App(rg: RenderGroup) {
    const cheatSheetButton = el("BUTTON", { class: cnInfoButton, title: "click for a list of keyboard shortcuts and functionality" }, [
        "cheatsheet?"
    ]);
    let currentHelpInfo = 1;
    cheatSheetButton.el.addEventListener("click", () => {
        currentHelpInfo = currentHelpInfo !== 2 ? 2 : 0;
        rerenderApp();
    });

    const filterEditor = newComponent(ActivityFiltersEditor);
    const filterEditorRow = div({ class: "row", style: "" }, [
        filterEditor,
    ]);
    const notesList = newComponent(NotesList);
    const todoList = newComponent(TodoList);
    const rightPanelArea = div({ style: "width: 30%", class: "col sb1l" });
    const bottomLeftArea = div({ class: "flex-1 col", style: "padding: 0" });
    const bottomRightArea = div({ class: "flex-1 col sb1l", style: "padding: 0" })

    const activityListContainer = newComponent(ActivityListContainer);
    const todoListContainer = div({ class: "flex-1 col" }, [
        todoList
    ]);

    const scratchPadModal = newComponent(ScratchPadModal);
    const interactiveGraphModal = newComponent(InteractiveGraphModal);
    const settingsModal = newComponent(SettingsModal);
    const fuzzyFindModal = newComponent(FuzzyFindModal);
    const deleteModal = newComponent(DeleteModal);
    const loadBackupModal = newComponent(LoadBackupModal);
    const linkNavModal = newComponent(LinkNavModal);
    const exportModal = newComponent(ExportModal);

    function setShowingDurations(enabled: boolean) {
        state._isShowingDurations = enabled;
    }

    const durationsButton = newComponent(Button);
    durationsButton.render({
        label: "Durations",
        onClick: () => {
            setShowingDurations(!state._isShowingDurations);
            rerenderApp();
        }
    });
    const todoNotesButton = newComponent(Button);
    todoNotesButton.render({
        label: "Todo Notes",
        onClick: () => {
            toggleCurrentDockedMenu("todoLists");
        },
    });
    const activitiesButton = newComponent(Button);
    activitiesButton.render({
        label: "Activities",
        onClick: () => {
            toggleCurrentDockedMenu("activities");
        }
    });

    let backupText = "";
    let backupFilename = "";
    const bottomButtons = div({ class: "row align-items-end sb1t" }, [
        div({ class: "row align-items-end" }, [
            rg.cArgs(Button, c => c.render({
                label: "Scratch Pad",
                onClick: () => {
                    setCurrentModal(scratchPadModal);
                }
            })),
        ]),
        div({ class: "row align-items-end" }, [
            rg.cArgs(Button, c => c.render({
                label: "Graph",
                onClick: () => {
                    setCurrentModal(interactiveGraphModal);
                }
            }))
        ]),
        div({ class: "flex-1 text-align-center" }, [statusTextIndicator]),
        div({ style: "width: 100px" }, [VERSION_NUMBER]),
        div({ class: "row" }, [
            isRunningFromFile() ? (
                div()
            ) : (
                makeDownloadThisPageButton()
            ),
            rg.cArgs(Button, c => c.render({
                label: "Delete current",
                onClick: () => {
                    setCurrentModal(deleteModal);
                }
            })),
            rg.cArgs(Button, c => c.render({
                label: "Settings",
                onClick: () => {
                    setCurrentModal(settingsModal);
                }
            })),
            todoNotesButton,
            activitiesButton,
            durationsButton,
            rg.cArgs(Button, c => c.render({
                label: "Search",
                onClick: () => {
                    setCurrentModal(fuzzyFindModal);
                }
            })),
            rg.cArgs(Button, c => c.render({
                label: "Export",
                onClick: () => {
                    handleErrors(() => {
                        setCurrentModal(exportModal);
                    });
                }
            })),
            rg.cArgs(Button, c => c.render({
                label: "Load JSON",
                onClick: () => {
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
                }
            })),
        ])
    ]);

    const errorBanner = div({ style: "padding: 20px; background-color: red; color: white; position: sticky; top: 0" });

    const appRoot = div({ class: "relative", style: "padding-bottom: 100px" }, [
        div({ class: "col", style: "position: fixed; top: 0; bottom: 0px; left: 0; right: 0;" }, [
            div({ class: "row flex-1" }, [
                div({ class: "col flex-1 overflow-y-auto" }, [
                    rg.if(() => currentHelpInfo === 2, (rg) => rg.c(CheatSheet)),
                    div({ class: "row align-items-center", style: "padding: 10px;" }, [
                        el("H2", {}, [
                            rg.text(() => "Currently working on - " + formatDate(new Date(), undefined, true, true)),
                        ]),
                        div({ class: "flex-1" }),
                        cheatSheetButton,
                        rg.c(DarkModeToggle),
                    ]),
                    errorBanner,
                    notesList,
                    rg.if(() => state._isShowingDurations, (rg) => rg.c(HighLevelTaskDurations)),
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
        scratchPadModal,
        interactiveGraphModal,
        fuzzyFindModal,
        settingsModal,
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
            e.key !== "Home" &&
            e.key !== "End" &&
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
                // Somewhat hacky to make this kind of carve out for specific modals but not a big deal for now
                if (
                    currentModal !== interactiveGraphModal
                ) {
                    e.preventDefault();
                    setCurrentModal(null);
                }
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
            setCurrentModal(scratchPadModal);
            return;
        } else if (
            e.key === "G" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            setCurrentModal(interactiveGraphModal);
            return;
        } else if (
            e.key === "," &&
            ctrlPressed
        ) {
            e.preventDefault();
            setCurrentModal(settingsModal);
            return;
        } else if (
            e.key === "A" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            if (state.dockedMenu !== "activities") {
                setCurrentDockedMenu("activities")
            } else {
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
        } else if (
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
                if (
                    isInTodoList &&
                    e.ctrlKey &&
                    e.shiftKey
                ) {
                    setTodoListIndex(state._todoNoteIds.length - 1);
                } else {
                    const parent = getNote(state, currentNote.parentId);
                    const siblings = parent.childIds;
                    handleUpDownMovement(siblings[siblings.length - 1] || undefined);
                }
            } else if (currentNote.parentId && e.key === "Home") {
                if (
                    isInTodoList &&
                    e.ctrlKey &&
                    e.shiftKey
                ) {
                    setTodoListIndex(0);
                } else {
                    const parent = getNote(state, currentNote.parentId);
                    const siblings = parent.childIds;
                    handleUpDownMovement(siblings[0] || undefined);
                }
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
                        state._todoNoteFilters = Math.min(2, state._todoNoteFilters + 1);
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
    const worker = newWebWorker([CHECK_INTERVAL_MS], (checkIntervalMs: number) => {
        let started = false;
        setInterval(() => {
            postMessage("is-open-check");

            if (!started) {
                started = true;
                // logTrace isn't dfined inside of web workers, so using console.log instead
                console.log("Web worker successfuly started! This page can now auto-insert breaks if you've closed this tab for extended periods of time");
            }
        }, checkIntervalMs);
    });
    worker.onmessage = () => {
        autoInsertBreakIfRequired();
    };
    worker.onerror = (e) => {
        console.error("Webworker error: ", e);
    }

    rg.preRenderFn(appRoot, function rerenderAppComponent() {
        recomputeState(state);

        // render modals
        {
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

            if (setVisible(settingsModal, currentModal === settingsModal)) {
                settingsModal.render(undefined);
            }

            if (setVisible(deleteModal, currentModal === deleteModal)) {
                deleteModal.render(undefined);
            }

            if (setVisible(exportModal, currentModal === exportModal)) {
                exportModal.render(undefined);
            }

            scratchPadModal.render({
                canvasArgs: {
                    outputLayers: state.scratchPadCanvasLayers,
                    onInput() { },
                    onWrite() {
                        debouncedSave();
                    }
                },
                open: currentModal === scratchPadModal
            });

            if (setVisible(interactiveGraphModal, currentModal === interactiveGraphModal)) {
                interactiveGraphModal.render(undefined)
            }
        }

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
            cursorNoteId: state._todoNoteIds[getCurrentTodoNoteIdx()],
        });

        let error = "";
        if (state.criticalSavingError) {
            error = state.criticalSavingError;
        }

        setVisible(errorBanner, !!error);
        setText(errorBanner, error);
    });

    // rg.renderFn(appRoot, () => {
    //     enableDebugMode();
    //     printRenderCounts();
    // });

    return appRoot;
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
            const mb = bytesToMegabytes(bytes);

            // in case the storage.estimate().then never happens, lets just show something.
            showStatusText("Saved (" + mb.toFixed(2) + "mb)", "var(--fg-color)", SAVE_DEBOUNCE);

            // A shame we need to do this :(
            navigator.storage.estimate().then((data) => {
                const estimatedMbUsage = bytesToMegabytes(data.usage ?? 0);
                showStatusText("Saved (" + mb.toFixed(2) + "mb / " + estimatedMbUsage.toFixed(2) + "mb)", "var(--fg-color)", SAVE_DEBOUNCE);

                const baseErrorMessage = "WARNING: Your browser is consuming SIGNIFICANTLY more disk space on this site than what should be required: " +
                    estimatedMbUsage.toFixed(2) + "mb being used instead of an expected " + (mb * 2).toFixed(2) + "mb.";

                const COMPACTION_THRESHOLD = 10;
                const CRITICAL_ERROR_THRESHOLD = 20;

                if (mb * COMPACTION_THRESHOLD < estimatedMbUsage) {
                    console.warn(baseErrorMessage);
                    tryForceIndexedDBCompaction();
                }

                if (mb * CRITICAL_ERROR_THRESHOLD < estimatedMbUsage) {
                    tryForceIndexedDBCompaction();

                    const criticalSavingError = baseErrorMessage + " You should start backing up your data ever day, and anticipate a crash of some sort. Also consider using this website in another browser. This bug should be reported as a github issue on https://github.com/Tejas-H5/Working-on-Tree"

                    state.criticalSavingError = criticalSavingError;
                    console.error(criticalSavingError);
                } else {
                    state.criticalSavingError = "";
                }
            });

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

const app = newComponent(App);
appendChild(
    newInsertable(document.body),
    app
);

const rerenderApp = (shouldScroll = true, isTimer = false) => {
    // there are actually very few times when we don't want to scroll to the current note
    renderOptions.shouldScroll = shouldScroll;
    renderOptions.isTimer = isTimer;
    app.render(undefined);
}


initState(() => {
    autoInsertBreakIfRequired();

    // A lot of UI relies on the current date/time to render it's contents
    // In order for this UI to always be up-to-date, I'm just re-rendering the entire application somewhat frequently.
    // I have decided that this is a viable approach, and is probably the easiest and simplest way to handle this for now.
    // Components should just be designed to work despite excessive re-renders anyway.
    // I'm still not convinced that rerendering the ENTIRE page is a good solution.
    // I'm also not convinced that this problem is unsolveable without using create() and dispose() methods. 
    // For now I'll just limit this to twice a second, and then profile and fix any performance bottlenecks 
    // (which is apparently very easy to do here)
    setInterval(() => {
        // rerenderApp(false, true);
    }, 500);

    initKeyboardListeners(rerenderApp);

    rerenderApp();
});
