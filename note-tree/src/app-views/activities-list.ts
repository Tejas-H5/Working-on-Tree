import { imListRowBegin, imListRowCellStyle, imListRowEnd, } from "src/app-components/list-row";
import {
    clampedListIdx,
    clampedListIdxRange,
    getNavigableListInput,
    imNavListBegin,
    imNavListEnd,
    imNavListRowBegin,
    imNavListRowEnd,
    ListPosition,
    navListNextItemSlice,
    newListPosition
} from "src/app-components/navigable-list";
import { imEditableTime } from "src/app-components/time-input";
import { BLOCK, CENTER, CH, COL, imAlign, imFlex, imGap, imJustify, imLayoutBegin, imLayoutEnd, imNoWrap, imSize, INLINE_BLOCK, NA, NONE, PX, ROW } from "src/components/core/layout";
import { imTextAreaBegin, imTextAreaEnd } from "src/components/editable-text-area";
import { imLine, LINE_HORIZONTAL } from "src/components/im-line";
import { newScrollContainer, ScrollContainer, startScrolling } from "src/components/scroll-container";
import { BYPASS_TEXT_AREA, debouncedSave, getAxisRaw, GlobalContext, hasDiscoverableCommand, REPEAT, SHIFT } from "src/global-context";
import {
    Activity,
    getActivityDate,
    getActivityDurationMs,
    getActivityText,
    getCurrentNote,
    getHigherLevelTask,
    getLastActivity,
    getLastActivityForNoteIdx,
    getNote,
    isBreak,
    isCurrentlyTakingABreak,
    newBreakActivity,
    pushBreakActivity,
    setCurrentNote,
    state
} from "src/state";
import { arrayAt, boundsCheck } from "src/utils/array-utils";
import { assert } from "src/utils/assert";
import { clampDate, cloneDate, floorDateLocalTime, formatDate, formatDuration, formatTime, isSameDate, ONE_MINUTE } from "src/utils/datetime";
import { ImCache, imFor, imForEnd, imIf, imIfElse, imIfEnd, imKeyedBegin, imKeyedEnd, imMemo, isFirstishRender } from "src/utils/im-core";
import { elSetStyle, EV_CHANGE, EV_INPUT, getGlobalEventSystem, imOn, imStr } from "src/utils/im-dom";
import { isKeyPressedOrRepeated } from "src/utils/key-state";

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
    debouncedSave(ctx, state, activitiesViewTakeBreak.name);
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
    const [_lo, hi] = getActivityRange(s);

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
    const [lo, _hi] = getActivityRange(s);

    if (lo > 0) {
        // move to prev day
        activitiesViewSetIdx(ctx, s, lo - 1, true);
    }
}

export function activitiesViewSetIdx(ctx: GlobalContext, s: ActivitiesViewState, idx: number, notInRange: boolean) {
    if (s.activities.length === 0) return;

    if (s.scrollContainer) {
        startScrolling(s.scrollContainer, true);
    }

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

function canInsertBreak(_ctx: GlobalContext, s: ActivitiesViewState) {
    const currentActivity = arrayAt(s.activities, s.activityListPositon.idx);
    if (!currentActivity) return false;

    return true;
}

function insertBreak(
    ctx: GlobalContext,
    s: ActivitiesViewState
) {
    // TODO: make this work when we have filtered activities
    if (!canInsertBreak(ctx, s)) return;

    const filteredListIdx = s.activityListPositon.idx;
    const activity = arrayAt(s.activities, filteredListIdx);
    if (!activity) {
        return;
    }

    const allActivities = state.activities;

    const idx = allActivities.indexOf(activity);
    if (idx === -1) {
        return;
    }
    
    const nextActivity = arrayAt(allActivities, idx + 1);

    const timeA = getActivityDate(activity).getTime();
    const duration = getActivityDurationMs(activity, nextActivity);
    const midpoint = timeA + duration / 2;

    const newBreak = newBreakActivity("New break", new Date(midpoint), false);

    allActivities.splice(idx + 1, 0, newBreak);
    state._activitiesMutationCounter++;
    state._activitiesLastTouchedIdx = filteredListIdx + 1;
    if (s.activities !== allActivities) {
        // TODO: figure out a way for state._activitiesMutationCounter to flow down into us.
        // state._activitiesMutationCounter -> duration view filter changes -> this thing's activities list changes -> 
        // but it can't work, because we use the index to know what the 'current activity' is. sooo maybe idx not good?
        s.activities.splice(filteredListIdx + 1, 0, newBreak);
    }
    activitiesViewSetIdx(ctx, s, filteredListIdx + 1, false);

    s.isEditing = EDITING_ACTIVITY;;
    debouncedSave(ctx, state, "Insert break activities list");
};

function handleKeyboardInput(ctx: GlobalContext, s: ActivitiesViewState) {
    const { keyboard } = ctx;

    const [lo, hi] = getActivityRange(s);
    const currentActivity = arrayAt(s.activities, s.activityListPositon.idx);

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
            s.activityListPositon.idx === s._endActivityIdxEx - 1 &&
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
                s.isEditing = EDITING_ACTIVITY;
            } 

            if (
                currentActivity &&
                !isBreak(currentActivity) &&
                hasDiscoverableCommand(ctx, keyboard.enterKey, "Edit activity time")
            ) {
                s.isEditing = EDITING_TIME;
            } 

            if (canInsertBreak(ctx, s) && hasDiscoverableCommand(ctx, keyboard.enterKey, "Insert break under", SHIFT)) {
                insertBreak(ctx, s);
            }

            const keys = getGlobalEventSystem().keyboard.keys;

            // TODO: make axis discoverable
            const hDelta = getAxisRaw(isKeyPressedOrRepeated(keys, keyboard.leftKey), isKeyPressedOrRepeated(keys, keyboard.rightKey));
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
            const [lo, _hi] = getActivityRange(s);
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

    let currentActivity = arrayAt(s.activities, s.activityListPositon.idx);

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

        let idx = s.activities.length - 1;
        if (currentActivity) {
            const currIdx = s.activities.indexOf(currentActivity);
            if (currIdx !== -1) {
                idx = currIdx;
            }
        }

        activitiesViewSetIdx(ctx, s, idx, NOT_IN_RANGE);
        currentActivity = arrayAt(s.activities, s.activityListPositon.idx);
    }

    const viewHasFocusChanged = imMemo(c, viewHasFocus);
    if (viewHasFocusChanged) {
        if (!viewHasFocus) {
            s.currentFocus = FOCUS_ACTIVITIES_LIST;
        }
    }

    const activitiesMutated = imMemo(c, state._activitiesMutationCounter);
    if (activitiesMutated || viewHasFocusChanged) {
        // Don't track the current note if this UI is focused, as it will also move the current note when navigating activities
        if (!viewHasFocus) {
            activitiesViewSetIdx(ctx, s, state._activitiesLastTouchedIdx, true);
        }
    }

    const currentNote = getCurrentNote(state);
    if (imMemo(c, currentNote) && !viewHasFocus) {
        // Let's make sure the activity we're lookint at is always the most recent
        // activity for the current note.

        const idx = s.activityListPositon.idx;
        if (boundsCheck(s.activities, idx)) {
            const activity = s.activities[idx];
            if (activity.nId !== state.currentNoteId) {
                const newActivityIdx = getLastActivityForNoteIdx(state, state.currentNoteId);
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

    imLayoutBegin(c, COL); imFlex(c); {
        imLayoutBegin(c, ROW); imListRowCellStyle(c); imAlign(c); imJustify(c); {
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

        imListRowBegin(
            c,
            dateSelectorFocused,
            dateSelectorFocused,
            viewHasFocus && dateSelectorFocused
        ); {
            if (isFirstishRender(c)) {
                elSetStyle(c, "fontWeight", "bold");
            }

            imLayoutBegin(c, ROW); imFlex(c); imListRowCellStyle(c); imGap(c, 1, CH); {

                imLayoutBegin(c, BLOCK); imFlex(c); imLayoutEnd(c);

                if (imIf(c) && dateSelectorFocused && s._canMoveToPrevDay) {
                    // TODO: buttons
                    imLayoutBegin(c, BLOCK); imStr(c, "<-"); imLayoutEnd(c);
                } imIfEnd(c);

                imLayoutBegin(c, ROW); {
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
                    imLayoutBegin(c, BLOCK); imStr(c, "->"); imLayoutEnd(c);
                } imIfEnd(c);

                imLayoutBegin(c, BLOCK); imFlex(c); imLayoutEnd(c);
            } imLayoutEnd(c);

        } imListRowEnd(c);

        imLine(
            c,
            LINE_HORIZONTAL, 1,
            !!s.scrollContainer.root && s.scrollContainer.root.scrollTop > 1,
        );

        const list = imNavListBegin(
            c,
            s.scrollContainer,
            s.activityListPositon.idx,
            viewHasFocus && currentFocus === FOCUS_ACTIVITIES_LIST,
            !!s.isEditing
        ); {
            const current = getCurrentNote(state);
            const hlt = getHigherLevelTask(state, current);

            // We want to accumulate activity durations, and display it once it's large enough
            let totalDuration = 0;

            imFor(c); while (navListNextItemSlice(
                list, 
                s._startActivityIdx, s._endActivityIdxEx
            )) {
                const { i, itemSelected } = list;

                const activity = s.activities[i];
                const nextActivity = arrayAt(s.activities, i + 1);

                imKeyedBegin(c, activity); {
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

                    imNavListRowBegin(c, list, itemHighlighted, itemSelected); {
                        imLayoutBegin(c, ROW); imListRowCellStyle(c); imGap(c, 10, PX); imFlex(c); imAlign(c); {
                            imLayoutBegin(c, INLINE_BLOCK); {
                                if (imIf(c) && isEditingTime) {
                                    const lowerBound = arrayAt(s.activities, i - 1)?.t;
                                    const upperBound = arrayAt(s.activities, i + 1)?.t;

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
                                            debouncedSave(ctx, state, "Activities list time input");
                                            ctx.handled = true;
                                        }
                                    }

                                    ctx.textAreaToFocus = textArea;
                                    ctx.focusWithAllSelected = true;
                                } else {
                                    imIfElse(c);

                                    imLayoutBegin(c, BLOCK); imStr(c, formatTime(activity.t)); imNoWrap(c); imLayoutEnd(c);
                                } imIfEnd(c);
                            } imLayoutEnd(c);

                            imLayoutBegin(c, BLOCK); imSize(c, 5, PX, 0, NA); imLayoutEnd(c);

                            let text = getActivityText(state, activity);
                            imLayoutBegin(c, ROW); imAlign(c); imJustify(c, isBreakActivity ? CENTER : NONE); imFlex(c); {
                                if (imMemo(c, isBreakActivity)) {
                                    elSetStyle(c, "padding", isBreakActivity ? "40px" : "0");
                                }

                                const isEditingActivityChanged = imMemo(c, isEditingActivity);
                                if (imIf(c) && !isEditingActivity) {
                                    imLayoutBegin(c, BLOCK); imStr(c, text); imLayoutEnd(c);
                                } else {
                                    imIfElse(c);

                                    const [, textArea] = imTextAreaBegin(c, {
                                        value: activity.breakInfo ?? "",
                                        placeholder: "Enter break info",
                                    }); {
                                        const input = imOn(c, EV_INPUT);
                                        const change = imOn(c, EV_CHANGE);

                                        if (input || change) {
                                            activity.breakInfo = textArea.value;
                                            debouncedSave(ctx, state, "Break info input");
                                            ctx.handled = true;
                                        }

                                        if (isEditingActivityChanged) {
                                            textArea.selectionStart = textArea.value.length;
                                            textArea.selectionEnd = textArea.value.length;
                                        }

                                        ctx.textAreaToFocus = textArea;
                                        ctx.focusWithAllSelected = true;
                                    } imTextAreaEnd(c);
                                } imIfEnd(c);
                            } imLayoutEnd(c);
                        } imLayoutEnd(c);
                    } imNavListRowEnd(c);

                    const activityDuration = getActivityDurationMs(activity, nextActivity);
                    totalDuration += activityDuration;
                    if (imIf(c) && totalDuration > ONE_MINUTE * 5) {
                        imLayoutBegin(c, ROW); imAlign(c); imJustify(c); {
                            imStr(c, formatDuration(totalDuration));
                            totalDuration = 0
                        } imLayoutEnd(c);
                    } imIfEnd(c);
                } imKeyedEnd(c);
            } imForEnd(c);

            imKeyedBegin(c, "footer"); {
                if (imIf(c) && !hasActivities) {
                    imLayoutBegin(c, ROW); imFlex(c); imAlign(c); imJustify(c); {
                        imStr(c, s.activities.length === 0 ? "No activities yet!" : "No activities today");
                    } imLayoutEnd(c);
                } imIfEnd(c);
            } imKeyedEnd(c);
        } imNavListEnd(c, list);
    } imLayoutEnd(c);
}
