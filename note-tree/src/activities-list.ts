import {
    imBeginScrollContainer,
    newScrollContainer,
    ScrollContainer,
    scrollToItem,
    startScrolling
} from "src/components/scroll-container";
import { imLine } from "./app-components/common";
import { CENTER, CH, COL, imAlign, imBegin, imFlex, imGap, imInitClasses, imJustify, INLINE_BLOCK, NONE, PX, ROW } from "./components/core/layout";
import { cn } from "./components/core/stylesheets";
import { imSpan } from "./components/core/text";
import { imBeginTextArea, imEndTextArea } from "./components/editable-text-area";
import { addToNavigationList, BYPASS_TEXT_AREA, getAxisRaw, GlobalContext, hasCommand, hasDiscoverableCommand, hasDiscoverableHold } from "./global-context";
import { imBeginListRow, imEndListRow, imListRowCellStyle, ROW_EDITING, ROW_EXISTS, ROW_FOCUSED, ROW_HIGHLIGHTED, ROW_SELECTED } from "./list-row";
import { clampedListIdx, clampedListIdxRange, getNavigableListInput, ListPosition, newListPosition } from "./navigable-list";
import { Activity, APP_VIEW_ACTIVITIES, APP_VIEW_NOTES, getActivityDurationMs, getActivityText, getActivityTime, getCurrentNote, getHigherLevelTask, getLastActivity, getNote, isBreak, isCurrentlyTakingABreak, newBreakActivity, pushBreakActivity, state } from "./state";
import { boundsCheck } from "./utils/array-utils";
import { floorDateLocalTime, formatDate, formatDuration, formatTime, isDayBefore, isSameDate } from "./utils/datetime";
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
    imNextRoot,
    imOn,
    isFirstishRender,
    setStyle,
    setText,
    VERTICAL
} from "./utils/im-dom-utils";

const FOCUS_ACTIVITIES_LIST = 0;
const FOCUS_DATE_SELECTOR = 1

export type ActivitiesViewState = {
    activities: Activity[];

    currentFocus: typeof FOCUS_ACTIVITIES_LIST | typeof FOCUS_DATE_SELECTOR;
    activityListPositon: ListPosition;
    isEditingActivity: boolean;

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

        currentFocus: FOCUS_ACTIVITIES_LIST,
        activityListPositon: newListPosition(),
        isEditingActivity: false,

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
        pushBreakActivity(state, newBreakActivity("Taking a break...", new Date(), true));
    } else {
        // allow the next code select the last break for editing
    }
    activitiesViewSetIdx(ctx.activityView, ctx.activityView.activities.length - 1, true);
    s.isEditingActivity = true;
    ctx.requestSaveState = true;
}

function getActivitiesNextDateStartIdx(
    activities: Activity[],
    startIdx: number,
): number {
    if (!boundsCheck(activities, startIdx)) return startIdx;

    let i =  startIdx;

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

export function activitiesViewSetIdx(s: ActivitiesViewState, idx: number, notInRange = false) {
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
    s.isEditingActivity = true;
    activitiesViewSetIdx(s, idx + 1, true);
};

function handleKeyboardInput(ctx: GlobalContext, s: ActivitiesViewState) {
    const { keyboard } = ctx;

    let nextActivityIdx = -1;
    let nextActivityIdxNotInRange = false;

    const shift = hasDiscoverableHold(ctx, keyboard.shiftKey);

    const lastIdx = s.activityListPositon.idx;
    const currentActivity = s.activities[s.activityListPositon.idx];
    const viewingActivities = hasActivitiesToView(s);
    const currentFocus = getCurrentFocus(s);
    const activityListFocused = currentFocus === FOCUS_ACTIVITIES_LIST;
    const dateSelectorFocused = currentFocus === FOCUS_DATE_SELECTOR;

    if (dateSelectorFocused) {
        s.isEditingActivity = false;
    }

    const [lo, hi] = getActivityRange(s);

    // Moving up/down
    const delta = getNavigableListInput(ctx);
    if (!ctx.handled && delta) {
        if (activityListFocused) {
            if (!s.isEditingActivity) {
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
        if (!s.isEditingActivity) {
            if (keyboard.homeKey.pressed) {
                nextActivityIdx = lo;
                ctx.handled = true;
            } else if (keyboard.endKey.pressed) {
                nextActivityIdx = hi - 1;
                ctx.handled = true;
            } else if (
                isBreak(currentActivity) &&
                // !currentActivity.locked && // TODO: review this flag. Not sure what the point of it is.
                !shift && hasDiscoverableCommand(ctx, keyboard.enterKey, "Edit break")
            )  {
                s.isEditingActivity = true;
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
                if (currentActivity.nId) {
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
        }
    }


    // escape key
    if (!ctx.handled) {
        if (s.isEditingActivity) {
            if (
                hasDiscoverableCommand(ctx, keyboard.enterKey, "Finish editing", BYPASS_TEXT_AREA) ||
                hasDiscoverableCommand(ctx, keyboard.escapeKey, "Finish editing", BYPASS_TEXT_AREA) // TODO: this has to revert the edit.
            ) {
                s.isEditingActivity = false;
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
    viewFocused: boolean
) {
    addToNavigationList(ctx, APP_VIEW_ACTIVITIES);

    s.activities = state.activities;;

    s.now = ctx.now;

    if (imMemoMany(state.currentNoteId, state._isEditingFocusedNote)) {
        if (state._isEditingFocusedNote) {
            const lastActivity = s.activities[s.activities.length - 1];
            setCurrentViewingDate(s, lastActivity.t);
            s.currentFocus = FOCUS_ACTIVITIES_LIST;
            activitiesViewSetIdx(s, s.activities.length - 1);
        }
    }

    if (imMemo(s.activityListPositon.idx)) {
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

    if (viewFocused) {
        handleKeyboardInput(ctx, s);
    }

    imBegin(COL); imFlex(); {

        const dateSelectorFocused  = currentFocus === FOCUS_DATE_SELECTOR;

        imBeginListRow(dateSelectorFocused ? (viewFocused ? ROW_FOCUSED : ROW_SELECTED) : ROW_EXISTS); {
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

                const isEditing = viewFocused && itemSelected && s.isEditingActivity;
                const isEditingChanged = imMemo(isEditing);

                let status = ROW_EXISTS;
                if (itemSelected) {
                    status = ROW_SELECTED;
                    if (viewFocused) {
                        status = ROW_FOCUSED;
                        if (isEditing) {
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
                            imBegin(); setText(formatTime(activity.t)); imInitClasses(cn.noWrap); imEnd();

                            const duration = getActivityDurationMs(activity, s.activities[idx + 1]);
                            imBegin(); setText(formatDuration(duration, 2)); imInitClasses(cn.noWrap); imEnd();
                        } imEnd();

                        imLine(VERTICAL, 1);

                        let text = getActivityText(state, activity);
                        imBegin(ROW); imAlign(); imJustify(isBreakActivity ? CENTER : NONE); imFlex(); {
                            if (imMemo(isBreakActivity)) {
                                setStyle("padding", isBreakActivity ? "40px" : "0");
                            }

                            if (imIf() && !isEditing) {
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
                                    }

                                    if (isEditingChanged) {
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

        imLine(
            HORIZONTAL, 1,
            !!s.scrollContainer.root && s.scrollContainer.root.root.scrollTop > 1,
        );

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
            setText(text);
        } imEnd();
    } imEnd();
}
