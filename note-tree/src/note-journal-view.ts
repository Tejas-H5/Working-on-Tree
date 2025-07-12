import { imBeginAppHeading, imEndAppHeading } from "./app-heading";
import { imTimerRepeat } from "./app-utils/timer";
import { imBegin, imFlex, ROW } from "./components/core/layout";
import { imT } from "./components/core/text";
import { imTextArea } from "./components/editable-text-area";
import { GlobalContext } from "./global-context";
import { imBeginListRow, imEndListRow, imListRowCellStyle } from "./list-row";
import {
    clampedListIdx,
    getNavigableListInput,
    imBeginNavigableListContainer,
    NavigableList,
    newNavigableList
} from "./navigable-list";
import { boundsCheck, moveArrayItem } from "./utils/array-utils";
import { assert } from "./utils/assert";
import { formatDateTime } from "./utils/datetime";
import {
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imNextRoot,
    imState,
    newBoolean,
    setText,
} from "./utils/im-dom-utils";

export type JournalViewState = {
    list:    NavigableList;
    editing: number;
    plans:   PlanItem[];
}

const NOT_EDITING         = 0;
const EDITING_START_TIME  = 1;
const EDITING_END_TIME    = 2;
const EDITING_TEXT        = 3;
const EDITING_MODES_COUNT = 4;

function newJournalViewState(): JournalViewState {
    const planItem = newPlanItem("", null, null);

    return {
        list:    newNavigableList(),
        editing: EDITING_START_TIME,
        plans: [planItem],
    };
}

type PlanItem = {
    start: Date | null;
    end:   Date | null;
    text: string;
}

function newPlanItem(text: string = "", start: Date | null, end: Date | null): PlanItem {
    return {
        text,
        start,
        end,
    };
}

function addPlanItemUnderCurrent(s: JournalViewState) {
    let newIdx = s.list.idx + 1;
    if (deleteCurrentIfEmpty(s, true)) {
        newIdx--;
    }

    const newItem = newPlanItem("TODO item " + s.plans.length, null, null);
    s.plans.splice(newIdx, 0, newItem);
    s.list.idx = newIdx;
    return newItem;
}

function getCurrentPlanItem(s: JournalViewState): PlanItem {
    assert(boundsCheck(s.plans, s.list.idx));
    return s.plans[s.list.idx];
}

function deleteCurrentIfEmpty(s: JournalViewState, allowDeletingOnlyNote = false): boolean {
    assert(boundsCheck(s.plans, s.list.idx));
    const item = getCurrentPlanItem(s);

    if (!allowDeletingOnlyNote && s.plans.length <= 1) return false;
    if (item.text.trim().length > 0) return false;

    s.plans.splice(s.list.idx, 1);
    s.list.idx = clampedListIdx(s.list.idx, s.plans.length);

    return true;
}

function handleKeyboardInput(ctx: GlobalContext, s: JournalViewState) {
    const keyboard = ctx.keyboard;

    if (!ctx.handled && s.editing) {
        if (keyboard.escapeKey.pressed) {
            s.editing = NOT_EDITING;
            ctx.handled = true;
            deleteCurrentIfEmpty(s);
        } else if (keyboard.tabKey.pressed) {
            if (s.editing !== NOT_EDITING) {
                if (keyboard.shiftKey.held) {
                    s.editing--;
                    if (s.editing === NOT_EDITING) {
                        s.editing = EDITING_MODES_COUNT - 1;
                    }
                } else {
                    s.editing++;
                    if (s.editing === EDITING_MODES_COUNT) {
                        s.editing = NOT_EDITING + 1;
                    }
                }
                ctx.handled = true;
            }
        }
    }

    if (!ctx.handled && !s.editing) {
        const delta = getNavigableListInput(ctx);
        const moveNote = keyboard.altKey.held;
        if (!ctx.handled && delta) {
            let newIdx = clampedListIdx(s.list.idx + delta, s.plans.length);
            if (moveNote) {
                moveArrayItem(s.plans, s.list.idx, newIdx);
            }

            s.list.idx = newIdx;
            ctx.handled = true;
        }
    }

    if (!ctx.handled) {
        if (keyboard.enterKey.pressed && !keyboard.enterKey.repeat) {
            if (keyboard.shiftKey.held) {
                addPlanItemUnderCurrent(s);
            }

            s.editing = EDITING_TEXT;
            ctx.handled = true;
        }
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

    imNoteJournalView(ctx, s);
}

export function imNoteJournalView(ctx: GlobalContext, s: JournalViewState) {
    handleKeyboardInput(ctx, s);

    imBeginNavigableListContainer(s.list); {

        imFor(); for (let i = 0; i < s.plans.length; i++) {
            imNextRoot();

            const focused = s.list.idx === i;
            const plan = s.plans[i];

            imBeginListRow(focused, s.editing !== NOT_EDITING); {
                imBegin(ROW); imListRowCellStyle(); imFlex(); {
                    const isEditing = s.editing && focused;
                    if (imIf() && isEditing) {
                        {
                            const [event, textArea] = imTextArea({ value: "a", });

                            if (s.editing === EDITING_START_TIME) {
                                ctx.textAreaToFocus = textArea;
                                ctx.focusWithAllSelected = true;
                            }
                        }

                        {
                            const [event, textArea] = imTextArea({ value: "a", });

                            if (s.editing === EDITING_END_TIME) {
                                ctx.textAreaToFocus = textArea;
                                ctx.focusWithAllSelected = true;
                            }
                        }

                        {
                            const isEditingText = s.editing === EDITING_TEXT;

                            const [event, textArea] = imTextArea({ 
                                value: plan.text, 
                                placeholder: isEditingText ? "Enter some text, or find a note with >" : undefined,
                            });

                            if (event) {
                                if (event.input || event.change) {
                                    plan.text = event.text;
                                }
                            }

                            if (isEditingText) {
                                ctx.textAreaToFocus = textArea;
                            }
                        }
                    } else {
                        imElse();
                        imBegin(); {
                            setText(plan.text);
                        } imEnd();
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
