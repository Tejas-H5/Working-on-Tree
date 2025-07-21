import {
    imBeginScrollContainer,
    newScrollContainer,
    ScrollContainer,
    scrollToItem,
    startScrolling
} from "src/components/scroll-container";
import { imLine } from "./app-components/common";
import { CH, COL, imAlign, imBegin, imFlex, imGap, imInitClasses, imJustify, INLINE_BLOCK, PX, ROW, STRETCH } from "./components/core/layout";
import { cn } from "./components/core/stylesheets";
import { imSpan } from "./components/core/text";
import { getAxisRaw, GlobalContext } from "./global-context";
import { imBeginListRow, imEndListRow, imListRowCellStyle, ROW_EXISTS, ROW_FOCUSED, ROW_HIGHLIGHTED, ROW_SELECTED } from "./list-row";
import { clampedListIdx, clampedListIdxRange, getNavigableListInput, ListPosition, newListPosition } from "./navigable-list";
import { Activity, APP_VIEW_TREE, getActivityDurationMs, getActivityText, getCurrentNote, getHigherLevelTask, getNote, state } from "./state";
import { boundsCheck } from "./utils/array-utils";
import { floorDateLocalTime, formatDate, formatDuration, formatTime, isDayBefore, isSameDate } from "./utils/datetime";
import {
    HORIZONTAL,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imMemo,
    imMemoMany,
    imNextRoot,
    imState,
    isFirstishRender,
    setClass,
    setStyle,
    setText,
    VERTICAL
} from "./utils/im-dom-utils";

const FOCUS_ACTIVITIES_LIST = 0;
const FOCUS_DATE_SELECTOR = 1;

export type ActivitiesViewState = {
    activities: Activity[];

    currentFocus: typeof FOCUS_ACTIVITIES_LIST | typeof FOCUS_DATE_SELECTOR;
    activityListPositon: ListPosition;

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

function handleKeyboardInput(ctx: GlobalContext, s: ActivitiesViewState) {
    const { keyboard } = ctx;

    const currentActivity = s.activities[s.activityListPositon.idx];
    const viewingActivities = hasActivitiesToView(s);
    const currentFocus = getCurrentFocus(s);
    const activityListFocused = currentFocus === FOCUS_ACTIVITIES_LIST;
    const dateSelectorFocused = currentFocus === FOCUS_DATE_SELECTOR;

    const [lo, hi] = getActivityRange(s);

    // Moving up/down
    const delta = getNavigableListInput(ctx);
    if (!ctx.handled && delta) {

        if (activityListFocused) {
            if (s.activityListPositon.idx === lo && delta < 0) {
                s.currentFocus = FOCUS_DATE_SELECTOR;
                ctx.handled = true;
            } else if (s.activityListPositon.idx === hi - 1 && delta > 0) {
                // move to next day
                if (hi < s.activities.length - 1) {
                    setCurrentViewingDate(s, s.activities[hi + 1].t);
                    const [lo2] = getActivityRange(s);
                    activitiesViewSetIdx(s, lo - 1);
                    s.currentFocus = FOCUS_DATE_SELECTOR;
                } else if (!isSameDate(s.now, s.currentViewingDate)) {
                    setCurrentViewingDate(s, s.now);
                    s.currentFocus = FOCUS_DATE_SELECTOR;
                }
                ctx.handled = true;
            } else {
                activitiesViewSetIdx(s, s.activityListPositon.idx + delta);
                ctx.handled = true;
            }
        } else {
            if (delta > 0 && viewingActivities) {
                s.currentFocus = FOCUS_ACTIVITIES_LIST;
                activitiesViewSetIdx(s, lo);
                ctx.handled = true;
            } else if (delta < 0) {
                if (lo > 0) {
                    // move to prev day
                    activitiesViewSetIdx(s, lo - 1, true);
                    s.currentFocus = FOCUS_ACTIVITIES_LIST;
                }
                ctx.handled = true;
            }
        }
    }

    if (!ctx.handled && activityListFocused) {
        if (keyboard.homeKey.pressed) {
            activitiesViewSetIdx(s, lo);
            ctx.handled = true;
        } else if (keyboard.endKey.pressed) {
            activitiesViewSetIdx(s, hi - 1);
            ctx.handled = true;
        } else if (keyboard.enterKey.pressed && !keyboard.enterKey.repeat) {
            if (currentActivity.nId) {
                state._currentScreen = APP_VIEW_TREE;
            } else {
                // TODO: feedback that it wasn't possible.
            }
            ctx.handled = true;
        }

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

                if (foundIdx) {
                }
            }
            ctx.handled = true;
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
                    let text;
                    if (dateSelectorFocused || !hasActivities) {
                        if (isSameDate(s.currentViewingDate, s.now)) {
                            text = "Activities today (" + formatDate(s.currentViewingDate, true) + ")";
                        } else {
                            text = "Activities on " + formatDate(s.currentViewingDate, true);
                        }
                    } else {
                        const numActivities = s._endActivityIdxEx - s._startActivityIdx;
                        const relIdx = s.activityListPositon.idx - s._startActivityIdx;
                        text = "Activity " + (relIdx + 1) + "/" + numActivities + " on " + formatDate(s.currentViewingDate, true);
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
                imNextRoot();

                const itemSelected = currentFocus === FOCUS_ACTIVITIES_LIST &&
                    s.activityListPositon.idx === idx;

                let status = ROW_EXISTS;
                if (itemSelected) {
                    status = ROW_SELECTED;
                    if (viewFocused) {
                        status = ROW_FOCUSED;
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

                const root = imBeginListRow(status); {
                    imBegin(ROW); imListRowCellStyle(); imGap(10, PX); imFlex(); imAlign(STRETCH); {
                        imBegin(INLINE_BLOCK); {
                            imBegin(); setText(formatTime(activity.t)); imInitClasses(cn.noWrap); imEnd();

                            const duration = getActivityDurationMs(activity, s.activities[idx + 1]);
                            imBegin(); setText(formatDuration(duration, 2)); imInitClasses(cn.noWrap); imEnd();
                        } imEnd();

                        imLine(VERTICAL, 1);

                        let text = getActivityText(state, activity);
                        imBegin(ROW); imAlign(); imFlex(); {
                            setClass(cn.truncated, !itemSelected);
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

            setText("[Shift+B] to take a break");
        } imEnd();
    } imEnd();
}
