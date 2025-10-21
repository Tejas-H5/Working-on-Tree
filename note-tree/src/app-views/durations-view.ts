import {
    getRowStatus,
    imListCursorColor,
    imListCursorBg as imListRowBg,
    imListRowCellStyle,
    imListTableRowBegin,
    imListTableRowEnd,
    imTableCellFlexBegin,
    imTableCellFlexEnd
} from "src/app-components/list-row";
import {
    AXIS_HORIZONTAL,
    clampedListIdxRange,
    getNavigableListInput,
    imNavListBegin,
    imNavListEnd,
    imNavListNextItemArray,
    ListPosition,
    newListPosition
} from "src/app-components/navigable-list";
import {
    BLOCK,
    COL,
    imAlign,
    imFlex,
    imJustify,
    imLayout,
    imLayoutEnd,
    imSize,
    PERCENT,
    PX,
    ROW,
    STRETCH,
    TABLE
} from "src/components/core/layout";
import { imB, imBEnd } from "src/components/core/text";
import { imLine, LINE_HORIZONTAL } from "src/components/im-line";
import {
    newScrollContainer,
    ScrollContainer,
    scrollToItem,
    startScrolling
} from "src/components/scroll-container";
import { GlobalContext } from "src/global-context";
import {
    Activity,
    getActivityDate,
    getActivityDurationMs,
    getHigherLevelTask,
    getNote,
    getNoteTextWithoutPriority,
    isBreak,
    NoteId,
    recomputeAllNoteDurations,
    state,
    TreeNote
} from "src/state";
import { assert, mustGetDefined } from "src/utils/assert";
import { addDays, DAYS_OF_THE_WEEK_ABBREVIATED, floorDateToWeekLocalTime, formatDate, formatDurationAsHours, isSameDate } from "src/utils/datetime";
import { ImCache, imFor, imForEnd, imMemo } from "src/utils/im-core";
import { imStr } from "src/utils/im-dom";

type TaskBlockInfo = {
    // null means it's a break
    hlt: TreeNote | null;
    name: string;
    slots: {
        time: number;
        activityIndices: number[];
    }[];
};

export type DurationsViewState = {
    scrollContainer: ScrollContainer;
    tableRowPos: ListPosition;
    tableColPos: ListPosition;

    durations: TaskBlockInfo[];
    activityFilter: number[] | null;
    hltMap: Map<NoteId | null, TaskBlockInfo>;
    totals: { time: number; }[];

    activitiesFrom: Date | null;
    activitiesTo: Date | null;
};

function getNumDays(_s: DurationsViewState) {
    return 7;
}

export function newDurationsViewState(): DurationsViewState {
    return {
        scrollContainer: newScrollContainer(),
        tableRowPos: newListPosition(),
        tableColPos: newListPosition(),
        durations: [],
        activitiesFrom: null,
        activitiesTo: null,
        activityFilter: null,
        hltMap: new Map(),
        totals: [],
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

function recomputeDurations(s: DurationsViewState) {
    recomputeAllNoteDurations(state, s.activitiesFrom, s.activitiesTo);

    const numDays = getNumDays(s);

    s.hltMap = new Map<NoteId | null, TaskBlockInfo>();

    s.totals = [];
    for (let i = 0; i < numDays; i++) {
        s.totals.push({ time: 0 });
    }

    for (let i = state._activitiesFromIdx; i >= 0 && i <= state._activitiesToIdx; i++) {
        const activity = state.activities[i];
        const nextActivity = state.activities[i + 1] as Activity | undefined;
        const durationMs = getActivityDurationMs(activity, nextActivity);

        const activityDate = getActivityDate(activity);
        const nextActivityDate = getActivityDate(nextActivity);

        // Specifically skip breaks spanning multiple days. This just means we didn't do anything the rest of the day,
        // and not that we took a week-long break
        if (isBreak(activity) && !isSameDate(activityDate, nextActivityDate)) {
            continue;
        }

        let block: TaskBlockInfo | undefined;
        let newBlock = false;

        if (isBreak(activity)) {
            block = s.hltMap.get(null);
            if (!block) {
                block = {
                    hlt: null,
                    slots: [],
                    name: "Breaks",
                };
                s.hltMap.set(null, block);
                newBlock = true;
            }
        } else {
            const nId = activity.nId;
            if (!nId) {
                continue;
            }

            const note = getNote(state.notes, nId);
            const hlt = getHigherLevelTask(state, note);
            if (!hlt) {
                continue;
            }

            block = s.hltMap.get(hlt.id);
            if (!block) {
                block = {
                    hlt,
                    slots: [],
                    name: getNoteTextWithoutPriority(hlt.data),
                };
                newBlock = true;
                s.hltMap.set(hlt.id, block);
            }
        }

        if (newBlock) {
            for (let i = 0; i < numDays; i++) {
                block.slots.push({
                    time: 0,
                    activityIndices: [],
                });
            }
        }
        assert(block.slots.length === 7);

        const dayOfWeek = activityDate.getDay();
        block.slots[dayOfWeek].time += durationMs;
        block.slots[dayOfWeek].activityIndices.push(i);
        s.totals[dayOfWeek].time += durationMs;
    }

    s.tableColPos.idx = clampedListIdxRange(s.tableColPos.idx, -1, numDays + 1);

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
    const numDays = getNumDays(s);
    s.tableRowPos.idx = clampedListIdxRange(s.tableRowPos.idx, 0, s.durations.length);
    s.tableColPos.idx = clampedListIdxRange(s.tableColPos.idx, -1, numDays + 1);

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

    s.durations = [...s.hltMap.values()].sort((a, b) => {
        const col = s.tableColPos.idx;
        const aTotal = a.slots[col].time;
        const bTotal = b.slots[col].time;
        return bTotal - aTotal;
    });
}

export function imDurationsView(
    c: ImCache,
    ctx: GlobalContext,
    s: DurationsViewState
) {
    const numDays = getNumDays(s);

    const firstColumnWidthPercentage = 50;
    const restColumnWidthPercentage =  (100 - firstColumnWidthPercentage) / numDays;

    const viewHasFocus = ctx.currentView === s;
    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);
    }

    const focusChanged = imMemo(c, viewHasFocus);
    const activitiesChanged = imMemo(c, state._activitiesMutationCounter);

    if (focusChanged || activitiesChanged) {
        if (!s.activitiesTo && !s.activitiesFrom) {
            s.activitiesFrom = new Date();
            floorDateToWeekLocalTime(s.activitiesFrom);

            s.activitiesTo = new Date(s.activitiesFrom.getTime());
            addDays(s.activitiesTo, 7);
        }
        recomputeDurations(s);
        setTableRow(ctx, s, s.tableRowPos.idx);
    }

    ctx.views.activities.inputs.activityFilter = s.activityFilter;

    // NOTE: the 'correct' thing to do here is a CSS table. But that doesn't work with all the UI primitives we've already made. We also sacfice a LOT of control over how the rows are sized.
    // But the layout is shit when we try to roll it ourselves, so I will just give in and use table. :(
    // And as it turns out, even after we use css table, it is even worse. 
    // there are all sorts of ways that the table API won't work properly, and all sorts
    // of workarounds you need to use. 
    // It would have been better to just get around to learning css grid, but
    // I'm in too deep. We gotta get this done.

    const allRowsSelected = s.tableRowPos.idx === -1;
    const allColsSelected = s.tableColPos.idx === -1;
    const allSelected = allRowsSelected && allColsSelected;

    imLayout(c, COL); imFlex(c); {
        imLayout(c, COL); {
            imLayout(c, TABLE); imFlex(c); {
                imListTableRowBegin(c, allSelected, viewHasFocus && allSelected); imAlign(c, STRETCH); {
                    imTableCellFlexBegin(c, ROW, firstColumnWidthPercentage, PERCENT); imJustify(c); imAlign(c); {
                        imLayout(c, BLOCK); imFlex(c); imLayoutEnd(c);

                        imLayout(c, BLOCK); {
                            imB(c); {
                                imStr(c, "Duration Timesheet - ");
                                imStr(c, formatDate(s.activitiesFrom, true));
                                imStr(c, " to ");
                                imStr(c, formatDate(s.activitiesTo, true));
                            } imBEnd(c);
                        } imLayoutEnd(c);

                        imLayout(c, BLOCK); imFlex(c); imLayoutEnd(c);
                    } imTableCellFlexEnd(c);


                    imFor(c); for (let colIdx = 0; colIdx < numDays; colIdx++) {
                        imTableCellFlexBegin(c, COL, restColumnWidthPercentage, PERCENT); imAlign(c); imJustify(c); {
                            const colSelectedIndividual = s.tableColPos.idx === colIdx;
                            const colSelected = colSelectedIndividual || allColsSelected;

                            imListRowBg(
                                c,
                                getRowStatus(colSelected, viewHasFocus && allRowsSelected)
                            );

                            imLayout(c, BLOCK); imSize(c, 100, PERCENT, 7, PX); {
                                imListCursorColor(
                                    c,
                                    getRowStatus(colSelected, viewHasFocus && colSelectedIndividual)
                                );
                            } imLayoutEnd(c);

                            imLayout(c, BLOCK); imListRowCellStyle(c); {
                                let str = DAYS_OF_THE_WEEK_ABBREVIATED[colIdx];
                                imB(c).root; imStr(c, str); imBEnd(c);
                            } imLayoutEnd(c);
                        } imTableCellFlexEnd(c);
                    } imForEnd(c);
                } imListTableRowEnd(c);

                imListTableRowBegin(c, false, false); {
                    imTableCellFlexBegin(c, ROW, firstColumnWidthPercentage, PERCENT); imAlign(c); imJustify(c); {
                        imStr(c, "Total");
                    } imTableCellFlexEnd(c);

                    // imLine(c, LINE_VERTICAL, 1);

                    const numDays = getNumDays(s);

                    imFor(c); for (let colIdx = 0; colIdx < numDays; colIdx++) {
                        imTableCellFlexBegin(c, ROW, restColumnWidthPercentage, PERCENT); imAlign(c); imJustify(c); {
                            const colSelectedIndividual = s.tableColPos.idx === colIdx;
                            const colSelected = colSelectedIndividual || allColsSelected;

                            imListRowBg(
                                c,
                                getRowStatus(colSelected, viewHasFocus && allRowsSelected)
                            );

                            imLayout(c, BLOCK); imListRowCellStyle(c); {
                                const totalMs = s.totals[colIdx].time;
                                imStr(c, formatDurationAsHours(totalMs));
                            } imLayoutEnd(c);
                        } imTableCellFlexEnd(c);
                    } imForEnd(c);
                } imListTableRowEnd(c);
            } imLayoutEnd(c);
        } imLayoutEnd(c);

        imLine(c, LINE_HORIZONTAL, 1);

        const list = imNavListBegin(c, s.scrollContainer, s.tableRowPos.idx, viewHasFocus); imAlign(c, STRETCH); {
            imLayout(c, TABLE); {

                imFor(c); while (imNavListNextItemArray(list, s.durations)) {
                    const { i: rowIdx } = list;
                    const block = s.durations[rowIdx];

                    const rowSelectedIndividual = s.tableRowPos.idx === rowIdx;
                    const rowSelected = rowSelectedIndividual || allRowsSelected;

                    const root = imListTableRowBegin(c, false, false); {
                        imTableCellFlexBegin(c, ROW, firstColumnWidthPercentage, PERCENT); imAlign(c, STRETCH); imJustify(c); {
                            imLayout(c, BLOCK); imSize(c, 10, PX, 100, PERCENT); {
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
                        } imTableCellFlexEnd(c);

                        imFor(c); for (let colIdx = 0; colIdx < block.slots.length; colIdx++) {
                            const slot = block.slots[colIdx];

                            const colSelectedIndividual = s.tableColPos.idx === colIdx;
                            const colSelected = colSelectedIndividual || allColsSelected;

                            const cellSelected = (rowSelected || allRowsSelected) && (colSelected || allColsSelected);

                            imTableCellFlexBegin(c, ROW, restColumnWidthPercentage, PERCENT); imAlign(c); imJustify(c); {
                                imListRowBg(
                                    c,
                                    getRowStatus(rowSelected || colSelected, viewHasFocus && cellSelected),
                                );

                                imStr(c, formatDurationAsHours(slot.time));
                            } imTableCellFlexEnd(c);
                        } imForEnd(c);
                    } imListTableRowEnd(c);

                    if (rowSelectedIndividual && list.scrollContainer) {
                        scrollToItem(c, list.scrollContainer, root);
                    }
                } imForEnd(c);
            } imLayoutEnd(c);
        } imNavListEnd(c, list);
    } imLayoutEnd(c);
}
