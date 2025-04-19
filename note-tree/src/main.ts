// Doesn't really follow any convention. I bump it up by however big I feel the change I made was.
// This will need to change if this number ever starts mattering more than "Is the one I have now the same as latest?"
// 'X' will also denote an unstable/experimental build. I never push anything up if I think it will break things, but still
const VERSION_NUMBER = "1.02.14";

import { AsciiCanvas, newCanvasState, resetCanvas } from "src/canvas";
import { Button, Checkbox, DateTimeInput, Modal, PaginationControl, ScrollContainer } from "src/components";
import { ASCII_MOON_STARS, ASCII_SUN, AsciiIconData } from "src/icons";
import { clampIndexToArrayBounds, clampIndexToBounds, countOccurances, moveArrayItem, newArray } from "src/utils/array-utils";
import { DAYS_OF_THE_WEEK_ABBREVIATED, addDays, extractDateFromText, floorDateLocalTime, floorDateToWeekLocalTime, formatDate, formatDateTime, formatDuration, formatDurationAsHours, formatIsoDate, formatTime, getDatePlaceholder, getTimestamp, isValidDate, parseDateSafe, parseIsoDate, parseLocaleDateString, truncate } from "src/utils/datetime";
import {
    Component,
    Insertable,
    RenderGroup,
    addChildren,
    appendChild,
    cn,
    contentsDiv,
    div,
    el,
    getCurrentNumAnimations,
    initializeDomUtils,
    isDebugging,
    isEditingInput,
    isEditingTextSomewhereInDocument,
    newComponent,
    newComponentArgs,
    newCssBuilder,
    newInsertable,
    newListRenderer,
    replaceChildren,
    scrollIntoView,
    setAttr,
    setAttrs,
    setClass,
    setDebugMode,
    setInputValue,
    setStyle,
    setText,
    setVisible,
    span,
} from "src/utils/dom-utils";
import { loadFile, saveText } from "src/utils/file-download";
import { Range } from "src/utils/fuzzyfind";
import * as tree from "src/utils/int-tree";
import { Pagination, getCurrentEnd, getStart, idxToPage, setPage } from "src/utils/pagination";
import { forEachUrlPosition, openUrlInNewTab } from "src/utils/url";
import { bytesToMegabytes, utf8ByteLength } from "src/utils/utf8";
import { newWebWorker } from "src/utils/web-workers";
import { EditableTextArea } from "./components/text-area";
import { TextInput } from "./components/text-input";
import { InteractiveGraph } from "./interactive-graph";
import {
    Activity,
    AppTheme,
    Boolean7,
    CurrentDateScope,
    DockableMenu,
    ESTIMATE_START_PREFIX,
    FuzzyFindState,
    InProgressNotesState,
    MIN_TASK_STREAM_IDX,
    NoteId,
    NoteTreeGlobalState,
    STATUS_ASSUMED_DONE,
    STATUS_DONE,
    STATUS_IN_PROGRESS,
    TaskCompletion,
    TaskCompletions,
    TaskStream,
    TreeNote,
    ViewAllTaskStreamsState,
    ViewCurrentScheduleState,
    ViewTaskStreamState,
    WorkdayConfig,
    WorkdayConfigHoliday,
    WorkdayConfigWeekDay,
    addNoteToTaskStream,
    applyPendingScratchpadWrites,
    clamp,
    deleteDoneNote,
    deleteNoteIfEmpty,
    deleteTaskStream,
    dfsPre,
    findNextActiviyIndex,
    findPreviousActiviyIndex,
    formatDurationAsEstimate,
    fuzzySearchNotes,
    getActivityDurationMs,
    getActivityText,
    getActivityTime,
    getCurrentInProgressState,
    getCurrentNote,
    getCurrentStateAsJSON,
    getCurrentTaskStreamState,
    getHigherLevelTask,
    getLastActivity,
    getLastActivityWithNote,
    getLastActivityWithNoteIdx,
    getLastSelectedNote,
    getMostRecentlyWorkedOnChildActivityIdx,
    getMostRecentlyWorkedOnChildActivityNote,
    getNote,
    getNoteChildEstimates,
    getNoteDurationUsingCurrentRange,
    getNoteDurationWithoutRange,
    getNoteEstimate,
    getNoteNDownForMovement,
    getNoteNUpForMovement,
    getNoteOneDownLocally,
    getNoteOneUpLocally,
    getNoteOrUndefined,
    getNoteTextTruncated,
    getNoteTextWithoutPriority,
    getNumParentsInTaskStream,
    getParentNoteWithEstimate,
    getQuicklistIndex,
    getRootNote,
    getWorkdayConfigHolidayDate,
    hasAnyTimeAtAll,
    hasNote,
    idIsNil,
    idIsNilOrRoot,
    idIsNilOrUndefined,
    idIsRoot,
    initializeNoteTreeTextArea,
    insertChildNote,
    insertNewTaskStreamAt,
    insertNoteAfterCurrent,
    isBreak,
    isCurrentlyTakingABreak,
    isEditableBreak,
    isNoteInTaskStream,
    isNoteUnderParent,
    loadState,
    loadStateFromBackup,
    newBreakActivity,
    noteStatusToString,
    parseNoteEstimate,
    predictTaskCompletions,
    pushBreakActivity,
    recomputeState,
    recomputeViewAllTaskStreamsState,
    recomputeViewTaskStreamState,
    removeNoteFromNoteIds,
    resetState,
    saveState,
    setActivityRangeToThisWeek,
    setActivityRangeToToday,
    setActivityTime,
    setCurrentActivityIdxToCurrentNote,
    setCurrentNote,
    setFuzzyFindIndex,
    setIsEditingCurrentNote,
    setQuicklistIndex,
    setStateFromJSON,
    setTheme,
    shouldScrollToNotes,
    state,
    toggleActivityScopedNote
} from "./state";
import { cnApp, cssVars } from "./styling";
import { assert } from "./utils/assert";
import { logTrace } from "./utils/log";

const SAVE_DEBOUNCE = 1500;
const ERROR_TIMEOUT_TIME = 5000;

const GITHUB_PAGE = "https://github.com/Tejas-H5/Working-on-Tree";
const GITHUB_PAGE_ISSUES = "https://github.com/Tejas-H5/Working-on-Tree/issues/new?template=Blank+issue";

// Used by webworker and normal code
export const CHECK_INTERVAL_MS = 1000 * 10;

const cssb = newCssBuilder();

const cnHoverLink = cssb.cn("hover-link", [
    `:hover{ cursor: pointer; }`,
    `:hover::after { content: " -->"; }`,
]);

function NoteLink(rg: RenderGroup<{
    text: string;
    shouldScroll: boolean;
    focusAnyway?: boolean;
    noteId?: NoteId;
}>) {
    return div({ style: "padding:5px; ", class: [cn.handleLongWords] }, [
        rg.class(cnHoverLink, (s) => !idIsNilOrUndefined(s.noteId)),
        rg.style("backgroundColor", (s) => (!!s.focusAnyway || state.currentNoteId === s.noteId) ? (
            `${cssVars.bgColorFocus}`
        ) : (
            `${cssVars.bgColor}`
        )),
        rg.text((s) => truncate(s.text, 500)),
        rg.on("click", ({ noteId, shouldScroll }, e) => {
            e.stopImmediatePropagation();

            // setTimeout here because of a funny bug when clicking on a list of note links that gets inserted into 
            // while we are clicking will cause the click event to be called on both of those links. Only in HTML is
            // something like this allowed to happen. LOL.
            setTimeout(() => {
                if (!idIsNilOrUndefined(noteId)) {
                    setCurrentNote(state, noteId);

                    renderSettings.shouldScroll = shouldScroll;
                    rerenderApp();
                }
            }, 1);
        }),
    ]);
}

function ScrollNavItem(rg: RenderGroup<{
    isCursorVisible: boolean;
    isCursorActive: boolean;
    isGreyedOut?: boolean;
    isFocused: boolean;
}>, children: Insertable[]) {
    return div({ class: [cn.row, cn.alignItemsStretch] }, [
        rg.style(`backgroundColor`, (s) => s.isFocused ? `${cssVars.bgColorFocus}` : ``),
        rg.style(`color`, (s) => s.isGreyedOut ? `${cssVars.unfocusTextColor}` : ``),
        div({ style: "min-width: 5px;" }, [
            rg.style("opacity", s => s.isCursorVisible ? "1" : "0"),
            rg.style("backgroundColor", (s) => {
                return s.isCursorActive ? `${cssVars.fgColor}` : cssVars.bgColorFocus2
            }),
        ]),
        div({ class: [cn.flex1, cn.handleLongWords] }, [
            ...children,
        ]),
    ]);
}

const NIL_HLT_HEADING = "<No higher level task>";

function QuickList(rg: RenderGroup<{ cursorNoteId?: NoteId; }>) {
    const listInternal = newComponent(FuzzyFindResultsList);
    const empty = div({}, [
        "Search for some notes, and then fast-travel through the results with [Ctrl] + [Shift] + [Up/Down]. ",
        "If the query is empty, notes from the task stream that was selected last will be used instead.",
    ]);
    const scrollContainer = newComponent(ScrollContainer);
    const root = div({ class: [cn.flex1, cn.col] }, [
        el("H3", { style: "user-select: none; padding-left: 10px; text-align: center;" }, [
            rg.text(() => {
                let query = "";
                if (state._fuzzyFindState.query) {
                    query = `"${state._fuzzyFindState.query}"`;
                } else{
                    const taskStream = state.taskStreams[state.currentTaskStreamIdx];
                    if (taskStream) {
                        query = "Task stream [" + taskStream.name + "]"
                    } else {
                        query = "No query. Notes will appear here once you search for something, or create some task streams.";
                    }
                }

                let scope = "Global";
                if (!idIsNil(state._fuzzyFindState.scopedToNoteId)) {
                    const note = getNoteOrUndefined(state, state._fuzzyFindState.scopedToNoteId);
                    if (note) {
                        scope = getNoteTextTruncated(note.data);
                    }
                }

                return `${query} - [${scope}]`;
            }),
        ]),
        div({ style: `border-bottom: 1px solid ${cssVars.bgColorFocus2}` }),
        addChildren(setAttrs(scrollContainer, { class: [cn.flex1, cn.col] }, true), [
            empty,
            listInternal,
        ])
    ]);

    rg.preRenderFn((s) => {
        setVisible(empty, state._fuzzyFindState.matches.length === 0);

        let scrollEl: Insertable | null = null;

        listInternal.render({
            finderState: state._fuzzyFindState,
            compact: true,
            isCursorActive: isInQuicklist,
        });

        scrollContainer.render({
            scrollEl,
            rescrollMs: 5000,
        });
    });

    return root;
}

function BreakInput(rg: RenderGroup) {
    const breakInput = el<HTMLInputElement>("INPUT", { class: [cn.w100] });
    const breakButton = newComponent(Button);
    const root = div({ style: "padding: 5px;" }, [
        // I'm putting it here above the break input because it seems fitting amongst the other activity times, however,
        // this clock is really just a way for me to know that my app hasn't frozen.
        // So if I ever want to delete it, I _must_ put it somewhere else.
        div({}, [
            rg.realtime(rg =>
                rg.text(() => formatDateTime(new Date(), undefined, true, true))
            )
        ]),
        div({ class: [cn.row, cn.alignItemsCenter] }, [
            div({ class: [cn.flex1] }, [breakInput]),
            div({}, [breakButton]),
        ]),
    ]);

    rg.preRenderFn(function renderBreakInput() {
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

function ActivityListItem(rg: RenderGroup<{
    previousActivity: Activity | undefined;
    activity: Activity;
    nextActivity: Activity | undefined;
    showDuration: boolean;
    focus: boolean;
    greyedOut?: boolean;
    hasCursor: boolean;
}>) {
    const breakEdit = el<HTMLInputElement>(
        "INPUT", { class: [cn.preWrap, cn.w100, cnApp.solidBorderSmRounded], style: "padding-left: 5px" }
    );

    function deleteBreak() {
        const s = rg.s;
        const { activity } = s;

        if (!isEditableBreak(activity)) {
            // can only delete breaks
            return;
        }

        const idx = state.activities.indexOf(activity);
        if (idx === -1) {
            return;
        }

        state.activities.splice(idx, 1);
        rerenderApp();
    };

    function insertBreak() {
        const s = rg.s;
        const { activity, nextActivity } = s;

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
        rerenderApp();
    };

    const noteLink = newComponent(NoteLink);
    const timestamp = newComponent(DateTimeInput);
    const timestampWrapper = div({ style: "" }, [timestamp]);
    const cursorRow = newComponentArgs(ScrollNavItem, [[
        div({ class: [cn.hoverParent, cn.borderBox], style: "min-height: 10px" }, [
            div({ class: [cn.hoverTarget] }, [
                div({ class: [cn.row, cn.alignItemsCenter, cn.justifyContentCenter] }, [
                    div({ class: [cn.flex1], style: `border-bottom: 1px solid ${cssVars.fgColor}` }),
                    rg.c(Button, c => c.render({
                        label: "+ Insert break here",
                        onClick: insertBreak,
                    })),
                    div({ class: [cn.flex1], style: `border-bottom: 1px solid ${cssVars.fgColor}` }),
                ])
            ]),
        ]),
        div({ class: [cn.row], style: "gap: 20px; padding: 5px 0;" }, [
            div({ class: [cn.flex1] }, [
                timestampWrapper,
                div({ class: [cn.row, cn.alignItemsCenter], style: "padding-left: 20px" }, [
                    noteLink,
                    breakEdit,
                    rg.if(
                        isEditable,
                        rg => rg.c(Button, c => c.render({
                            label: " x ",
                            onClick: deleteBreak,
                        }))
                    ),
                ]),
            ]),
            rg.if(s => s.activity === state.activities[state.activities.length - 1], rg =>
                rg.realtime(rg =>
                    rg.inlineFn(
                        div({ style: "padding-left: 10px; padding-right: 10px;" }),
                        (c, s) => {
                            renderDuration(
                                c,
                                s.activity,
                                s.nextActivity,
                                s.showDuration,
                            );
                        }
                    )
                )
            ),
            rg.else(rg =>
                rg.inlineFn(
                    div({ style: "padding-left: 10px; padding-right: 10px;" }),
                    (c, s) => {
                        renderDuration(
                            c,
                            s.activity,
                            s.nextActivity,
                            s.showDuration,
                        );
                    }
                )
            )
        ])
    ]]);

    const root = div({}, [
        cursorRow,
    ]);

    function isEditable() {
        const s = rg.s;
        const { activity, greyedOut } = s;
        return !greyedOut && isEditableBreak(activity);
    }

    function renderDuration(
        el: Insertable<HTMLElement>,
        activity: Activity,
        nextActivity: Activity | undefined,
        showDuration: boolean,
    ) {
        // The idea is that only breaks we insert ourselves retroactively are editable, as these times
        // did not come from the computer's sytem time but our own subjective memory
        const isAnApproximation = isEditable();

        if (setVisible(el, showDuration)) {
            const durationStr = (isAnApproximation ? "~" : "") + formatDuration(getActivityDurationMs(activity, nextActivity));
            setText(el, durationStr);
        }
    }

    rg.preRenderFn(function renderActivityListItem(s) {
        const { activity, greyedOut, focus, hasCursor } = s;

        cursorRow.render({
            isCursorVisible: hasCursor,
            isCursorActive: isInHotlist,
            isFocused: focus,
            isGreyedOut: greyedOut,
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
                shouldScroll: true,
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
    });

    function updateActivityTime(date: Date | null) {
        if (!date) {
            return;
        }

        const s = rg.s;
        const { previousActivity, activity, nextActivity } = s;

        if (previousActivity) {
            // don't update our date to be before the previous time
            const prevTime = getActivityTime(previousActivity);
            if (prevTime.getTime() > date.getTime()) {
                showStatusText(`Can't set time to ${formatDateTime(date)} as it would re-order the activities`);
                return;
            }
        }

        let nextTime = nextActivity ? getActivityTime(nextActivity) : new Date();
        if (nextTime.getTime() < date.getTime()) {
            showStatusText(`Can't set time to ${formatDateTime(date)} as it would re-order the activities`);
            return;
        }

        setActivityTime(activity, date);
        rerenderApp();
        debouncedSave();
    }

    noteLink.el.addEventListener("click", () => {
        const s = rg.s;
        const { activity } = s;
        if (!activity.nId) {
            return;
        }

        setCurrentNote(state, activity.nId);
        rerenderApp();
    });

    function handleBreakTextEdit() {
        const s = rg.s;
        const { activity } = s;

        // 'prevent' clearing it out
        const val = breakEdit.el.value || activity.breakInfo;

        activity.breakInfo = val;
        rerenderApp();
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
    return rg.cArgs(Modal, (c) => c.render({
        onClose: () => setCurrentModalAndRerenderApp(null),
    }), [
        div({ class: [cn.col], style: "align-items: stretch" }, [
            rg.c(Button, c => c.render({
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
            rg.c(Button, c => c.render({
                label: "Download JSON",
                onClick: () => {
                    handleErrors(() => {
                        // TODO: custom method to generate a new file name
                        saveText(getCurrentStateAsJSON(), `Note-Tree Backup - ${formatDateTime(new Date()).replace(/\//g, "-")}.json`);
                    });
                }
            }))
        ])
    ]);
}

function DeleteModal(rg: RenderGroup) {
    const heading = el("H2", { style: "text-align: center" }, ["Delete current note"]);
    const textEl = div();
    const countEl = div();
    const timeEl = div();
    const recentEl = div();
    const deleteButton = newComponent(Button);
    const cantDelete = div({
        class: [cnApp.solidBorder], style: `padding: 10px; background: ${cssVars.fgColor}; color: red;`
    }, [
        "This note is still in progress!!!"
    ]);
    const root = newComponentArgs(Modal, [[
        div({ style: modalPaddingStyles(10, 70, 50) }, [
            heading,
            textEl,
            div({ style: "height: 20px" }),
            countEl,
            timeEl,
            recentEl,
            div({ style: "height: 20px" }),
            div({ class: [cn.row, cn.justifyContentCenter] }, [
                deleteButton,
                cantDelete,
            ]),
            div({ style: "height: 20px" }),
            div({ style: "text-align: center" }, [
                "NOTE: I only added the ability to delete notes as a way to improve performance, if typing were to start lagging all of a sudden. You may not need to delete notes for quite some time, although more testing on my end is still required."
            ])
        ])
    ]]);

    function deleteNote(e: MouseEvent) {
        e.preventDefault();

        const currentNote = getCurrentNote(state);
        if (currentNote.data._status !== STATUS_DONE) {
            return;
        }

        deleteDoneNote(state, currentNote);
        setCurrentModalAndRerenderApp(null);
        showStatusText(
            "Deleted!" +
            (Math.random() < 0.05 ? " - Good riddance..." : "")
        );
    };

    rg.preRenderFn(function renderDeleteModal() {
        const currentNote = getCurrentNote(state);

        root.render({
            onClose: () => setCurrentModalAndRerenderApp(null),
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
            setText(recentEl, "The last activity under this note was on " + formatDateTime(getActivityTime(activity), undefined, true));
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
    function LinkItem(rg: RenderGroup<{
        noteId: NoteId;
        text: string;
        range: Range;
        url: string;
        isFocused: boolean;
    }>) {
        const textEl = newComponent(HighlightedText);
        const root = newComponentArgs(ScrollNavItem, [[textEl]]);

        rg.preRenderFn(function renderLinkItem(s) {
            const { text, range, isFocused } = s;

            textEl.render({
                text,
                highlightedRanges: [range]
            });

            root.render({
                isCursorVisible: isFocused,
                isCursorActive: true,
                isFocused: isFocused,
            });
        });

        return root;
    }

    const scrollView = newComponent(ScrollContainer);
    const linkList = newListRenderer(scrollView, () => newComponent(LinkItem));
    const content = div({ class: [cn.col, cn.flex1], style: "padding: 20px" }, [
        el("H2", {}, ["URLs above or under the current note"]),
        linkList,
    ]);
    const empty = div({ style: "padding: 40px" }, ["Couldn't find any URLs above or below the current note."]);
    const root = newComponentArgs(Modal, [[
        div({ class: [cn.col, cn.h100], style: modalPaddingStyles(0) }, [
            content,
            empty,
        ])
    ]]);

    let idx = 0;
    let lastNote: TreeNote | undefined;

    rg.preRenderFn(function renderLinkNavModal() {
        const currentNote = getCurrentNote(state);
        if (lastNote === currentNote) {
            return;
        }

        lastNote = currentNote;

        root.render({
            onClose: () => setCurrentModalAndRerenderApp(null),
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
            let lastNote = currentNote;
            {
                let note = currentNote;
                while (!idIsNilOrRoot(note.parentId)) {
                    note = getNote(state, note.parentId);

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
                }
            }

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
        let scrollEl: Insertable<HTMLElement> | null = null;
        for (let i = 0; i < linkList.components.length; i++) {
            const c = linkList.components[i];
            const s = c.s;
            s.isFocused = i === idx;
            c.renderWithCurrentState();
            if (s.isFocused) {
                scrollEl = c;
            }
        }
        scrollView.render({ scrollEl });
    }

    function moveIndex(amount: number) {
        idx = Math.max(0, Math.min(linkList.components.length - 1, idx + amount));
        rerenderItems();
    }

    document.addEventListener("keydown", (e) => {
        if (state._currentModal?.el !== root.el) {
            // Don't let this code execute  when this modal is closed...
            return;
        }


        if (e.key === "ArrowUp") {
            e.preventDefault();
            moveIndex(-1);
        } else if (e.key === "PageUp") {
            e.preventDefault();
            moveIndex(-10);
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            moveIndex(1);
        } else if (e.key === "PageDown") {
            e.preventDefault();
            moveIndex(10);
        } else if (e.key === "Enter") {
            e.preventDefault();

            const { url, noteId } = linkList.components[idx].s;
            e.stopImmediatePropagation();

            if (e.shiftKey) {
                if (noteId !== state.currentNoteId) {
                    setCurrentNote(state, noteId, state.currentNoteId);
                    rerenderApp();
                }
            } else {

                openUrlInNewTab(url);
                setCurrentModalAndRerenderApp(null);
            }
        }
    });

    return root;
}


function EditableActivityList(rg: RenderGroup<{
    activityIndexes: number[] | undefined;
    pageSize?: number;
}>) {
    const pagination: Pagination = { pageSize: 10, start: 0, totalCount: 0 }
    const paginationControl = newComponent(PaginationControl);

    const listRoot = newListRenderer(div({ style: "" }), () => newComponent(ActivityListItem));
    const listScrollContainer = newComponent(ScrollContainer);
    addChildren(setAttrs(listScrollContainer, { class: [cn.flex1] }, true), [
        listRoot,
    ]);
    const statusTextEl = div({ class: [cn.textAlignCenter] }, []);
    const root = div({ class: [cn.w100, cn.flex1, cn.col], style: "" }, [
        statusTextEl,
        listScrollContainer,
        paginationControl,
    ]);

    let lastIdx = -1;

    rg.preRenderFn(function rerenderActivityList(s) {
        const { pageSize, activityIndexes } = s;

        pagination.pageSize = pageSize || 10;
        if (lastIdx !== state._currentlyViewingActivityIdx) {
            lastIdx = state._currentlyViewingActivityIdx;
            setPage(pagination, idxToPage(pagination, state.activities.length - 1 - lastIdx));
        }
        paginationControl.render({
            pagination,
            totalCount: activityIndexes ? activityIndexes.length : state.activities.length,
            rerender: rg.renderWithCurrentState,
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

        listScrollContainer.render({ scrollEl });

        let statusText = "";
        if (activityIndexes) {
            if (lastIdx === activities.length - 1) {
                statusText = "Reached most recent activity";
            } else if (activityIndexes.length === 0) {
                if (!idIsNil(state._currentActivityScopedNoteId)) {
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

function getNoteProgressCountText(note: TreeNote): string {
    const totalCount = note.childIds.length;
    const doneCount = countOccurances(note.childIds, (id) => {
        const note = getNote(state, id);
        return note.data._status === STATUS_DONE || note.data._status === STATUS_ASSUMED_DONE;
    });


    let progressText = "";

    if (totalCount !== 0) {
        progressText = `(${doneCount}/${totalCount})`;;
    }

    return progressText;
}


function recomputeFuzzyFinderMatches(finderState: FuzzyFindState) {
    const rootNote = !idIsNil(finderState.scopedToNoteId) ? getNote(state, finderState.scopedToNoteId)
        : getRootNote(state);

    const matches = finderState.matches;

    fuzzySearchNotes(state, rootNote, finderState.query, matches);

    const MAX_MATCHES = 100;
    if (matches.length > MAX_MATCHES) {
        matches.splice(MAX_MATCHES, matches.length - MAX_MATCHES);
    }

    const counts = finderState.counts;

    counts.numFinished = 0;
    counts.numInProgress = 0;
    counts.numShelved = 0;
    for (const match of matches) {
        if (match.note.data._status === STATUS_IN_PROGRESS) {
            counts.numInProgress++;
        } else {
            counts.numFinished++;
        }

        if (match.note.data._shelved) {
            counts.numShelved++;
        }
    }

    if (!idIsNil(finderState.scopedToNoteId)) {
        finderState.currentIdx = finderState.currentIdxLocal;
    } else {
        finderState.currentIdx = finderState.currentIdxGlobal;
    }
}


function HighlightedText(rg: RenderGroup<{
    text: string;
    highlightedRanges: Range[];
}>) {
    function HighlightedTextSpan(rg: RenderGroup<{
        highlighted: boolean;
        text: string;
    }>) {
        return span({}, [
            rg.class(cnApp.unfocusedTextColor, (s) => !s.highlighted),
            rg.text((s) => s.text),
        ]);
    }

    return rg.list(div(), HighlightedTextSpan, (getNext, s) => {
        const { highlightedRanges: ranges, text } = s;

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
}

function FuzzyFindResultsList(rg: RenderGroup<{
    finderState: FuzzyFindState;
    compact: boolean;
    isCursorActive: boolean;
}>) {
    function FuzzyFinderResultItem(rg: RenderGroup<{
        note: TreeNote;
        ranges: Range[];
        hasFocus: boolean;
        compact: boolean;
        isCursorActive: boolean;
    }>) {
        const textDiv = newComponent(HighlightedText);
        const children = [
            div({
                class: [cn.row, cn.justifyContentStart],
                style: "padding-right: 20px; padding: 10px;"
            }, [
                rg.if(s => !s.compact, rg =>
                    div({ class: [cn.pre] }, [
                        rg.text(({ note }) => {
                            return getNoteProgressCountText(note) + " - ";
                        })
                    ])
                ),
                div({ class: [cn.flex1] }, [
                    textDiv,
                ]),
            ]),
            rg.if(s => s.hasFocus, rg =>
                rg.with(s => {
                    const note = getMostRecentlyWorkedOnChildActivityNote(state, s.note);
                    if (note) {
                        return [s, note] as const;
                    }
                }, rg =>
                    div({
                        class: [cn.row, cn.justifyContentStart, cn.preWrap],
                        style: "padding: 10px 10px 10px 10px;"
                    }, [
                        rg.style("paddingLeft", s => s[0].compact ? "10px" : "100px"),
                        div({ class: [cn.flex1], style: `border: 1px solid ${cssVars.fgColor}; padding: 10px;` }, [
                            rg.text(s => s[1].data.text)
                        ])
                    ])
                )
            ),
        ];
        const root = newComponentArgs(ScrollNavItem, [children]);
        let lastRanges: any = null;

        rg.preRenderFn(function renderFindResultItem(s) {
            const { ranges, hasFocus, note } = s;

            // This is basically the same as the React code, to render a diff list, actually, useMemo and all
            if (ranges !== lastRanges) {
                textDiv.render({ text: note.data.text, highlightedRanges: ranges });
            }

            root.render({
                isFocused: hasFocus,
                isCursorVisible: hasFocus,
                isCursorActive: s.isCursorActive,
            });

            if (hasFocus) {
                const scrollParent = root.el.parentElement!;
                scrollIntoView(scrollParent, root, 0.5, 0.5);
            }
        });

        return root;
    };

    const resultList = newListRenderer(div({ class: [cn.h100, cn.overflowYAuto] }), () => newComponent(FuzzyFinderResultItem));

    rg.preRenderFn(({ finderState, compact, isCursorActive }) => {
        resultList.render((getNext) => {
            for (let i = 0; i < finderState.matches.length; i++) {
                const m = finderState.matches[i];
                getNext().render({
                    note: m.note,
                    ranges: m.ranges || [[0, m.note.data.text.length]],
                    hasFocus: i === finderState.currentIdx,
                    compact,
                    isCursorActive
                });
            }
        });
    });

    return resultList;
}

function FuzzyFinder(rg: RenderGroup<{
    visible: boolean;
    state: FuzzyFindState;
}>) {
    const searchInput = el<HTMLInputElement>("INPUT", { class: [cn.w100] });
    const root = div({ class: [cn.flex1, cn.col] }, [
        div({ style: "padding: 10px; gap: 10px;", class: [cn.noWrap, cn.row] }, [
            rg.text(s => !idIsNil(s.state.scopedToNoteId) ? "Search (Current note)" : "Search (Everywhere)"),
            div({}, " - "),
            rg.text(s => s.state.counts.numInProgress + " in progress, " +
                s.state.counts.numFinished + " done, " +
                s.state.counts.numShelved + " shelved"
            ),
        ]),
        div({ class: [cn.row, cn.alignItemsCenter], }, [
            div({ style: "width: 10px" }),
            searchInput,
            div({ style: "width: 10px" }),
        ]),
        div({ style: "height: 10px" }),
        div({ class: [cn.flex1] }, [
            rg.c(FuzzyFindResultsList, (c, s) => c.render({
                finderState: s.state,
                compact: false,
                isCursorActive: true,
            })),
        ]),
    ]);

    let timeoutId = 0;
    const DEBOUNCE_MS = 10;
    function recomputeMatches(query: string) {
        const finderState = rg.s.state;

        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            state._fuzzyFindState.query = query;
            recomputeFuzzyFinderMatches(finderState)

            rg.renderWithCurrentState();
        }, DEBOUNCE_MS);
    }

    let matchesInvalid = true;
    let toggleCurrentNoteVsEverywhere = true;
    let isVisble = false;

    rg.preRenderFn(function renderFuzzyFinder(s) {
        const visibleChanged = isVisble !== s.visible;
        isVisble = s.visible;
        if (!isVisble) {
            return;
        }

        const finderState = s.state;

        if (matchesInvalid || visibleChanged) {
            matchesInvalid = false;
            if (visibleChanged) {
                finderState.scopedToNoteId = -1;
            } else if (toggleCurrentNoteVsEverywhere) {
                if (idIsNil(finderState.scopedToNoteId)) {
                    finderState.scopedToNoteId = state.currentNoteId;
                } else {
                    finderState.scopedToNoteId = -1;
                }
            }

            recomputeMatches(finderState.query);
            toggleCurrentNoteVsEverywhere = false;
            return;
        }

        searchInput.el.focus();

        if (finderState.currentIdx >= finderState.matches.length) {
            finderState.currentIdx = 0;
        }
    });

    searchInput.el.addEventListener("keydown", (e) => {
        const finderState = rg.s.state;

        const note = finderState.matches[finderState.currentIdx]?.note as TreeNote | undefined;

        if (note && e.key === "Enter") {
            e.preventDefault();
            const previewNote = getMostRecentlyWorkedOnChildActivityNote(state, note);
            setCurrentNote(state, (previewNote ?? note).id, state.currentNoteId);
            setCurrentModalAndRerenderApp(null);
            rerenderApp();
            return;
        } else if (note && handleAddOrRemoveToStream(e)) {
            // no need to re-sort the results. better if we don't actually
            rerenderApp();
            return;
        }


        let handled = false;

        const navInput = getKeyboardNavigationInput(e);
        if (navInput) {
            if (
                navInput.moveDelta && 
                // NOTE: not handling home/end here - we want to use these in the text input
                !navInput.moveToEnd
            ) {
                let idx;
                if (navInput.moveToEnd) {
                    idx = navInput.moveDelta < 0 ? 0 : finderState.matches.length - 1;
                } else {
                    idx = rg.s.state.currentIdx + navInput.moveDelta;
                }
                rg.s.state.currentIdx = clampIndexToArrayBounds(idx, finderState.matches);
                handled = true;
            }
        } else if (
            (e.ctrlKey || e.metaKey)
            && e.shiftKey
            && e.key === "F"
        ) {
            matchesInvalid = true;
            toggleCurrentNoteVsEverywhere = true;
            handled = true;
        }

        if (handled) {
            e.preventDefault();
            setFuzzyFindIndex(finderState, finderState.currentIdx);
            rg.renderWithCurrentState();
        }
    });

    searchInput.el.addEventListener("input", () => {
        const finderState = rg.s.state;

        finderState.query = searchInput.el.value.toLowerCase();
        finderState.currentIdx = 0;
        finderState.currentIdxGlobal = 0;
        finderState.currentIdxLocal = 0;
        matchesInvalid = true;
        rg.renderWithCurrentState();
    });

    return root;
}

type KeyboardNavigationResult = {
    moveDelta: number;
    moveToEnd: boolean;
    moveToImportant: boolean;
    absoluteMovement: number;
    doRangeSelect: boolean;
    doDrag: boolean;
};

function getKeyboardNavigationInput(e: KeyboardEvent): KeyboardNavigationResult | undefined {
    const result: KeyboardNavigationResult = {
        absoluteMovement: -1,
        moveDelta: 0,
        moveToEnd: false,
        moveToImportant: false,
        doRangeSelect: false,
        doDrag: false,
    };

    const pageAmount = 10;
    const ctrlKey = e.ctrlKey || e.metaKey;
    const altKey = e.altKey;
    const shiftKey = e.shiftKey;

    let handled = true;

    switch (e.key) {
        case "ArrowDown": {
            result.moveDelta = 1;
            if (ctrlKey) {
                result.moveToImportant = true;
            }
        } break;
        case "ArrowUp": {
            result.moveDelta = -1;
            if (ctrlKey) {
                result.moveToImportant = true;
            }
        } break;
        case "PageDown":
            result.moveDelta = pageAmount;
            break;
        case "PageUp":
            result.moveDelta = -pageAmount;
            break;
        case "End": {
            result.moveDelta = 1;
            result.moveToEnd = true;
        } break;
        case "Home": {
            result.moveDelta = -1;
            result.moveToEnd = true;
        } break;
        case "1": {
            result.absoluteMovement = 0;
        } break;
        case "2": {
            result.absoluteMovement = 1;
        } break;
        case "3": {
            result.absoluteMovement = 2;
        } break;
        case "4": {
            result.absoluteMovement = 3;
        } break;
        case "5": {
            result.absoluteMovement = 4;
        } break;
        case "6": {
            result.absoluteMovement = 5;
        } break;
        case "7": {
            result.absoluteMovement = 6;
        } break;
        case "8": {
            result.absoluteMovement = 7;
        } break;
        case "9": {
            result.absoluteMovement = 8;
        } break;
        case "0": {
            result.absoluteMovement = 0;
        } break;
        default: {
            handled = false;
        } break;
    }

    if (!handled) {
        return undefined;
    }

    result.doDrag = altKey;
    result.doRangeSelect = shiftKey;
    e.preventDefault();

    return result;
}

function FuzzyFindModal(rg: RenderGroup<{
    visible: boolean;
}>) {
    return rg.if(
        s => s.visible,
        rg => rg.cArgs(Modal, c => c.render({
            onClose: () => setCurrentModalAndRerenderApp(null),
        }), [
            div({ class: [cn.col, cn.h100], style: modalPaddingStyles(0) }, [
                rg.c(FuzzyFinder, (c, s) => c.render({
                    visible: s.visible,
                    state: state._fuzzyFindState,
                })),
            ])
        ])
    );
}

function AddToStreamModalItem(rg: RenderGroup<{
    currentNote: TreeNote;
    isFocused: boolean;
    state: ViewAllTaskStreamsState;
    // right now, null means that this represents the schedule instead of a normal task stream
    nextState: ViewTaskStreamState | null;
    isChecked: boolean;
    count: number;
    toggle: (stream: TaskStream | null, note: TreeNote) => void;
    navigate: () => void;
}>) {
    let isNoteInStream = false;
    let numParentsInStream = 0;
    let name = "";

    rg.preRenderFn(s => {
        isNoteInStream = s.isChecked;
        numParentsInStream = s.count;

        if (s.nextState) {
            name = s.nextState.taskStream.name;
        } else {
            name = "[[[ Schedule ]]]";
        }
    });

    return rg.cArgs(ScrollNavItem, (c, s) => c.render({
        isFocused: s.isFocused,
        isGreyedOut: false,
        isCursorVisible: s.isFocused,
        isCursorActive: true,
    }), [
        div({
            class: [cn.row, cn.alignItemsCenter, cn.preWrap, cn.justifyContentCenter],
            style: "padding: 10px",
        }, [
            // Schedule item is a little bit bigger - to give it more visual importance
            rg.style("fontSize", s => s.nextState ? "" : "1.2em"),
            rg.style("fontWeight", s => s.nextState ? "" : "bold"),
            div({
                style: "width: 20ch",
                class: [cn.row, cn.alignItemsCenter, cn.preWrap],
            }, [
                rg.style("color", s => (!isNoteInStream && numParentsInStream === 0) ? cssVars.unfocusTextColor : ""),
                rg.c(Checkbox, (c, s) => c.render({
                    value: isNoteInStream,
                    onChange: () => {
                        s.toggle(s.nextState ? s.nextState.taskStream : null, s.currentNote); 
                    },
                })),
                div({ style: "width: 10px" }),
                rg.text(s => {
                    const sb = [];
                    if (isNoteInStream) {
                        sb.push("this note");
                    }
                    if (numParentsInStream > 0) {
                        sb.push(numParentsInStream + " parents");
                    }

                    if (sb.length === 0) {
                        return "not in stream";
                    }
                    return sb.join(", ");
                }),
            ]),

            // the name

            rg.if(s => s.isFocused && s.state.isRenaming && !!s.nextState, rg =>
                rg.c(TextInput, (c, s) => c.render({
                    focus: s.isFocused,
                    focusWithAllSelected: true,
                    value: s.nextState!.taskStream.name,
                    autoSize: true,
                    onChange: (val) => {
                        s.nextState!.taskStream.name = val;
                        rerenderApp();
                    }
                })),
            ),
            rg.else(rg =>
                rg.text((s) => name),
            ),

            // more info
            div({ style: "width: 3ch" }),

            rg.text(s => {
                let n;
                if (s.nextState) {
                    n = s.nextState.taskStream.noteIds.length;
                } else {
                    n = state.scheduledNoteIds.length;
                }

                if (n === 0) {
                    return "no notes";
                }

                if (n === 1) {
                    return "1 note";
                }

                return `${n} notes`;
            }),
            " - ",
            rg.text(s => {
                if (!s.nextState) {
                    return "-";
                }

                let n = 0;
                for (const p of s.nextState.inProgressNotes) {
                    n += p.inProgressIds.length;
                }

                if (n === 0) {
                    return "none in progress";
                }

                if (n === 1) {
                    return "1 in progress";
                }

                return `${n} in progress`;
            }),
            " - ",
            rg.text(s => {
                let duration = 0;

                const noteIds = s.nextState ? s.nextState.taskStream.noteIds : state.scheduledNoteIds;
                for (const id of noteIds) {
                    const note = getNote(state, id);
                    duration += getNoteDurationWithoutRange(state, note);
                }

                return formatDurationAsHours(duration) + " spent";
            }),
            " - ",
            rg.text(s => {
                let estimate = 0;
                let hasEstimate = false;
                const noteIds = s.nextState ? s.nextState.taskStream.noteIds : state.scheduledNoteIds;
                for (const id of noteIds) {
                    const note = getNote(state, id);
                    const noteEstimate = getNoteEstimate(note);
                    if (noteEstimate !== -1) {
                        estimate += noteEstimate;
                        hasEstimate = true;
                    }
                }

                if (!hasEstimate) {
                    return "no estimates";
                }

                return formatDurationAsHours(estimate) + " estimated";
            }),
            div({ class: [cn.flex1] }),
            div({ style: "width: 3ch" }),
            rg.c(Button, (c, s) => c.render({
                label: "->",
                onClick: () => s.navigate(),
            }))
        ])
    ]);
}

function ViewCurrentSchedule(rg: RenderGroup<ViewCurrentScheduleState>) {
    function TaskItem(rg: RenderGroup<{
        holidays: WorkdayConfigHoliday[];
        shouldRenderDate: boolean;
        c: TaskCompletion;
        s: ViewCurrentScheduleState;
        note: TreeNote;
        hasFocus: boolean;
        isCursorActive: boolean;
        wc: WorkdayConfig;
    }>) {
        const children = [
            div({
                class: [cn.row, cn.justifyContentStart, cnApp.gap10],
                style: "padding-right: 20px; padding: 10px"
            }, [
                div({ style: "width: 250px" }, [
                    rg.style("color", s => s.c.remaining <= 0 ? "#F00" : ""),
                    rg.text(s => {
                        const estimate = getNoteEstimate(s.note);
                        if (estimate === -1) {
                            if (s.hasFocus) {
                                return `No estimate! Press [E] to estimate a total, or [R] to estimate the remaining time`;
                            }

                            return `No estimate!`
                        }

                        if (s.c.remaining < 0) {
                            if (s.hasFocus) {
                                return "No time remaining! Press [R] to re-estimate the remaining time";
                            }
                            return "No time remaining!";
                        }

                        return "E=" + formatDurationAsHours(estimate) + ", " + formatDurationAsHours(s.c.remaining) + " remaining";
                    }),
                ]),
                " | ",
                div({}, [
                    rg.text(s => formatTime(s.c.date)),
                ]),
                div({ class: [cn.flex1] }, [
                    rg.text(s => s.note.data.text),
                ]),
            ]),
        ];
        const scrollNavItem = newComponentArgs(ScrollNavItem, [children]);

        rg.preRenderFn(({hasFocus, isCursorActive}) => {
            scrollNavItem.render({
                isFocused: hasFocus,
                isCursorVisible: hasFocus,
                isCursorActive: isCursorActive,
            });

            if (hasFocus) {
                const scrollParent = root.el.parentElement!;
                scrollIntoView(scrollParent, root, 0.5, 0.5);
            }
        })

        const root = div({}, [
            (() => {
                function HolidayItem(rg: RenderGroup<WorkdayConfigHoliday>) {
                    return el("H3", {
                        style: "margin: 0; text-align: center;"
                    }, [
                        rg.text(s => getWorkdayConfigHolidayDate(s).toLocaleDateString() + " - " + s.name)
                    ]);
                }

                return rg.list(div(), HolidayItem, (getNext, s) => {
                    for (const h of s.holidays) {
                        getNext().render(h);
                    }
                });
            })(),
            rg.if(s => s.shouldRenderDate, rg =>
                el("H3", { style: "margin: 0;" }, rg.text(s => s.c.date.toDateString())),
            ),
            scrollNavItem,
            rg.if(s => s.hasFocus && s.s.isEstimating, rg =>
                div({ class: [cn.row] }, [
                    div({}, [ 
                        rg.text(s => s.s.isEstimatingRemainder ? "New estimate (remaining): " : "New estimate: " ),
                    ]),
                    rg.c(TextInput, (c, s) => {
                        let text = s.note.data.text;
                        let [estimate, start, end] = parseNoteEstimate(text);

                        if (start === -1) {
                            text += " E=0h00m";

                            s.note.data.text = text;
                            rerenderAppNextFrame();

                            [estimate, start, end] = parseNoteEstimate(text);

                            if (estimate === -1) {
                                throw new Error("Estimate format has changed, but we forgot to update this code");
                            }
                        }

                        if (s.s.isEstimatingRemainder) {
                            c.render({
                                value: s.s.remainderText || "0h0m",
                                onChange: (newValue: string) => {
                                    s.s.remainderText = newValue;

                                    const duration = getNoteDurationWithoutRange(state, s.note);
                                    const [remainderEstimate] = parseNoteEstimate(ESTIMATE_START_PREFIX + s.s.remainderText);
                                    if (!isNaN(remainderEstimate)) {
                                        s.note.data.text = text.substring(0, start) + formatDurationAsEstimate(duration + remainderEstimate) + text.substring(end);
                                        debouncedSave();
                                        rerenderApp();
                                    }
                                },
                                focus: true,
                                autoSize: true,
                            })
                        } else {
                            c.render({
                                value: s.note.data.text.substring(start + ESTIMATE_START_PREFIX.length, end),
                                onChange: (newValue: string) => {
                                    s.note.data.text = text.substring(0, start + ESTIMATE_START_PREFIX.length) + newValue + text.substring(end);
                                    debouncedSave();
                                    rerenderApp();
                                },
                                focus: true,
                                autoSize: true,
                            })
                        }
                    })
                ])
            )
        ]);
        return root;
    };

    let completions: TaskCompletions[] = [];
    const allowedDays: Boolean7 = [false, false, false, false, false, false, false];
    const resultList = newListRenderer(div({ class: [cn.flex1, cn.overflowYAuto ] }), () => newComponent(TaskItem));

    let holidayName = "";
    let holidayDateStr = "";
    let holidayError = "";
    let holidayIsValid = true;

    const datePlaceholder = getDatePlaceholder();

    function dateFromDayMonthOptionalYear(date: number, monthIdx: number, year: number): Date | null {
        if (monthIdx !== -1 && date !== -1) {
            // We successfuly inferred something resembling a date.

            let inferredYear = false;
            if (year === -1) {
                year = (new Date()).getFullYear();
                inferredYear = true;
            }

            const dateObj = new Date(year, monthIdx, date);
            if (inferredYear && dateObj < new Date()) {
                dateObj.setFullYear(year + 1);
                dateObj.setMonth(monthIdx);
                dateObj.setDate(date);
            }

            return dateObj;
        }

        return null;
    }

    function checkHoliday() {
        holidayIsValid = false;
        holidayError = "";

        if (!holidayDateStr && !holidayName) {
            // No error, but still not valid.
            return;
        }

        if (holidayName && !holidayDateStr) {
            let { date, monthIdx, year } = extractDateFromText(holidayName);
            const holidayDate = dateFromDayMonthOptionalYear(date, monthIdx, year);
            if (holidayDate ){
                holidayDateStr = holidayDate.toLocaleDateString();
            }
        }

        let holidayDate = parseLocaleDateString(holidayDateStr);
        if (!holidayDate) {
            holidayDate = parseIsoDate(holidayDateStr);
            if (!holidayDate) {
                let { date, monthIdx, year } = extractDateFromText(holidayDateStr);
                holidayDate = dateFromDayMonthOptionalYear(date, monthIdx, year);
            }
        } 

        if (!holidayDate || !isValidDate(holidayDate)) {
            if (holidayDateStr) {
                console.log(holidayDateStr);
                // dont tell me 'invalid date' unless I've actually typed in a date.
                holidayError = "expected date format: " + datePlaceholder;
            }

            return;
        }

        holidayDateStr = holidayDate.toLocaleDateString();

        if (holidayDate < new Date()) {
            holidayError = "date can't be in the past";
            return;
        }

        holidayIsValid = true;
    }

    checkHoliday();


    rg.preRenderFn(function renderFindResultItem(s) {
        predictTaskCompletions(state, state.scheduledNoteIds, state.workdayConfig, completions);

        resultList.render((getNext) => {
            let lastCompletionDate = new Date();
            let holidays: WorkdayConfigHoliday[] = [];
            for (const c of completions) {
                let isFirst = true;

                for (const h of state.workdayConfig.holidays) {
                    const hDate = getWorkdayConfigHolidayDate(h);
                    if (lastCompletionDate < hDate && hDate <= c.dateFloored) {
                        holidays.push(h);
                    }
                }

                lastCompletionDate = c.dateFloored;

                for (const ci of c.completions) {
                    const note = getNote(state, ci.taskId);

                    getNext().render({
                        holidays,
                        note,
                        hasFocus: state.scheduledNoteIds[s.noteIdx] === note.id,
                        isCursorActive: true,
                        c: ci,
                        s,
                        shouldRenderDate: isFirst,
                        wc: state.workdayConfig,
                    });

                    holidays.length = 0;
                    isFirst = false;
                }
            }
        });
    });

    return div({ class: [cn.flex1, cn.h100, cn.col] }, [
        rg.if(s => s.isConfiguringWorkday, rg => 
            div({ class: [cn.flex1, cn.col, cn.alignItemsStretch] }, [
                div({ class: [cn.flex1, cn.row, cnApp.gap10] }, [
                    div({ class: [cn.flex1, cn.col, cnApp.gap10] }, [
                        el("H3", { class: [cn.row, cn.alignItemsCenter, cnApp.gap10] }, [
                            rg.c(Button, (c, s) => c.render({
                                label: "<-",
                                onClick: () => {
                                    s.isConfiguringWorkday = false;
                                    rerenderApp();
                                }
                            })),
                            "Workday Config",
                        ]),
                        (() => {
                            function ConfigItem(rg: RenderGroup<{
                                wc: WorkdayConfig;
                                i: number;
                                wd: WorkdayConfigWeekDay;
                                allowedDays: Boolean7;
                            }>) {

                                return div({
                                    class: [cn.row, cn.alignItemsCenter],
                                    style: `padding: 10px; border: 1px solid ${cssVars.fgColor};`,
                                }, [
                                    div({ class: [cn.col, cnApp.gap5], }, [
                                        div({ class: [cn.row] }, [
                                            div({ style: "width: 200px" }, "Start time:"),
                                            rg.c(TextInput, (c, s) => c.render({
                                                value: s.wd.dayStartHour.toPrecision(2),
                                                onChange: (newValue) => {
                                                    let res = parseFloat(newValue);
                                                    if (!isNaN(res)) {
                                                        res = clamp(Math.round(res * 100) / 100, 0, 24);
                                                        s.wd.dayStartHour = res;
                                                    }

                                                    rerenderApp();
                                                    debouncedSave();
                                                }
                                            })),
                                        ]),
                                        div({ class: [cn.row] }, [
                                            div({ style: "width: 200px" }, "Working hours:"),
                                            rg.c(TextInput, (c, s) => c.render({
                                                value: s.wd.workingHours.toPrecision(2),
                                                onChange: (newValue) => {
                                                    let res = parseFloat(newValue);
                                                    if (!isNaN(res)) {
                                                        res = clamp(Math.round(res * 100) / 100, 0, 24);
                                                        s.wd.workingHours = res;
                                                    }

                                                    rerenderApp();
                                                    debouncedSave();
                                                }
                                            })),
                                        ]),
                                        rg.list(div({ class: [cn.row, cnApp.gap10] }), Checkbox, (getNext, s) => {
                                            for (let i = 0; i < s.wd.weekdayFlags.length; i++) {
                                                if (!s.allowedDays[i]) {
                                                    continue;
                                                }

                                                getNext().render({
                                                    label: DAYS_OF_THE_WEEK_ABBREVIATED[i],
                                                    value: s.wd.weekdayFlags[i],
                                                    onChange: (val) => {
                                                        s.wd.weekdayFlags[i] = val;
                                                        rerenderApp();
                                                        debouncedSave();
                                                    }
                                                });
                                            }
                                        }),
                                    ]),
                                    div({ class: [cn.flex1] }),
                                    rg.if(s => s.i > 0, rg =>
                                        rg.c(Button, (c, s) => c.render({
                                            label: "Remove",
                                            onClick: () => {
                                                s.wc.weekdayConfigs.splice(s.i, 1);
                                                debouncedSave();
                                                rerenderApp();
                                            }
                                        })),
                                    )
                                ])
                            }

                            return rg.list(contentsDiv(), ConfigItem, (getNext, s) => {
                                for (let i = 0; i < allowedDays.length; i++) {
                                    allowedDays[i] = true;
                                }

                                for (let i = 0; i < state.workdayConfig.weekdayConfigs.length; i++) {
                                    const wd = state.workdayConfig.weekdayConfigs[i];
                                    getNext().render({
                                        i,
                                        wc: state.workdayConfig,
                                        wd,
                                        allowedDays,
                                    });

                                    for (let i = 0; i < wd.weekdayFlags.length; i++) {
                                        if (wd.weekdayFlags[i]) {
                                            allowedDays[i] = false;
                                        }
                                    }
                                }
                            });
                        })(),
                        rg.if(() => {
                            return allowedDays.some(d => d)
                        }, rg =>
                            rg.c(Button, (c, s) => c.render({
                                label: "Add",
                                onClick: () => {
                                    state.workdayConfig.weekdayConfigs.push({
                                        dayStartHour: 9,
                                        workingHours: 7.5,
                                        weekdayFlags: [false, false, false, false, false, false, false],
                                    });

                                    rerenderApp();
                                    debouncedSave();
                                }
                            })),
                        ),
                        rg.if(s => !hasAnyTimeAtAll(state.workdayConfig), rg =>
                            div({}, [
                                "Really? You've got no time at all?? None?"
                            ])
                        ),
                    ]),
                    div({ class: [cn.flex1] }, [
                        el("H3", {}, ["Holidays"]),
                        rg.if(s => state.workdayConfig.holidays.length === 0, rg => 
                            div({}, ["None :("]),
                        ),
                        div({ class: [cn.table, cn.w100] }, [
                            (() => {
                                function HolidayItem(rg: RenderGroup<{
                                    wc: WorkdayConfig;
                                    i: number;
                                    wh: WorkdayConfigHoliday;
                                }>) {
                                    let isOldDate = false;

                                    rg.preRenderFn(s => {
                                        const date = getWorkdayConfigHolidayDate(s.wh);
                                        isOldDate = date < new Date();
                                    });

                                    return div({ class: [cn.tableRow, cn.alignItemsCenter, cnApp.gap10] }, [
                                        span({ class: [cn.tableCell], style: "vertical-align: middle" }, [
                                            rg.class(cnApp.unfocusedTextColor, s => isOldDate),
                                            rg.text(s => s.wh.name),
                                        ]),
                                        span({ class: [cn.tableCell], style: "vertical-align: middle" }, [
                                            rg.class(cnApp.unfocusedTextColor, s => isOldDate),
                                            rg.text(s => {
                                                const date = getWorkdayConfigHolidayDate(s.wh);
                                                const text = date.toDateString();
                                                if (isOldDate) {
                                                    return text + " [old]";
                                                }
                                                return text;
                                            }),
                                        ]),
                                        span({ class: [cn.tableCell], style: "vertical-align: middle" }, [
                                            rg.c(Button, (c, s) => c.render({
                                                label: "Remove",
                                                onClick: () => {
                                                    state.workdayConfig.holidays.splice(s.i, 1);
                                                    debouncedSave();
                                                    rerenderApp();
                                                }
                                            })),
                                        ])
                                    ]);
                                }

                                return rg.list(contentsDiv(), HolidayItem, (getNext, s) => {
                                    for (let i = 0; i < state.workdayConfig.holidays.length; i++) {
                                        const wh = state.workdayConfig.holidays[i];
                                        getNext().render({ wc: state.workdayConfig, wh, i, });
                                    }
                                });
                            })(),
                            div({ class: [cn.row, cn.alignItemsCenter, cnApp.gap10, cn.tableRow] }, [
                                span({ class: [cn.tableCell], style: "vertical-align: middle" }, [
                                    "Holiday name: ",
                                    rg.c(TextInput, (c) => c.render({
                                        value: holidayName,
                                        placeholder: "Name",
                                        onChange: val => {
                                            holidayName = val;
                                            checkHoliday();
                                            rerenderApp();
                                        }
                                    })),
                                ]),
                                span({ class: [cn.tableCell], style: "vertical-align: middle" }, [
                                    div({}, [
                                        " Date: ",
                                        rg.c(TextInput, (c) => c.render({
                                            value: holidayDateStr,
                                            placeholder: datePlaceholder,
                                            onChange: val => {
                                                holidayDateStr = val;

                                                checkHoliday();
                                                rerenderApp();
                                            }
                                        })),
                                    ]),
                                    div({ style: "color: #F00" }, [
                                        rg.text(s => holidayError),
                                    ]),
                                ]),
                                span({ class: [cn.tableCell], style: "vertical-align: middle" }, [
                                    rg.c(Button, (c, s) => c.render({
                                        label: "Add",
                                        disabled: !holidayIsValid,
                                        className: holidayIsValid ? undefined : cnApp.unfocusedTextColor,
                                        onClick: () => {
                                            if (!holidayIsValid) {
                                                return;
                                            }

                                            const date = parseLocaleDateString(holidayDateStr);
                                            if (!date) {
                                                return;
                                            }

                                            state.workdayConfig.holidays.push({
                                                name: holidayName,
                                                date: formatIsoDate(date),
                                            });

                                            holidayDateStr = "";
                                            holidayName = "";

                                            checkHoliday();

                                            debouncedSave();
                                            rerenderApp();
                                        }
                                    })),
                                ])
                            ]),
                        ]),
                        div({
                            style: "display: flex; flex-wrap: wrap"
                        }, [
                            () => {
                                function HolidayItem(rg: RenderGroup<{ date: string; name: string; }>) {
                                    // TODO: implement
                                }
                            }
                        ])
                    ])
                ])
            ])
        ),
        rg.else(rg =>
            div({ class: [cn.flex1, cn.col] }, [
                el("H3", { class: [cn.row] }, [
                    "Estimated Completion Dates",
                    div({ class: [cn.flex1] }),
                    rg.c(Button, (c, s) => c.render({
                        label: "Configure workday",
                        onClick: () => {
                            s.isConfiguringWorkday = true;
                            rerenderApp();
                        }
                    })),
                ]),
                resultList,
            ]),
        )
    ]);
}

function ViewTaskStream(rg: RenderGroup<{ 
    state: ViewTaskStreamState; 
    goBack: () => void; 
}>) {
    let inProgressState: InProgressNotesState | undefined;
    let numInProgress = 0;

    rg.preRenderFn((s) => {
        recomputeViewTaskStreamState(s.state, state, s.state.taskStream, true);
        inProgressState = getCurrentInProgressState(s.state);

        numInProgress = 0;
        for (const p of s.state.inProgressNotes) {
            numInProgress += p.inProgressIds.length;
        }
    });

    return div({ class: [cn.col, cn.w100] }, [
        div({}, [
            el("H3", { class: [cn.textAlignCenter] }, [
                rg.c(Button, (c, s) => c.render({
                    label: "<- ",
                    onClick: () => s.goBack(),
                })),
                rg.text(s => s.state.taskStream.name),
                rg.if(s => !!inProgressState && numInProgress > 0,
                    rg => rg.text((s) => {
                        return " -> " + numInProgress + " in progress";
                    })
                )
            ]),
        ]),
        div({ class: [cn.row, cn.flex1] }, [
            rg.c(NotesList, (c, s) => {
                c.render({
                    hasFocus: !s.state.isViewingInProgress,
                    currentNoteId: s.state.taskStream.noteIds[s.state.currentStreamNoteIdx],
                    ratio: 1,
                    alwaysMultipleLines: true,
                    flatNoteIds: s.state.taskStream.noteIds,
                    noteDepths: s.state.streamNoteDepths,
                });
            }),
            div({ class: [cn.flex1, cn.col] }, [
                rg.if(s => s.state.isFinding, rg =>
                    rg.c(TextInput, (c, s) => {
                        c.render({
                            value: s.state.currentQuery,
                            focus: true,
                            onChange(val) {
                                s.state.currentQuery = val;
                                rerenderApp();
                            }
                        });
                    }),
                ),
                rg.if(s => !!inProgressState && (inProgressState.inProgressIds.length > 0), rg =>
                    rg.c(NotesList, (c, s) => {
                        if (inProgressState) {
                            c.render({
                                hasFocus: s.state.isViewingInProgress,
                                currentNoteId: inProgressState.inProgressIds[inProgressState.currentInProgressNoteIdx],
                                ratio: 1,
                                alwaysMultipleLines: false,
                                flatNoteIds: inProgressState.inProgressIds,
                                noteDepths: inProgressState.inProgressNoteDepths,
                            });
                        }
                    })
                ),
                rg.else_if(s => !s.state.isFinding, rg =>
                    div({ class: [cn.row, cn.flex1, cn.alignItemsCenter, cn.justifyContentCenter] }, [
                        "No notes in progress"
                    ])
                )
            ]),
        ])
    ]);
}

function ViewAllTaskStreams(rg: RenderGroup<{
    currentIdx: number;
    state: ViewAllTaskStreamsState;
    toggle: (stream: TaskStream | null, note: TreeNote) => void;
    navigate: (streamIdx: number) => void;
}>) {
    let currentNote: TreeNote;
    rg.preRenderFn(s => {
        currentNote = getCurrentNote(state);
    });

    return div({ class: [cn.col] }, [
        el("H3", { class: [cn.textAlignLeft] }, [
            div({}, [
                "Add [", rg.text(() => getNoteTextTruncated(currentNote.data)), "] to streams:",
            ]),
        ]),
        div({}, [
            rg.list(contentsDiv(), AddToStreamModalItem, (getNext, s) => {
                const currentNote = getCurrentNote(state);

                getNext().render({
                    nextState: null,
                    currentNote,
                    toggle: s.toggle,
                    navigate: () => s.navigate(-1),
                    isFocused: s.currentIdx === -1,
                    state: s.state,
                    isChecked: state.scheduledNoteIds.includes(currentNote.id),
                    count: state.scheduledNoteIds.length,
                });


                for (let i = 0; i < s.state.viewTaskStreamStates.length; i++) {
                    const nextState = s.state.viewTaskStreamStates[i];
                    const isNoteInStream = isNoteInTaskStream(nextState.taskStream, currentNote);
                    const numParentsInStream = getNumParentsInTaskStream(state, nextState.taskStream, currentNote);

                    getNext().render({
                        nextState,
                        currentNote,
                        toggle: s.toggle,
                        navigate: () => s.navigate(i),
                        isFocused: s.currentIdx === i,
                        state: s.state,
                        isChecked: isNoteInStream,
                        count: numParentsInStream,
                    });
                }
            }),
            rg.else(
                rg => div({ class: [cn.row, cn.justifyContentCenter] }, [
                    rg.text(() => "[Ctrl] + [Enter] to create a new task stream"),
                ])
            )
        ])
    ])
}


function getNavigationNextIndex(
    navInput: KeyboardNavigationResult,
    idx: number,
    len: number,
): number {
    let newIdx = idx;
    if (navInput.moveDelta) {
        if (navInput.moveToEnd) {
            newIdx = navInput.moveDelta < 0 ? 0 : len - 1;
        } else if (false && navInput.moveToImportant) {
            // TODO: moveToImportant
        } else {
            newIdx += navInput.moveDelta;
        }
    }

    return clampIndexToBounds(newIdx, len);
}

function hasCtrlKey(e: KeyboardEvent) {
    return (e.ctrlKey || e.metaKey);
}

function hasKeyCtrlF(e: KeyboardEvent) {
    return hasCtrlKey(e) && e.key.toLowerCase() === "f";
}

function AddToStreamModal(rg: RenderGroup<{
    visible: boolean;
}>) {
    function goToAllStreams() {
        viewAllTaskStreamsState.isViewingCurrentStream = false;
        rerenderApp();
    }

    let initialNoteId: NoteId;
    const viewAllTaskStreamsState: ViewAllTaskStreamsState = {
        isRenaming: false,
        canDelete: false,
        isCurrentNoteInStream: false,
        viewTaskStreamStates: [],
        isViewingCurrentStream: false,
        scheduleViewState: {
            noteIdx: 0,
            goBack: goToAllStreams,
            isEstimating: false,
            isEstimatingRemainder: false,
            remainderText: "",
            isConfiguringWorkday: false,
        }
    };

    let canRename = false;
    let lastVisible = false;
    let currentNote: TreeNote;
    let viewStreamState: ViewTaskStreamState | undefined;
    let scheduleViewState: ViewCurrentScheduleState;

    rg.preRenderFn((s) => {
        let changed = s.visible !== lastVisible;
        lastVisible = s.visible;
        if (!s.visible) {
            return;
        }

        canRename = state.currentTaskStreamIdx >= 0;

        currentNote = getCurrentNote(state);
        scheduleViewState = viewAllTaskStreamsState.scheduleViewState;

        recomputeViewAllTaskStreamsState(viewAllTaskStreamsState, state, changed, currentNote, state.taskStreams);

        if (changed) {
            initialNoteId = currentNote.id;
            scheduleViewState.isEstimating = false;
            scheduleViewState.isEstimatingRemainder = false;
        }

        viewStreamState = getCurrentTaskStreamState(viewAllTaskStreamsState, state);
    });


    function toggleNoteInTaskStream(stream: TaskStream | null, note: TreeNote) {
        if (!addNoteToTaskStream(stream, note)) {
            if (stream) {
                removeNoteFromNoteIds(stream.noteIds, note.id);
            } else {
                removeNoteFromNoteIds(state.scheduledNoteIds, note.id);
            }
        }
    };

    document.addEventListener("keydown", (e) => {
        if (state._currentModal?.el !== rg.root.el) {
            return;
        }

        if (handleAddOrRemoveToStream(e)) {
            setCurrentModal(null);
            rerenderApp();
            return;
        }

        let handled = false;

        if (viewAllTaskStreamsState.isViewingCurrentStream) {
            if (viewStreamState) {
                const inProgressState = getCurrentInProgressState(viewStreamState);

                if (e.key === "Enter") {
                    let noteToJumpToId;
                    const inProgressState = getCurrentInProgressState(viewStreamState);
                    if (inProgressState && viewStreamState.isViewingInProgress) {
                        noteToJumpToId = inProgressState.inProgressIds[inProgressState.currentInProgressNoteIdx];
                    } else {
                        noteToJumpToId = viewStreamState.taskStream.noteIds[viewStreamState.currentStreamNoteIdx];
                    }
                    setCurrentNote(state, noteToJumpToId, initialNoteId);
                    handled = true;
                } else if (viewStreamState.isViewingInProgress && inProgressState) {
                    const navInput = getKeyboardNavigationInput(e);
                    if (navInput) {
                        inProgressState.currentInProgressNoteIdx = getNavigationNextIndex(
                            navInput,
                            inProgressState.currentInProgressNoteIdx,
                            inProgressState.inProgressIds.length
                        );
                        handled = true;
                    } else if (e.key === "ArrowLeft") {
                        viewStreamState.isViewingInProgress = false;
                        viewStreamState.isFinding = false;
                        viewStreamState.currentQuery = "";
                        handled = true;
                    } else if (hasKeyCtrlF(e)) {
                        // Ive used this feature literally 0 in prod lmao.
                        // forgot about it till I saw this code here.

                        viewStreamState.isFinding = !viewStreamState.isFinding;
                        viewStreamState.currentQuery = "";
                        e.preventDefault();
                        handled = true;
                    }
                } else {
                    const navInput = getKeyboardNavigationInput(e);
                    if (navInput) {
                        const oldIdx = viewStreamState.currentStreamNoteIdx;
                        let newIdx = getNavigationNextIndex(
                            navInput,
                            oldIdx,
                            viewStreamState.taskStream.noteIds.length
                        );

                        if (oldIdx !== newIdx && navInput.doDrag) {
                            moveArrayItem(viewStreamState.taskStream.noteIds, oldIdx, newIdx);
                            debouncedSave();
                        }

                        viewStreamState.currentStreamNoteIdx = newIdx;
                        handled = true;
                    }

                    // NOTE: trying out this new !handled style here. should allow us to handle someting
                    // deep inside a nested-if and disable later if-statements, decoupling from the `else` construct.

                    if (!handled && (e.key === "ArrowRight" && inProgressState)) {
                        if (inProgressState.inProgressIds.length > 0) {
                            viewStreamState.isViewingInProgress = true;
                            handled = true;
                        }
                    }

                    if (!handled && e.key === "ArrowLeft") {
                        viewAllTaskStreamsState.isViewingCurrentStream = false;
                        handled = true;
                    }

                    if (!handled && hasKeyCtrlF(e)) {
                        // doesnt do anything yet, but we catch it anway.
                        e.preventDefault();
                    }
                }
            } else if (scheduleViewState) {
                if (scheduleViewState.isEstimating) {
                    if (e.key === "Escape") {
                        scheduleViewState.isEstimating = false;
                        scheduleViewState.isEstimatingRemainder = false;
                        handled = true;
                        e.stopImmediatePropagation();
                    } else if (e.key === "Enter") {
                        scheduleViewState.isEstimating = false;
                        scheduleViewState.isEstimatingRemainder = false;
                        handled = true;
                        e.stopImmediatePropagation();
                    }
                } else if (scheduleViewState.isConfiguringWorkday) {
                    if (!handled && e.key === "ArrowLeft" && !isEditingTextSomewhereInDocument()) {
                        scheduleViewState.isConfiguringWorkday = false;
                        handled = true;
                    } else if (e.key === "Escape") {
                        scheduleViewState.isConfiguringWorkday = false;
                        e.stopImmediatePropagation();
                        handled = true;
                    }
                } else {
                    if (state.scheduledNoteIds.length > 0) {
                        const noteIds = state.scheduledNoteIds;
                        const noteId = state.scheduledNoteIds[scheduleViewState.noteIdx];

                        const navInput = getKeyboardNavigationInput(e);
                        if (e.key === "Enter") {
                            setCurrentNote(state, noteId, initialNoteId);
                            handled = true;
                        } else if (e.key === "e" || e.key === "E") {
                            if (!scheduleViewState.isEstimating) {
                                scheduleViewState.isEstimating = true;
                                scheduleViewState.isEstimatingRemainder = false;
                                e.preventDefault();
                            }

                            handled = true;
                        } else if (e.key === "r" || e.key === "R") {
                            if (!scheduleViewState.isEstimatingRemainder) {
                                scheduleViewState.isEstimating = true;
                                scheduleViewState.isEstimatingRemainder = true;
                                scheduleViewState.remainderText = "";
                                e.preventDefault();
                            }

                            handled = true;
                        } else if (e.key === "c" || e.key === "C") {
                            if (!scheduleViewState.isConfiguringWorkday) {
                                scheduleViewState.isConfiguringWorkday = true;
                                e.preventDefault();
                            }

                            handled = true;
                        } else if (navInput) {
                            const oldIdx = scheduleViewState.noteIdx;
                            let newIdx = getNavigationNextIndex(
                                navInput,
                                oldIdx,
                                noteIds.length,
                            );

                            if (oldIdx !== newIdx && navInput.doDrag) {
                                moveArrayItem(noteIds, oldIdx, newIdx);
                                debouncedSave();
                            }

                            scheduleViewState.noteIdx = newIdx;
                            handled = true;
                        }

                    }

                    if (!handled && e.key === "ArrowLeft") {
                        viewAllTaskStreamsState.isViewingCurrentStream = false;
                        handled = true;
                    }
                }
            }
        } else {
            if (hasCtrlKey(e) && e.key === "Enter") {
                // insert new stream under current
                state.currentTaskStreamIdx++;
                insertNewTaskStreamAt(state, state.currentTaskStreamIdx, "new stream");
                viewAllTaskStreamsState.isRenaming = true;
                handled = true;
            } else {
                if (viewAllTaskStreamsState.isRenaming) {
                    if (e.key === "Enter") {
                        viewAllTaskStreamsState.isRenaming = false;
                        handled = true;
                    } else if (viewAllTaskStreamsState.isRenaming && e.key === "Escape") {
                        e.stopImmediatePropagation();
                        // TODO: revert to old name
                        viewAllTaskStreamsState.isRenaming = false;
                        handled = true;
                    }
                } else {
                    if (e.key === "Enter") {
                        if (e.shiftKey) {
                            // enter rename mode
                            if (canRename) {
                                viewAllTaskStreamsState.isRenaming = true;
                            }
                            handled = true;
                        } else {
                            // TODO: needs to preserve the note's position in the stream itself before we removed it, unless we close the modal
                            toggleNoteInTaskStream(viewStreamState ? viewStreamState.taskStream : null, currentNote);
                            if (viewStreamState) {
                                recomputeViewTaskStreamState(viewStreamState, state, viewStreamState.taskStream, false);
                            }
                            handled = true;
                        }
                    } else if (e.key === "Delete" && viewAllTaskStreamsState.canDelete) {
                        // TODO: warn about this. At least we don't allow deleting non-empty streams

                        if (state.currentTaskStreamIdx >= 0) {
                            deleteTaskStream(state, state.taskStreams[state.currentTaskStreamIdx]);
                        }
                        state.currentTaskStreamIdx = clamp(state.currentTaskStreamIdx, MIN_TASK_STREAM_IDX, state.taskStreams.length - 1);
                        handled = true;
                    }
                }
            } 

            if (!handled) {
                const navInput = getKeyboardNavigationInput(e);
                if (navInput) {
                    // handled navigating streams list.
                    const oldIdx = state.currentTaskStreamIdx;
                    let newIdx = oldIdx;
                    if (navInput.moveDelta || navInput.absoluteMovement !== -1) {
                        if (navInput.absoluteMovement !== -1) {
                            newIdx = navInput.absoluteMovement + MIN_TASK_STREAM_IDX;
                        } else if (navInput.moveToEnd) {
                            newIdx = navInput.moveDelta < 0 ? MIN_TASK_STREAM_IDX : state.taskStreams.length - 1;
                        } else if (navInput.moveToImportant) {
                            if (navInput.moveDelta < 0) {
                                for (let i = oldIdx - 1; i >= 0; i--) {
                                    const stream = state.taskStreams[i];
                                    if (isNoteInTaskStream(stream, currentNote)) {
                                        newIdx = i;
                                        break;
                                    }
                                }
                            } else {
                                for (let i = oldIdx + 1; i < state.taskStreams.length; i++) {
                                    const stream = state.taskStreams[i];
                                    if (isNoteInTaskStream(stream, currentNote)) {
                                        newIdx = i;
                                        break;
                                    }
                                }
                            }
                        } else {
                            newIdx += navInput.moveDelta;
                        }
                        newIdx = clamp(newIdx, MIN_TASK_STREAM_IDX, state.taskStreams.length - 1);

                        if (navInput.doDrag) {
                            moveArrayItem(state.taskStreams, oldIdx, newIdx);
                            debouncedSave();
                        }

                        if (newIdx !== oldIdx) {
                            state.currentTaskStreamIdx = newIdx;
                            handled = true;
                        }
                    }
                }
            } 

            if (!handled && e.key === "ArrowRight") {
                viewAllTaskStreamsState.isViewingCurrentStream = true;
                handled = true;
            }
        }

        if (handled) {
            rerenderApp();
        }
    });

    return rg.if(
        s => s.visible,
        rg => rg.cArgs(Modal, c => c.render({
            onClose: () => setCurrentModalAndRerenderApp(null),
        }), [
            div({ class: [cn.row, cn.h100, cn.relative], style: "padding: 10px; max-width: 90vw; max-height: 90vw;" }, [
                rg.style("width", () => viewAllTaskStreamsState.isViewingCurrentStream ? "90vw" : ""),
                rg.style("height", () => viewAllTaskStreamsState.isViewingCurrentStream ? "90vh" : ""),
                rg.if(() => !viewAllTaskStreamsState.isViewingCurrentStream,
                    rg => rg.c(ViewAllTaskStreams, (c, s) => c.render({
                        currentIdx: state.currentTaskStreamIdx,
                        state: viewAllTaskStreamsState,
                        toggle: (stream, note) => {
                            const viewStreamState = viewAllTaskStreamsState.viewTaskStreamStates.find(
                                s => s.taskStream === stream
                            );

                            if (viewStreamState) {
                                toggleNoteInTaskStream(stream, note);
                                if (stream) {
                                    recomputeViewTaskStreamState(viewStreamState, state, stream, false);
                                }
                                rerenderApp();
                            }
                        },
                        navigate: (streamIdx) => {
                            state.currentTaskStreamIdx = streamIdx;
                            viewAllTaskStreamsState.isViewingCurrentStream = true;
                            rerenderApp();
                        },
                    })),
                ),
                rg.else_with((s) => {
                    if (viewAllTaskStreamsState.isViewingCurrentStream && !!viewStreamState) {
                        return { viewStreamState: viewStreamState };
                    }
                }, rg => rg.c(ViewTaskStream, (c, { viewStreamState }) => c.render({ 
                        state: viewStreamState!,
                        goBack: goToAllStreams,
                    })),
                ),
                rg.else(
                    rg => rg.c(ViewCurrentSchedule, (c) => c.render(scheduleViewState))
                ),
            ])
        ])
    );
}

function modalPaddingStyles(paddingPx: number = 0, width = 94, height = 90) {
    return `width: ${width}vw; height: ${height}vh; padding: ${paddingPx}px`;
}

function handleAddOrRemoveToStream(e: KeyboardEvent): boolean {
    const shiftPressed = e.shiftKey;
    const ctrlPressed = e.ctrlKey || e.metaKey;
    if (
        ctrlPressed &&
        (e.key === "s" || e.key === "S")
    ) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return true;
    }
    return false;
}


function LoadBackupModal(rg: RenderGroup<{
    fileName: string;
    text: string;
}>) {
    const fileNameDiv = el("H3");
    const infoDiv = div();
    const loadBackupButton = newComponent(Button, {
        label: "Load this backup",
        onClick: () => {
            const s = rg.s;
            if (!canLoad || !s.text) {
                return;
            }

            if (confirm("Are you really sure you want to load this backup? Your current state will be wiped")) {
                const { text } = s;

                setStateFromJSON(text, () => {
                    saveCurrentState({ debounced: false });

                    initState(() => {
                        setCurrentModalAndRerenderApp(null);
                    });
                });
            }
        }
    });
    const modal = newComponentArgs(Modal, [[
        div({ class: [cn.col], style: modalPaddingStyles(10, 40, 40) }, [
            fileNameDiv,
            infoDiv,
            loadBackupButton,
        ])
    ]]);

    let canLoad = false;

    rg.preRenderFn(function renderBackupModal(s) {
        modal.render({
            onClose: () => setCurrentModalAndRerenderApp(null),
        });

        const { text, fileName } = s;

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
                div({}, ["Notes: ", tree.getSizeExcludingRoot(backupState.notes).toString()]),
                div({}, ["Activities: ", backupState.activities.length.toString()]),
                div({}, ["Last Online: ", !lastOnline ? "No idea" : formatDateTime(lastOnline)]),
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
        setCurrentModalAndRerenderApp(null);
        debouncedSave();
    }

    return rg.cArgs(Modal, c => c.render({ onClose, }), [
        div({ style: modalPaddingStyles(10) }, [
            rg.c(InteractiveGraph, (c) => c.render({
                onClose,
                graphData: state.mainGraphData,
                onInput() {
                    debouncedSave();
                }
            }))
        ])
    ]);
}

const lastRenderTimes: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
let lastRenderTimesPos = 0;
function SettingsModal(rg: RenderGroup) {
    function onClose() {
        setCurrentModalAndRerenderApp(null);
        debouncedSave();
    }

    rg.intermittentFn(() => {
        if (state._currentModal === settingsModal) {
            rerenderApp();
        }
    }, 1000);

    const settingsRowClasses = [
        cn.row,
        cn.alignItemsCenter,
        cnApp.pad5,
        cnApp.gap5
    ];

    return rg.cArgs(Modal, c => c.render({ onClose }), [
        div({ class: [cn.col], style: "align-items: stretch; padding: 10px;" }, [
            div({ class: [cn.col, cnApp.gap10] }, [
                div({ class: [cnApp.solidBorderSmRounded], style: "padding: 10px; " }, [
                    el("H3", { class: [cn.textAlignCenter] }, "Settings"),

                    div({ class: settingsRowClasses }, [
                        rg.c(Checkbox, (c) => c.render({
                            label: "Show all notes (May cause instability, so this setting won't be saved)",
                            value: state._showAllNotes,
                            onChange(val) {
                                state._showAllNotes = val;
                                rerenderApp();
                            }
                        })),
                    ]),
                    div({ class: settingsRowClasses }, [
                        rg.c(Checkbox, (c) => c.render({
                            label: "Force notes that aren't being edited to be a single line",
                            value: state.settings.nonEditingNotesOnOneLine,
                            onChange(val) {
                                state.settings.nonEditingNotesOnOneLine = val;
                                rerenderApp();
                            }
                        })),
                    ]),
                    rg.if(() => !state.settings.nonEditingNotesOnOneLine, rg =>
                        div({ class: settingsRowClasses }, [
                            div({ style: "padding-left: 20px" }, [
                                rg.c(Checkbox, (c) => c.render({
                                    label: "Force parent notes to be a single line",
                                    value: state.settings.parentNotesOnOneLine,
                                    onChange(val) {
                                        state.settings.parentNotesOnOneLine = val;
                                        rerenderApp();
                                    }
                                })),
                            ])
                        ]),
                    ),
                    div({ class: settingsRowClasses }, [
                        rg.c(Checkbox, (c) => c.render({
                            label: "Spaces instead of tabs",
                            value: state.settings.spacesInsteadOfTabs,
                            onChange(val) {
                                state.settings.spacesInsteadOfTabs = val;
                                rerenderApp();
                            }
                        })),
                        rg.if(() => state.settings.spacesInsteadOfTabs, rg =>
                            div({ style: "padding-left: 20px" }, [
                                div({ class: [cn.row, cn.alignItemsCenter] }, [
                                    "Tab Size: ",
                                    rg.c(Button, (c, s) => c.render({
                                        label: "-",
                                        onClick: () => {
                                            state.settings.tabStopSize -= 1;
                                            if (state.settings.tabStopSize < 1) {
                                                state.settings.tabStopSize = 1;
                                            }
                                            rerenderApp();
                                        }
                                    })),
                                    rg.text(() => "" + state.settings.tabStopSize),
                                    rg.c(Button, (c, s) => c.render({
                                        label: "+",
                                        onClick: () => {
                                            state.settings.tabStopSize += 1;
                                            // random ahh number 32.
                                            if (state.settings.tabStopSize > 32) {
                                                state.settings.tabStopSize = 32;
                                            }
                                            rerenderApp();
                                        }
                                    })),
                                ])
                            ]),
                        ),
                    ]),
                    rg.c(Checkbox, (c) => c.render({
                        label: "Enable debug mode (!!!)",
                        value: isDebugging(),
                        onChange(val) {
                            setDebugMode(val);
                            rerenderApp();
                        }
                    })),
                ]),
                rg.if(() => isDebugging(), rg =>
                    div({ class: [cnApp.solidBorderSmRounded], style: "padding: 10px; " }, [
                        el("H3", { class: [cn.textAlignCenter] }, "Diagnostics"),
                        div({ class: [cn.row] }, [
                            "Render timings: ",
                            div({ class: [cnApp.gap10, cn.row] }, [
                                () => {
                                    function RenderTime(rg: RenderGroup<[number, boolean]>) {
                                        return span({}, [
                                            rg.style("borderBottom", s => s[1] ? `3px solid ${cssVars.fgColor}` : ""),
                                            rg.text(s => s[0] + "ms")
                                        ]);
                                    }

                                    return rg.list(contentsDiv(), RenderTime, (getNext) => {
                                        for (let i = 0; i < lastRenderTimes.length; i++) {
                                            getNext().render([
                                                lastRenderTimes[i],
                                                i === lastRenderTimesPos
                                            ]);
                                        }
                                    })
                                },
                            ]),
                        ]),
                        div({}, [
                            rg.realtime(rg =>
                                rg.text(() => `Realtime animations in progresss: ${getCurrentNumAnimations()}`),
                            )
                        ]),
                    ]),
                ),
            ]),
        ])
    ]);
}

function ScratchPadModal(rg: RenderGroup<{
    open: boolean;
}>) {
    const canvasState = newCanvasState();
    const asciiCanvas = newComponent(AsciiCanvas);
    const modalComponent = newComponentArgs(Modal, [[
        div({ style: modalPaddingStyles(10) }, [
            asciiCanvas
        ])
    ]]);

    let wasVisible = false;

    rg.preRenderFn(function renderAsciiCanvasModal(s) {
        const { open } = s;
        setVisible(modalComponent, open);

        if (!wasVisible && open) {
            if (!state._isEditingFocusedNote) {
                setIsEditingCurrentNote(state, true);
                rerenderAppNextFrame();
                return;
            }

            wasVisible = true;

            canvasState.tabSize = state.settings.spacesInsteadOfTabs ? state.settings.tabStopSize : 4;

            const note = getCurrentNote(state);
            asciiCanvas.render({
                canvasState,
                outputLayers: state._scratchPadCanvasLayers,
                onInput() { },
                onWrite() {
                    state._scratchPadCanvasCurrentNoteIdPendingSave = note.id;
                    debouncedSave();
                }
            });

            // needs to happen after we render the canvas, since we will be swapping out the output buffer
            resetCanvas(canvasState, false, note.data.text);
            asciiCanvas.renderWithCurrentState();
        } else if (wasVisible && !open) {
            wasVisible = false;
            applyPendingScratchpadWrites(state);
        }

        modalComponent.render({
            onClose() {
                setCurrentModalAndRerenderApp(null);
            },
        });
    });

    return modalComponent;
}

function NoteRowDurationInfo(rg: RenderGroup<{ note: TreeNote; }>) {
    const durationEl = span();
    const divider = span({}, ", ");
    const estimateContainer = span();
    const estimateEl = span();
    const root = div({
        class: [cn.row],
        style: "text-align: right; gap: 5px; padding-left: 10px;"
    }, [
        durationEl,
        divider,
        addChildren(estimateContainer, [
            estimateEl,
        ])
    ]);

    rg.intermittentFn(function renderNoteRowDurationInfo(_, s) {
        const { note } = s;

        const duration = getNoteDurationUsingCurrentRange(state, note);

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
    }, 100);

    return root;
}

type NoteRowInputArgs = {
    readOnly: boolean;
    note: TreeNote;
    treeVisualsInfo: TreeVisualsInfo;
    viewStartDepth: number;
    stickyOffset?: number;

    _isSticky: boolean;

    hasDivider: boolean;
    hasLightDivider: boolean;
    scrollParent: HTMLElement | null;
    currentNote: TreeNote;
    listHasFocus: boolean;
    forceOneLine: boolean;
    forceMultipleLines: boolean;

    orignalOffsetTop: number;

    durationInfoOnNewLine?: boolean;
};


function NoteRowInput(rg: RenderGroup<NoteRowInputArgs>) {
    const INDENT1 = 3;
    const INDENT2 = INDENT1;
    let noteDepth = 0;
    const getIndentation = (depth: number) => {
        const difference = depth - rg.s.viewStartDepth;
        // Notes on the current level or deeper get indented a bit more, for visual clarity,
        // and the parent notes won't get indented as much so that we aren't wasting space
        const indent2Amount = Math.max(0, difference);
        const indent1 = INDENT1 * Math.min(rg.s.viewStartDepth, depth);
        const indent2 = INDENT2 * Math.max(indent2Amount, 0);
        return indent1 + indent2;
    }

    let isFocused = false;
    let isEditing = false;
    let isShowingDurations = false;

    let currentSelectionStart = 0;

    function onInput(text: string) {
        if (!rg.s.listHasFocus) {
            return;
        }

        const s = rg.s;
        const { note } = s;

        // Perform a partial update on the state, to just the thing we're editing

        note.data.text = text;

        debouncedSave();

        rerenderApp();
    }

    function onInputKeyDown(e: KeyboardEvent, textArea: HTMLTextAreaElement) {
        if (!rg.s.listHasFocus) {
            return;
        }

        currentSelectionStart = textArea.selectionStart ?? 0;

        const currentNote = rg.s.currentNote;
        const shiftPressed = e.shiftKey;
        const ctrlPressed = e.ctrlKey || e.metaKey;

        let handled = false;
        let shouldPreventDefault = true;

        if (e.key === "Enter" && handleEnterPress(ctrlPressed, shiftPressed)) {
            handled = true;
        } else if (e.key === "Backspace") {
            deleteNoteIfEmpty(state, currentNote.id);
            shouldPreventDefault = false;
            handled = true;
        } else if (e.key === "ArrowUp") {
            shouldPreventDefault = false;
            handled = true;
        } else if (e.key === "ArrowDown") {
            shouldPreventDefault = false;
            handled = true;
        } 

        if (handled) {
            if (shouldPreventDefault) {
                e.preventDefault();
            }

            renderSettings.shouldScroll = true;
            rerenderApp();
        }
    }

    function setStickyOffset() {
        const s = rg.s;
        const { stickyOffset } = s;

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

    function scrollComponentToView(scrollParent: HTMLElement) {
        // Clearing and setting the sticky style allows for scrolling to work.

        clearStickyOffset();

        // Want to scroll based on where we are in the current note.
        const text = rg.s.note.data.text;
        let newLinesToScroll = 0;
        let newLinesInTotal = 1;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c === "\n") {
                if (i <= currentSelectionStart) {
                    newLinesToScroll += 1;
                }
                newLinesInTotal += 1;
            }
        }

        const percentageToScroll = newLinesToScroll / newLinesInTotal;

        // We can completely obscure the activity and todo lists, now that we have the right-dock
        scrollIntoView(scrollParent, root, 0.5, percentageToScroll);

        setStickyOffset();
    }

    rg.preRenderFn(function renderNoteRowInput({
        note,
        scrollParent,
        readOnly,
        currentNote,
        listHasFocus,
        treeVisualsInfo,
    }) {
        noteDepth = treeVisualsInfo.depth ?? note.data._depth;

        isFocused = currentNote.id === note.id && listHasFocus;
        isEditing = !readOnly && state._currentModal === null && (
            listHasFocus && isFocused && state._isEditingFocusedNote
        );

        isShowingDurations = state._isShowingDurations;

        setStickyOffset();

        // do auto-scrolling
        if (shouldScrollToNotes(state)) {
            if (isFocused && scrollParent) {
                let shouldScroll = renderSettings.shouldScroll;
                if (!shouldScroll) {
                    const rect = root.el.getBoundingClientRect();
                    const isOffscreen = rect.bottom < 0 || rect.top > window.innerHeight;
                    if (isOffscreen) {
                        shouldScroll = true;
                    }
                }

                if (shouldScroll) {
                    // without setTimeout here, calling focus won't work as soon as the page loads.
                    setTimeout(() => {
                        scrollComponentToView(scrollParent);
                    }, 1);
                }
            }
        }
    });

    rg.postRenderFn(s => {
        let hasStuck = false;
        if (s._isSticky) {
            hasStuck = s.orignalOffsetTop !== -420 && s.orignalOffsetTop !== root.el.offsetTop;
        }

        setStyle(root, "zIndex", hasStuck ? `${200 - noteDepth}` : "")
    });

    const cursorElement = div({ style: "width: 10px;" }, [
        rg.style("backgroundColor", (s) => {
            const lastActivity = getLastActivityWithNote(state);
            const isLastEditedNote = lastActivity?.nId === s.note.id;
            let isFocusedAndEditing = isLastEditedNote && !isCurrentlyTakingABreak(state);

            if (isFocusedAndEditing) {
                return "#F00";
            }

            if (s.listHasFocus) {
                if (isFocused) {
                    if (!isInQuicklist && !isInHotlist) {
                        return `${cssVars.fgColor}`;
                    }

                    return `${cssVars.bgColorFocus2}`;;
                }

                if (isLastEditedNote) {
                    return "#00F";
                }
            }

            return "";
        }),
    ]);

    const DURATION_BAR_HEIGHT = 4;

    const root = div({
        class: [cn.row, cn.pre],
        // need padding to make room for the scroll bar :sad:
        style: `background-color: ${cssVars.bgColor}; padding-right: 10px;`
    }, [
        rg.on("click", ({ note }) => {
            setCurrentNote(state, note.id);
            rerenderApp();
        }),
        rg.style("color", ({ note }) => {
            return !note.data._shelved && (
                note.data._isSelected ||
                note.data._status === STATUS_IN_PROGRESS
            ) ? `${cssVars.fgColor}` : `${cssVars.unfocusTextColor}`;
        }),
        rg.style(`backgroundColor`, () => isFocused ? `${cssVars.bgColorFocus}` : `${cssVars.bgColor}`),
        // Dividing line between different levels
        rg.style(`borderBottom`, s => s.hasDivider ? `1px solid ${cssVars.fgColor}`
            : s.hasLightDivider ? `1px solid ${cssVars.bgColorFocus}` : ``
        ),
        div({ class: [cn.flex1, cn.relative] }, [
            div({ class: [cn.row, cn.alignItemsStretch], style: "" }, [
                rg.style("lineHeight", s => s.note.data._status === STATUS_IN_PROGRESS ? "1.5" : "1.2"),
                // cursor element
                cursorElement,
                div({ style: "width: 10px" }),
                div({}, [
                    rg.text((s) => {
                        if (s.note.data._isScheduled) {
                            return "S->";
                        }

                        const count = s.note.data._taskStreams.length;

                        if (count === 0) {
                            return "   ";
                        }
                        if (count <= 9) {
                            return count + "->";
                        }
                        return "9+>"
                    })
                ]),
                div({ style: "width: 10px" }),
                // indentation - before vertical line
                div({ class: [cn.relative] }, [
                    // HACK - tree lines shouldn't be broken by the duration bars
                    rg.style("marginBottom", () => isShowingDurations ? `-${DURATION_BAR_HEIGHT}px` : ""),
                    rg.style("minWidth", () => {
                        return getIndentation(noteDepth) + "ch";
                    }),
                    () => {
                        function VerticalStroke(rg: RenderGroup<[number, boolean, boolean, boolean, boolean]>) {
                            const aboveHorizontal = div({
                                class: [cn.absolute],
                                style: `background-color: ${cssVars.fgColor}; width: 1px; top: 0; height: 1ch;`
                            }, [
                                rg.style("left", s => s[0] + "ch"),
                                rg.style("width", s => s[2] ? cssVars.focusedTreePathWidth : cssVars.unfocusedTreePathWidth),
                            ]);

                            const belowHorizontal = div({
                                class: [cn.absolute],
                                style: `background-color: ${cssVars.fgColor}; width: 1px; top: 1ch; bottom: 0;`
                            }, [
                                rg.style("left", s => s[0] + "ch"),
                                rg.style("width", s => s[4] ? cssVars.focusedTreePathWidth : cssVars.unfocusedTreePathWidth),
                            ]);

                            // a performance optimization so I don't have to use rg.if
                            rg.preRenderFn(s => {
                                const [_depth, isAboveLineVisible, aboveFocused, isBelowLineVisible, belowFocused] = s;
                                setVisible(aboveHorizontal, isAboveLineVisible);
                                setVisible(belowHorizontal, isBelowLineVisible);
                            });

                            return contentsDiv({}, [belowHorizontal, aboveHorizontal]);
                        }

                        return rg.list(contentsDiv(), VerticalStroke, (getNext, s) => {

                            const depth = noteDepth;
                            let currentDepth = depth;
                            let parent = s.note;

                            while (!idIsNil(parent.parentId) && currentDepth >= 0) {
                                const isParentLastNote = parent.data._index === parent.data._numSiblings - 1;
                                const isTopFocused = s.treeVisualsInfo._selectedPathDepth === currentDepth;
                                const isBottomFocused = s.treeVisualsInfo._selectedPathDepth === currentDepth
                                    && !s.treeVisualsInfo._selectedPathDepthIsFirst;

                                getNext().render([
                                    getIndentation(currentDepth),
                                    currentDepth === depth || !isParentLastNote, isTopFocused,
                                    !isParentLastNote, isBottomFocused,
                                ]);

                                currentDepth--;

                                parent = getNote(state, parent.parentId);
                            }
                        });
                    },
                ]),
                div({ class: [cn.relative], style: "padding-right: 5px; min-width: 5px;" }, [
                    div({
                        class: [cn.absolute],
                        style: `background-color: ${cssVars.fgColor}; height: 1px; top: 1ch; right: 0px; left: 0px`
                    }, [
                        rg.style("height", s => s.treeVisualsInfo._selectedPathDepthIsFirst ?
                            cssVars.focusedTreePathWidth : cssVars.unfocusedTreePathWidth)
                    ]),
                ]),
                div({ class: [cn.pre], style: "padding-left: 0.5ch; padding-right: 1ch; " }, [
                    rg.text(({ note, forceOneLine, forceMultipleLines }) => {
                        // The design onf this note status and the tree lines are inextricably linked, but you wouldn't see
                        // that from the code - the lines need to look as if they were exiting from below the middle of this status text:
                        //      |
                        //      +-- [ x ] >> blah blah blah
                        //      +--  ...  >> blah blah blah 2
                        //            |
                        //            |    <- like it does here
                        //            |
                        //            +--

                        let charCount;
                        if (forceMultipleLines || !forceOneLine) {
                            charCount = "";
                        } else if (note.data.text.length < 150) {
                            charCount = "";
                        } else {
                            charCount = `[${note.data.text.length}ch]`;
                        }

                        const status = noteStatusToString(note.data._status);
                        const progress = getNoteProgressCountText(note);

                        return `${status} ${progress}${charCount}`;
                    })
                ]),
                rg.cArgs(EditableTextArea, (c, s) => c.render({
                    text: s.note.data.text,
                    isEditing,
                    onInputKeyDown,
                    isOneLine: s.forceMultipleLines ? false : (
                        s.forceOneLine && !(isEditing || isFocused)
                    ),
                    onInput,
                    config: {
                        useSpacesInsteadOfTabs: state.settings.spacesInsteadOfTabs,
                        tabStopSize: state.settings.tabStopSize,
                    }
                }), initializeNoteTreeTextArea),
                div({ class: [cn.row, cn.alignItemsCenter], style: "padding-right: 4px" }, [
                    rg.if(s => !s.durationInfoOnNewLine, rg =>
                        rg.c(NoteRowDurationInfo, (c, { note }) => {
                            c.render({ note });
                        }),
                    ),
                    rg.text(s => s.note.data._shelved ? "[Shelved]" : ""),
                ]),
            ]),
            // Looks kinda bad, but this is the best we can do for now.
            rg.if(s => !!s.durationInfoOnNewLine, rg =>
                rg.c(NoteRowDurationInfo, (c, { note }) => {
                    c.render({ note });
                }),
            ),
            rg.if(() => isShowingDurations, rg =>
                rg.realtime(rg =>
                    rg.inlineFn(
                        div({ class: [cnApp.inverted], style: `height: ${DURATION_BAR_HEIGHT}px;` }),
                        (c, s) => {
                            const note = s.note;
                            const currentNote = s.currentNote;
                            const duration = getNoteDurationUsingCurrentRange(state, note);

                            assert(!idIsNil(note.parentId), "Note didn't have a parent!");
                            const parentNote = getNote(state, note.parentId);
                            const totalDuration = getNoteDurationUsingCurrentRange(state, parentNote);
                            let percent = totalDuration < 0.000001 ? 0 : 100 * duration / totalDuration;

                            setStyle(c, "width", percent + "%")

                            const isOnCurrentLevel = note.parentId === currentNote.parentId;
                            setStyle(c, `backgroundColor`, isOnCurrentLevel ? `${cssVars.fgColor}` : `${cssVars.unfocusTextColor}`);
                        }
                    )
                )
            ),
        ]),
    ]);
    return root;
}

export type TreeVisualsInfo = {
    depth: number;

    // for the tree visuals
    _isVisualLeaf: boolean; // Does this note have it's children expanded in the tree note view?
    _selectedPathDepth: number;  
    _selectedPathDepthIsFirst: boolean;  // Is this the first note on the selected path at this depth? (Nothing to do with Depth first search xD)
}

// NOTE: the tree visuals are still broken at the moment when using custom depths
export function recomputeTreeVisualsInfo(
    treeVisuals: TreeVisualsInfo[],
    flatNoteIds: NoteId[],
    currentNoteId: number | null,
) {
    assert(treeVisuals.length === flatNoteIds.length, "treeVisualsDst.length === flatNoteIds.length,");


    // recompute leaf status
    {
        // a note is a visual leaf it it doesn't have any children.
        // a note has children if there are notes under it with a depth greater than it.
        for (let i = 0; i < treeVisuals.length; i++) {
            const isLastItem = i === treeVisuals.length - 1;
            treeVisuals[i]._isVisualLeaf = isLastItem ||
                treeVisuals[i].depth >= treeVisuals[i + 1].depth;
        }
    }


    // recompute selected path depths
    {
        for (let i = 0; i < treeVisuals.length; i++) {
            treeVisuals[i]._selectedPathDepth = -1;
            treeVisuals[i]._selectedPathDepthIsFirst = false;
        }

        if (!idIsNilOrUndefined(currentNoteId) && !idIsRoot(currentNoteId)) {
            const currentNoteIdx = flatNoteIds.indexOf(currentNoteId);
            if (currentNoteIdx !== -1) {
                // If you take a picture of the tree diagram and then trace out
                // the 'focused' path, then this code will actually make sense
                let currentFocusedDepth = treeVisuals[currentNoteIdx].depth;
                for (let i = currentNoteIdx; i >= 0; i--) {
                    let newDepth = Math.min(
                        currentFocusedDepth,
                        treeVisuals[i].depth,
                    );

                    treeVisuals[i]._selectedPathDepth = newDepth;
                    treeVisuals[i]._selectedPathDepthIsFirst = i === currentNoteIdx ||
                        currentFocusedDepth !== newDepth;

                    currentFocusedDepth = newDepth;
                }
            }
        }
    }
}

function NotesList(rg: RenderGroup<{
    flatNoteIds: NoteId[];
    currentNoteId: NoteId | null;
    hasFocus: boolean;
    ratio: number;
    alwaysMultipleLines: boolean;

    noteDepths?: number[];
    scrollParentOverride?: HTMLElement;
    enableSticky?: boolean;
    durationInfoOnNewLine?: boolean;
}>) {
    const root = div({
        class: [cn.flex1, cn.w100, cnApp.sb1b, cnApp.sb1t],
    }, [
        rg.class(cn.overflowYAuto, s => !s.scrollParentOverride),
    ]);
    const noteList = newListRenderer(root, () => newComponent(NoteRowInput));

    const treeVisualInfo: TreeVisualsInfo[] = [];
    let viewStartDepth = 0;

    rg.preRenderFn(function renderNoteListInteral(s) {
        const { flatNoteIds, scrollParentOverride, currentNoteId, hasFocus } = s;

        const scrollParent = scrollParentOverride ?? root.el;

        if (!setVisible(root, flatNoteIds.length > 0)) {
            return;
        }

        setStyle(root, "flex", "" + s.ratio);

        // recompute tree visuals
        {
            if (s.noteDepths) {
                assert(s.flatNoteIds.length === s.noteDepths.length, "s.flatNoteIds.length === s.noteDepths.length");
            }

            treeVisualInfo.length = flatNoteIds.length;
            for (let i = 0; i < flatNoteIds.length; i++) {
                if (!treeVisualInfo[i]) {
                    treeVisualInfo[i] = {
                        depth: 0, _selectedPathDepthIsFirst: false, _selectedPathDepth: -1, _isVisualLeaf: false,
                    };
                }


                let depth;
                if (s.noteDepths) {
                    depth = s.noteDepths[i];
                } else {
                    depth = getNote(state, s.flatNoteIds[i]).data._depth;
                }

                treeVisualInfo[i].depth = depth;
            }
            recomputeTreeVisualsInfo(treeVisualInfo, s.flatNoteIds, currentNoteId);

            viewStartDepth = 0;
            if (treeVisualInfo.length > 0) {
                viewStartDepth = treeVisualInfo[0].depth;
                for (let i = 1; i < treeVisualInfo.length; i++) {
                    viewStartDepth = Math.min(viewStartDepth, treeVisualInfo[i].depth);
                }
            }
        }

        noteList.render((getNext) => {
            if (idIsNilOrUndefined(currentNoteId)) {
                return;
            }

            const currentNote = getNote(state, currentNoteId);

            for (let i = 0; i < flatNoteIds.length; i++) {
                const id = flatNoteIds[i];
                const note = getNote(state, id);
                const component = getNext();

                const flatNotesRoot = getNote(state, state._currentFlatNotesRootId);
                const isParentNote = note.data._depth < flatNotesRoot?.data._depth;

                // Rendering the component once without sticky and then a second time with sticky, so that
                // we can determine if a note has 'stuck' to the top of the page and apply a divider conditionally.

                // NOTE: stickyness now has nothing to do with isSticky. We can get to those notes quickly enough
                // using the quicklist anyway.
                const isSticky = !!s.enableSticky && (
                    state._showAllNotes ? false :
                        note.data._depth < flatNotesRoot?.data._depth
                );

                let forceOneLine = false;
                if (s.alwaysMultipleLines) {
                    forceOneLine = false;
                } else if (!forceOneLine) {
                    if (state.settings.nonEditingNotesOnOneLine) {
                        forceOneLine = true;
                    } else if (state.settings.parentNotesOnOneLine) {
                        forceOneLine = isParentNote;
                    } else {
                        forceOneLine = false;
                    }
                }

                component.render({
                    note,
                    treeVisualsInfo: treeVisualInfo[i],
                    viewStartDepth,
                    stickyOffset: undefined,
                    _isSticky: isSticky,
                    hasDivider: false,
                    hasLightDivider: false,
                    scrollParent,
                    readOnly: false,
                    currentNote,
                    listHasFocus: hasFocus,
                    orignalOffsetTop: -420,
                    forceOneLine,
                    forceMultipleLines: s.alwaysMultipleLines,
                    durationInfoOnNewLine: s.durationInfoOnNewLine,
                });

                if (isSticky) {
                    component.s.orignalOffsetTop = component.el.offsetTop;
                } else {
                    component.s.orignalOffsetTop = 0;
                }
            }
        });

        if (!updateStickyDivider()) {
            // The scroll position changes after we've rendered a bunch of notes, so we'll need to recompute this.
            setTimeout(() => {
                updateStickyDivider();
            }, 1);
        }
    });

    function updateStickyDivider(): boolean {
        const { flatNoteIds } = rg.s;

        let lastStuckComponentThatCanHaveADivider: Component<NoteRowInputArgs, HTMLDivElement> | undefined;
        let stickyOffset = 0;

        for (let i = 0; i < noteList.components.length; i++) {
            const id = flatNoteIds[i];
            const note = getNote(state, id);
            const component = noteList.components[i];

            const flatNotesRoot = getNote(state, state._currentFlatNotesRootId);

            let previousStickyOffset = component.s.stickyOffset;
            const newStickyOffset = component.s._isSticky ? stickyOffset : undefined;
            if (previousStickyOffset !== newStickyOffset) {
                component.s.stickyOffset = newStickyOffset;
                component.renderWithCurrentState();
            }

            if (component.s._isSticky) {
                const hasStuck = component.s.orignalOffsetTop !== component.el.offsetTop;
                if (hasStuck) {
                    const canHaveDivider = note.data._depth < flatNotesRoot?.data._depth;
                    if (canHaveDivider) {
                        lastStuckComponentThatCanHaveADivider = component;
                    }
                }

                // I have no idea how I would do this in React, tbh.
                // But it was really damn easy here lol.
                stickyOffset += component.el.getBoundingClientRect().height;
            }
        }

        if (lastStuckComponentThatCanHaveADivider) {
            lastStuckComponentThatCanHaveADivider.s.hasDivider = true;
            lastStuckComponentThatCanHaveADivider.renderWithCurrentState();
            return true;
        }

        return false;
    }

    return root;
}

function getTheme(): AppTheme {
    if (state.currentTheme === "Dark") {
        return "Dark";
    }

    return "Light";
};


function AsciiIcon(rg: RenderGroup<AsciiIconData>) {
    const icon = div();

    icon.el.style.userSelect = "none";
    icon.el.style.whiteSpace = "pre";
    icon.el.style.fontSize = "6px";
    icon.el.style.fontFamily = "Courier";
    icon.el.style.fontWeight = "bold";
    icon.el.style.textShadow = `1px 1px 0px ${cssVars.fgColor}`;

    rg.preRenderFn(function renderAsciiIcon(s) {
        const { data } = s;
        setText(icon, data);
    });

    return icon;
}

function DarkModeToggle(rg: RenderGroup) {
    const button = newComponent(Button, {
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

    rg.preRenderFn(() => {
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

function setCurrentModal(modal: Insertable | null) {
    if (state._currentModal === modal) {
        return;
    }

    state._currentModal = modal;
}

const setCurrentModalAndRerenderApp = (modal: Insertable | null) => {
    setCurrentModal(modal);
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

function ActivityListContainer(rg: RenderGroup<{ docked: boolean }>) {
    const scrollActivitiesToTop = newComponent(Button, {
        label: "Top",
        onClick: () => {
            state._currentlyViewingActivityIdx = state.activities.length - 1;
            rerenderApp();
        },
    });
    const scrollActivitiesToMostRecent = newComponent(Button, {
        label: "Most Recent",
        onClick: () => {
            state._currentlyViewingActivityIdx = getMostRecentIdx();
            rerenderApp();
        }
    });
    const scrollActivitiesToOldest = newComponent(Button, {
        label: "Oldest",
        onClick: () => {
            state._currentlyViewingActivityIdx = getOldestIdx();
            rerenderApp();
        }
    });
    const prevActivity = newComponent(Button);
    prevActivity.render({
        label: "->",
        onClick() {
            const idx = getPrevIdx();
            if (idx !== -1) {
                state._currentlyViewingActivityIdx = idx;
                rerenderApp();
            }
        }
    });
    const nextActivity = newComponent(Button, {
        label: "<-",
        onClick() {
            const idx = getNextIdx();
            if (idx !== -1) {
                state._currentlyViewingActivityIdx = idx;
                rerenderApp();
            }
        }
    });

    function handleLockUnlockActivitiesToNote() {
        toggleActivityScopedNote(state);
        rerenderApp();
    }

    const activityList = newComponent(EditableActivityList);
    const breakInput = newComponent(BreakInput);
    const root = div({ class: [cn.flex1, cn.col] }, [
        div({ class: [cn.flex, cn.row, cn.alignItemsCenter], style: "user-select: none; padding-left: 10px;" }, [
            el("H3", { style: "margin: 0; padding: 1em 0;", }, [
                rg.text(() => {
                    const note = getNoteOrUndefined(state, state._currentActivityScopedNoteId);
                    if (!note) {
                        return "Activity List";
                    }

                    return "Scope: " + truncate(getNoteTextWithoutPriority(note.data), 50);
                }),
            ]),
        ]),
        div({ class: [cn.row] }, [
            rg.c(Button, c => c.render({
                label: state._currentActivityScopedNoteId !== -1 ? "Unlock" : "Lock to selected",
                onClick: handleLockUnlockActivitiesToNote,
            })),
            div({ class: [cn.flex1] }),
            scrollActivitiesToTop,
            scrollActivitiesToMostRecent,
            scrollActivitiesToOldest,
            div({ style: "width: 10px" }),
            // Typically the <- arrow means to go back, but here it feels counter intuitive as
            // we're going up a list and -> feels more correct, like we're going backwards through the activity list.
            // Prob because -> is analogous with going down and <- is analogous with going up. 
            div({ style: "width: 50px" }, [nextActivity]),
            div({ style: "width: 50px" }, [prevActivity]),
        ]),
        div({ style: `border-bottom: 1px solid ${cssVars.bgColorFocus2}` }),
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

    function getOldestIdx() {
        return findNextActiviyIndex(state, state.currentNoteId, 0);
    }

    rg.preRenderFn(function renderActivityListContainer(s) {
        breakInput.render(null);

        if (s.docked) {
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
        setVisible(scrollActivitiesToOldest, state._currentlyViewingActivityIdx !== getOldestIdx());
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
        return div({ class: [cn.row] }, [
            div({ style: "width: 500px; padding-right: 50px;" }, [keymap]),
            div({ class: [cn.flex1] }, [desc]),
        ])
    }

    const root = div({ style: "padding: 10px" }, [
        el("H3", {}, ["Note tree " + VERSION_NUMBER + " Cheatsheet"]),
        el("H4", {}, ["Offline use"]),
        isRunningFromFile() ? (
            div({}, [
                "The 'Download this page!' button is gone, now that you've downloaded the page!",
                `You should also make it a habit to download your save-file very week or so, since browsers can stop working all of a sudden for various reasons (mostly from new updates every now and then)`,
                ` The same is true if I or my hosting provider decided to change the URL of this page - not something you need to worry about anymore, now that you've downloaded this page.`,
            ])
        ) : (
            div({}, [
                div({ class: [cn.row, cn.alignItemsCenter], style: "gap: 30px" }, [
                    ` This web page can be saved to your computer and ran offline!`,
                    makeDownloadThisPageButton(),
                ]),
                `You will need to download your save file here (Export -> Download JSON) and load the save file there (Load JSON) if you've already been using it online for a while.`,
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
        const siblings = getNote(state, currentNote.parentId).childIds;
        const currentIdx = siblings.indexOf(currentNote.id);
        if (siblings[currentIdx - 1] === lastNoteId || siblings[currentIdx + 1] === lastNoteId) {
            return false;
        }
    }

    setCurrentNote(state, lastNoteId);

    return true;
}

function moveInDirectonOverHotlist(backwards: boolean): boolean {
    if (backwards) {
        // NOTE: there is currently no UI that says that we will go back to the previous note :(
        if (moveToLastNote()) {
            return true;
        }
    }

    if (!isInHotlist) {
        isInHotlist = true;

        state._currentlyViewingActivityIdx = getLastActivityWithNoteIdx(state);
        if (state._currentlyViewingActivityIdx === -1) {
            return true;
        }

        const nId = state.activities[state._currentlyViewingActivityIdx].nId;
        if (state.currentNoteId !== nId) {
            setCurrentNote(state, nId!);
            setIsEditingCurrentNote(state, false);
            return true;
        }
    }

    let nextIdx = state._currentlyViewingActivityIdx;
    nextIdx = getNextHotlistActivityInDirection(state, nextIdx, backwards);

    if (nextIdx < 0 || nextIdx >= state.activities.length) {
        return false;
    }


    const nId = state.activities[nextIdx].nId;
    if (!nId) {
        return false;
    }

    setCurrentNote(state, nId);
    setIsEditingCurrentNote(state, false);
    state._currentlyViewingActivityIdx = nextIdx; // not necesssarily the most recent note

    return true;
}

let lateralMovementStartingNote: NoteId | undefined = undefined;
let isInHotlist = false;
let isInQuicklist = false;

function moveInDirectionOverQuickList(amount: number): boolean {
    if (!isInQuicklist) {
        recomputeFuzzyFinderMatches(state._fuzzyFindState);
        isInQuicklist = true;
    }

    if (state._fuzzyFindState.matches.length === 0) {
        return true;
    }

    const idx = Math.max(0, Math.min(state._fuzzyFindState.matches.length - 1, getQuicklistIndex(state) + amount));
    setQuicklistIndexForMove(idx);
    return true;
}

function setQuicklistIndexForMove(idx: number): boolean {
    if (idx === -1) {
        return false;
    }

    setQuicklistIndex(state, idx);

    // Move to the most recent note in this subtree.
    const note = state._fuzzyFindState.matches[getQuicklistIndex(state)].note;
    const previewNote = getMostRecentlyWorkedOnChildActivityNote(state, note);
    setCurrentNote(state, (previewNote ?? note).id);
    setIsEditingCurrentNote(state, false);

    return true;
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
    if (ctrlPressed) {
        insertChildNote(state);
        return true;
    }

    if (!state._isEditingFocusedNote) {
        setIsEditingCurrentNote(state, true);
        debouncedSave();
        return true;
    }

    // By default, all notes are now multiline. NO messing around with ``` and then using shift+enter or enter depending on 
    // if the note started with ``` or not. Silly. 

    if (shiftPressed) {
        insertNoteAfterCurrent(state);
        return true;
    }

    return false;
}

function HighLevelTaskDurations(rg: RenderGroup) {
    let currentHoverCol = -1;
    let currentFocusCol = -1;
    let hideBreaks = true;
    let over1Min = true;
    type Block = { nId: NoteId | undefined; times: number[]; };
    const hltMap = new Map<string, Block>();
    let hltSorted: [string, Block][] = [];

    function handleColEnter(i: number) {
        if (i >= 7) {
            currentHoverCol = -1;
        } else {
            currentHoverCol = i;
        }

        rg.renderWithCurrentState()
    }

    function handleColClick(i: number) {
        if (i >= 7 || state._currentDateScopeWeekDay === i) {
            state._currentDateScopeWeekDay = -1;
        } else {
            state._currentDateScopeWeekDay = i;
        }

        rerenderApp();
    }

    function newBlock(hltNId: NoteId | undefined): Block {
        if (state._currentDateScope === "week") {
            return {
                nId: hltNId,
                // The 8 is from 7 + 1 - I'm storing the total time this week at the end
                times: newArray(8, () => 0)
            }
        }

        return {
            nId: hltNId,
            // The 8 is from 7 + 1 - I'm storing the total time this week at the end
            times: [0],
        }
    }

    function setScope(scope: CurrentDateScope) {
        state._currentDateScopeWeekDay = -1;
        state._currentDateScope = scope;
        rerenderApp();
    }

    function moveDateWindow(backwards: boolean) {
        state._currentDateScopeWeekDay = -1;
        let numDays = state._currentDateScope === "week" ? 7 : 1;
        if (backwards) {
            numDays = -numDays;
        }

        if (state._activitiesFrom) {
            addDays(state._activitiesFrom, numDays);
        }

        if (state._activitiesTo) {
            addDays(state._activitiesTo, numDays);
        }

        rerenderApp();
    }

    function resetDateWindow() {
        state._currentDateScopeWeekDay = -1;

        if (state._currentDateScope === "week") {
            setActivityRangeToThisWeek(state);
        } else {
            setActivityRangeToToday(state);
        }

        rerenderApp();
    }

    function handleActivitiesToChange(date: Date | null) {
        state._activitiesTo = date;
        rerenderApp();
    }

    function handleActivitiesFromChange(date: Date | null) {
        state._activitiesFrom = date;
        rerenderApp();
    }

    const ONE_MINUTE = 1000 * 60;

    rg.preRenderFn(function renderHighlevelTaskDurations() {
        hltMap.clear();
        currentFocusCol = state._currentDateScopeWeekDay;
        for (let i = state._activitiesFromIdx; i >= 0 && i <= state._activitiesToIdx; i++) {
            const activity = state.activities[i];
            const nextActivity = state.activities[i + 1] as Activity | undefined;
            const durationMs = getActivityDurationMs(activity, nextActivity);

            if (hideBreaks && isBreak(activity)) {
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


            const block = hltMap.get(hltText) ?? newBlock(hltNId);

            const dayOfWeek = getActivityTime(activity).getDay();

            if (state._currentDateScope === "week") {
                block.times[dayOfWeek] += durationMs;
                block.times[7] += durationMs;
            } else {
                block.times[0] += durationMs;
            }

            hltMap.set(hltText, block);
        }

        function getTotalTime(b: Block): number {
            return b.times[b.times.length - 1];
        }

        hltSorted = [...hltMap.entries()]
            .sort((a, b) => getTotalTime(b[1]) - getTotalTime(a[1]));
    });

    return div({ class: [cnApp.sb1b, cn.col, cn.alignItemsCenter], style: "padding: 10px" }, [
        rg.on("click", () => { state._currentDateScopeWeekDay = -1; rerenderApp(); }),
        div({ class: [cn.row], style: "gap: 10px; padding-bottom: 10px" }, [
            div({ class: [cn.row] }, [
                rg.c(Button, c => c.render({
                    label: "<-",
                    onClick: () => moveDateWindow(true),
                })),
                rg.c(Button, c => c.render({
                    label: "->",
                    onClick: () => moveDateWindow(false),
                })),
                span({}, [
                    // Opacity and not conditional rendering here to prevent layout shift when dissapearing and re-appearing.
                    // Funilly enough I can still click on it...
                    rg.style("opacity", () => {
                        let value;
                        if (state._currentDateScope === "week") {
                            const d = new Date();
                            floorDateToWeekLocalTime(d);
                            value = d.getTime() !== state._activitiesFrom?.getTime();
                        } else {
                            const d = new Date();
                            floorDateLocalTime(d);
                            value = d.getTime() !== state._activitiesFrom?.getTime();
                        }

                        return value ? "1" : "0";
                    }),
                    rg.c(Button, c => c.render({
                        label: state._currentDateScope === "week" ? "this week" : "today",
                        onClick: resetDateWindow
                    })),
                ]),
            ]),
            rg.c(DateTimeInput, c => c.render({
                label: "From",
                nullable: true,
                readOnly: state._currentDateScope === "week",
                value: state._activitiesFrom,
                onChange: handleActivitiesFromChange,
            })),
            rg.c(DateTimeInput, c => c.render({
                label: "To",
                nullable: true,
                readOnly: state._currentDateScope === "week",
                value: state._activitiesTo,
                onChange: handleActivitiesToChange,
            })),
            div({ class: [cn.flex1] }),
            rg.c(Button, c => c.render({
                label: "Week",
                onClick: () => state._currentDateScope !== "week" ? setScope("week") : setScope("any"),
                toggled: state._currentDateScope === "week",
            })),
            rg.c(Button, c => c.render({
                label: "Breaks",
                toggled: !hideBreaks,
                onClick: () => { hideBreaks = !hideBreaks; rerenderApp(); }
            })),
            rg.c(Button, c => c.render({
                label: ">1 min",
                toggled: over1Min,
                onClick: () => { over1Min = !over1Min; rerenderApp(); }
            })),
            div({ class: [cn.flex1] }),
        ]),
        rg.list(div(), DayRow, (getNext) => {
            // Only need the header for a week
            if (state._currentDateScope === "week") {
                const date = new Date(state._activitiesFrom!);
                floorDateToWeekLocalTime(date);

                const text: string[] = [];
                for (const weekDay of DAYS_OF_THE_WEEK_ABBREVIATED) {
                    text.push(weekDay + ' ' + date.getDate());
                    addDays(date, 1);
                }
                text.push("Total");

                getNext().render({
                    name: "Tasks",
                    text: text,
                    bold: true,
                    nId: undefined,
                    onColEnter: handleColEnter,
                    onColClick: handleColClick,
                    currentHoverCol,
                    currentFocusCol,
                });
            }

            if (hltMap.size === 0) {
                return;
            }

            let totalTimes;
            if (state._currentDateScope === "week") {
                totalTimes = newArray(8, () => 0);
            } else {
                totalTimes = newArray(1, () => 0);
            }
            for (const [hltName, { times, nId }] of hltSorted) {
                for (let i = 0; i < times.length; i++) {
                    totalTimes[i] += times[i];
                }


                let total = times[times.length - 1];
                if (over1Min && total < ONE_MINUTE) {
                    continue;
                }

                getNext().render({
                    name: hltName,
                    text: times.map(formatDurationAsHours),
                    bold: false,
                    nId,
                    currentHoverCol,
                    currentFocusCol,
                    onColEnter: handleColEnter,
                    onColClick: handleColClick,
                });
            }

            getNext().render({
                name: "Total",
                text: totalTimes.map(formatDurationAsHours),
                bold: false,
                nId: undefined,
                currentHoverCol,
                currentFocusCol,
                onColEnter: handleColEnter,
                onColClick: handleColClick,
            });
        }),
        rg.else(
            () => div({}, ["No tasks to display!"])
        )
    ]);

    function DayRow(rg: RenderGroup<{
        name: string;
        nId: NoteId | undefined;
        text: string[];
        bold: boolean;
        onColEnter?(i: number): void;
        onColClick?(i: number): void;
        currentFocusCol: number;
        currentHoverCol: number;
    }>) {
        return div({ class: [cn.row, cnApp.sb1b] }, [
            rg.on("mouseleave", (s) => s.onColEnter?.(-1)),
            rg.style("backgroundColor", (s) => (state.currentNoteId === s.nId) ? (
                `${cssVars.bgColorFocus}`
            ) : (
                `${cssVars.bgColor}`
            )),
            rg.style("fontWeight", s => s.bold ? "bold" : ""),
            div({ class: [cn.flex1] }, [
                rg.c(NoteLink, (nl, s) => {
                    nl.render({
                        text: s.name,
                        focusAnyway: false,
                        noteId: s.nId,
                        shouldScroll: false,
                    });
                })
            ]),
            div({ style: "min-width: 100px" }),
            rg.list(div({ class: [cn.row] }), TimeItem, (getNext, s) => {
                for (let i = 0; i < s.text.length; i++) {
                    const bgColor = s.currentHoverCol === i ? `${cssVars.bgColorFocus2}` :
                        s.currentFocusCol === i ? `${cssVars.bgColorFocus}` :
                            "";

                    getNext().render({
                        str: s.text[i],
                        i,
                        bgColor,
                        onColEnter: s.onColEnter,
                        onColClick: s.onColClick,
                    });
                }
            })
        ]);

        function TimeItem(rg: RenderGroup<{
            str: string;
            i: number;
            onColEnter?(i: number): void;
            onColClick?(i: number): void;
            bgColor: string;
        }>) {
            return div({ class: [cn.textAlignCenter], style: "width: 10ch" }, [
                rg.style("cursor", (s) => s.onColEnter ? "pointer" : ""),
                rg.style("backgroundColor", s => s.bgColor),
                rg.on("mouseenter", (s) => s.onColEnter?.(s.i)),
                rg.on("click", (s, e) => { e.stopImmediatePropagation(); s.onColClick?.(s.i); }),
                rg.text((s) => s.str),
            ])
        }
    }
}

function HelpModal(rg: RenderGroup<{ open: boolean; }>) {
    const scrollContainer = newComponent(ScrollContainer);

    rg.preRenderFn(s => {
        setVisible(rg.root, s.open);
    });

    return rg.cArgs(Modal, (c) => c.render({
        onClose() {
            setCurrentModalAndRerenderApp(null);
        },
    }), [
        div({ style: modalPaddingStyles(10) }, [
            div({ class: [cn.col, cn.alignItemsStretch, cn.h100] }, [
                el("H3", {}, `Note tree ${VERSION_NUMBER} - help`),
                addChildren(setAttrs(scrollContainer, { scroll: "no" }), [
                    "This program is mainly driven by keyboard shortcuts. ",
                    "There are still a couple buttons you have to click on, but in an ideal world, I would have added keyboard shortcuts for them. ",
                    "This help view is a work in progress"
                ]),
            ])
        ])
    ]);
}

const cnInfoButton = cssb.cn("info-button", [` { 
    display: inline-block;
    text-align: center;
    font-style: italic;
    margin: 10px;
    padding: 10px;
    border-radius: 10px;
}`,
    `:hover { background-color: #AAF; }`,
    `:active { background-color: #00F; color: ${cssVars.bgColor}; }`
]);

// Singleton modals
const helpModal = newComponent(HelpModal);
const scratchPadModal = newComponent(ScratchPadModal);
const interactiveGraphModal = newComponent(InteractiveGraphModal);
const settingsModal = newComponent(SettingsModal);
const fuzzyFindModal = newComponent(FuzzyFindModal);
const deleteModal = newComponent(DeleteModal);
const loadBackupModal = newComponent(LoadBackupModal);
const linkNavModal = newComponent(LinkNavModal);
const exportModal = newComponent(ExportModal);
const addRemoveToStreamModal = newComponent(AddToStreamModal);


// NOTE: We should only ever have one of these ever.
// Also, there is code here that relies on the fact that
// setInterval in a webworker won't run when a computer goes to sleep, or a tab is closed, and
// auto-inserts a break. This might break automated tests, if we ever
// decide to start using those
export function App(rg: RenderGroup) {
    let t0 = 0;
    rg.preRenderFn(() => {
        t0 = performance.now();
    });

    rg.postRenderFn(() => {
        lastRenderTimes[lastRenderTimesPos] = performance.now() - t0;
        lastRenderTimesPos++;
        if (lastRenderTimesPos >= lastRenderTimes.length) {
            lastRenderTimesPos = 0;
        }
    });

    const cheatSheetButton = el("BUTTON", { class: [cnInfoButton], title: "click for a list of keyboard shortcuts and functionality" }, [
        div({}, "Note tree " + VERSION_NUMBER),
        div({}, "cheatsheet"),
    ]);

    let currentHelpInfo = 1;
    cheatSheetButton.el.addEventListener("click", () => {
        currentHelpInfo = currentHelpInfo !== 2 ? 2 : 0;
        rerenderApp();
    });

    const notesList = newComponent(NotesList);
    const todoList = newComponent(QuickList);
    const rightPanelArea = div({ style: "width: 30%", class: [cn.col, cnApp.sb1l] });
    const bottomLeftArea = div({ class: [cn.flex1, cn.col], style: "padding: 0" });
    const bottomRightArea = div({ class: [cn.flex1, cn.col, cnApp.sb1l], style: "padding: 0" })

    const activityListContainer = newComponent(ActivityListContainer);
    const todoListContainer = div({ class: [cn.flex1, cn.col] }, [
        todoList
    ]);


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
    const quicklistButton = newComponent(Button);
    quicklistButton.render({
        label: "Quicklist",
        onClick: () => {
            toggleCurrentDockedMenu("quicklist");
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
    const bottomButtons = div({ class: [cn.row, cn.alignItemsStretch, cnApp.sb1t] }, [
        div({ class: [cn.row, cn.alignItemsEnd] }, [
            rg.c(Button, c => c.render({
                label: "Scratch Pad",
                onClick: () => {
                    setCurrentModalAndRerenderApp(scratchPadModal);
                }
            })),
        ]),
        div({ class: [cn.row, cn.alignItemsEnd] }, [
            rg.c(Button, c => c.render({
                label: "Graph",
                onClick: () => {
                    setCurrentModalAndRerenderApp(interactiveGraphModal);
                }
            }))
        ]),
        div({ class: [cn.flex1, cn.row, cn.alignItemsCenter, cn.justifyContentCenter] }, [
            statusTextIndicator,
        ]),
        div({ class: [cn.row] }, [
            isRunningFromFile() ? (
                div()
            ) : (
                makeDownloadThisPageButton()
            ),
            rg.c(Button, c => c.render({
                label: "Delete current",
                onClick: () => {
                    setCurrentModalAndRerenderApp(deleteModal);
                }
            })),
            rg.c(Button, c => c.render({
                label: "Settings",
                onClick: () => {
                    setCurrentModalAndRerenderApp(settingsModal);
                }
            })),
            quicklistButton,
            activitiesButton,
            durationsButton,
            rg.c(Button, c => c.render({
                label: "Search",
                onClick: () => {
                    setCurrentModalAndRerenderApp(fuzzyFindModal);
                }
            })),
            rg.c(Button, c => c.render({
                label: "Export",
                onClick: () => {
                    handleErrors(() => {
                        setCurrentModalAndRerenderApp(exportModal);
                    });
                }
            })),
            rg.c(Button, c => c.render({
                label: "Load JSON",
                onClick: () => {
                    loadFile((file) => {
                        if (!file) {
                            return;
                        }

                        file.text().then((text) => {
                            backupFilename = file.name;
                            backupText = text;
                            setCurrentModalAndRerenderApp(loadBackupModal);
                        });
                    });
                }
            })),
        ])
    ]);

    const errorBanner = rg.if(() => !!state.criticalSavingError || !!state._criticalLoadingError, rg =>
        div({ style: "padding: 20px; background-color: red; color: white; position: sticky; top: 0" }, [
            rg.if(() => !!state.criticalSavingError, rg =>
                rg.text(() => "Saving state failed: " + state.criticalSavingError),
            ),
            rg.else_if(() => !!state._criticalLoadingError, rg =>
                div({}, [
                    div({}, [
                        rg.text(() => "Loading save state failed: " + state._criticalLoadingError),
                    ]),
                    div({}, [
                        "Saving will be disabled till this issue gets fixed on our end - you'll need to report it.",
                    ]),
                ]),
            ),
            div({}, [
                "Report issues here: ",
                el("A", {
                    class: [cnHoverLink],
                    style: `color: currentColor;`,
                    href: GITHUB_PAGE_ISSUES,
                }, [GITHUB_PAGE_ISSUES]),
            ])
        ])
    );
    const notesScrollRoot = div({ class: [cn.col, cn.flex1, cn.overflowYAuto] });

    const appRoot = div({ class: [cn.relative], style: "padding-bottom: 100px" }, [
        div({ class: [cn.col], style: "position: fixed; top: 0; bottom: 0px; left: 0; right: 0;" }, [
            div({ class: [cn.row, cn.flex1] }, [
                addChildren(notesScrollRoot, [
                    rg.if(
                        () => currentHelpInfo === 2,
                        (rg) => rg.c(CheatSheet, c => c.render(null))
                    ),
                    div({ class: [cn.row, cn.alignItemsCenter], style: "padding: 10px;" }, [
                        div({ class: [cn.flex1] }, [
                            el("H2", {}, [
                                rg.text(() => currentAppHeader),
                            ]),
                        ]),
                        cheatSheetButton,
                        rg.c(DarkModeToggle, c => c.render(null)),
                    ]),
                    errorBanner,
                    div({ class: [cn.row] }, [
                        notesList,
                    ]),
                    rg.if(() => state._isShowingDurations,
                        (rg) => rg.c(HighLevelTaskDurations, c => c.render(null))
                    ),
                    div({ class: [cn.row], style: "" }, [
                        bottomLeftArea,
                        bottomRightArea,
                    ]),
                ]),
                rightPanelArea,
            ]),
            bottomButtons,
        ]),
        helpModal,
        scratchPadModal,
        interactiveGraphModal,
        fuzzyFindModal,
        settingsModal,
        deleteModal,
        loadBackupModal,
        linkNavModal,
        exportModal,
        addRemoveToStreamModal,
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
            isInQuicklist
        ) {
            isInQuicklist = false;
            state._lastNoteId = lateralMovementStartingNote;
            rerenderApp();
        }
    });


    document.addEventListener("keydown", (e) => {
        if (e.key === "F1") {
            if (state._currentModal !== helpModal) {
                setCurrentModalAndRerenderApp(helpModal);
            } else {
                setCurrentModalAndRerenderApp(null);
            }
            return;
        }


        // returns true if we need a rerender
        const ctrlPressed = e.ctrlKey || e.metaKey;
        const shiftPressed = e.shiftKey;
        const currentNote = getCurrentNote(state);

        if (state._currentModal !== null) {
            if (e.key === "Escape") {
                // Somewhat hacky to make this kind of carve out for specific modals but not a big deal for now
                if (
                    state._currentModal !== interactiveGraphModal
                ) {
                    e.preventDefault();
                    setCurrentModalAndRerenderApp(null);
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
            isInQuicklist = false;
            lateralMovementStartingNote = state.currentNoteId;
        }

        // handle modals or gloabl key shortcuts
        if (e.key === "Delete") {
            e.preventDefault();
            setCurrentModalAndRerenderApp(deleteModal);
            return;
        } else if (
            e.key === "F" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            setCurrentModalAndRerenderApp(fuzzyFindModal);
            return;
        } else if (
            e.key === "S" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            setCurrentModalAndRerenderApp(scratchPadModal);
            return;
        } else if (
            e.key === "G" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            setCurrentModalAndRerenderApp(interactiveGraphModal);
            return;
        } else if (
            e.key === "L" &&
            ctrlPressed &&
            shiftPressed
        ) {
            e.preventDefault();
            toggleActivityScopedNote(state);
            rerenderApp();
            return;
        } else if (
            e.key === "," &&
            ctrlPressed
        ) {
            e.preventDefault();
            setCurrentModalAndRerenderApp(settingsModal);
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
                setCurrentDockedMenu("quicklist")
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
            setCurrentModalAndRerenderApp(linkNavModal);
            return;
        } else if (handleAddOrRemoveToStream(e)) {
            setCurrentModalAndRerenderApp(addRemoveToStreamModal);
            return;
        }

        const isEditingSomeText = isEditingTextSomewhereInDocument();

        let shouldPreventDefault = true;
        let handled = false;
        let noteIdBeforeKeyboardInput = state.currentNoteId;
        if (
            !state._isEditingFocusedNote &&
            !isEditingSomeText &&
            state._currentModal === null
        ) {
            // handle movements here

            function handleUpDownMovement(up: boolean, ctrlKey: boolean, amount = 1, end: boolean, home: boolean): boolean {
                const isMovingNode = e.altKey;

                const useSiblings = true;
                let nextNoteId;
                if (end) {
                    nextNoteId = currentNote.childIds[currentNote.childIds.length - 1];
                } else if (home) {
                    nextNoteId = currentNote.childIds[0];
                } else if (ctrlKey) {
                    if (up) {
                        nextNoteId = getNoteOneUpLocally(state, currentNote);
                    } else {
                        nextNoteId = getNoteOneDownLocally(state, currentNote);
                    }
                } else {
                    if (up) {
                        nextNoteId = getNoteNUpForMovement(state, currentNote, useSiblings, amount)
                    } else {
                        nextNoteId = getNoteNDownForMovement(state, currentNote, useSiblings, amount);
                    }
                }

                const nextNote = getNoteOrUndefined(state, nextNoteId);
                if (!nextNote) {
                    return false;
                }

                if (!isMovingNode) {
                    setCurrentNote(state, nextNote.id);
                    debouncedSave();
                    return true;
                }

                if (
                    currentNote.parentId !== -1 &&
                    currentNote.parentId === nextNote.parentId
                ) {
                    const parent = getNote(state, currentNote.parentId);
                    const siblings = parent.childIds;
                    const idxNext = siblings.indexOf(nextNote.id);
                    tree.insertAt(state.notes, parent, currentNote, idxNext);
                    debouncedSave();

                    return true;
                }

                return false;
            }

            function handleMovingOut(nextNoteId: NoteId): boolean {
                if (idIsNilOrRoot(nextNoteId)) {
                    return false;
                }

                if (!e.altKey) {
                    setCurrentNote(state, nextNoteId);
                    return true;
                }

                const nextNote = getNote(state, nextNoteId);
                tree.addAfter(state.notes, nextNote, currentNote);
                debouncedSave();
                return true;
            }

            function handleMovingIn(): boolean {
                if (!e.altKey) {
                    // move into the current note
                    const lastSelected = getLastSelectedNote(state, currentNote);
                    setCurrentNote(state, lastSelected ? lastSelected.id : null);
                    debouncedSave();
                    return true;
                }

                if (idIsNil(currentNote.parentId)) {
                    return false;
                }

                // move this note into the note above it
                const siblings = getNote(state, currentNote.parentId).childIds;
                const idx = siblings.indexOf(currentNote.id);
                if (idx === 0) {
                    return false;
                }

                const upperNote = getNote(state, siblings[idx - 1]);
                if (upperNote.childIds.length === 0) {
                    tree.addUnder(state.notes, upperNote, currentNote);
                    debouncedSave();
                    return true;
                }

                const noteInsideUpperNote = getLastSelectedNote(state, upperNote);
                if (noteInsideUpperNote) {
                    tree.addAfter(state.notes, noteInsideUpperNote, currentNote)
                    debouncedSave();
                    return true;
                }

                return false;
            }

            if (e.key === "Enter" && !isEditingSomeText && handleEnterPress(ctrlPressed, shiftPressed)) {
                handled = true;
            } else if (e.key === "ArrowDown") {
                if (ctrlPressed && shiftPressed) {
                    shouldPreventDefault = true;
                    handled = moveInDirectionOverQuickList(1);
                } else if (ctrlPressed) {
                    handled = handleUpDownMovement(false, true, 1, false, false);
                } else {
                    handled = handleUpDownMovement(false, false, 1, false, false);
                }
            } else if (e.key === "ArrowUp") {
                if (ctrlPressed && shiftPressed) {
                    shouldPreventDefault = true;
                    handled = moveInDirectionOverQuickList(-1);
                } else if (ctrlPressed) {
                    handled = handleUpDownMovement(true, true, 1, false, false);
                } else {
                    handled = handleUpDownMovement(true, false, 1, false, false);
                }
            } else if (e.key === "PageUp") {
                shouldPreventDefault = true;
                handled = handleUpDownMovement(true, false, 10, false, false);
            } else if (!idIsNil(currentNote.parentId) && e.key === "PageDown") {
                shouldPreventDefault = true;
                handled = handleUpDownMovement(false, false, 10, false, false);
            } else if (!idIsNil(currentNote.parentId) && e.key === "End") {
                if (
                    isInQuicklist &&
                    e.ctrlKey &&
                    e.shiftKey
                ) {
                    handled = setQuicklistIndexForMove(state._fuzzyFindState.matches.length - 1);
                } else {
                    handled = handleUpDownMovement(true, false, 0, true, false);
                }
            } else if (!idIsNil(currentNote.parentId) && e.key === "Home") {
                if (
                    isInQuicklist &&
                    e.ctrlKey &&
                    e.shiftKey
                ) {
                    handled = setQuicklistIndexForMove(0);
                } else {
                    handled = handleUpDownMovement(true, false, 0, false, true);
                }
            } else if (e.key === "ArrowLeft") {
                // The browser can't detect ctrl when it's pressed on its own :((((  (well like this anyway)
                // Otherwise I would have liked for this to just be ctrl
                if (ctrlPressed && shiftPressed) {
                    shouldPreventDefault = true;
                    handled = moveInDirectonOverHotlist(true);
                } else {
                    handled = handleMovingOut(currentNote.parentId)
                }
            } else if (e.key === "ArrowRight") {
                if (ctrlPressed && shiftPressed) {
                    shouldPreventDefault = true;
                    handled = moveInDirectonOverHotlist(false);
                } else {
                    // move into note
                    handled = handleMovingIn();
                }
            } 
        } else if (e.key === "Escape") {
            if (isEditingSomeText) {
                setIsEditingCurrentNote(state, false);
                handled = true;
            } else {
                setCurrentModal(null);
                handled = true;
            }
        } 

        if (handled) {
            if (shouldPreventDefault) {
                e.preventDefault();
            }

            if (noteIdBeforeKeyboardInput !== state.currentNoteId) {
                renderSettings.shouldScroll = true;
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

    // Legacy code do be like this sometimes ...
    rg.preRenderFn(function rerenderAppComponent() {
        recomputeState(state);

        // recompute the app title
        {
            const currentNote = getCurrentNote(state);
            const hlt = getHigherLevelTask(state, currentNote);
            if (!hlt) {
                setAppHeader("Currently working on");
            } else {
                const text = "Current task: " + getNoteTextWithoutPriority(hlt.data);
                setAppHeader(text);
            }
        }

        // render modals
        {
            if (setVisible(loadBackupModal, state._currentModal === loadBackupModal)) {
                loadBackupModal.render({
                    text: backupText,
                    fileName: backupFilename,
                });
            } else {
                backupText = "";
            }

            if (setVisible(linkNavModal, state._currentModal === linkNavModal)) {
                linkNavModal.render(null);
            }

            fuzzyFindModal.render({ visible: state._currentModal === fuzzyFindModal });

            if (setVisible(settingsModal, state._currentModal === settingsModal)) {
                settingsModal.render(null);
            }

            if (setVisible(deleteModal, state._currentModal === deleteModal)) {
                deleteModal.render(null);
            }

            if (setVisible(exportModal, state._currentModal === exportModal)) {
                exportModal.render(null);
            }

            scratchPadModal.render({
                open: state._currentModal === scratchPadModal
            });

            helpModal.render({
                open: state._currentModal === helpModal
            });

            addRemoveToStreamModal.render({
                visible: state._currentModal === addRemoveToStreamModal,
            });

            if (setVisible(interactiveGraphModal, state._currentModal === interactiveGraphModal)) {
                interactiveGraphModal.render(null)
            }
        }

        // Rerender interactive components _after_ recomputing the state above

        setClass(durationsButton, "inverted", state._isShowingDurations);
        setClass(quicklistButton, "inverted", state.dockedMenu === "quicklist" && state.showDockedMenu);
        setClass(activitiesButton, "inverted", state.dockedMenu === "activities" && state.showDockedMenu);

        let currentDockedMenu: DockableMenu | null = state.dockedMenu;

        if (isInHotlist) {
            currentDockedMenu = "activities";
        } else if (isInQuicklist) {
            currentDockedMenu = "quicklist";
        } else if (!state.showDockedMenu) {
            currentDockedMenu = null;
        }

        // Render the list after rendering the right dock, so that the sticky offsets have the correct heights.
        // The right panel can cause lines to wrap when they otherwise wouldn't have, resulting in incorrect heights
        notesList.render({
            flatNoteIds: state._flatNoteIds,
            scrollParentOverride: notesScrollRoot.el,
            currentNoteId: state.currentNoteId,
            hasFocus: state._currentModal === null,
            ratio: 2,
            alwaysMultipleLines: false,
            enableSticky: true,
        });


        let hasActivities = false;
        if (setVisible(rightPanelArea, currentDockedMenu === "activities")) {
            // Render activities in the side panel
            setVisible(bottomRightArea, false);
            appendChild(rightPanelArea, activityListContainer);
            activityListContainer.render({ docked: true });
            hasActivities = true;
        } else {
            // Render activities in their normal spot
            setVisible(bottomRightArea, true);
            appendChild(bottomRightArea, activityListContainer);
            activityListContainer.render({ docked: false });
        }

        if (!hasActivities && setVisible(rightPanelArea, currentDockedMenu === "quicklist")) {
            // Render todo list in the right panel
            setVisible(bottomLeftArea, false);
            appendChild(rightPanelArea, todoListContainer);
        } else {
            // Render todo list in their normal spot
            setVisible(bottomLeftArea, true);
            appendChild(bottomLeftArea, todoListContainer);
        }
        todoList.render({
            cursorNoteId: state._fuzzyFindState.matches[getQuicklistIndex(state)]?.note?.id,
        });

        // doing it at the end so that we can bypass the save notification.
        // NOTE: Super scuffed, but it's good enough for now
        if (state._showStatusText) {
            state._showStatusText = false;
            setTimeout(() => {
                showStatusText(state._statusText, state._statusTextColor);
            }, 1);
        }
    });

    return appRoot;
};


let statusTextClearTimeout = 0;
let statusText = "";
let statusTextColor = "";
function StatusIndicator(rg: RenderGroup) {
    return div({ class: [cn.preWrap], style: `background-color: ${cssVars.bgColor}` }, [
        rg.realtime(
            rg => rg.text(() => {
                if (statusText) {
                    return statusText;
                }

                const now = new Date();
                const useColon = now.getTime() % 1000 < 500;    // top notch animation

                return formatDateTime(new Date(), useColon ? ":" : " ") + " - [Press F1 for help]";
            })
        ),
        rg.style("color", () => statusTextColor),
    ]);
}
const statusTextIndicator = newComponent(StatusIndicator, null);

const showStatusText = (text: string, color: string = cssVars.fgColor, timeout: number = STATUS_TEXT_PERSIST_TIME) => {
    if (statusTextClearTimeout) {
        clearTimeout(statusTextClearTimeout);
    }

    statusText = text;
    statusTextColor = color;
    statusTextIndicator.renderWithCurrentState();

    const timeoutAmount = timeout;
    if (timeoutAmount > 0) {
        statusTextClearTimeout = setTimeout(() => {
            statusText = "";
            statusTextColor = cssVars.fgColor;
            rerenderApp();
        }, timeoutAmount);
    }
};

let saveTimeout = 0;
const saveCurrentState = ({ debounced } = { debounced: false }) => {
    // user can switch to a different note mid-debounce, so we need to save
    // these here before the debounce

    const thisState = state;

    const save = () => {
        if (state !== thisState) {
            logTrace("The state changed unexpectedly! let's not save...");
            return;
        }

        // We need to apply the current scratch pad state to the current note just before we save, so that we don't lose what
        // we were working on in the scratchpad.
        applyPendingScratchpadWrites(thisState);

        // save current note
        saveState(thisState, (serialized) => {
            // notification

            // JavaScript strings are UTF-16 encoded
            const bytes = utf8ByteLength(serialized);
            const mb = bytesToMegabytes(bytes);

            // in case the storage.estimate().then never happens, lets just show something.
            showStatusText(`Saved (` + mb.toFixed(2) + `mb)`, `${cssVars.fgColor}`, SAVE_DEBOUNCE);

            // A shame we need to do this :(
            navigator.storage.estimate().then((data) => {
                state.criticalSavingError = "";

                const estimatedMbUsage = bytesToMegabytes(data.usage ?? 0);
                if (estimatedMbUsage < 100) {
                    // don't bother showing this warning if we're using way less than 100 mb. it will
                    // cause unnecessary panic. We're more concerned about when it starts taking up 15gb and
                    // then locking up/freezing/crashing the site.
                    return;
                }

                showStatusText(`Saved (` + mb.toFixed(2) + `mb / ` + estimatedMbUsage.toFixed(2) + `mb)`, `${cssVars.fgColor}`, SAVE_DEBOUNCE);

                const baseErrorMessage = "WARNING: Your browser is consuming SIGNIFICANTLY more disk space on this site than what should be required: " +
                    estimatedMbUsage.toFixed(2) + "mb being used instead of an expected " + (mb * 2).toFixed(2) + "mb.";

                const COMPACTION_THRESHOLD = 20;
                const CRITICAL_ERROR_THRESHOLD = 40;

                if (mb * COMPACTION_THRESHOLD < estimatedMbUsage) {
                    console.warn(baseErrorMessage);
                }

                if (mb * CRITICAL_ERROR_THRESHOLD < estimatedMbUsage) {
                    const criticalSavingError = baseErrorMessage + " You should start backing up your data ever day, and anticipate a crash of some sort. Also consider using this website in another browser. This bug should be reported as a github issue on " + GITHUB_PAGE

                    state.criticalSavingError = criticalSavingError;
                    console.error(criticalSavingError);
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

    showStatusText(`Saving...`, `${cssVars.fgColor}`, -1);
    saveTimeout = setTimeout(() => {
        save();
    }, SAVE_DEBOUNCE);
};

const debouncedSave = () => {
    saveCurrentState({
        debounced: true
    });
};

let currentAppHeader = "Currently working on";
function setAppHeader(newHeader: string) {
    currentAppHeader = newHeader;
}

const root = newInsertable(document.body);
initializeDomUtils(root);
const app = newComponent(App);
appendChild(root, app);

const renderSettings = {
    shouldScroll: false,
};

function rerenderApp() {
    app.render(null);

    renderSettings.shouldScroll = false;
}

let renderNextFrameTimeout = 0;
function rerenderAppNextFrame() {
    clearTimeout(renderNextFrameTimeout);
    renderNextFrameTimeout = setTimeout(rerenderApp, 1);
}

initState(() => {
    autoInsertBreakIfRequired();
    rerenderApp();
});
