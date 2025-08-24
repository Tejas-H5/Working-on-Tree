import { imLine, LINE_HORIZONTAL, LINE_VERTICAL } from "./app-components/common";
import { BLOCK, COL, imAlign, imFlex, imJustify, imLayout, imLayoutEnd, imSize, INLINE, NA, PX, ROW } from "./components/core/layout";
import { imB, imBEnd } from "./components/core/text";
import { newScrollContainer, ScrollContainer, scrollToItem, startScrolling } from "./components/scroll-container";
import { GlobalContext } from "./global-context";
import { getRowStatus, imListRowBegin, imEndListRowNoPadding, imListCursorColor, imListCursorBg as imListRowBg, imListRowCellStyle } from "./list-row";
import {
    AXIS_HORIZONTAL,
    clampedListIdxRange,
    getNavigableListInput,
    imNavListBegin,
    imNavListEnd,
    imNavListNextItemArray,
    ListPosition,
    newListPosition
} from "./navigable-list";
import {
    Activity,
    getActivityDurationMs,
    getActivityTime,
    getHigherLevelTask,
    getNote,
    getNoteTextWithoutPriority,
    idIsNilOrRoot,
    isBreak,
    NoteId,
    recomputeAllNoteDurations,
    setActivityRangeToThisWeek,
    state,
    TreeNote
} from "./state";
import { boundsCheck } from "./utils/array-utils";
import { assert, mustGetDefined } from "./utils/assert";
import { addDays, DAYS_OF_THE_WEEK_ABBREVIATED, floorDateToWeekLocalTime, formatDate, formatDurationAsHours } from "./utils/datetime";
import { ImCache, imFor, imForEnd, imGet, imMemo, imSet, inlineTypeId, isFirstishRender } from "./utils/im-core";
import { addDocumentAndWindowEventListeners, elSetStyle, imStr } from "./utils/im-dom";

type TaskBlockInfo = {
    hlt: TreeNote;
    name: string;
    slots: {
        time: number;
        activityIndices: number[];
    }[];
};

export type CurrentDateScope = "any" | "week";

export type DurationsViewState = {
    scrollContainer: ScrollContainer;
    tableRowPos: ListPosition;
    tableColPos: ListPosition;

    durations: TaskBlockInfo[];
    activityFilter: number[] | null;

    activitiesFrom: Date | null;
    activitiesTo: Date | null;
    hideBreaks: boolean;
    scope: CurrentDateScope;
};

function getNumDays(s: DurationsViewState) {
    let numDays;
    if (s.scope === "week") {
        numDays = 7;
    } else {
        numDays = 1;
    }
    return numDays;
}

export function newDurationsViewState(): DurationsViewState {
    return {
        scrollContainer: newScrollContainer(),
        tableRowPos: newListPosition(),
        tableColPos: newListPosition(),
        durations: [],
        activitiesFrom: null,
        activitiesTo: null,
        hideBreaks: false,
        scope: "week",
        activityFilter: null,
    };
}

function handleKeyboardInput(ctx: GlobalContext, s: DurationsViewState) {
    const vNav = getNavigableListInput(ctx, s.tableRowPos.idx, -1, s.durations.length);
    if (vNav) {
        setTableRow(ctx, s, vNav.newIdx);
    }

    const numDays = getNumDays(s);
    const hNav = getNavigableListInput(ctx, s.tableColPos.idx, -1, numDays + 1, AXIS_HORIZONTAL);
    if (hNav) {
        setTableCol(ctx, s, hNav.newIdx);
    }
}

function setTableRow(ctx: GlobalContext, s: DurationsViewState, newRow: number) {
    s.tableRowPos.idx = clampedListIdxRange(newRow, -1, s.durations.length);
    startScrolling(s.scrollContainer, true);
    setTableCol(ctx, s, s.tableColPos.idx);
}

function setTableCol(ctx: GlobalContext, s: DurationsViewState, newCol: number) {
    if (!s.activitiesTo || !s.activitiesFrom) {
        return;
    }

    const numDays = getNumDays(s);
    s.tableColPos.idx = clampedListIdxRange(newCol, -1, numDays + 1);

    let fullRecomputation = false;

    if (s.tableColPos.idx === -1) {
        addDays(s.activitiesFrom, -1);
        floorDateToWeekLocalTime(s.activitiesFrom);

        s.activitiesTo = new Date(s.activitiesFrom);
        addDays(s.activitiesTo, 7);

        s.tableColPos.idx = numDays - 1;
        fullRecomputation = true;
    } else if (s.tableColPos.idx === numDays) {
        const newActivitiesFrom = new Date(s.activitiesFrom);
        addDays(newActivitiesFrom, 7);
        if (newActivitiesFrom.getTime() < ctx.now.getTime()) {
            s.activitiesFrom = newActivitiesFrom;

            s.activitiesTo = new Date(s.activitiesFrom);
            addDays(s.activitiesTo, 7);

            s.tableColPos.idx = 0;
            fullRecomputation = true;
        } else {
            s.tableColPos.idx = numDays - 1;
        }
    } 

    if (fullRecomputation) {
        recomputeDurations(s);
    } else { 
        recomputeActivityFilter(s);
    }
}

const NIL_HLT_HEADING = "<No higher level task>";

function recomputeDurations(s: DurationsViewState) {
    recomputeAllNoteDurations(state, s.activitiesFrom, s.activitiesTo);

    const hltMap = new Map<NoteId | undefined, TaskBlockInfo>();

    for (let i = state._activitiesFromIdx; i >= 0 && i <= state._activitiesToIdx; i++) {
        const activity = state.activities[i];
        const nextActivity = state.activities[i + 1] as Activity | undefined;
        const durationMs = getActivityDurationMs(activity, nextActivity);

        if (s.hideBreaks && isBreak(activity)) {
            continue;
        }

        const nId = activity.nId;
        if (!nId) {
            continue;
        } 

        const note = getNote(state.notes, nId);
        const hlt = getHigherLevelTask(state, note);
        if (!hlt) {
            continue;
        }

        let block = hltMap.get(hlt.id);
        if (!block) {
            block = { hlt, slots: [], name: "" };

            block.name = getNoteTextWithoutPriority(block.hlt.data);

            const numDays = getNumDays(s);
            for (let i = 0; i < numDays; i++) {
                block.slots.push({
                    time: 0,
                    activityIndices: [],
                });
            }

            hltMap.set(hlt.id, block); 
        }

        const dayOfWeek = getActivityTime(activity).getDay();

        if (s.scope === "week") {
            assert(block.slots.length === 7);
            block.slots[dayOfWeek].time += durationMs;
            block.slots[dayOfWeek].activityIndices.push(i);
        } else {
            assert(block.slots.length === 1);
            block.slots[0].time += durationMs;
            block.slots[0].activityIndices.push(i);
        }

        hltMap.set(hlt.id, block);
    }

    s.durations = [...hltMap.values()].sort((a, b) => {
        const aTotal = a.slots[a.slots.length - 1].time;
        const bTotal = b.slots[b.slots.length - 1].time;
        return bTotal - aTotal;
    });

    if (s.tableRowPos.idx >= s.durations.length) {
        s.tableRowPos.idx = 0;
    }
    if (s.tableColPos.idx >= getNumDays(s)) {
        s.tableColPos.idx = 0;
    }

    recomputeActivityFilter(s);
}

// Expensive method, avoid callint it too often!
function recomputeActivityFilter(s: DurationsViewState) {
    let rowIdx = s.tableRowPos.idx;
    let colIdx = s.tableColPos.idx;

    function getFilter(): number[] {
        if (s.durations.length === 0) return [];

        if (rowIdx !== -1 && colIdx !== -1) {
            const row = s.durations[rowIdx]; assert(!!row);
            const cell = row.slots[colIdx]; assert(!!cell);
            return [...cell.activityIndices];
        }

        if (rowIdx !== -1) {
            const row = s.durations[rowIdx]; assert(!!row);
            return row.slots.flatMap(s => s.activityIndices);
        }

        if (colIdx !== -1) {
            return s.durations.flatMap(d => mustGetDefined(d.slots[colIdx].activityIndices));
        }

        return s.durations.flatMap(d => d.slots.flatMap(s => s.activityIndices));
    }

    s.activityFilter = getFilter();
}

export function imDurationsView(
    c: ImCache,
    ctx: GlobalContext,
    s: DurationsViewState
) {
    const viewHasFocus = ctx.currentView === s;
    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);
    }

    if (imMemo(c, viewHasFocus)) {
        if (!s.activitiesTo && !s.activitiesFrom) {
            s.activitiesFrom = new Date();
            floorDateToWeekLocalTime(s.activitiesFrom);

            s.activitiesTo = new Date(s.activitiesFrom.getTime());
            addDays(s.activitiesTo, 7);
        }

        recomputeDurations(s);
        setActivityRangeToThisWeek(state);
        setTableRow(ctx, s, s.tableRowPos.idx);
    }

    ctx.views.activities.inputs.activityFilter = s.activityFilter;

    imLayout(c, COL); imFlex(c); {
        // NOTE: the 'correct' thing to do here is a CSS table. But that doesn't work with
        // all the UI primitives we've already made. We also sacfice a LOT of control over how the rows are sized.
        
        let tableState; tableState = imGet(c, inlineTypeId(imLayout));
        if (!tableState) tableState = imSet(c, {
            lastMaxWidth: 0,
            maxWidth: 0,
            recomputedPrevFrame: false,
        });

        if (tableState.recomputedPrevFrame) {
            tableState.maxWidth = 50;
        }

        const allRowsSelected = s.tableRowPos.idx === -1;
        const allColsSelected = s.tableColPos.idx === -1;
        const allSelected = allRowsSelected && allColsSelected;

        imListRowBegin(c, allSelected, viewHasFocus && allSelected); {
            imLayout(c, ROW); imFlex(c); imAlign(c); {
                imLayout(c, BLOCK); imFlex(c); imLayoutEnd(c);

                imLayout(c, BLOCK); {
                    imB(c); {
                        imStr(c, "Duration Timesheet - ");
                        imStr(c, formatDate(s.activitiesFrom, true))
                        imStr(c, " to ");
                        imStr(c, formatDate(s.activitiesTo, true))
                    } imBEnd(c);
                } imLayoutEnd(c);

                imLayout(c, BLOCK); imFlex(c); imLayoutEnd(c);
            } imLayoutEnd(c);

            imLine(c, LINE_VERTICAL, 1);

            const numDays = getNumDays(s);

            imFor(c); for (let colIdx = 0; colIdx < numDays; colIdx++) {
                imLayout(c, BLOCK); {
                    const colSelectedIndividual = s.tableColPos.idx === colIdx;
                    const colSelected = colSelectedIndividual || allColsSelected;

                    imListRowBg(
                        c,
                        getRowStatus(colSelected, viewHasFocus && allRowsSelected)
                    );

                    imLayout(c, BLOCK); imSize(c, 0, NA, 7, PX); {
                        imListCursorColor(
                            c,
                            getRowStatus(colSelected, viewHasFocus && colSelectedIndividual)
                        );
                    } imLayoutEnd(c);

                    imLayout(c, BLOCK); imListRowCellStyle(c); {
                        if (imMemo(c, tableState.lastMaxWidth)) {
                            elSetStyle(c, "width", tableState.lastMaxWidth + "px");
                        }

                        let str = DAYS_OF_THE_WEEK_ABBREVIATED[colIdx];
                        const span = imB(c).root; imStr(c, str); imBEnd(c);
                        if (tableState.recomputedPrevFrame) {
                            tableState.maxWidth = Math.max(tableState.maxWidth, span.scrollWidth);
                        }
                    } imLayoutEnd(c);
                } imLayoutEnd(c);
            } imForEnd(c);
        } imEndListRowNoPadding(c);

        imLine(c, LINE_HORIZONTAL, 1);

        const list = imNavListBegin(c, s.scrollContainer, s.tableRowPos.idx, viewHasFocus); {
            while (imNavListNextItemArray(list, s.durations)) {
                const { i: rowIdx } = list;
                const block = s.durations[rowIdx];

                const rowSelectedIndividual = s.tableRowPos.idx === rowIdx;
                const rowSelected = rowSelectedIndividual || allRowsSelected;

                const root = imLayout(c, ROW); {
                    imLayout(c, BLOCK); {
                        if (isFirstishRender(c)) {
                            elSetStyle(c, "width", "10px");
                        }

                        imListCursorColor(
                            c,
                            getRowStatus(rowSelectedIndividual, viewHasFocus && rowSelectedIndividual),
                        );
                    } imLayoutEnd(c);

                    imLayout(c, BLOCK); imFlex(c); imListRowCellStyle(c); {
                        const selected = (rowSelected || allRowsSelected) && allColsSelected;

                        imListRowBg(
                            c,
                            getRowStatus(rowSelected, viewHasFocus && selected),
                        );

                        imStr(c, block.name); 
                    } imLayoutEnd(c);

                    imLine(c, LINE_VERTICAL, 1);

                    imFor(c); for (let colIdx = 0; colIdx <block.slots.length; colIdx++) {
                        const slot = block.slots[colIdx];

                        const colSelectedIndividual = s.tableColPos.idx === colIdx;
                        const colSelected = colSelectedIndividual || allColsSelected;

                        const cellSelected = (rowSelected || allRowsSelected) && (colSelected || allColsSelected);

                        imLayout(c, BLOCK); imListRowCellStyle(c); {
                            imListRowBg(
                                c,
                                getRowStatus(rowSelected || colSelected, viewHasFocus && cellSelected),
                            );

                            if (imMemo(c, tableState.lastMaxWidth)) {
                                elSetStyle(c, "width", tableState.lastMaxWidth + "px");
                            }

                            const span = imLayout(c, INLINE); {
                                if (tableState.recomputedPrevFrame) {
                                    tableState.maxWidth = Math.max(tableState.maxWidth, span.scrollWidth);
                                }

                                imStr(c, formatDurationAsHours(slot.time)); 
                            } imLayoutEnd(c);
                        } imLayoutEnd(c);
                    } imForEnd(c);
                } imLayoutEnd(c);

                if (rowSelectedIndividual && list.scrollContainer) {
                    scrollToItem(c, list.scrollContainer, root);
                }
            }
        } imNavListEnd(c, list);


        tableState.recomputedPrevFrame = !!imMemo(c, s.durations)
        tableState.lastMaxWidth = tableState.maxWidth;
    } imLayoutEnd(c);
}

