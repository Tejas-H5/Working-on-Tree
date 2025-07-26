import {
    imBeginScrollContainer, 
    newScrollContainer,
    ScrollContainer,
    scrollToItem,
    startScrolling
} from "src/components/scroll-container";
import { imLine } from "./app-components/common";
import {
    CENTER,
    CH,
    COL,
    imAlign,
    imBegin,
    imFlex,
    imGap,
    imInitClasses,
    imJustify,
    imText,
    INLINE_BLOCK,
    NONE,
    PX,
    ROW
} from "./components/core/layout";
import { cn } from "./components/core/stylesheets";
import { imSpan } from "./components/core/text";
import { imBeginTextArea, imEndTextArea } from "./components/editable-text-area";
import { imEditableTime } from "./time-input";
import {
    addToNavigationList,
    BYPASS_TEXT_AREA,
    getAxisRaw,
    GlobalContext,
    hasDiscoverableCommand,
    hasDiscoverableHold,
    REPEAT,
    updateDiscoverableCommands
} from "./global-context";
import {
    imBeginListRow,
    imEndListRow,
    imListRowCellStyle,
    ROW_EDITING,
    ROW_EXISTS,
    ROW_FOCUSED,
    ROW_HIGHLIGHTED,
    ROW_SELECTED
} from "./list-row";
import {
    clampedListIdx,
    clampedListIdxRange,
    getNavigableListInput,
    ListPosition,
    newListPosition
} from "./navigable-list";
import {
    Activity,
    APP_VIEW_ACTIVITIES,
    getActivityDurationMs,
    getActivityText,
    getActivityTime,
    getCurrentNote,
    getHigherLevelTask,
    getLastActivity,
    getNote,
    isBreak,
    isCurrentlyTakingABreak,
    newBreakActivity,
    pushBreakActivity,
    state
} from "./state";
import { boundsCheck, get } from "./utils/array-utils";
import {
    clampDate,
    cloneDate,
    floorDateLocalTime,
    formatDate,
    formatDuration,
    formatTime,
    formatTimeForInput,
    isDayBefore,
    isSameDate
} from "./utils/datetime";
import {
    getImCore,
    HORIZONTAL,
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imMemo,
    imMemoMany,
    imNextRoot,
    imOn,
    isFirstishRender,
    setStyle,
    setText,
    VERTICAL
} from "./utils/im-dom-utils";
import { assert, mustGet } from "./utils/assert";

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
    activities: Activity[];

    viewHasFocus: boolean;

    currentFocus: typeof FOCUS_ACTIVITIES_LIST | typeof FOCUS_DATE_SELECTOR;
    activityListPositon: ListPosition;
    isEditing: EditingStatus;

    scrollContainer: ScrollContainer;

    now: Date;

    currentViewingDate: Date;
    _startActivityIdx: number;
    _endActivityIdxEx: number; // exclusive index
    _canMoveToNextDay: boolean;
    _canMoveToPrevDay: boolean;
}




export function newActivitiesViewState(): ActivitiesViewState {
    return {
        activities: [],

        viewHasFocus: false,

        currentFocus: FOCUS_ACTIVITIES_LIST,
        activityListPositon: newListPosition(),
        isEditing: EDITING_NOTHING,

        scrollContainer: newScrollContainer(),

        now: new Date(),

        currentViewingDate: new Date(),

        _startActivityIdx: 0,
        _endActivityIdxEx: 0,
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
    activitiesViewSetIdx(ctx.activityView, ctx.activityView.activities.length - 1, NOT_IN_RANGE);
    s.isEditing = EDITING_ACTIVITY;
    ctx.requestSaveState = true;
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
    const lo = s._startActivityIdx;
    const hi = s._endActivityIdxEx;
    return [lo, hi];
}

export const IN_RANGE = false;
export const NOT_IN_RANGE = true;

export function activitiesViewSetIdx(s: ActivitiesViewState, idx: number, notInRange: boolean) {
    if (s.activities.length === 0) return;

    let newIdx = idx;

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
            state.currentNoteId = activity.nId;
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

    ctx.requestSaveState = true;
    s.isEditing = EDITING_ACTIVITY;;
    activitiesViewSetIdx(s, idx + 1, IN_RANGE);
};

function handleKeyboardInput(ctx: GlobalContext, s: ActivitiesViewState) {
    const { keyboard } = ctx;

    let nextActivityIdx = -1;
    let nextActivityIdxNotInRange = false;

    const shift = hasDiscoverableHold(ctx, keyboard.shiftKey);

    const lastIdx = s.activityListPositon.idx;
    const currentActivity = get(s.activities, s.activityListPositon.idx);
    const viewingActivities = hasActivitiesToView(s);
    const currentFocus = getCurrentFocus(s);
    const activityListFocused = currentFocus === FOCUS_ACTIVITIES_LIST;
    const dateSelectorFocused = currentFocus === FOCUS_DATE_SELECTOR;

    if (dateSelectorFocused) {
        s.isEditing = EDITING_NOTHING;
    }

    // Moving up/down
    const delta = getNavigableListInput(ctx);
    if (!ctx.handled && delta) {
        const [lo, hi] = getActivityRange(s);

        if (activityListFocused) {
            if (s.isEditing === EDITING_NOTHING) {
                if (s.activityListPositon.idx === lo && delta < 0) {
                    s.currentFocus = FOCUS_DATE_SELECTOR;
                    ctx.handled = true;
                } else if (s.activityListPositon.idx === hi - 1 && delta > 0) {
                    // move to next day
                    if (hi < s.activities.length - 1) {
                        setCurrentViewingDate(s, s.activities[hi + 1].t);
                        const [lo2] = getActivityRange(s);
                        nextActivityIdx = lo - 1;
                        s.currentFocus = FOCUS_DATE_SELECTOR;
                    } else if (!isSameDate(s.now, s.currentViewingDate)) {
                        setCurrentViewingDate(s, s.now);
                        s.currentFocus = FOCUS_DATE_SELECTOR;
                    }
                    ctx.handled = true;
                } else {
                    nextActivityIdx = s.activityListPositon.idx + delta;
                    ctx.handled = true;
                }
            }
        } else {
            if (delta > 0 && viewingActivities) {
                s.currentFocus = FOCUS_ACTIVITIES_LIST;
                nextActivityIdx = lo;
                ctx.handled = true;
            } else if (delta < 0) {
                if (lo > 0) {
                    // move to prev day
                    nextActivityIdx = lo - 1;
                    nextActivityIdxNotInRange = true;
                    s.currentFocus = FOCUS_ACTIVITIES_LIST;
                }
                ctx.handled = true;
            }
        }
    }

    if (!ctx.handled && activityListFocused) {
        if (s.isEditing === EDITING_NOTHING) {
            if (keyboard.homeKey.pressed) {
                const [lo, hi] = getActivityRange(s);
                nextActivityIdx = lo;
                ctx.handled = true;
            } else if (keyboard.endKey.pressed) {
                const [lo, hi] = getActivityRange(s);
                nextActivityIdx = hi - 1;
                ctx.handled = true;
            } else if (
                currentActivity &&
                isBreak(currentActivity) &&
                // !currentActivity.locked && // TODO: review this flag. Not sure what the point of it is.
                !shift && hasDiscoverableCommand(ctx, keyboard.enterKey, "Edit break")
            ) {
                s.isEditing = EDITING_ACTIVITY;;
                ctx.handled = true;
            } else if (
                currentActivity &&
                !isBreak(currentActivity) &&
                !shift &&  hasDiscoverableCommand(ctx, keyboard.enterKey, "Edit activity time")
            ) {
                s.isEditing = EDITING_TIME;
                ctx.handled = true;
            } else if (shift) {
                if (hasDiscoverableCommand(ctx, keyboard.enterKey, "Insert break under")) {
                    insertBreakBetweenCurrentAndNext(ctx, s);
                    ctx.handled = true;
                }
            }

            // TODO: make axis discoverable
            const hDelta = getAxisRaw(keyboard.leftKey.pressed, keyboard.rightKey.pressed);
            if (!ctx.handled && hDelta) {
                if (currentActivity?.nId) {
                    const note = getNote(state, currentActivity.nId);
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
                        const note = getNote(state, activity.nId);
                        const noteHlt = getHigherLevelTask(state, note);
                        if (noteHlt === hlt) {
                            foundIdx = i;
                            break;
                        }
                    }

                    if (foundIdx !== -1) {
                        nextActivityIdx = foundIdx;
                        nextActivityIdxNotInRange = true;
                    }
                }
                ctx.handled = true;
            }
        } else {
            if (currentActivity && isBreak(currentActivity)) {
                let command;
                let editNext: EditingStatus;
                if (s.isEditing === EDITING_TIME) {
                    command = "Edit break info";
                    editNext = EDITING_ACTIVITY;
                } else  {
                    command = "Edit time";
                    editNext = EDITING_TIME;
                }

                if (hasDiscoverableCommand(ctx, keyboard.tabKey, command, BYPASS_TEXT_AREA | REPEAT)) {
                    ctx.handled = true;
                    s.isEditing = editNext;
                }
            } else {
                if (hasDiscoverableCommand(ctx, keyboard.tabKey, "Do literally nothign", BYPASS_TEXT_AREA | REPEAT)) {
                    // xddd
                    ctx.handled = true;
                }
            }
        }
    }


    // escape key
    if (!ctx.handled) {
        if (s.isEditing !== EDITING_NOTHING) {
            if (
                hasDiscoverableCommand(ctx, keyboard.enterKey, "Finish editing", BYPASS_TEXT_AREA) ||
                hasDiscoverableCommand(ctx, keyboard.escapeKey, "Finish editing", BYPASS_TEXT_AREA) // TODO: this has to revert the edit.
            ) {
                s.isEditing = EDITING_NOTHING;
                ctx.handled = true;
            }
        }
    }

    if (!ctx.handled && dateSelectorFocused) {
        let newDate: Date | undefined;

        if (s.activities.length > 0) {
            if (keyboard.homeKey.pressed) {
                newDate = s.activities[0].t;
            } else if (keyboard.endKey.pressed) {
                newDate = s.now;
            }
        }

        if (!newDate) {
            const hDelta = getAxisRaw(keyboard.leftKey.pressed, keyboard.rightKey.pressed);

            if (hDelta) {
                const [lo, hi] = getActivityRange(s);
                if (hDelta > 0) {
                    if (hi < s.activities.length - 1) {
                        // next day
                        newDate = s.activities[hi + 1].t;
                    } else {
                        // today
                        newDate = s.now;
                    }
                    ctx.handled = true;
                } else if (hDelta < 0) {
                    if (lo > 0) {
                        // previous day
                        newDate = s.activities[lo - 1].t;
                    }
                    ctx.handled = true;
                }
            }
        }

        if (newDate) {
            if (isDayBefore(s.now, newDate)) {
                newDate = s.now;
            } else if (s.activities.length > 0 && isDayBefore(newDate, s.activities[0].t)) {
                newDate = s.activities[0].t;
            }
            setCurrentViewingDate(s, newDate);
            ctx.handled = true;
        }
    }

    // Move activities. Also delete the current activity if it was empty.
    // TODO: we need a more robust way to do this, without simply recomputing the entire list like before.
    if (ctx.handled && nextActivityIdx !== -1) {
        if (boundsCheck(s.activities, lastIdx)) {
            const lastActivity = s.activities[lastIdx];
            if (isBreak(lastActivity) && lastActivity.breakInfo !== undefined && lastActivity.breakInfo.length === 0) {
                s.activities.splice(lastIdx, 1);
                if (nextActivityIdx >= lastIdx) {
                    nextActivityIdx--;
                }
            }
        }

        activitiesViewSetIdx(s, nextActivityIdx, nextActivityIdxNotInRange);
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

export function imActivitiesList(
    ctx: GlobalContext,
    s: ActivitiesViewState,
    viewHasFocus: boolean
) {
    addToNavigationList(ctx, APP_VIEW_ACTIVITIES);

    s.activities = state.activities;;

    s.now = ctx.now;

    const viewHasFocusChanged = imMemo(viewHasFocus);
    if (viewHasFocusChanged) {
        if (!viewHasFocus) {
            s.currentFocus = FOCUS_ACTIVITIES_LIST;
            activitiesViewSetIdx(s, s.activities.length - 1, NOT_IN_RANGE);
        }
    }

    if (imMemoMany(
        s.activityListPositon.idx,
        s.currentFocus
    )) {
        startScrolling(s.scrollContainer, true);
    }

    if (imMemo(s.currentViewingDate)) {
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

    imBegin(COL); imFlex(); {

        imBegin(ROW); imListRowCellStyle(); imAlign(); imJustify(); {
            if (isFirstishRender()) {
                setStyle("fontWeight", "bold");
            }

            let text = "[Shift+B] to take a break";
            const last = getLastActivity(state);
            if (last && isBreak(last)) {
                text = "Taking a break...";
                if (last.breakInfo) {
                    text = "Taking a break: " + last.breakInfo;
                }
            } 
            imText(text);

        } imEnd();

        const dateSelectorFocused  = currentFocus === FOCUS_DATE_SELECTOR;

        imBeginListRow(dateSelectorFocused ? (viewHasFocus ? ROW_FOCUSED : ROW_SELECTED) : ROW_EXISTS); {
            if (isFirstishRender()) {
                setStyle("fontWeight", "bold");
            }

            imBegin(ROW); imFlex(); imListRowCellStyle(); imGap(1, CH); {
                imBegin(); imFlex(); imEnd();

                if (imIf() && dateSelectorFocused && s._canMoveToPrevDay) {
                    // TODO: buttons
                    imBegin(); setText("<-"); imEnd();
                } imEndIf();

                imBegin(ROW); {
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
                    imSpan(text); imEnd();
                } imEnd();

                if (imIf() && dateSelectorFocused && s._canMoveToNextDay) {
                    // TODO: buttons
                    imBegin(); setText("->"); imEnd();
                } imEndIf();

                imBegin(); imFlex(); imEnd();
            } imEnd();

        } imEnd();

        imLine(
            HORIZONTAL, 1,
            !!s.scrollContainer.root && s.scrollContainer.root.root.scrollTop > 1,
        );

        imBeginScrollContainer(s.scrollContainer); {
            const current = getCurrentNote(state);
            const hlt = getHigherLevelTask(state, current);

            imFor(); for (
                let idx = s._startActivityIdx;
                idx < s._endActivityIdxEx;
                idx++
            ) {
                const activity = s.activities[idx];
                imNextRoot(activity);

                const itemSelected = currentFocus === FOCUS_ACTIVITIES_LIST &&
                    s.activityListPositon.idx === idx;

                const isEditingActivity = viewHasFocus && itemSelected && s.isEditing === EDITING_ACTIVITY;
                const isEditingTime     = viewHasFocus && itemSelected && s.isEditing === EDITING_TIME;

                let status = ROW_EXISTS;
                if (itemSelected) {
                    status = ROW_SELECTED;
                    if (viewHasFocus) {
                        status = ROW_FOCUSED;
                        if (s.isEditing) {
                            status = ROW_EDITING;
                        }
                    }
                }

                if (status === ROW_EXISTS && hlt) {
                    if (activity.nId) {
                        const note = getNote(state, activity.nId);
                        const noteHlt = getHigherLevelTask(state, note);
                        if (noteHlt === hlt) {
                            status = ROW_HIGHLIGHTED;
                        }
                    }
                }

                const isBreakActivity = isBreak(activity);

                const root = imBeginListRow(status); {
                    imBegin(ROW); imListRowCellStyle(); imGap(10, PX); imFlex(); imAlign(); {
                        imBegin(INLINE_BLOCK); {
                            if (imIf() && isEditingTime) {
                                const lowerBound = get(s.activities, idx - 1)?.t;
                                const upperBound = get(s.activities, idx + 1)?.t;

                                const { edit, textArea } = imEditableTime(activity.t, lowerBound ?? null, upperBound);

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
                                        ctx.requestSaveState = true;
                                        ctx.handled = true;
                                    }
                                }

                                ctx.textAreaToFocus = textArea;
                                ctx.focusWithAllSelected = true;
                            } else {
                                imElse();

                                imBegin(); setText(formatTime(activity.t)); imInitClasses(cn.noWrap); imEnd();
                            } imEndIf();

                            const duration = getActivityDurationMs(activity, s.activities[idx + 1]);
                            imBegin(); setText(formatDuration(duration, 2)); imInitClasses(cn.noWrap); imEnd();
                        } imEnd();

                        imLine(VERTICAL, 1);

                        let text = getActivityText(state, activity);
                        imBegin(ROW); imAlign(); imJustify(isBreakActivity ? CENTER : NONE); imFlex(); {
                            if (imMemo(isBreakActivity)) {
                                setStyle("padding", isBreakActivity ? "40px" : "0");
                            }

                            const isEditingActivityChanged  = imMemo(isEditingActivity);
                            if (imIf() && !isEditingActivity) {
                                imBegin(); setText(text); imEnd();
                            } else {
                                imElse();

                                const [, textArea] = imBeginTextArea({
                                    value: activity.breakInfo ?? "",
                                    placeholder: "Enter break info",
                                }); {
                                    const input = imOn("input");
                                    const change = imOn("change");

                                    if (input || change) {
                                        activity.breakInfo = textArea.root.value;
                                        ctx.requestSaveState = true;
                                        ctx.handled = true;
                                    }

                                    if (isEditingActivityChanged) {
                                        textArea.root.selectionStart = textArea.root.value.length;
                                        textArea.root.selectionEnd = textArea.root.value.length;
                                    }

                                    ctx.textAreaToFocus = textArea;
                                    ctx.focusWithAllSelected = true;
                                } imEndTextArea();

                            } imEndIf();
                            setText(text);
                        } imEnd();
                    } imEnd();
                } imEndListRow();

                if (itemSelected) {
                    scrollToItem(s.scrollContainer, root)
                }
            } imEndFor();

            if (imIf() && !hasActivities) {
                imBegin(ROW); imFlex(); imAlign(); imJustify(); {
                    imSpan(
                        s.activities.length === 0 ? "No activities yet!"
                            : "No activities today"
                    ); imEnd();
                } imEnd();
            } imEndIf();
        } imEnd();
    } imEnd();
}
