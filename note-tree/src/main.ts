import { AsciiCanvas, getLayersString, newCanvasState, resetCanvas } from "src/canvas";
import { Button, Checkbox, DateTimeInput, Modal, PaginationControl, ScrollContainer } from "src/components";
import { ASCII_MOON_STARS, ASCII_SUN, AsciiIconData } from "src/icons";
import { countOccurances, newArray } from "src/utils/array-utils";
import { copyToClipboard } from "src/utils/clipboard";
import { DAYS_OF_THE_WEEK_ABBREVIATED, addDays, floorDateLocalTime, floorDateToWeekLocalTime, formatDate, formatDuration, formatDurationAsHours, getTimestamp, parseDateSafe, truncate } from "src/utils/datetime";
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
import { InteractiveGraph } from "./interactive-graph";
import {
    Activity,
    AppTheme,
    CurrentDateScope,
    DockableMenu,
    FuzzyFindState,
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
    fuzzySearchNotes,
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
    getNoteNDownForMovement,
    getNoteNUpForMovement,
    getNoteOneDownLocally,
    getNoteOneUpLocally,
    getNoteOrUndefined,
    getNoteTextTruncated,
    getNoteTextWithoutPriority,
    getParentNoteWithEstimate,
    getQuicklistIndex,
    getRootNote,
    getSecondPartOfRow,
    hasNote,
    idIsNil,
    idIsNilOrRoot,
    idIsNilOrUndefined,
    insertChildNote,
    insertNoteAfterCurrent,
    isBreak,
    isCurrentlyTakingABreak,
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
    toggleActivityScopedNote,
    toggleNoteSticky
} from "./state";
import { cnApp, cssVars } from "./styling";
import { assert } from "./utils/assert";

const SAVE_DEBOUNCE = 1500;
const ERROR_TIMEOUT_TIME = 5000;

// Doesn't really follow any convention. I bump it up by however big I feel the change I made was.
// This will need to change if this number ever starts mattering more than "Is the one I have now the same as latest?"
// 'X' will also denote an unstable/experimental build. I never push anything up if I think it will break things, but still
const VERSION_NUMBER = "1.01.01";

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
        rg.on("click", ({ noteId }, e) => {
            e.stopImmediatePropagation();

            // setTimeout here because of a funny bug when clicking on a list of note links that gets inserted into 
            // while we are clicking will cause the click event to be called on both of those links. Only in HTML is
            // something like this allowed to happen. LOL.
            setTimeout(() => {
                if (!idIsNilOrUndefined(noteId)) {
                    setCurrentNote(state, noteId);
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
        rg.if(
            (s) => s.isCursorVisible,
            () => div({ style: "min-width: 5px;" }, [
                rg.style("backgroundColor", (s) => {
                    return s.isCursorActive ? `${cssVars.fgColor}` : cssVars.bgColorFocus2
                }),
            ])
        ),
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
        "If the query is empty, notes that have been pinned will appear here instead.",
    ]);
    const scrollContainer = newComponent(ScrollContainer);
    const root = div({ class: [cn.flex1, cn.col] }, [
        el("H3", { style: "user-select: none; padding-left: 10px; text-align: center;" }, [
            rg.text(() => {
                let query = "";
                if (state._fuzzyFindState.query) {
                    query = `"${state._fuzzyFindState.query}"`;
                } else {
                    query = "Pinned notes"
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
                rg.text(() => formatDate(new Date(), undefined, true, true))
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
        "INPUT", { class: [cn.preWrap, cn.w100, cnApp.solidBorderSmRounded ], style: "padding-left: 5px" }
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
            rg.c(Button, c => c.render({
                label: "Copy open notes",
                onClick: () => {
                    handleErrors(() => {
                        const flatNotes: NoteId[] = [];
                        const currentNote = getCurrentNote(state);
                        recomputeFlatNotes(state, flatNotes, currentNote, true);

                        copyToClipboard(exportAsText(state, flatNotes));
                        showStatusText("Copied current open notes as text");
                    });
                }
            })),
            rg.c(Button, c => c.render({
                label: "Download JSON",
                onClick: () => {
                    handleErrors(() => {
                        saveText(getCurrentStateAsJSON(), `Note-Tree Backup - ${formatDate(new Date(), "-")}.json`);
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
    const cantDelete = div({}, ["Can't delete notes that are still in progress..."]);
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
                    setCurrentNote(state, noteId, true);
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
    counts.numPinned = 0;
    for (const match of matches) {
        if (match.note.data._status === STATUS_IN_PROGRESS) {
            counts.numInProgress++;
        } else {
            counts.numFinished++;
        }

        if (match.note.data._shelved) {
            counts.numShelved++;
        }

        if (match.note.data.isSticky) {
            counts.numPinned++;
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
}>) {
    function FuzzyFinderResultItem(rg: RenderGroup<{
        note: TreeNote;
        ranges: Range[];
        hasFocus: boolean;
        compact: boolean;
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
                rg.if(
                    s => !!s.note.data.isSticky,
                    () => div({
                        class: [cn.row, cn.alignItemsCenter, cn.pre],
                        style: `background-color: ${cssVars.pinned}; color: #FFF`
                    }, [" ! "]),
                ),
                rg.c(NoteRowDurationInfo, (c, s) => c.render({ note: s.note })),
            ]),
            rg.if(s => s.hasFocus, rg =>
                rg.with(s => {
                    const lastSelectedNote = getLastSelectedNote(state, s.note);
                    if (lastSelectedNote) {
                        return [s, lastSelectedNote] as const;
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
                isCursorActive: true,
            });

            if (hasFocus) {
                const scrollParent = root.el.parentElement!;
                scrollIntoView(scrollParent, root, 0.5);
            }
        });

        return root;
    };

    const resultList = newListRenderer(div({ class: [cn.h100, cn.overflowYAuto] }), () => newComponent(FuzzyFinderResultItem));

    rg.preRenderFn(({ finderState, compact }) => {
        resultList.render((getNext) => {
            for (let i = 0; i < finderState.matches.length; i++) {
                const m = finderState.matches[i];
                getNext().render({
                    note: m.note,
                    ranges: m.ranges,
                    hasFocus: i === finderState.currentIdx,
                    compact
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
                s.state.counts.numShelved + " shelved, " + 
                s.state.counts.numPinned + " pinned"),
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
                finderState.scopedToNoteId = state.currentNoteId;
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
            const lastSelectedChild = getLastSelectedNote(state, note);
            setCurrentNote(state, (lastSelectedChild ?? note).id, true);
            setCurrentModalAndRerenderApp(null);
            rerenderApp();
            return;
        } else if (note && handleToggleNoteSticky(e, note)) {
            // no need to re-sort the results. better if we don't actually
            rerenderApp();
            return;
        }

        let handled = true;

        // NOTE: no home, end, we need that for the search input
        if (e.key === "ArrowDown") {
            finderState.currentIdx++;
        } else if (e.key === "PageDown") {
            finderState.currentIdx += 10;
        } else if (e.key === "ArrowUp") {
            finderState.currentIdx--;
        } else if (e.key === "PageUp") {
            finderState.currentIdx -= 10;
        } else if (
            (e.ctrlKey || e.metaKey)
            && e.shiftKey
            && e.key === "F"
        ) {
            matchesInvalid = true;
            toggleCurrentNoteVsEverywhere = true;
        } else {
            handled = false;
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

function modalPaddingStyles(paddingPx: number = 0, width = 94, height = 90) {
    return `width: ${width}vw; height: ${height}vh; padding: ${paddingPx}px`;
}

function handleToggleNoteSticky(e: KeyboardEvent, note: TreeNote): boolean {
    const shiftPressed = e.shiftKey;
    const ctrlPressed = e.ctrlKey || e.metaKey;
    if (
        ctrlPressed &&
        shiftPressed &&
        (e.key === "1" || e.key === "!")
    ) {
        toggleNoteSticky(note);
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

                setStateFromJSON(text,  () => {
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

    return rg.cArgs(Modal, c => c.render({ onClose }), [
        div({ class: [cn.col], style: "align-items: stretch; padding: 10px;" }, [
            div({ class: [cn.col, cnApp.gap10] }, [ 
                div({ class: [cnApp.solidBorderSmRounded], style: "padding: 10px; " }, [
                    el("H3", { class: [cn.textAlignCenter] }, "Settings"),
                    rg.c(Checkbox, (c) => c.render({
                        label: "Force notes that aren't being edited to be a single line",
                        value: state.settings.nonEditingNotesOnOneLine,
                        onChange(val) {
                            state.settings.nonEditingNotesOnOneLine = val;
                            rerenderApp();
                        }
                    })),
                    rg.if(() => !state.settings.nonEditingNotesOnOneLine, rg =>
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
                    ),
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
                        div({ class: [cn.row]}, [
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

            const note = getCurrentNote(state);
            asciiCanvas.render({ 
                canvasState,
                outputLayers: state.scratchPadCanvasLayers,
                onInput() { },
                onWrite() {
                    debouncedSave();
                }
            });

            // needs to happen after we render the canvas, since we will be swapping out the output buffer
            resetCanvas(canvasState, false, note.data.text);
            asciiCanvas.renderWithCurrentState();
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
                rerenderAppNextFrame();
            }
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
    stickyOffset?: number;

    _isSticky: boolean;

    hasDivider: boolean;
    hasLightDivider: boolean;
    scrollParent: HTMLElement | null;
    currentNote: TreeNote;
    listHasFocus: boolean;
    forceOneLine: boolean;

    orignalOffsetTop: number;
    visualDepth?: number;
};

function NoteRowInput(rg: RenderGroup<NoteRowInputArgs>) {
    const INDENT1 = 3;
    const INDENT2 = INDENT1;
    let startDepth = 0;
    let noteDepth = 0;
    const getIndentation = (depth: number) => {
        const difference = depth - startDepth;
        // Notes on the current level or deeper get indented a bit more, for visual clarity,
        // and the parent notes won't get indented as much so that we aren't wasting space
        const indent2Amount = Math.max(0, difference);
        const indent1 = INDENT1 * Math.min(startDepth, depth);
        const indent2 = INDENT2 * Math.max(indent2Amount, 0);
        return indent1 + indent2;
    }

    let isFocused = false;
    let isEditing = false;
    let isShowingDurations = false;


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

    function onInputKeyDown(e: KeyboardEvent) {
        if (!rg.s.listHasFocus) {
            return;
        }

        const currentNote = rg.s.currentNote;
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

        // We can completely obscure the activity and todo lists, now that we have the right-dock
        scrollIntoView(scrollParent, root, 0.5);

        setStickyOffset();
    }

    rg.preRenderFn(function renderNoteRowInput({
        note, 
        scrollParent,
        readOnly,
        currentNote,
        listHasFocus,
        visualDepth,
    }) {
        const flatNotesRoot = getNoteOrUndefined(state, state._currentFlatNotesRootId);
        noteDepth = visualDepth ?? note.data._depth;
        startDepth = visualDepth !== undefined ? 0 : (
            flatNotesRoot ? flatNotesRoot.data._depth : note.data._depth
        );

        const wasFocused = isFocused;
        isFocused = currentNote.id === note.id && state._currentModal === null;
        isEditing = !readOnly && (
            listHasFocus && isFocused && state._isEditingFocusedNote
        );

        const wasShowingDurations = isShowingDurations;
        isShowingDurations = state._isShowingDurations;

        setStickyOffset();

        // do auto-scrolling
        if (scrollParent && listHasFocus && shouldScrollToNotes(state)) {
            if (isFocused && (!wasFocused || (wasShowingDurations !== isShowingDurations))) {
                // without setTimeout here, calling focus won't work as soon as the page loads.
                setTimeout(() => {
                    scrollComponentToView(scrollParent);
                }, 1);
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
                note.data._status === STATUS_IN_PROGRESS ||
                note.data.isSticky
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
                div({
                    class: [cn.row, cn.alignItemsCenter, cn.pre],
                    style: `background-color: ${cssVars.pinned}; color: #FFF`
                }, [
                    rg.style("opacity", s => !!s.note.data.isSticky ? "1" : "0"),
                    " ! "
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
                                const isTopFocused = s.note.data._selectedPathDepth === currentDepth;
                                const isBottomFocused = s.note.data._selectedPathDepth === currentDepth
                                        && !s.note.data._selectedPathDepthIsFirst;

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
                        rg.style("height", s => s.note.data._selectedPathDepthIsFirst ?
                            cssVars.focusedTreePathWidth : cssVars.unfocusedTreePathWidth)
                    ]),
                ]),
                div({ class: [cn.pre], style: "padding-left: 0.5ch; padding-right: 1ch; " }, [
                    rg.text(({ note, forceOneLine }) => {
                        // The design onf this note status and the tree lines are inextricably linked, but you wouldn't see
                        // that from the code - the lines need to look as if they were exiting from below the middle of this status text:
                        //      |
                        //      +-- [ x ] >> blah blah blah
                        //      +--  ...  >> blah blah blah 2
                        //            |
                        //            |    <- like it does here
                        //            |
                        //            +--
                        
                        const charCount = !forceOneLine ? "" : (
                                note.data.text.length < 150 ? "" : `[${note.data.text.length}ch]`
                        );

                        const status = noteStatusToString(note.data._status);
                        const progress = getNoteProgressCountText(note);

                        return `${status} ${progress}${charCount}`;
                    })
                ]),
                rg.c(EditableTextArea, (c, s) => c.render({
                    text: s.note.data.text,
                    isEditing,
                    onInputKeyDown,
                    isOneLineWhenNotEditing: s.forceOneLine,
                    onInput
                })),
                div({ class: [cn.row, cn.alignItemsCenter], style: "padding-right: 4px" }, [
                    rg.c(NoteRowDurationInfo, (c, { note }) => {
                        c.render({ note });
                    }),
                    rg.text(s => s.note.data._shelved ? "[Shelved]" : ""),
                ])
            ]),
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

function NotesList(rg: RenderGroup<{
    flatNoteIds: NoteId[];
    noteDepths?: number[];
    scrollParent: HTMLElement | null;
    currentNoteId: NoteId | null;
    hasFocus: boolean;
    ratio: number;
}>) {
    const root = div({
        class: [cn.flex1, cn.w100, cnApp.sb1b, cnApp.sb1t],
    });
    const noteList = newListRenderer(root, () => newComponent(NoteRowInput));

    rg.preRenderFn(function renderNoteListInteral(s) {
        const { flatNoteIds, scrollParent, currentNoteId, hasFocus, noteDepths } = s;

        if (!setVisible(root, flatNoteIds.length > 0)) {
            return;
        }

        setStyle(root, "flex", "" + s.ratio);

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

                const isSticky = note.data.isSticky ||
                    (note.data._status === STATUS_IN_PROGRESS && note.data._depth <= flatNotesRoot?.data._depth);
                    
                component.render({
                    note,
                    stickyOffset: undefined,
                    _isSticky: isSticky,
                    hasDivider: false,
                    hasLightDivider: false,
                    scrollParent,
                    readOnly: false,
                    currentNote,
                    listHasFocus: hasFocus,
                    orignalOffsetTop: -420,
                    forceOneLine: state.settings.nonEditingNotesOnOneLine ? true : (
                        state.settings.parentNotesOnOneLine ? isParentNote : false
                    ),
                    visualDepth: noteDepths?.[i],
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
        onClick: () => {
            const idx = getPrevIdx();
            if (idx !== -1) {
                state._currentlyViewingActivityIdx = idx;
                rerenderApp();
            }
        }
    });
    const nextActivity = newComponent(Button, {
        label: "<-",
        onClick: () => {
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
let isInQuicklist = false;

function moveInDirectionOverQuickList(amount: number) {
    if (!isInQuicklist) {
        recomputeFuzzyFinderMatches(state._fuzzyFindState);
        isInQuicklist = true;
    }

    if (state._fuzzyFindState.matches.length === 0) {
        return;
    }

    const idx = Math.max(0, Math.min(state._fuzzyFindState.matches.length - 1, getQuicklistIndex(state)+ amount));
    setQuicklistIndexForMove(idx);
}

function setQuicklistIndexForMove(idx: number) {
    if (idx === -1) {
        return;
    }

    setQuicklistIndex(state, idx);

    // Move to the most recent note in this subtree.
    setCurrentNote(state, state._fuzzyFindState.matches[getQuicklistIndex(state)].note.id);
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
        setActivityRangeToToday(state);
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
                    // TODO: scroll container
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
                }, [ GITHUB_PAGE_ISSUES ]),
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
        } else if (handleToggleNoteSticky(e, currentNote)) {
            rerenderApp();
            return;
        }

        const isEditingSomeText = isEditingTextSomewhereInDocument();

        let shouldPreventDefault = true;
        let needsRerender = true;
        if (
            !state._isEditingFocusedNote &&
            !isEditingSomeText &&
            state._currentModal === null
        ) {
            // handle movements here

            function handleUpDownMovement(up: boolean, ctrlKey: boolean, amount = 1, end: boolean, home: boolean) {
                const isMovingNode = e.altKey;

                const useSiblings = isMovingNode;
                let nextNoteId;
                if (end) {
                    nextNoteId = currentNote.childIds[currentNote.childIds.length - 1];
                } else if (home) {
                    nextNoteId = currentNote.childIds[0];
                } else if (up) {
                    if (ctrlKey) {
                        nextNoteId = getNoteOneUpLocally(state, currentNote);
                    } else {
                        nextNoteId = getNoteNUpForMovement(state, currentNote, useSiblings, amount)
                    }
                } else {
                    if (ctrlKey) {
                        nextNoteId = getNoteOneDownLocally(state, currentNote);
                    } else {
                        nextNoteId = getNoteNDownForMovement(state, currentNote, useSiblings, amount);
                    } 
                }

                const nextNote = getNoteOrUndefined(state, nextNoteId);
                if (!nextNote) {
                    return;
                }

                if (!isMovingNode) {
                    setCurrentNote(state, nextNote.id);
                    debouncedSave();
                    return;
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
                }
            }

            function handleMovingOut(nextNoteId: NoteId) {
                if (idIsNilOrRoot(nextNoteId)) {
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

                if (idIsNil(currentNote.parentId)) {
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
                    moveInDirectionOverQuickList(1);
                } else if (ctrlPressed) {
                    handleUpDownMovement(false, true, 1, false, false);
                } else {
                    handleUpDownMovement(false, false, 1, false, false);
                }
            } else if (e.key === "ArrowUp") {
                if (ctrlPressed && shiftPressed) {
                    shouldPreventDefault = true;
                    moveInDirectionOverQuickList(-1);
                } else if (ctrlPressed) {
                    handleUpDownMovement(true, true, 1, false, false);
                } else {
                    handleUpDownMovement(true, false, 1, false, false);
                }
            } else if (e.key === "PageUp") {
                shouldPreventDefault = true;
                handleUpDownMovement(true, false, 10, false, false);
            } else if (!idIsNil(currentNote.parentId) && e.key === "PageDown") {
                shouldPreventDefault = true;
                handleUpDownMovement(false, false, 10, false, false);
            } else if (!idIsNil(currentNote.parentId) && e.key === "End") {
                if (
                    isInQuicklist &&
                    e.ctrlKey &&
                    e.shiftKey
                ) {
                    setQuicklistIndexForMove(state._fuzzyFindState.matches.length - 1);
                } else {
                    handleUpDownMovement(true, false, 0, true, false);
                }
            } else if (!idIsNil(currentNote.parentId) && e.key === "Home") {
                if (
                    isInQuicklist &&
                    e.ctrlKey &&
                    e.shiftKey
                ) {
                    setQuicklistIndexForMove(0);
                } else {
                    handleUpDownMovement(true, false, 0, false, true);
                }
            } else if (e.key === "ArrowLeft") {
                // The browser can't detect ctrl when it's pressed on its own :((((  (well like this anyway)
                // Otherwise I would have liked for this to just be ctrl
                if (ctrlPressed && shiftPressed) {
                    shouldPreventDefault = true;
                    moveInDirectonOverHotlist(true);
                } else {
                    handleMovingOut(currentNote.parentId)
                }
            } else if (e.key === "ArrowRight") {
                if (ctrlPressed && shiftPressed) {
                    shouldPreventDefault = true;
                    moveInDirectonOverHotlist(false);
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
                setCurrentModalAndRerenderApp(null);
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
            scrollParent: notesScrollRoot.el,
            currentNoteId: state.currentNoteId,
            hasFocus: true,
            ratio: 2,
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
    });

    return appRoot;
};

let statusTextClearTimeout = 0;
const statusTextIndicator = div({ class: [cn.preWrap], style: `background-color: ${cssVars.bgColor}` })
const showStatusText = (text: string, color: string = `${cssVars.fgColor}`, timeout: number = STATUS_TEXT_PERSIST_TIME) => {
    if (statusTextClearTimeout) {
        clearTimeout(statusTextClearTimeout);
    }

    statusTextIndicator.el.textContent = text;
    statusTextIndicator.el.style.color = color;

    const timeoutAmount = timeout;
    if (timeoutAmount > 0) {
        statusTextClearTimeout = setTimeout(() => {
            statusTextIndicator.el.textContent = "[Press F1 for help]";
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

function rerenderApp() {
    app.render(null);
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
