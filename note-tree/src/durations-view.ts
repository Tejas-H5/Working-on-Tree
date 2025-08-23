import { imLine, LINE_HORIZONTAL, LINE_VERTICAL } from "./app-components/common";
import { BLOCK, COL, imAlign, imFlex, imLayout, imLayoutEnd, imSize, INLINE, NA, PX, ROW } from "./components/core/layout";
import { imB, imBEnd } from "./components/core/text";
import { newScrollContainer, ScrollContainer, scrollToItem, startScrolling } from "./components/scroll-container";
import { GlobalContext } from "./global-context";
import { getRowStatus, imBeginListRow, imEndListRow, imEndListRowNoPadding, imListCursorBg as imListRowBg, imListCursorColor, imListRowCellStyle } from "./list-row";
import {
    AXIS_HORIZONTAL,
    clampedListIdxRange,
    getNavigableListInput,
    imBeginNavList,
    imEndNavList,
    imNavListNextItemArray,
    ListPosition,
    newListPosition
} from "./navigable-list";
import {
    Activity,
    getActivityDurationMs,
    getActivityTime,
    getCurrentNote,
    getHigherLevelTask,
    getNote,
    getNoteTextWithoutPriority,
    isBreak,
    NoteId,
    recomputeAllNoteDurations,
    setActivityRangeToThisWeek,
    state,
    TreeNote
} from "./state";
import { boundsCheck } from "./utils/array-utils";
import { assert } from "./utils/assert";
import { addDays, DAYS_OF_THE_WEEK_ABBREVIATED, floorDateToWeekLocalTime, formatDurationAsHours } from "./utils/datetime";
import { ImCache, imFor, imForEnd, imGet, imMemo, imSet, inlineTypeId, isFirstishRender } from "./utils/im-core";
import { elSetStyle, imStr } from "./utils/im-dom";

type TaskBlockInfo = {
    hlt: TreeNote;
    name: string;
    slots: {
        time: number;
        activityIndices: number[];
        noteIds: Set<NoteId>;
    }[];
};

export type CurrentDateScope = "any" | "week";

export type DurationsViewState = {
    scrollContainer: ScrollContainer;
    tableRowPos: ListPosition;
    tableColPos: ListPosition;

    durations: TaskBlockInfo[];
    activitiesFrom: Date | null;
    activitiesTo: Date | null;
    hideBreaks: boolean;
    scope: CurrentDateScope;
};

function getNumDays(s: DurationsViewState) {
    let numDays;
    if (s.scope === "week") {
        numDays = 7 + 1; // 1 for the total
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
    };
}

function handleKeyboardInput(ctx: GlobalContext, s: DurationsViewState) {
    const vNav = getNavigableListInput(ctx, s.tableRowPos.idx, -1, s.durations.length);
    if (vNav) {
        setTableRow(ctx, s, vNav.newIdx);
    }

    const numDays = getNumDays(s);
    const hNav = getNavigableListInput(ctx, s.tableColPos.idx, -1, numDays, AXIS_HORIZONTAL);
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
    const numDays = getNumDays(s);
    s.tableColPos.idx = clampedListIdxRange(newCol, -1, numDays);
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

        const note = getNote(state, nId);
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
                    noteIds: new Set(),
                });
            }

            hltMap.set(hlt.id, block); 
        }

        const dayOfWeek = getActivityTime(activity).getDay();

        if (s.scope === "week") {
            assert(block.slots.length === 8);
            block.slots[7].time         += durationMs;
            block.slots[7].noteIds.add(nId);
            block.slots[7].activityIndices.push(i);
            block.slots[dayOfWeek].time += durationMs;
            block.slots[dayOfWeek].noteIds.add(nId);
            block.slots[dayOfWeek].activityIndices.push(i);
        } else {
            assert(block.slots.length === 1);
            block.slots[0].time += durationMs;
            block.slots[0].noteIds.add(nId);
            block.slots[0].activityIndices.push(i);
        }

        hltMap.set(hlt.id, block);
    }

    s.durations = [...hltMap.values()].sort((a, b) => {
        const aTotal = a.slots[a.slots.length - 1].time;
        const bTotal = b.slots[b.slots.length - 1].time;
        return bTotal - aTotal;
    });

    recomputeNotesFilter(s);
}

function recomputeNotesFilter(s: DurationsViewState) {

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

    let recomputed = false;

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

        recomputed = true;
    }

    imLayout(c, COL); imListRowCellStyle(c); imAlign(c); {
        if (isFirstishRender(c)) {
            elSetStyle(c, "fontWeight", "bold");
        }

        imLayout(c, BLOCK); imStr(c, "Durations"); imLayoutEnd(c);
    } imLayoutEnd(c);

    imLine(c, LINE_HORIZONTAL, 1);

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
            tableState.maxWidth = 0;
        }

        const allRowsSelected = s.tableRowPos.idx === -1;
        const allColsSelected = s.tableColPos.idx === -1;
        const allSelected = allRowsSelected && allColsSelected;

        imBeginListRow(c, allSelected, viewHasFocus && allSelected); {
            imLayout(c, BLOCK); imFlex(c); {
                imLayout(c, BLOCK); imSize(c, 0, NA, 7, PX); {
                    imListCursorColor(
                        c,
                        getRowStatus(allSelected, viewHasFocus && allSelected)
                    );
                } imLayoutEnd(c);

                imB(c).root; imListRowCellStyle(c); imStr(c, "High level tasks"); imBEnd(c);
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

                        let str = colIdx < DAYS_OF_THE_WEEK_ABBREVIATED.length ?
                                DAYS_OF_THE_WEEK_ABBREVIATED[colIdx] : "Total";

                        const span = imB(c).root; imStr(c, str); imBEnd(c);
                        if (tableState.recomputedPrevFrame) {
                            tableState.maxWidth = Math.max(tableState.maxWidth, span.getBoundingClientRect().width);
                        }
                    } imLayoutEnd(c);
                } imLayoutEnd(c);
            } imForEnd(c);
        } imEndListRowNoPadding(c);

        imLine(c, LINE_HORIZONTAL, 1);

        const list = imBeginNavList(c, s.scrollContainer, s.tableRowPos.idx, viewHasFocus); {
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
                                    tableState.maxWidth = Math.max(tableState.maxWidth, span.getBoundingClientRect().width);
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
        } imEndNavList(c, list);

        tableState.recomputedPrevFrame = recomputed;
        tableState.lastMaxWidth = tableState.maxWidth;
    } imLayoutEnd(c);
}

