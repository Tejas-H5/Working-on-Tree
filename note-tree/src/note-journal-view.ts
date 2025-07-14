import { imBeginAppHeading, imEndAppHeading } from "./app-heading";
import { getTimeElapsedSinceRepeat, imTimerRepeat, newTimer, timerRepeat, TimerState } from "./app-utils/timer";
import { imBegin, imFlex, imInitStyles, INLINE, ROW } from "./components/core/layout";
import { imT } from "./components/core/text";
import { doExtraTextAreaInputHandling, imBeginTextArea, imEndTextArea, } from "./components/editable-text-area";
import { GlobalContext } from "./global-context";
import { imBeginListRow, imEndListRow, imListRowCellStyle } from "./list-row";
import {
    clampedListIdx,
    getNavigableListInput,
    imBeginNavigableListContainer,
    NavigableList,
    newNavigableList
} from "./navigable-list";
import { boundsCheck, swap } from "./utils/array-utils";
import { assert } from "./utils/assert";
import { addMinutes, dateSetLocalTime, formatDateTime, formatDuration, formatTime, formatTimeForInput, parseTimeInput, roundToNearestMinutes } from "./utils/datetime";
import {
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
    newBoolean,
    setStyle,
    setText,
    timeSeconds
} from "./utils/im-dom-utils";

export type PlanViewState = {
    list:    NavigableList;
    editing: number;
    plans:   PlanItem[];

    error: string;
    errorPlan: PlanItem | null;
    errorTimer: TimerState;
}

const NOT_EDITING         = 0;
const EDITING_START_TIME  = 1;
const EDITING_END_TIME    = 2;
const EDITING_TEXT        = 3;

function newJournalViewState(): PlanViewState {
    const planItem = newPlanItem("", new Date());

    return {
        list:    newNavigableList(),
        editing: EDITING_START_TIME,
        plans: [planItem],

        error: "",
        errorPlan: null,
        errorTimer: newTimer(),
    };
}

// NOTE: Values starting with _ aren't serialized
type PlanItem = {
    start: Date;
    end:   Date;
    text:  string;

    // NOTE: stuff like this is a hack, and doesn't scale well. we hsould delete it asap;
    _startInputText: string;
    _endInputText: string;
}

function newPlanItem(text: string = "", start: Date): PlanItem {
    const end = new Date(start);
    getEndTimeFromStartTime(end);

    return {
        text,
        _startInputText: "",
        start,
        _endInputText: "",
        end,
    };
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
    const newItem = newPlanItem("", item.end);
    s.plans.splice(newIdx, 0, newItem);
    moveListIdx(s, newIdx);
    s.editing = EDITING_START_TIME;

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
    return s.plans[idx - 1].end;
}

function setPlanStartTime(s: PlanViewState, plan: PlanItem, time: Date | null) {
    if (!time) {
        time = getPreviousDate(s, plan, false)
    } 

    const now = new Date();
    if (time.getTime() < now.getTime()) {
        plan.start = now;
    } else {
        plan.start = time;
    }

    // TODO: update end position to be the same duration away

    movePlanIntoPosition(s, plan);
}

function getEndTimeFromStartTime(start: Date) {
    const end = new Date(start);
    addMinutes(end, 30);
    return end;
}

function setPlanEndTime(s: PlanViewState, plan: PlanItem, time: Date | null) {
    if (!time) {
        time = getPreviousDate(s, plan, true)
        time = getEndTimeFromStartTime(time);
    } 

    const previousTime = getPreviousDate(s, plan, true);
    if (time.getTime() < previousTime.getTime()) {
        plan.end = previousTime;
    } else {
        plan.end = time;
    }

    movePlanIntoPosition(s, plan);
}

function movePlanIntoPosition(s: PlanViewState, plan: PlanItem) {
    let idx = indexOf(s, plan);
    let imThatGuy = idx === s.list.idx;

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

    if (imThatGuy) {
        s.list.idx = idx;
    }
}

function isEmpty(item: PlanItem) {
    return item.text.trim().length === 0;
}

function moveListIdx(s: PlanViewState, idx: number) {
    assert(boundsCheck(s.plans, s.list.idx));
    const item = getCurrentPlanItem(s);

    // Delete empty plans only after we've moved away from them
    if (s.plans.length > 1 && isEmpty(item))  {
        s.plans.splice(s.list.idx, 1);
        if (idx >= s.list.idx) {
            idx--;
        }
        s.list.idx--;
    }

    if (boundsCheck(s.plans, idx)) {
        s.list.idx = idx;
    }

    if (!boundsCheck(s.plans, s.list.idx)) {
        // failsafe
        s.list.idx = s.plans.length - 1;
    }
}

function handleKeyboardInput(ctx: GlobalContext, s: PlanViewState) {
    const keyboard = ctx.keyboard;
    const currentPlanItem = getCurrentPlanItem(s);

    if (!ctx.handled && s.editing) {
        const isEditingStartTime = s.editing === EDITING_START_TIME;
        const isEditingEndTime   = s.editing === EDITING_END_TIME;

        if (keyboard.escapeKey.pressed) {
            s.editing = NOT_EDITING;
            ctx.handled = true;
        }

        if (isEditingStartTime || isEditingEndTime) {
            const up = keyboard.upKey.pressed;
            const down = keyboard.downKey.pressed;
            if (up || down) {
                let timeIncrement = 5;
                if (keyboard.altKey.held) {
                    timeIncrement = 30;
                }

                let dateToEdit = new Date(isEditingStartTime ? currentPlanItem.start : currentPlanItem.end);
                if (up) {
                    roundToNearestMinutes(dateToEdit, timeIncrement);
                    addMinutes(dateToEdit, timeIncrement);
                } else {
                    roundToNearestMinutes(dateToEdit, timeIncrement);
                    addMinutes(dateToEdit, -timeIncrement);
                }

                if (isEditingStartTime) {
                    setPlanStartTime(s, currentPlanItem, dateToEdit);
                    currentPlanItem._startInputText = formatTimeForInput(currentPlanItem.start);
                } else {
                    setPlanEndTime(s, currentPlanItem, dateToEdit);
                    currentPlanItem._endInputText = formatTimeForInput(currentPlanItem.end);
                }

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
            if (s.editing === NOT_EDITING) {
                startEditingPlan(s);
            } else {
                assert(s.editing > 0 && s.editing <= EDITING_TEXT);

                if (keyboard.shiftKey.held) {
                    if (s.editing !== EDITING_START_TIME) {
                        s.editing--;
                    } else if (s.list.idx > 0) {
                        s.list.idx--;
                        s.editing = EDITING_TEXT;
                    }
                } else {
                    if (s.editing !== EDITING_TEXT) {
                        s.editing++;
                    } else if (s.list.idx < s.plans.length - 1) {
                        s.list.idx++;
                        s.editing = EDITING_START_TIME;
                    } else {
                        addPlanItemUnderCurrent(s);
                    }
                }
            }

            ctx.handled = true;
        }
    }
}

function startEditingPlan(s: PlanViewState) {
    const plan = getCurrentPlanItem(s);
    if (plan.text === "") {
        s.editing = EDITING_START_TIME;
    } else {
        s.editing = EDITING_TEXT;
    }
}

export function imAppViewJournal(ctx: GlobalContext) {
    const s = imState(newJournalViewState);

    const displayColon = imState(newBoolean);
    if (imTimerRepeat(1.0)) {
        displayColon.val = !displayColon.val;
    }

    imBeginAppHeading(); {
        imT(formatDateTime(new Date(), displayColon.val ? ":" : " "));
        imT(" - Plan");
    } imEndAppHeading();

    imNotePlanView(ctx, s);
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

function parseStartTime(s: PlanViewState, text: string, planItem: PlanItem): Date | null {
    const previousTime = getPreviousDate(s, planItem, false);
    const [time, err] = parseTimeInput(text, previousTime);
    if (!time || err) {
        return null;
    } 

    const today = new Date();
    dateSetLocalTime(today, time);
    return today;
}

function parseEndTime(text: string, plan: PlanItem, prevPlan: PlanItem |  null) {
    let previousTime;
    if (plan.start) {
        previousTime = plan.start;
    } else if (prevPlan && prevPlan.end) {
        previousTime = prevPlan.end;
    } else {
        previousTime = new Date();
    }

    const [time, err] = parseTimeInput(text, previousTime);
    if (!time || err) {
        return null;
    }

    const today = new Date();
    dateSetLocalTime(today, time);
    return today;
}

export function imNotePlanView(ctx: GlobalContext, s: PlanViewState) {
    handleKeyboardInput(ctx, s);

    timerRepeat(s.errorTimer, timeSeconds(), null, !!s.error);

    imBeginNavigableListContainer(s.list); {

        imFor(); for (let i = 0; i < s.plans.length; i++) {
            const plan = s.plans[i];
            imNextRoot(plan);

            const focused = s.list.idx === i;
            let prevPlan: PlanItem | null = null;
            if (i !== 0) {
                prevPlan = s.plans[i - 1];
            }

            imBeginListRow(focused, s.editing !== NOT_EDITING); {
                imBegin(); imFlex(); imListRowCellStyle(); {
                    imBegin(ROW); imListRowCellStyle(); {
                        imInitStyles("gap: 10px");

                        const isEditingStartTime = focused && s.editing === EDITING_START_TIME;
                        const isEditingEndTime = focused && s.editing === EDITING_END_TIME;
                        const isEditingText = focused && s.editing === EDITING_TEXT;

                        imBegin(); {
                            const isEditingStartTimeChanged = imMemo(isEditingStartTime);

                            if (imIf() && isEditingStartTime) {
                                if (isEditingStartTimeChanged) {
                                    plan._startInputText = formatTimeForInput(plan.start);
                                }

                                const [, textArea] = imBeginTextArea({
                                    value: plan._startInputText,
                                    placeholder: isEditingStartTime ? "Start" : undefined,
                                }); {
                                    const input = imOn("input");
                                    const change = imOn("change");
                                    if (input || change) {
                                        plan._startInputText = textArea.root.value;

                                        setPlanStartTime(s, plan, parseStartTime(s, plan._startInputText, plan));
                                    }

                                    ctx.textAreaToFocus = textArea;
                                    ctx.focusWithAllSelected = true;
                                } imEndTextArea();
                            } else {
                                imElse();

                                if (isEditingStartTimeChanged) {
                                    setPlanStartTime(s, plan, parseStartTime(s, plan._startInputText, plan));
                                }

                                imBegin(INLINE); setText(formatTime(plan.start)); imEnd();
                            } imEndIf();
                        } imEnd();

                        imBegin(); {
                            const isEditingEndTimeChanged = imMemo(isEditingEndTime);

                            if (imIf() && isEditingEndTime) {

                                if (isEditingEndTimeChanged) {
                                    plan._endInputText = formatTimeForInput(plan.end);
                                }

                                const [, textArea] = imBeginTextArea({
                                    value: plan._endInputText,
                                    placeholder: isEditingEndTime ? "End" : undefined,
                                }); {
                                    const input = imOn("input");
                                    const change = imOn("change");
                                    if (input || change) {
                                        plan._endInputText = textArea.root.value;
                                        setPlanEndTime(s, plan, parseEndTime(plan._endInputText, plan, prevPlan));
                                    }

                                    ctx.textAreaToFocus = textArea;
                                    ctx.focusWithAllSelected = true;
                                } imEndTextArea();
                            } else {
                                imElse();

                                if (isEditingEndTimeChanged) {
                                    setPlanEndTime(s, plan, parseEndTime(plan._endInputText, plan, prevPlan));
                                }

                                imBegin(INLINE); setText(formatTime(plan.end)); imEnd();
                            } imEndIf();
                        } imEnd();

                        imBegin(); {
                            const duration = (plan.start && plan.end) ? plan.end.getTime() - plan.start.getTime() : null;
                            if (imMemo(duration)) {
                                if (duration !== null) {
                                    setText("[ " + formatDuration(duration) + " ]");
                                } else {
                                    setText("[ ?h ]");
                                }
                            }

                        } imEnd();

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

                    const time = ERROR_DISPLAY_TIME_SECONDS - getTimeElapsedSinceRepeat(s.errorTimer, timeSeconds());
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
                }; imEnd();
            } imEndListRow();
        } imEndFor();

        if (imIf() && s.plans.length === 0) {
            imBeginListRow(true); {
                imBegin(ROW); imListRowCellStyle(); imFlex(); {
                    setText("+ New plan"); 
                }; imEnd();
            } imEndListRow();
        } imEndIf();

    } imEnd();
}
