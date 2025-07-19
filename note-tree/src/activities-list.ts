import { COL, imAlign, imBegin, imFlex, imH100, imJustify, imScrollContainer, ROW } from "./components/core/layout";
import { imT } from "./components/core/text";
import { GlobalContext } from "./global-context";
import { Activity, getActivityText, state } from "./state";
import { boundsCheck } from "./utils/array-utils";
import { isSameDate } from "./utils/datetime";
import { imEnd, imEndFor, imEndIf, imFor, imIf, imMemo, imNextRoot, imState, UIRoot } from "./utils/im-dom-utils";

const FOCUS_ACTIVITIES_LIST = 0;
const FOCUS_DATE_SELECTOR = 1;

export type ActivitiesViewState = {
    scrollContainer: UIRoot<HTMLElement> | null;

    currentFocus: typeof FOCUS_ACTIVITIES_LIST | typeof FOCUS_DATE_SELECTOR;

    currentViewingDate: Date;
    _startActivityIdx: number;
    _endActivityIdx: number;
}

function newActivitiesViewState(): ActivitiesViewState {
    return {
        scrollContainer: null,

        currentFocus: FOCUS_ACTIVITIES_LIST,

        currentViewingDate: new Date(),
        _startActivityIdx: 0,
        _endActivityIdx: 0,
    };
}

function getActivitiesForDateStartIdx(
    activities: Activity[],
    date: Date,
    startSeekingFrom: number = 0     // <- can speed up subsequent lookups without requiring binary search
): number {
    let i = startSeekingFrom;

    // step cursor somewhere before the first activity for this date
    while (i > 0) {
        if (
            activities[i].t < date && 
            !isSameDate(activities[i].t, date)
        ) break;
        i--;
    }

    // step cursor forward. as soon as we've reached into the range, can return.
    while (i < activities.length - 1) {
        i++;
        if (isSameDate(activities[i].t, date)) break;
    }

    return i;
}

function getActivitiesNextDateStartIdx(
    activities: Activity[],
    startIdx: number,
): number {
    if (!boundsCheck(activities, startIdx)) return -1;

    let i =  startIdx;

    const date = activities[i].t;

    while (i < activities.length - 1) {
        i++;
        if (!isSameDate(activities[i].t, date)) break;
    }

    return i;
}



// TODO: finish, or delete. we don't use this right now.
export function imActivitiesList(ctx: GlobalContext, viewFocused: boolean) {
    const s = imState(newActivitiesViewState);
    const activities = state.activities;

    if (imMemo(s.currentViewingDate)) {
        s._startActivityIdx = getActivitiesForDateStartIdx(activities, s.currentViewingDate, s._startActivityIdx);
        s._endActivityIdx   = getActivitiesNextDateStartIdx(activities, s._startActivityIdx);
    }

    const scrollParent = imBegin(COL); imFlex(); imScrollContainer(); 
    s.scrollContainer = scrollParent; {
        imFor(); for (
            let i = s._startActivityIdx;
            i < s._endActivityIdx;
            i++
        ) {
            const activity = activities[i];
            imNextRoot();

            imBegin(); {
                let text = getActivityText(state, activity);
                imT(text); imEnd();
            } imEnd();
        } imEndFor();

        if (imIf() && s._startActivityIdx >= s._endActivityIdx) {
            imBegin(ROW); imH100(); imAlign(); imJustify(); {
                imT("No activities yet!"); imEnd();
            } imEnd();
        } imEndIf();
    } imEnd();
}
