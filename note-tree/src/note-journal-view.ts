import { imBeginAppHeading, imEndAppHeading } from "./app-heading";
import { getTimeElapsedSinceRepeat, imTimerRepeat, newTimer, timerRepeat, TimerState } from "./app-utils/timer";
import { imBegin, imFlex, INLINE, ROW } from "./components/core/layout";
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
import { boundsCheck } from "./utils/array-utils";
import { assert } from "./utils/assert";
import { addHours, dateSetLocalTime, formatDateTime, formatTime, parseTimeInput } from "./utils/datetime";
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
    newString,
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
    const planItem = newPlanItem("", null, null);

    return {
        list:    newNavigableList(),
        editing: EDITING_START_TIME,
        plans: [planItem],

        error: "",
        errorPlan: null,
        errorTimer: newTimer(),
    };
}

type PlanItem = {
    start: Date | null;
    end:   Date | null;
    text:  string;
}

function newPlanItem(text: string = "", start: Date | null, end: Date | null): PlanItem {
    return {
        text,
        start,
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

function addPlanItemUnderCurrent(s: PlanViewState) {
    // don't allow creating a new note if the current note is empty. 
    const item = getCurrentPlanItem(s);
    if (isEmpty(item)) {
        setError(s, item, "Add text here first");
        return;
    }

    clearError(s);

    let newIdx = s.list.idx + 1;
    const newItem = newPlanItem("", null, null);
    s.plans.splice(newIdx, 0, newItem);
    s.list.idx = newIdx;
    s.editing = EDITING_START_TIME;

    return newItem;
}

function getCurrentPlanItem(s: PlanViewState): PlanItem {
    assert(boundsCheck(s.plans, s.list.idx));
    return s.plans[s.list.idx];
}

function isEmpty(item: PlanItem) {
    return item.text.trim().length === 0;
}

function deleteCurrentIfEmpty(s: PlanViewState, allowDeletingOnlyNote = false): boolean {
    assert(boundsCheck(s.plans, s.list.idx));
    const item = getCurrentPlanItem(s);

    if (!allowDeletingOnlyNote && s.plans.length <= 1) return false;
    if (!isEmpty(item)) return false;

    s.plans.splice(s.list.idx, 1);
    s.list.idx = clampedListIdx(s.list.idx, s.plans.length);

    return true;
}

function handleKeyboardInput(ctx: GlobalContext, s: PlanViewState) {
    const keyboard = ctx.keyboard;

    if (!ctx.handled && s.editing) {
        if (keyboard.escapeKey.pressed) {
            s.editing = NOT_EDITING;
            ctx.handled = true;
            deleteCurrentIfEmpty(s);
        }

        // TODO: move notes up and down, alt
    }

    if (!ctx.handled && !s.editing) {
        const delta = getNavigableListInput(ctx);
        if (delta) {
            let newIdx = clampedListIdx(s.list.idx + delta, s.plans.length);

            s.list.idx = newIdx;
            ctx.handled = true;
        }
    }

    if (!ctx.handled) {
        if (keyboard.enterKey.pressed) {
            if (!keyboard.enterKey.repeat) {
                if (keyboard.shiftKey.held) {
                    addPlanItemUnderCurrent(s);
                }

                startEditingPlan(s);
            }
            ctx.handled = true;
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
    s.editing = EDITING_TEXT;
    if (isFinalPlan(s, plan)) {
        if (plan.start === null) {
            s.editing = EDITING_START_TIME;
        } else if (plan.end === null) {
            s.editing = EDITING_END_TIME;
        }
    }
}

function isFinalPlan(s: PlanViewState, plan: PlanItem) {
    return s.plans.length > 0 && s.plans[s.plans.length - 1] === plan;
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



export function imNotePlanView(ctx: GlobalContext, s: PlanViewState) {
    handleKeyboardInput(ctx, s);

    timerRepeat(s.errorTimer, timeSeconds(), null, !!s.error);

    imBeginNavigableListContainer(s.list); {

        imFor(); for (let i = 0; i < s.plans.length; i++) {
            const plan = s.plans[i];
            imNextRoot(plan);

            const focused = s.list.idx === i;
            const isFinalPlan = i === s.plans.length - 1;
            let prevPlan: PlanItem | null = null;
            if (i !== 0) {
                prevPlan = s.plans[i - 1];
            }

            imBeginListRow(focused, s.editing !== NOT_EDITING); {
                imBegin(); imFlex(); imListRowCellStyle(); {
                    imBegin(ROW); imListRowCellStyle(); {
                        const isEditingStartTime = focused && s.editing === EDITING_START_TIME;
                        const isEditingEndTime = focused && s.editing === EDITING_END_TIME;
                        const isEditingText = focused && s.editing === EDITING_TEXT;

                        imBegin(); {
                            if (isFirstishRender()) {
                                setStyle("width", "100px");
                            }

                            const text = imState(newString);
                            const isEditingStartTimeChanged = imMemo(isEditingStartTime);

                            if (imIf() && isEditingStartTime) {
                                if (isEditingStartTimeChanged) {
                                    const canInfer = plan.start === null;
                                    if (canInfer) {
                                        let inferredTime;
                                        if (prevPlan && prevPlan.end) {
                                            inferredTime = new Date(prevPlan.end);
                                        } else {
                                            inferredTime = new Date();
                                        }

                                        text.val = formatTime(inferredTime);
                                    }
                                }

                                const [, textArea] = imBeginTextArea({
                                    value: text.val,
                                    placeholder: isEditingStartTime ? "Start" : undefined,
                                }); {
                                    const input = imOn("input");
                                    const change = imOn("change");
                                    if (input || change) {
                                        text.val = textArea.root.value;
                                    }

                                    ctx.textAreaToFocus = textArea;
                                    ctx.focusWithAllSelected = true;
                                } imEndTextArea();
                            } else {
                                imElse();

                                if (isEditingStartTimeChanged) {
                                    let previousTime;
                                    if (prevPlan && prevPlan.end) {
                                        previousTime = prevPlan.end;
                                    } else {
                                        previousTime = new Date();
                                    }
                                    const [time, err] = parseTimeInput(text.val, previousTime);
                                    if (!time || err) {
                                        plan.start = null;
                                    } else {
                                        const today = new Date();
                                        dateSetLocalTime(today, time);
                                        plan.start = today;
                                    }
                                    text.val = formatTime(plan.start);
                                }

                                imBegin(INLINE); setText(formatTime(plan.start)); imEnd();
                            } imEndIf();
                        } imEnd();

                        imBegin(); {
                            if (isFirstishRender()) {
                                setStyle("width", "100px");
                            }

                            const text = imState(newString);
                            const isEditingEndTimeChanged = imMemo(isEditingEndTime);

                            if (imIf() && isEditingEndTime) {

                                if (isEditingEndTimeChanged) {
                                    const canInfer = plan.end === null && isFinalPlan;
                                    if (canInfer) {
                                        let inferredTime = new Date();
                                        if (plan.start !== null) {
                                            inferredTime = new Date(plan.start);
                                            addHours(inferredTime, 1);
                                            text.val = formatTime(inferredTime);
                                        }
                                    }
                                }

                                const [root, textArea] = imBeginTextArea({
                                    value: text.val,
                                    placeholder: isEditingEndTime ? "End" : undefined,
                                }); {
                                    if (isFirstishRender()) {
                                        setStyle("width", "100px", root);
                                    }

                                    const input = imOn("input");
                                    const change = imOn("change");
                                    if (input || change) {
                                        text.val = textArea.root.value;
                                    }

                                    ctx.textAreaToFocus = textArea;
                                    ctx.focusWithAllSelected = true;
                                } imEndTextArea();
                            } else {
                                imElse();

                                if (isEditingEndTimeChanged) {
                                    let previousTime;
                                    if (plan.start) {
                                        previousTime = plan.start;
                                    } else if (prevPlan && prevPlan.end) {
                                        previousTime = prevPlan.end;
                                    } else {
                                        previousTime = new Date();
                                    }
                                    const [time, err] = parseTimeInput(text.val, previousTime);
                                    if (!time || err) {
                                        plan.end = null;
                                    } else {
                                        const today = new Date();
                                        dateSetLocalTime(today, time);
                                        plan.end = today;
                                    }
                                    text.val = formatTime(plan.end);
                                }

                                imBegin(INLINE); setText(formatTime(plan.end)); imEnd();
                            } imEndIf();
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
