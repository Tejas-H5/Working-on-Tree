import { imBegin, imFlex, ROW } from "./components/core/layout";
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
import {
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imMemo,
    imNextRoot,
    imState,
    setStyle,
    setText
} from "./utils/im-dom-utils";

export type JournalViewState = {
    list:    NavigableList;
    editing: number;
    plans:   PlanItem[];
}

const NOT_EDITING        = 0;
const EDITING_START_TIME = 1;
const EDITING_END_TIME   = 2;
const EDITING_TEXT       = 3;

function newJournalViewState(): JournalViewState {
    return {
        list:    newNavigableList(),
        editing: NOT_EDITING,

        plans: [
            newPlanItem("First TODO"),
        ],
    };
}

type PlanItem = {
    text: string;
}

function newPlanItem(text: string = ""): PlanItem {
    return {
        text,
    };
}

function addPlanItemUnderCurrent(s: JournalViewState) {
    const newIdx = s.list.idx + 1;
    const newItem = newPlanItem("TODO item " + s.plans.length);
    s.plans.splice(newIdx, 0, newItem);
    s.list.idx = newIdx;
    return newItem;
}

function getCurrentPlanItem(s: JournalViewState): PlanItem {
    assert(boundsCheck(s.plans, s.list.idx));
    return s.plans[s.list.idx];
}

function handleKeyboardInput(s: JournalViewState, ctx: GlobalContext) {
    const keyboard = ctx.keyboard;

    if (!ctx.handled && s.editing) {
        if (keyboard.escapeKey.pressed) {
            s.editing = NOT_EDITING;
            ctx.handled = true;

            assert(boundsCheck(s.plans, s.list.idx));
            const item = getCurrentPlanItem(s);
            if (
                s.plans.length > 1 &&           // (Don't delete the only item)
                item.text.trim().length === 0   // Delete this item if it's empty.
            ) {
                s.plans.splice(s.list.idx, 1);
                s.list.idx = clampedListIdx(s.list.idx, s.plans.length);
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
        if (keyboard.enterKey.pressed) {
            if (keyboard.shiftKey.held) {
                addPlanItemUnderCurrent(s);
            }

            s.editing = EDITING_TEXT;
            ctx.handled = true;
        }
    }
}

export function imNoteJournalView(ctx: GlobalContext) {
    const s = imState(newJournalViewState);

    handleKeyboardInput(s, ctx);

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
                        }

                        {
                            const [event, textArea] = imTextArea({ value: "a", });
                        }

                        {
                            const [event, textArea] = imTextArea({ value: plan.text, });
                            if (event) {
                                if (event.input || event.change) {
                                    plan.text = event.text;
                                }
                            }
                            if (s.editing === EDITING_TEXT) {
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
