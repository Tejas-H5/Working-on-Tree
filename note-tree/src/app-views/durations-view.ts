import {
    getRowStatus,
    imListCursorColor,
    imListCursorBg as imListRowBg,
    imListRowCellStyle,
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
import { imB, imBEnd } from "src/components/core/text";
import {
    newScrollContainer,
    ScrollContainer,
    scrollToItem,
    startScrolling
} from "src/components/scroll-container";
import { focusItem, GlobalContext } from "src/global-context";
import {
    Activity,
    getActivityDate,
    getActivityDurationMs,
    getNoteOrUndefined,
    isBreak,
    recomputeAllDurations,
    state
} from "src/state";
import { arrayAt } from "src/utils/array-utils";
import { assert, mustGetDefined } from "src/utils/assert";
import {
    addDays,
    DAYS_OF_THE_WEEK_ABBREVIATED,
    floorDateToWeekLocalTime,
    formatDate,
    formatDurationAsHours,
    isSameDate
} from "src/utils/datetime";
import { im, ImCache, imdom } from "src/utils/im-js";
import { BLOCK, COL, cssVars, imui, NA, PERCENT, PX, ROW, STRETCH, } from "src/utils/im-js/im-ui";
import { getPageOrUndefined, TreePage } from "./journal-view";

type TaskBlockInfo = {
    // null -> break
    page: TreePage | null;
    name: string;
    slots: { time: number; activityIndices: number[]; }[];
};

export type DurationsViewState = {
    scrollContainer: ScrollContainer;
    tableRowPos: ListPosition;
    tableColPos: ListPosition;

    durations: TaskBlockInfo[];
    activityFilter: number[] | null;
    taskBlocks: TaskBlockInfo[];

    activitiesFrom: Date | null;
    activitiesTo: Date | null;

    pageJumpedFromId: number | undefined;
};

function getBlockForPage(s: DurationsViewState, page: TreePage | null): TaskBlockInfo | undefined {
    for (const val of s.taskBlocks) {
        if (val.page === page) return val;
    }
    return undefined;
}

function pushBlock(s: DurationsViewState, page: TreePage | null, activity: Activity, numDays: number): TaskBlockInfo {
    let name;
    if (page) {
        if (page.data.noteTree && activity.nId) {
            const note = getNoteOrUndefined(page.data.noteTree, activity.nId);
            if (note) {
                name = `${page.data.name} -> ${note.data.text}`
            }
        } 

        if (!name) {
            name = page.data.name;
        }
    } else {
        name = "Break"
    }
    const block: TaskBlockInfo = {
        page:  page,
        slots: [],
        name:  name
    }
    for (let i = 0; i < numDays + 1; i++) {
        block.slots.push({ time: 0, activityIndices: [], });
    }
    s.taskBlocks.push(block);
    return block;
}

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
        taskBlocks: [],
        pageJumpedFromId: undefined,
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
    s.tableRowPos.idx = newRow;
    fixTableRowColValues(s);

    startScrolling(s.scrollContainer, true);
    setTableCol(ctx, s, s.tableColPos.idx);
}

function setTableCol(ctx: GlobalContext, s: DurationsViewState, newCol: number) {
    if (!s.activitiesTo || !s.activitiesFrom) {
        return;
    }

    const numDays = getNumDays(s);
    s.tableColPos.idx = newCol;
    fixTableRowColValues(s);

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

    const currentBlock = arrayAt(s.durations, s.tableRowPos.idx);
    if (currentBlock?.page) {
        focusItem(ctx, state, currentBlock.page.id, undefined);
    }
}

function recomputeDurations(s: DurationsViewState) {
    recomputeAllDurations(state, state.journal, s.activitiesFrom, s.activitiesTo);

    const numDays = getNumDays(s);

    s.taskBlocks = [];

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

        if (isBreak(activity)) {
            block = getBlockForPage(s, null);
            if (!block) block = pushBlock(s, null, activity, numDays);
        } else {
            const page = getPageOrUndefined(state.journal, activity.journal?.idx);
            if (page) {
                block = getBlockForPage(s, page);
                if (!block) block = pushBlock(s, page, activity, numDays);
            }
        }

        if (!block) continue;

        assert(block.slots.length === 8);

        const dayOfWeek = activityDate.getDay();
        block.slots[dayOfWeek].time += durationMs;
        block.slots[dayOfWeek].activityIndices.push(i);
        block.slots[DAYS_OF_THE_WEEK_ABBREVIATED.length].time += durationMs;
    }

    if (s.tableRowPos.idx >= s.durations.length) {
        s.tableRowPos.idx = 0;
    }
    if (s.tableColPos.idx >= getNumDays(s)) {
        s.tableColPos.idx = 0;
    }
    fixTableRowColValues(s);

    recomputeActivityFilter(s);
}

function fixTableRowColValues(s: DurationsViewState) {
    const numDays = getNumDays(s);
    s.tableRowPos.idx = clampedListIdxRange(s.tableRowPos.idx, -1, s.durations.length);
    s.tableColPos.idx = clampedListIdxRange(s.tableColPos.idx, -1, numDays + 1);
}

// Expensive method, avoid calling it too often!
function recomputeActivityFilter(s: DurationsViewState) {
    fixTableRowColValues(s);

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

    s.durations = [...s.taskBlocks.values()].sort((a, b) => {
        const col = s.tableColPos.idx;
        const aTotal = a.slots[col].time;
        const bTotal = b.slots[col].time;
        return bTotal - aTotal;
    });
}

export function imDurationsView(
    c: ImCache,
    ctx: GlobalContext,
    s: DurationsViewState,
) {
    const numDays = getNumDays(s);

    const firstColumnWidthPercentage = 50;
    const restColumnWidthPercentage =  (100 - firstColumnWidthPercentage) / numDays;

    const viewHasFocus = ctx.currentView === s;
    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);
    }

    const focusChanged = im.Memo(c, viewHasFocus);
    const activitiesChanged = im.Memo(c, state._activitiesMutationCounter);

    if (focusChanged && viewHasFocus) {
        s.pageJumpedFromId = state.journal.currentlyEditing.pageIdx;
    }

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

    const allRowsSelected = s.tableRowPos.idx === -1;
    const allColsSelected = s.tableColPos.idx === -1;

    imui.Begin(c, COL); imui.Flex(c); imui.Bg(c, cssVars.bg); {
        const list = imNavListBegin(c, s.scrollContainer, s.tableRowPos.idx, viewHasFocus); imui.Align(c, STRETCH); {
            imui.Begin(c, BLOCK); {
                if (im.isFirstishRender(c)) {
                    imdom.setStyle(c, "display", "grid");
                    imdom.setStyle(c, "gridTemplateColumns", "7fr " + "1fr ".repeat(DAYS_OF_THE_WEEK_ABBREVIATED.length + 1));
                }

                // HEADER
                {
                    imui.Begin(c, COL); {
                        imui.Begin(c, BLOCK); imui.Size(c, 0, NA, 10, PX); {
                            // Cursor cant come here
                        } imui.End(c);

                        imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                            imB(c); {
                                imdom.Str(c, "Duration Timesheet - ");
                                imdom.Str(c, formatDate(s.activitiesFrom, true));
                                imdom.Str(c, " to ");
                                imdom.Str(c, formatDate(s.activitiesTo, true));
                            } imBEnd(c);
                        } imui.End(c);
                    } imui.End(c);

                    im.For(c); for (let colIdx = 0; colIdx < numDays; colIdx++) {
                        const colSelectedIndividual = s.tableColPos.idx === colIdx;
                        const colSelected = colSelectedIndividual || allColsSelected;

                        imui.Begin(c, COL); {
                            imListRowBg(
                                c,
                                getRowStatus(colSelected, colSelected, viewHasFocus && allRowsSelected)
                            );

                            imui.Begin(c, BLOCK); imui.Size(c, 0, NA, 10, PX); {
                                imListCursorColor(c,
                                    getRowStatus(colSelected, colSelected, viewHasFocus && colSelectedIndividual)
                                );
                            } imui.End(c);
 
                            imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                                let str = DAYS_OF_THE_WEEK_ABBREVIATED[colIdx];
                                imB(c).root; imdom.Str(c, str); imBEnd(c);
                            } imui.End(c);
                        } imui.End(c);
                    } im.ForEnd(c);

                    imui.Begin(c, COL); {
                        imui.Begin(c, BLOCK); imui.Size(c, 0, NA, 10, PX); {
                            // Cursor cant come here
                        } imui.End(c);

                        imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                            imB(c); imdom.Str(c, "Total"); imBEnd(c);
                        } imui.End(c);
                    } imui.End(c);
                }

                // ROWS
                {
                    im.For(c); while (imNavListNextItemArray(list, s.durations)) {
                        const { i: rowIdx } = list;
                        const block = s.durations[rowIdx];

                        const rowSelectedIndividual = s.tableRowPos.idx === rowIdx;
                        const rowSelected = rowSelectedIndividual || allRowsSelected;

                        const root = imui.Begin(c, ROW); {
                            const selected = (rowSelected || allRowsSelected) && allColsSelected;
                            imListRowBg(
                                c,
                                getRowStatus(rowSelected, rowSelected, viewHasFocus && selected),
                            );
                            imui.Begin(c, BLOCK); imui.Size(c, 10, PX, 100, PERCENT); {
                                imListCursorColor(
                                    c,
                                    getRowStatus(rowSelectedIndividual, rowSelectedIndividual, viewHasFocus && rowSelectedIndividual),
                                );
                            } imui.End(c);

                            imui.Begin(c, BLOCK); imui.Flex(c); imListRowCellStyle(c); {
                                imdom.Str(c, block.name);
                            } imui.End(c);
                        } imui.End(c);

                        im.For(c); for (let colIdx = 0; colIdx < block.slots.length; colIdx++) {
                            const slot = block.slots[colIdx];

                            const colSelectedIndividual = s.tableColPos.idx === colIdx;
                            const colSelected = colSelectedIndividual || allColsSelected;

                            const cellSelected = (rowSelected || allRowsSelected) && (colSelected || allColsSelected);

                            imui.Begin(c, ROW); {
                                imListRowBg(
                                    c,
                                    getRowStatus(rowSelected || colSelected, rowSelected || colSelected, viewHasFocus && cellSelected),
                                );

                                imdom.Str(c, formatDurationAsHours(slot.time));
                            } imui.End(c);
                        } im.ForEnd(c);

                        if (rowSelectedIndividual && list.scrollContainer) {
                            scrollToItem(c, list.scrollContainer, root);
                        }
                    } im.ForEnd(c);
                }
            } imui.End(c);
        } imNavListEnd(c, list);
    } imui.End(c);
}
