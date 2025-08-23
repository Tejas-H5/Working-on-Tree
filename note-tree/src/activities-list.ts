import {
    newScrollContainer,
    ScrollContainer
} from "src/components/scroll-container";
import { imLine, LINE_HORIZONTAL, LINE_VERTICAL } from "./app-components/common";
import {
    BLOCK,
    CENTER,
    CH,
    COL,
    imAlign,
    imFlex,
    imGap,
    imJustify,
    imLayout,
    imLayoutEnd,
    imNoWrap,
    INLINE_BLOCK,
    NONE,
    PX,
    ROW
} from "./components/core/layout";
import { imBeginTextArea, imEndTextArea } from "./components/editable-text-area";
import {
    BYPASS_TEXT_AREA,
    getAxisRaw,
    GlobalContext,
    hasDiscoverableCommand,
    REPEAT,
    SHIFT
} from "./global-context";
import {
    imBeginListRow,
    imEndListRow,
    imListRowCellStyle,
} from "./list-row";
import {
    clampedListIdx,
    clampedListIdxRange,
    getNavigableListInput,
    imBeginNavList,
    imBeginNavListRow,
    imEndNavList,
    imEndNavListRow,
    ListPosition,
    navListNextItemSlice,
    newListPosition
} from "./navigable-list";
import {
    Activity,
    getActivityDurationMs,
    getActivityText,
    getActivityTime,
    getCurrentNote,
    getHigherLevelTask,
    getLastActivity,
    getLastActivityWithNote,
    getNote,
    isBreak,
    isCurrentlyTakingABreak,
    newBreakActivity,
    pushBreakActivity,
    setCurrentNote,
    state
} from "./state";
import { imEditableTime } from "./time-input";
import { arrayAt, boundsCheck, get } from "./utils/array-utils";
import { clampDate, cloneDate, floorDateLocalTime, formatDate, formatDuration, formatTime, isSameDate } from "./utils/datetime";
import { ImCache, imIf, imIfElse, imIfEnd, imKeyed, imKeyedEnd, imMemo, isFirstishRender } from "./utils/im-core";
import { elSetStyle, EV_CHANGE, EV_INPUT, imOn, imStr } from "./utils/im-dom";
import { assert } from "./utils/assert";

const FOCUS_ACTIVITIES_LIST = 0;
const FOCUS_DATE_SELECTOR = 1

export const EDITING_NOTHING = 0;
export const EDITING_TIME = 1;
export const EDITING_ACTIVITY = 2;

type EditingStatus
    = typeof EDITING_NOTHING
    | typeof EDITING_TIME
    | typeof EDITING_ACTIVITY

export type ActivitiesViewState = {
    inputs: {
        activityFilter: number[] | null;
    };

    activities: Activity[];
    filteredActivities: Activity[] | null;

    viewHasFocus: boolean;

    currentFocus: typeof FOCUS_ACTIVITIES_LIST | typeof FOCUS_DATE_SELECTOR;
    activityListPositon: ListPosition;
    isEditing: EditingStatus;

    scrollContainer: ScrollContainer;

    now: Date;

    currentViewingDate: Date;
    _startActivityIdx: number;
    _endActivityIdxEx: number; // exclusive index
    _range: [number, number]; // TODO: remove _startidx and _endIdx
    _canMoveToNextDay: boolean;
    _canMoveToPrevDay: boolean;
}


export function newActivitiesViewState(): ActivitiesViewState {
    return {
        inputs: { activityFilter: null, },

        activities: [],
        filteredActivities: [],

        viewHasFocus: false,

        currentFocus: FOCUS_ACTIVITIES_LIST,
        activityListPositon: newListPosition(),
        isEditing: EDITING_NOTHING,

        scrollContainer: newScrollContainer(),

        now: new Date(),

        currentViewingDate: new Date(),

        _startActivityIdx: 0,
        _endActivityIdxEx: 0,
        _range: [0, 0],
        _canMoveToNextDay: false,
        _canMoveToPrevDay: false,
    };
}

function getActivitiesForDateStartIdx(
    activities: Activity[],
    date: Date,
    startSeekingFrom: number = 0     // <- can speed up subsequent lookups without requiring binary search
): number {
    let i = startSeekingFrom;

    if (i >= activities.length) i = activities.length - 1;

    // step cursor somewhere before the first activity for this date
    while (i >= 0) {

        if (
            activities[i].t < date &&
            !isSameDate(activities[i].t, date)
        ) break;

        if (i === 0) {
            // reached the first note.
            return 0;
        }

        i--;
    }

    // step cursor forward. as soon as we've reached into the range, can return.
    while (i < activities.length) {
        i++;
        if (i === activities.length) break;
        if (isSameDate(activities[i].t, date)) break;
    }

    return i;
}

export function activitiesViewTakeBreak(
    ctx: GlobalContext,
    s: ActivitiesViewState
) {
    if (!isCurrentlyTakingABreak(state)) {
        pushBreakActivity(state, newBreakActivity("Taking a break...", new Date(), NOT_IN_RANGE));
    } else {
        // allow the next code select the last break for editing
    }
    activitiesViewSetIdx(ctx, s, s.activities.length - 1, NOT_IN_RANGE);
    s.isEditing = EDITING_ACTIVITY;
    state._notesMutationCounter++;
}

function getActivitiesNextDateStartIdx(
    activities: Activity[],
    startIdx: number,
): number {
    if (!boundsCheck(activities, startIdx)) return startIdx;

    let i = startIdx;

    const date = activities[i].t;

    while (i < activities.length) {
        i++;
        if (i === activities.length) break;
        if (!isSameDate(activities[i].t, date)) break;
    }

    return i;
}

// NOTE: the incremental computation is a bit different
function getActivityRange(s: ActivitiesViewState): [number, number] {
    s._startActivityIdx = getActivitiesForDateStartIdx(s.activities, s.currentViewingDate, s._startActivityIdx);
    s._endActivityIdxEx = getActivitiesNextDateStartIdx(s.activities, s._startActivityIdx);

    s._range[0] = s._startActivityIdx;
    s._range[1] = s._endActivityIdxEx;
    return s._range;
}

export const IN_RANGE = false;
export const NOT_IN_RANGE = true;

function moveToNextDay(ctx: GlobalContext, s: ActivitiesViewState) {
    const [lo, hi] = getActivityRange(s);

    if (hi < s.activities.length - 1) {
        // move to the next day, if notes available
        activitiesViewSetIdx(ctx, s, hi + 1, true);
    } else if (
        !s.filteredActivities &&
        !isSameDate(s.now, s.currentViewingDate)
    ) {
        // if not viewing a filtered subset, and no more notes, move to today
        setCurrentViewingDate(s, s.now);
    }
}

function moveToPrevDay(ctx: GlobalContext, s: ActivitiesViewState) {
    const [lo, hi] = getActivityRange(s);

    if (lo > 0) {
        // move to prev day
        activitiesViewSetIdx(ctx, s, lo - 1, true);
    }
}

export function activitiesViewSetIdx(ctx: GlobalContext, s: ActivitiesViewState, idx: number, notInRange: boolean) {
    if (s.activities.length === 0) return;

    const lastIdx = s.activityListPositon.idx;
    let newIdx = idx;

    if (boundsCheck(s.activities, lastIdx)) {
        const lastActivity = s.activities[lastIdx];
        if (isBreak(lastActivity) && lastActivity.breakInfo !== undefined && lastActivity.breakInfo.length === 0) {
            s.activities.splice(lastIdx, 1);
            if (newIdx >= lastIdx) {
                newIdx--;
            }
        }
    }

    if (notInRange) {
        newIdx = clampedListIdx(idx, s.activities.length);
    } else {
        const [lo, hi] = getActivityRange(s);
        newIdx = clampedListIdxRange(idx, lo, hi);
    }

    if (newIdx !== s.activityListPositon.idx) {
        s.activityListPositon.idx = newIdx;

        const activity = s.activities[newIdx];
        if (activity.nId) {
            setCurrentNote(state, activity.nId, ctx.noteBeforeFocus?.id);
        }
    }

    if (s.activities.length > 0) {
        const activities = s.activities[newIdx];
        if (!isSameDate(activities.t, s.currentViewingDate)) {
            setCurrentViewingDate(s, activities.t);
        }
    }
}


function insertBreakBetweenCurrentAndNext(
    ctx: GlobalContext,
    s: ActivitiesViewState
) {
    const idx = s.activityListPositon.idx;
    if (!boundsCheck(s.activities, idx)) return;

    const activity = s.activities[idx];
    const nextActivity = s.activities[idx + 1];

    const timeA = getActivityTime(activity).getTime();
    const duration = getActivityDurationMs(activity, nextActivity);
    const midpoint = timeA + duration / 2;

    const newBreak = newBreakActivity("New break", new Date(midpoint), false);

    s.activities.splice(idx + 1, 0, newBreak);
    state._activitiesMutationCounter++;

    s.isEditing = EDITING_ACTIVITY;;
    activitiesViewSetIdx(ctx, s, idx + 1, IN_RANGE);
};

function handleKeyboardInput(ctx: GlobalContext, s: ActivitiesViewState) {
    const { keyboard } = ctx;

    const [lo, hi] = getActivityRange(s);
    const currentActivity = get(s.activities, s.activityListPositon.idx);
    const viewingActivities = hasActivitiesToView(s);

    if (!hasActivitiesToView(s)) {
        s.currentFocus === FOCUS_DATE_SELECTOR;
    }

    if (s.currentFocus === FOCUS_DATE_SELECTOR) {
        s.isEditing = EDITING_NOTHING;
    }

    if (s.currentFocus === FOCUS_ACTIVITIES_LIST) {
        if (s.activityListPositon.idx === lo && hasDiscoverableCommand(ctx, keyboard.upKey, "Select date", REPEAT)) {
            s.currentFocus = FOCUS_DATE_SELECTOR;
        }

        // Moving to the date view - down
        if (
            !isSameDate(s.now, s.currentViewingDate) && 
            s.activityListPositon.idx === s._endActivityIdxEx &&
            hasDiscoverableCommand(ctx, keyboard.downKey, "Next day", REPEAT)
        ) {
            s.currentFocus = FOCUS_DATE_SELECTOR;
            moveToNextDay(ctx, s);
        }

        if (s.isEditing === EDITING_NOTHING) {
            if (
                currentActivity &&
                isBreak(currentActivity) &&
                // !currentActivity.locked && // TODO: review this flag. Not sure what the point of it is.
                hasDiscoverableCommand(ctx, keyboard.enterKey, "Edit break")
            ) {
                s.isEditing = EDITING_ACTIVITY;;
            } 

            if (
                currentActivity &&
                !isBreak(currentActivity) &&
                hasDiscoverableCommand(ctx, keyboard.enterKey, "Edit activity time")
            ) {
                s.isEditing = EDITING_TIME;
            } 

            if (hasDiscoverableCommand(ctx, keyboard.enterKey, "Insert break under", SHIFT)) {
                insertBreakBetweenCurrentAndNext(ctx, s);
            }

            // TODO: make axis discoverable
            const hDelta = getAxisRaw(keyboard.leftKey.pressed, keyboard.rightKey.pressed);
            if (!ctx.handled && hDelta) {
                ctx.handled = true;

                if (currentActivity?.nId) {
                    const note = getNote(state.notes, currentActivity.nId);
                    const hlt = getHigherLevelTask(state, note);

                    let foundIdx = -1;

                    const dir = hDelta > 0 ? 1 : -1;
                    for (
                        let i = s.activityListPositon.idx + dir;
                        i < s.activities.length && i >= 0;
                        i += dir
                    ) {
                        const activity = s.activities[i];
                        if (!activity.nId) continue;
                        const note = getNote(state.notes, activity.nId);
                        const noteHlt = getHigherLevelTask(state, note);
                        if (noteHlt === hlt) {
                            foundIdx = i;
                            break;
                        }
                    }

                    if (foundIdx !== -1) {
                        activitiesViewSetIdx(ctx, s, foundIdx, true);
                    }
                }
            }

            // Moving up/down in the list
            const listNavigation = getNavigableListInput(ctx, s.activityListPositon.idx, lo, hi);
            if (listNavigation) {
                activitiesViewSetIdx(ctx, s, listNavigation.newIdx, false);
            }
        } else if (currentActivity && isBreak(currentActivity)) {
            let command;
            let editNext: EditingStatus;
            if (s.isEditing === EDITING_TIME) {
                command = "Edit break info";
                editNext = EDITING_ACTIVITY;
            } else {
                command = "Edit time";
                editNext = EDITING_TIME;
            }

            if (hasDiscoverableCommand(ctx, keyboard.tabKey, command, BYPASS_TEXT_AREA | REPEAT)) {
                ctx.handled = true;
                s.isEditing = editNext;
            }
        } else {
            if (hasDiscoverableCommand(ctx, keyboard.tabKey, "Do literally nothign", BYPASS_TEXT_AREA | REPEAT)) { /* xddd */ }
        }
    }

    if (s.currentFocus === FOCUS_DATE_SELECTOR) {
        if (
            lo > 0 && 
            hasDiscoverableCommand(ctx, keyboard.leftKey, "Prev day", REPEAT)
        ) {
            moveToPrevDay(ctx, s);
            const [lo, hi] = getActivityRange(s);
            activitiesViewSetIdx(ctx, s, lo, false);
        }

        if (
            !isSameDate(s.now, s.currentViewingDate) && 
            hasDiscoverableCommand(ctx, keyboard.rightKey, "Next day", REPEAT)
        ) {
            moveToNextDay(ctx, s);
        }

        if (
            lo > 0 && 
            hasDiscoverableCommand(ctx, keyboard.upKey, "Prev day - end", REPEAT)
        ) {
            moveToPrevDay(ctx, s);
            s.currentFocus = FOCUS_ACTIVITIES_LIST;
        }

        if (
            hasActivitiesToView(s) &&
            hasDiscoverableCommand(ctx, keyboard.downKey, "Activities", REPEAT)
        ) {
            activitiesViewSetIdx(ctx, s, lo, true);
            s.currentFocus = FOCUS_ACTIVITIES_LIST;
        }

        if (
            s.activities.length > 0 && 
            !s.filteredActivities &&
            hasDiscoverableCommand(ctx, keyboard.homeKey, "First day")
        ) {
            setCurrentViewingDate(s, s.activities[0].t);
        }

        if (
            s.activities.length > 0 && 
            !s.filteredActivities &&
            hasDiscoverableCommand(ctx, keyboard.endKey, "Today")
        ) {
            setCurrentViewingDate(s, s.now);
        }
    }

    // escape key
    if (s.isEditing !== EDITING_NOTHING) {
        if (
            hasDiscoverableCommand(ctx, keyboard.enterKey, "Finish editing", BYPASS_TEXT_AREA) ||
            hasDiscoverableCommand(ctx, keyboard.escapeKey, "Finish editing", BYPASS_TEXT_AREA) // TODO: escape has to also revert the edit.
        ) {
            s.isEditing = EDITING_NOTHING;
            ctx.handled = true;
        }
    }
}

function setCurrentViewingDate(s: ActivitiesViewState, newDate: Date) {
    newDate = new Date(newDate);
    floorDateLocalTime(newDate);
    s.currentViewingDate = newDate;
}

function hasActivitiesToView(s: ActivitiesViewState): boolean {
    return s._startActivityIdx < s._endActivityIdxEx;
}

function getCurrentFocus(s: ActivitiesViewState) {
    const hasActivities = hasActivitiesToView(s);
    if (!hasActivities) {
        return FOCUS_DATE_SELECTOR;
    }

    return s.currentFocus;
}

export function imActivitiesList(c: ImCache, ctx: GlobalContext, s: ActivitiesViewState) {
    const viewHasFocus = ctx.currentView === s;

    s.now = ctx.now;

    const filter = s.inputs.activityFilter;

    if (imMemo(c, filter)) {
        // recompute filtered activities

        if (filter) {
            filter.sort((a, b) => a - b);
            s.filteredActivities = [];
            for (let i = 0; i < filter.length; i++) {
                const idx = filter[i];
                const activity = state.activities[idx]; assert(!!activity);
                s.filteredActivities.push(activity);
            }

            const current = arrayAt(s.activities, s.activityListPositon.idx);
            if (current) {
                const idx = s.filteredActivities.indexOf(current);
                if (idx !== -1) {
                    activitiesViewSetIdx(ctx, s, idx, NOT_IN_RANGE);
                }
            }
        } else {
            s.filteredActivities = null;
        }
    }

    if (imMemo(c, s.filteredActivities)) {
        if (s.filteredActivities) {
            s.activities = s.filteredActivities;
        } else {
            s.activities = state.activities;
        }
    }

    const viewHasFocusChanged = imMemo(c, viewHasFocus);
    if (viewHasFocusChanged) {
        if (!viewHasFocus) {
            s.currentFocus = FOCUS_ACTIVITIES_LIST;
        }
    }

    if (imMemo(c, state.currentNoteId) && !viewHasFocus) {
        // Let's make sure the activity we're lookint at is always the most recent
        // activity for the current note.

        const idx = s.activityListPositon.idx;
        if (boundsCheck(s.activities, idx)) {
            const activity = s.activities[idx];
            if (activity.nId !== state.currentNoteId) {
                let newActivityIdx = -1;
                for (let i = state.activities.length - 1; i >= 0; i--) {
                    const activity = state.activities[i];
                    if (activity.nId === state.currentNoteId) {
                        newActivityIdx = i;
                        break;
                    }
                }

                if (newActivityIdx !== -1) {
                    activitiesViewSetIdx(ctx, s, newActivityIdx, NOT_IN_RANGE);
                }
            }
        }
    }

    if (imMemo(c, s.currentViewingDate)) {
        s._startActivityIdx = getActivitiesForDateStartIdx(s.activities, s.currentViewingDate, s._startActivityIdx);
    }

    // We can append or delete activities. So the end index isn't cached
    s._endActivityIdxEx = getActivitiesNextDateStartIdx(s.activities, s._startActivityIdx);

    const hasActivities = hasActivitiesToView(s);
    const currentFocus = getCurrentFocus(s);

    s._canMoveToPrevDay = s._startActivityIdx !== 0;
    s._canMoveToNextDay = s._endActivityIdxEx !== s.activities.length;

    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);
    }

    imLayout(c, COL); imFlex(c); {
        imLayout(c, ROW); imListRowCellStyle(c); imAlign(c); imJustify(c); {
            if (isFirstishRender(c)) {
                elSetStyle(c, "fontWeight", "bold");
            }

            let text = "[Shift+B] to take a break";
            const last = getLastActivity(state);
            if (last && isBreak(last)) {
                text = "Taking a break...";
                if (last.breakInfo) {
                    text = "Taking a break: " + last.breakInfo;
                }
            } 

            imStr(c, text);

        } imLayoutEnd(c);

        const dateSelectorFocused  = currentFocus === FOCUS_DATE_SELECTOR;

        imBeginListRow(
            c,
            dateSelectorFocused,
            viewHasFocus && dateSelectorFocused
        ); {
            if (isFirstishRender(c)) {
                elSetStyle(c, "fontWeight", "bold");
            }

            imLayout(c, ROW); imFlex(c); imListRowCellStyle(c); imGap(c, 1, CH); {

                imLayout(c, BLOCK); imFlex(c); imLayoutEnd(c);

                if (imIf(c) && dateSelectorFocused && s._canMoveToPrevDay) {
                    // TODO: buttons
                    imLayout(c, BLOCK); imStr(c, "<-"); imLayoutEnd(c);
                } imIfEnd(c);

                imLayout(c, ROW); {
                    let dateText;
                    if (isSameDate(s.currentViewingDate, s.now)) {
                        dateText = " today (" + formatDate(s.currentViewingDate, true) + ")";
                    } else {
                        dateText = " on " + formatDate(s.currentViewingDate, true);
                    }

                    let text;
                    if (dateSelectorFocused || !hasActivities) {
                        text = dateText;
                    } else {
                        const numActivities = s._endActivityIdxEx - s._startActivityIdx;
                        const relIdx = s.activityListPositon.idx - s._startActivityIdx;
                        text = "Activity " + (relIdx + 1) + "/" + numActivities + dateText;
                    }

                    imStr(c, text);

                    if (imIf(c) && filter) {
                        imStr(c, `[Filtered, ${filter.length} entries]`);
                    } imIfEnd(c);
                } imLayoutEnd(c);

                if (imIf(c) && dateSelectorFocused && s._canMoveToNextDay) {
                    // TODO: buttons
                    imLayout(c, BLOCK); imStr(c, "->"); imLayoutEnd(c);
                } imIfEnd(c);

                imLayout(c, BLOCK); imFlex(c); imLayoutEnd(c);
            } imLayoutEnd(c);

        } imEndListRow(c);

        imLine(
            c,
            LINE_HORIZONTAL, 1,
            !!s.scrollContainer.root && s.scrollContainer.root.scrollTop > 1,
        );

        const list = imBeginNavList(
            c,
            s.scrollContainer,
            s.activityListPositon.idx,
            viewHasFocus && currentFocus === FOCUS_ACTIVITIES_LIST,
            !!s.isEditing
        ); {
            const current = getCurrentNote(state);
            const hlt = getHigherLevelTask(state, current);

            while (navListNextItemSlice(
                list, 
                s._startActivityIdx, s._endActivityIdxEx
            )) {
                const { i, itemSelected } = list;
                const activity = s.activities[i];

                imKeyed(c, activity); {
                    const isEditingActivity = viewHasFocus && itemSelected && s.isEditing === EDITING_ACTIVITY;
                    const isEditingTime = viewHasFocus && itemSelected && s.isEditing === EDITING_TIME;

                    let itemHighlighted = itemSelected;
                    if (!itemHighlighted && hlt) {
                        if (activity.nId) {
                            const note = getNote(state.notes, activity.nId);
                            const noteHlt = getHigherLevelTask(state, note);
                            if (noteHlt === hlt) {
                                itemHighlighted = true;
                            }
                        }
                    }

                    const isBreakActivity = isBreak(activity);

                    imBeginNavListRow(c, list, itemHighlighted); {
                        imLayout(c, ROW); imListRowCellStyle(c); imGap(c, 10, PX); imFlex(c); imAlign(c); {
                            imLayout(c, INLINE_BLOCK); {
                                if (imIf(c) && isEditingTime) {
                                    const lowerBound = get(s.activities, i - 1)?.t;
                                    const upperBound = get(s.activities, i + 1)?.t;

                                    const { edit, textArea } = imEditableTime(c, activity.t, lowerBound ?? null, upperBound);

                                    if (edit) {
                                        let newVal: Date | undefined;
                                        if (edit.timeInput) {
                                            newVal = edit.timeInput;
                                        } else if (edit.durationInput) {
                                            newVal = cloneDate(upperBound ?? null) || new Date();
                                            newVal.setTime(newVal.getTime() - edit.durationInput);
                                        }

                                        if (newVal) {
                                            newVal = clampDate(newVal, lowerBound ?? null, upperBound ?? null);
                                            activity.t = newVal;
                                            state._activitiesMutationCounter++;
                                            ctx.handled = true;
                                        }
                                    }

                                    ctx.textAreaToFocus = textArea;
                                    ctx.focusWithAllSelected = true;
                                } else {
                                    imIfElse(c);

                                    imLayout(c, BLOCK); imStr(c, formatTime(activity.t)); imNoWrap(c); imLayoutEnd(c);
                                } imIfEnd(c);

                                const duration = getActivityDurationMs(activity, s.activities[i + 1]);
                                imLayout(c, BLOCK); imStr(c, formatDuration(duration, 2)); imNoWrap(c); imLayoutEnd(c);
                            } imLayoutEnd(c);

                            imLine(c, LINE_VERTICAL, 1);

                            let text = getActivityText(state, activity);
                            imLayout(c, ROW); imAlign(c); imJustify(c, isBreakActivity ? CENTER : NONE); imFlex(c); {
                                if (imMemo(c, isBreakActivity)) {
                                    elSetStyle(c, "padding", isBreakActivity ? "40px" : "0");
                                }

                                const isEditingActivityChanged = imMemo(c, isEditingActivity);
                                if (imIf(c) && !isEditingActivity) {
                                    imLayout(c, BLOCK); imStr(c, text); imLayoutEnd(c);
                                } else {
                                    imIfElse(c);

                                    const [, textArea] = imBeginTextArea(c, {
                                        value: activity.breakInfo ?? "",
                                        placeholder: "Enter break info",
                                    }); {
                                        const input = imOn(c, EV_INPUT);
                                        const change = imOn(c, EV_CHANGE);

                                        if (input || change) {
                                            activity.breakInfo = textArea.value;
                                            state._activitiesMutationCounter++;
                                            ctx.handled = true;
                                        }

                                        if (isEditingActivityChanged) {
                                            textArea.selectionStart = textArea.value.length;
                                            textArea.selectionEnd = textArea.value.length;
                                        }

                                        ctx.textAreaToFocus = textArea;
                                        ctx.focusWithAllSelected = true;
                                    } imEndTextArea(c);
                                } imIfEnd(c);
                            } imLayoutEnd(c);
                        } imLayoutEnd(c);
                    } imEndNavListRow(c);
                } imKeyedEnd(c);
            } 

            imKeyed(c, "footer"); {
                if (imIf(c) && !hasActivities) {
                    imLayout(c, ROW); imFlex(c); imAlign(c); imJustify(c); {
                        imStr(c, s.activities.length === 0 ? "No activities yet!" : "No activities today");
                    } imLayoutEnd(c);
                } imIfEnd(c);
            } imKeyedEnd(c);
        } imEndNavList(c, list);
    } imLayoutEnd(c);
}
