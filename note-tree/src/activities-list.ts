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
import {
    addToNavigationList,
    APP_VIEW_ACTIVITIES,
    APP_VIEW_NOTES,
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
    imNavListNextSlice,
    ListPosition,
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
    getNote,
    isBreak,
    isCurrentlyTakingABreak,
    newBreakActivity,
    pushBreakActivity,
    setCurrentNote,
    state,
    TreeNote
} from "./state";
import { imEditableTime } from "./time-input";
import { boundsCheck, get } from "./utils/array-utils";
import {
    clampDate,
    cloneDate,
    floorDateLocalTime,
    formatDate,
    formatDuration,
    formatTime,
    isDayBefore,
    isSameDate
} from "./utils/datetime";
import {
    HORIZONTAL,
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imMemo,
    imMemoMany,
    imNextListRoot,
    imOn,
    imIsFirstishRender,
    setStyle,
    setText,
    VERTICAL
} from "./utils/im-dom-utils";

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
    _range: [number, number]; // TODO: remove _startidx and _endIdx
    _canMoveToNextDay: boolean;
    _canMoveToPrevDay: boolean;
}




export function newActivitiesViewState(): ActivitiesViewState {
    return {
        activities: [],

        viewHasFocus: false,
        noteBeforeFocus: null,

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
    activitiesViewSetIdx(ctx.activityView, ctx.activityView.activities.length - 1, NOT_IN_RANGE);
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

function moveToNextDay(s: ActivitiesViewState) {
    const [lo, hi] = getActivityRange(s);

    if (hi < s.activities.length - 1) {
        // move to the next day, if notes available
        activitiesViewSetIdx(s, hi + 1, true);
    } else if (!isSameDate(s.now, s.currentViewingDate)) {
        // if no more notes, move to today
        setCurrentViewingDate(s, s.now);
    }
}

function moveToPrevDay(s: ActivitiesViewState) {
    const [lo, hi] = getActivityRange(s);

    if (lo > 0) {
        // move to prev day
        activitiesViewSetIdx(s, lo - 1, true);
    }
}

export function activitiesViewSetIdx(s: ActivitiesViewState, idx: number, notInRange: boolean) {
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
            setCurrentNote(state, activity.nId, s.noteBeforeFocus?.id);
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
    activitiesViewSetIdx(s, idx + 1, IN_RANGE);
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
            hasDiscoverableCommand(ctx, keyboard.downKey, "Next day", REPEAT)
        ) {
            s.currentFocus = FOCUS_DATE_SELECTOR;
            moveToNextDay(s);
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
                        activitiesViewSetIdx(s, foundIdx, true);
                    }
                }
            }

            // Moving up/down in the list
            const listNavigation = getNavigableListInput(ctx, s.activityListPositon.idx, lo, hi);
            if (listNavigation) {
                activitiesViewSetIdx(s, listNavigation.newIdx, false);
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
        if (lo > 0 && hasDiscoverableCommand(ctx, keyboard.leftKey, "Prev day", REPEAT)) {
            moveToPrevDay(s);
            const [lo, hi] = getActivityRange(s);
            activitiesViewSetIdx(s, lo, false);
        }

        if (
            !isSameDate(s.now, s.currentViewingDate) && 
            hasDiscoverableCommand(ctx, keyboard.rightKey, "Next day", REPEAT)
        ) {
            moveToNextDay(s);
        }

        if (lo > 0 && hasDiscoverableCommand(ctx, keyboard.upKey, "Prev day - end", REPEAT)) {
            moveToPrevDay(s);
            s.currentFocus = FOCUS_ACTIVITIES_LIST;
        }

        if (
            hasActivitiesToView(s) &&
            hasDiscoverableCommand(ctx, keyboard.downKey, "Activities", REPEAT)
        ) {
            activitiesViewSetIdx(s, lo, true);
            s.currentFocus = FOCUS_ACTIVITIES_LIST;
        }

        if (s.activities.length > 0 && hasDiscoverableCommand(ctx, keyboard.homeKey, "First day")) {
            setCurrentViewingDate(s, s.activities[0].t);
        }

        if (s.activities.length > 0 && hasDiscoverableCommand(ctx, keyboard.endKey, "Today")) {
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
        if (viewHasFocus) {
            s.noteBeforeFocus = getCurrentNote(state);
        } else {
            s.currentFocus = FOCUS_ACTIVITIES_LIST;
            activitiesViewSetIdx(s, s.activities.length - 1, NOT_IN_RANGE);
        }
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
            if (imIsFirstishRender()) {
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

        imBeginListRow(
            dateSelectorFocused,
            viewHasFocus && dateSelectorFocused
        ); {
            if (imIsFirstishRender()) {
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

        } imEndListRow();

        imLine(
            HORIZONTAL, 1,
            !!s.scrollContainer.root && s.scrollContainer.root.root.scrollTop > 1,
        );

        const list = imBeginNavList(
            s.scrollContainer,
            s.activityListPositon.idx,
            viewHasFocus && currentFocus === FOCUS_ACTIVITIES_LIST,
            !!s.isEditing
        ); {
            const current = getCurrentNote(state);
            const hlt = getHigherLevelTask(state, current);

            while (imNavListNextSlice(
                list,
                s.activities, s._startActivityIdx, s._endActivityIdxEx
            )) {
                const { i, itemSelected } = list;
                const activity = s.activities[i];

                const isEditingActivity = viewHasFocus && itemSelected && s.isEditing === EDITING_ACTIVITY;
                const isEditingTime     = viewHasFocus && itemSelected && s.isEditing === EDITING_TIME;

                let itemHighlighted = itemSelected;
                if (!itemHighlighted && hlt) {
                    if (activity.nId) {
                        const note = getNote(state, activity.nId);
                        const noteHlt = getHigherLevelTask(state, note);
                        if (noteHlt === hlt) {
                            itemHighlighted = true;
                        }
                    }
                }

                const isBreakActivity = isBreak(activity);

                imBeginNavListRow(list, itemHighlighted); {
                    imBegin(ROW); imListRowCellStyle(); imGap(10, PX); imFlex(); imAlign(); {
                        imBegin(INLINE_BLOCK); {
                            if (imIf() && isEditingTime) {
                                const lowerBound = get(s.activities, i - 1)?.t;
                                const upperBound = get(s.activities, i + 1)?.t;

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
                                        state._activitiesMutationCounter++;
                                        ctx.handled = true;
                                    }
                                }

                                ctx.textAreaToFocus = textArea;
                                ctx.focusWithAllSelected = true;
                            } else {
                                imElse();

                                imBegin(); setText(formatTime(activity.t)); imInitClasses(cn.noWrap); imEnd();
                            } imEndIf();

                            const duration = getActivityDurationMs(activity, s.activities[i + 1]);
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
                                        state._activitiesMutationCounter++;
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
                } imEndNavListRow(list);
            } 

            imNextListRoot("footer");
            if (imIf() && !hasActivities) {
                imBegin(ROW); imFlex(); imAlign(); imJustify(); {
                    imSpan(
                        s.activities.length === 0 ? "No activities yet!"
                            : "No activities today"
                    ); imEnd();
                } imEnd();
            } imEndIf();
        } imEndNavList(list);
    } imEnd();
}
