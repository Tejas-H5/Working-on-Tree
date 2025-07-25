import { cnApp } from "./app-styling";
import { getTimeElapsedSinceRepeat, newTimer, timerRepeat, TimerState } from "./app-utils/timer";
import { imBegin, imFlex, imInitStyles, INLINE, ROW } from "./components/core/layout";
import { doExtraTextAreaInputHandling, imBeginTextArea, imEndTextArea, } from "./components/editable-text-area";
import { addToNavigationList, GlobalContext } from "./global-context";
import { imBeginListRow, imEndListRow, imListRowCellStyle, ROW_EDITING, ROW_EXISTS, ROW_FOCUSED, ROW_SELECTED } from "./list-row";
import {
    imBeginScrollContainer,
    ScrollContainer,
    newScrollContainer
} from "src/components/scroll-container";
import { boundsCheck, swap } from "./utils/array-utils";
import { assert } from "./utils/assert";
import {
    addHours,
    addMinutes,
    dateSetLocalTime,
    formatDate,
    formatDuration,
    formatTime,
    formatTimeForInput,
    isSameDate,
    ONE_MINUTE,
    parseDurationInput,
    parseTimeInput,
    roundToNearestMinutes
} from "./utils/datetime";
import {
    DeferredAction,
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imMemo,
    imNextRoot,
    imOn,
    imState,
    isFirstishRender,
    setClass,
    setStyle,
    setText,
    getTimeSeconds,
    UIRoot,
    newString,
    imText
} from "./utils/im-dom-utils";
import { clampedListIdx, getNavigableListInput, ListPosition, newListPosition } from "./navigable-list";
import { APP_VIEW_PLAN } from "./state";
import { TextInput } from "./legacy-components/text-input";

export type PlanViewState = {
    now: Date;

    scrollContainer: ScrollContainer;

    list:    ListPosition;
    editing: number;
    plans:   PlanItem[];

    error: string;
    errorPlan: PlanItem | null;
    errorTimer: TimerState;
}

const NOT_EDITING         = 0;
const EDITING_TIME  = 1;
const EDITING_TEXT        = 2;


function newPlanItem(text: string = "", start: Date): PlanItem {
    return {
        text,
        start: new Date(start),
        _startInputText: "",
        _idx: -1,
    };
}

function newPlanItemAtTime(time: Date, text = "") {
    const planItem = newPlanItem(text, time);
    planItem._startInputText = formatTimeForInput(planItem.start);
    return planItem;
}

export function newPlanViewState(): PlanViewState {
    const state: PlanViewState = {
        now: new Date(),

        scrollContainer: newScrollContainer(),

        list: newListPosition(),
        editing: EDITING_TIME,
        plans: [newPlanItemAtTime(new Date())],

        error: "",
        errorPlan: null,
        errorTimer: newTimer(),
    };

    // TODO: remove this testing code
    state.plans = [
        newPlanItemAtTime(new Date(), "From yesterday"),
        newPlanItemAtTime(new Date(), "From yesterday"),
        newPlanItemAtTime(new Date(), "From yesterday"),
    ];

    addHours(state.plans[0].start, -24);
    addHours(state.plans[1].start, -23);
    addHours(state.plans[2].start, -22);

    reIndexPlans(state);

    return state;
}

function reIndexPlans(s: PlanViewState) {
    for (let i = 0; i < s.plans.length; i++) {
        s.plans[i]._idx = i;
    }
}

// NOTE: Values starting with _ aren't serialized
type PlanItem = {
    start: Date;
    text: string;
    _idx: number;
    _startInputText: string;
}

function setError(s: PlanViewState, item: PlanItem, err: string) {
    s.errorPlan = item;
    s.error = err;
}

function clearError(s: PlanViewState) {
    s.errorPlan = null;
    s.error = "";
}

function addPlanItemUnderCurrent(s: PlanViewState): PlanItem | null {
    // don't allow creating a new note if the current note is empty. 
    const item = getCurrentPlanItem(s);
    if (isEmpty(item)) {
        setError(s, item, "Add text here first");
        return null;
    }

    clearError(s);

    let newIdx = s.list.idx + 1;

    const start = getDefaultNextPlanTime(s, item);
    const newItem = newPlanItemAtTime(start);

    s.plans.splice(newIdx, 0, newItem);
    reIndexPlans(s);

    moveListIdx(s, newIdx);
    s.editing = EDITING_TIME;

    return newItem;
}

function getCurrentPlanItem(s: PlanViewState): PlanItem {
    assert(boundsCheck(s.plans, s.list.idx));
    return s.plans[s.list.idx];
}

function getPreviousDate(s: PlanViewState, planItem: PlanItem, end: boolean): Date {
    if (end) return planItem.start;

    const idx = indexOf(s, planItem);
    if (idx === 0) return new Date();
    return s.plans[idx - 1].start;
}

function setPlanStartTime(s: PlanViewState, plan: PlanItem, time: Date, updateOrder: boolean) {
    if (time.getTime() < s.now.getTime()) {
        plan.start = s.now;
    } else {
        plan.start = time;
    }

    if (updateOrder) {
        // only move this plan if the input was parseable, or final
        movePlanIntoPosition(s, plan);
    }
}

function getDefaultNextPlanTime(s: PlanViewState, planItem: PlanItem) {
    let result;
    if (planIsReadonly(s, planItem)) {
        result = new Date();
    } else {
        result = new Date(planItem.start);
        addMinutes(result, 30);
    }

    return result;
}

function movePlanIntoPosition(s: PlanViewState, plan: PlanItem) {
    let idx = indexOf(s, plan);
    let imHim = idx === s.list.idx;

    while (idx > 0) {
        if (s.plans[idx - 1].start.getTime() < plan.start.getTime()) break;
        swap(s.plans, idx - 1, idx);
        idx--;
    }

    while (idx < s.plans.length - 1) {
        if (s.plans[idx + 1].start.getTime() > plan.start.getTime()) break;
        swap(s.plans, idx + 1, idx);
        idx++;
    }

    reIndexPlans(s);

    if (imHim) {
        // Probably fine to set this directly here
        s.list.idx = idx;
    }
}

function isEmpty(item: PlanItem) {
    return item.text.trim().length === 0;
}

function moveListIdx(s: PlanViewState, idx: number) {
    assert(boundsCheck(s.plans, s.list.idx));
    let item = getCurrentPlanItem(s);

    // Delete empty plans only after we've moved away from them
    if (s.plans.length > 1 && isEmpty(item))  {
        s.plans.splice(s.list.idx, 1);
        reIndexPlans(s);

        if (idx >= s.list.idx) {
            idx--;
        }
        s.list.idx--;
    }

    if (boundsCheck(s.plans, idx)) {
        s.list.idx = idx;
    } else if (s.plans.length === 0) {
        s.list.idx = -1;
    }

    item = getCurrentPlanItem(s);
    if (planIsReadonly(s, item)) {
        s.editing = NOT_EDITING;
    }
}

function handleKeyboardInput(ctx: GlobalContext, s: PlanViewState) {
    const keyboard = ctx.keyboard;
    const currentPlanItem = getCurrentPlanItem(s);
    const isReadonly = planIsReadonly(s, currentPlanItem);

    if (!ctx.handled && s.editing) {
        if (keyboard.escapeKey.pressed) {
            s.editing = NOT_EDITING;
            ctx.handled = true;
        }

        if (s.editing === EDITING_TIME) {
            const up = keyboard.upKey.pressed;
            const down = keyboard.downKey.pressed;
            if (up || down) {
                let timeIncrement = 5;
                if (keyboard.altKey.held) {
                    timeIncrement = 30;
                }

                let dateToEdit = new Date(currentPlanItem.start);
                if (up) {
                    roundToNearestMinutes(dateToEdit, timeIncrement);
                    addMinutes(dateToEdit, timeIncrement);
                } else {
                    roundToNearestMinutes(dateToEdit, timeIncrement);
                    addMinutes(dateToEdit, -timeIncrement);
                }

                setPlanStartTime(s, currentPlanItem, dateToEdit, true);
                currentPlanItem._startInputText = formatTimeForInput(currentPlanItem.start);

                ctx.handled = true;
            }
        }
    }

    if (!ctx.handled && !s.editing) {
        const delta = getNavigableListInput(ctx);
        if (delta) {
            let newIdx = clampedListIdx(s.list.idx + delta, s.plans.length);

            moveListIdx(s, newIdx);
            ctx.handled = true;
        }
    }

    if (!ctx.handled) {
        if (keyboard.enterKey.pressed) {
            if (!keyboard.enterKey.repeat) {
                if (keyboard.shiftKey.held) {
                    if (addPlanItemUnderCurrent(s)) {
                        startEditingPlan(s);
                    }
                } else {
                    startEditingPlan(s);
                }
                ctx.handled = true;
            }
        } else if (keyboard.tabKey.pressed) {
            if (s.editing !== NOT_EDITING) {
                assert(s.editing > 0 && s.editing <= EDITING_TEXT);

                if (keyboard.shiftKey.held) {
                    if (s.editing !== EDITING_TIME) {
                        s.editing--;
                    } else if (s.list.idx > 0) {
                        moveListIdx(s, s.list.idx - 1);
                        s.editing = EDITING_TEXT;
                    }
                } else {
                    if (s.editing !== EDITING_TEXT) {
                        s.editing++;
                    } else if (s.list.idx < s.plans.length - 1) {
                        moveListIdx(s, s.list.idx + 1);
                        s.editing = EDITING_TIME;
                    } else {
                        addPlanItemUnderCurrent(s);
                    }
                }

                ctx.handled = true;
            }
        }
    }
}

function startEditingPlan(s: PlanViewState) {
    const plan = getCurrentPlanItem(s);
    if (planIsReadonly(s, plan)) {
        s.editing = NOT_EDITING;
        return;
    }

    if (plan.text === "") {
        s.editing = EDITING_TIME;
    } else {
        s.editing = EDITING_TEXT;
    }
}

const ERROR_DISPLAY_TIME_SECONDS = 2;


export function inverseLerpClamped(a: number, b: number, t: number): number {
    let result = (t - a) / (b - a);

    if (result > 1) result = 1;
    if (result < 0) result = 0;

    return result;
}

function indexOf(s: PlanViewState, item: PlanItem): number {
    const idx = s.plans.indexOf(item);
    assert(idx !== -1);
    return idx;
}


function getPlanDuration(plan: PlanItem, nextPlan: PlanItem): number {
    return nextPlan.start.getTime() - plan.start.getTime();
}

function getNextPlan(s: PlanViewState, plan: PlanItem): PlanItem | null {
    const idx = plan._idx;
    assert(s.plans[idx] === plan);
    if (idx + 1 === s.plans.length) return null;

    return s.plans[idx + 1];
}

function planIsReadonly(s: PlanViewState, plan: PlanItem) {
    if (!isSameDate(plan.start, s.now)) {
        // Our edit method automatically does max(now, newDate) on anything we edit. 
        // This is fine for plans made today for the future, but it corrupts all historical data.
        // So dates before today should also be locked.
        return plan.start.getTime() < s.now.getTime();
    }

    const nextPlan = getNextPlan(s, plan);
    if (nextPlan) {
        return nextPlan.start.getTime() < s.now.getTime();
    }

    return false;
}

export function imNotePlanView(
    ctx: GlobalContext,
    s: PlanViewState,
    viewFocused: boolean
) {
    addToNavigationList(ctx, APP_VIEW_PLAN);

    if (viewFocused) {
        handleKeyboardInput(ctx, s);
    }

    s.now = ctx.now;

    timerRepeat(s.errorTimer, getTimeSeconds(), null, !!s.error);

    imBeginScrollContainer(s.scrollContainer); {

        let planMutateAction: DeferredAction;

        imFor(); for (let i = 0; i < s.plans.length; i++) {
            const plan = s.plans[i];
            imNextRoot(plan);

            const focused = viewFocused && s.list.idx === i;
            let prevPlan: PlanItem | null = null;
            if (i !== 0) prevPlan = s.plans[i - 1];

            let nextPlan: PlanItem | null = null;
            if (i < s.plans.length - 1) nextPlan = s.plans[i + 1];

            // prevent editing plans that you've already made
            const isReadonly = planIsReadonly(s, plan);
            const notToday = !isSameDate(s.now, plan.start);

            const nextIsANewDay = !!nextPlan && !isSameDate(plan.start, nextPlan.start);
            const duration = nextPlan ? getPlanDuration(plan, nextPlan) : 0;
            const durationChanged = imMemo(duration);

            const isEditing = s.editing !== NOT_EDITING;
            // HACK: ensure we aren't editing a readonly note
            if (focused && isReadonly && isEditing) {
                s.editing = NOT_EDITING;
            }

            let status = ROW_EXISTS;
            if (focused) {
                status = ROW_SELECTED;
                if (viewFocused) {
                    status = ROW_FOCUSED;
                    if (isEditing) {
                        status = ROW_EDITING;
                    }
                }
            }

            imBeginListRow(status); {
                if (imMemo(isReadonly)) {
                    setClass(cnApp.defocusedText, isReadonly);
                }

                imBegin(); imFlex(); imListRowCellStyle(); {
                    imBegin(ROW); imListRowCellStyle(); {
                        imInitStyles("gap: 10px");

                        const isEditingTime = !isReadonly && focused && s.editing === EDITING_TIME;
                        const isEditingText = !isReadonly && focused && s.editing === EDITING_TEXT;

                        if (imIf() && notToday) {
                            imBegin(); setText(formatDate(plan.start)); imEnd();
                        } imEndIf();

                        imBegin(); {
                            const isEditingStartTimeChanged = imMemo(isEditingTime);

                            if (imIf() && isEditingTime) {
                                if (isEditingStartTimeChanged) {
                                    plan._startInputText = formatTimeForInput(plan.start);
                                }

                                const [, textArea] = imBeginTextArea({
                                    value: plan._startInputText,
                                    placeholder: isEditingTime ? "Time" : undefined,
                                }); {
                                    const input = imOn("input");
                                    const change = imOn("change");
                                    if (input || change) {
                                        plan._startInputText = textArea.root.value;
                                        const newTime = parseStartTime(s, plan._startInputText, plan);
                                        if (newTime) {
                                            planMutateAction = () => setPlanStartTime(s, plan, newTime, false);
                                        }
                                    }

                                    ctx.textAreaToFocus = textArea;
                                    ctx.focusWithAllSelected = true;
                                } imEndTextArea();
                            } else {
                                imElse();

                                imBegin(INLINE); setText(formatTime(plan.start)); imEnd();
                            } imEndIf();
                        } imEnd();

                        if (imIf() && !nextIsANewDay) {
                            imBegin(); {
                                if (durationChanged) {
                                    setText("[ " + formatDuration(duration) + " ]");
                                    setStyle("opacity", duration === 0 ? "0" : "1");
                                }
                            } imEnd();
                        } imEndIf();

                        imBegin(); imFlex(); {
                            if (imIf() && isEditingText) {
                                const [, textArea] = imBeginTextArea({
                                    value: plan.text,
                                    placeholder: isEditingText ? "Enter some text, or find a note with >" : undefined,
                                }); {
                                    const input = imOn("input");
                                    const change = imOn("change");

                                    if (input || change) {
                                        plan.text = textArea.root.value;
                                    }

                                    const keyDown = imOn("keydown");
                                    if (keyDown) {
                                        // Not being able to insert tabs into the plan view is an OK tradeoff for useability
                                        if (keyDown.key !== "Tab") {
                                            ctx.handled = doExtraTextAreaInputHandling(keyDown, textArea.root, {})
                                        }
                                    }

                                    ctx.textAreaToFocus = textArea;
                                } imEndTextArea();
                            } else {
                                imElse();
                                imBegin(INLINE); setText(plan.text); imEnd();
                            } imEndIf();
                        }; imEnd();
                    }; imEnd();

                    const time = ERROR_DISPLAY_TIME_SECONDS - getTimeElapsedSinceRepeat(s.errorTimer, getTimeSeconds());
                    const opacity = inverseLerpClamped(0, 0.5, time);
                    if (opacity < 0.001) {
                        clearError(s);
                    }

                    if (imIf() && plan === s.errorPlan) {
                        imBegin(ROW); imListRowCellStyle(); {
                            if (isFirstishRender()) {
                                setStyle("background", "white");
                                setStyle("color", "red");
                            }

                            setStyle("opacity", "" + opacity);

                            setText(s.error);
                        }; imEnd();
                    } imEndIf();

                    // TODO: instead, check duration to the start of the next day for conditional render here
                    if (imIf() && nextIsANewDay && duration > (1 * ONE_MINUTE)) {
                        imBegin(); imListRowCellStyle(); {
                            if (isFirstishRender()) {
                                setStyle("paddingLeft", "50px");
                            }
                            setText(formatDuration(duration));
                        } imEnd();
                    } imEndIf();
                }; imEnd();
            } imEndListRow();
        } imEndFor();

        if (planMutateAction) planMutateAction();
    } imEnd();
}

