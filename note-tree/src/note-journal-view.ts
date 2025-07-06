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
    disableIm,
    enableIm,
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imNextRoot,
    imState,
    setText
} from "./utils/im-dom-utils";

export type JournalViewState = {
    list:    NavigableList;
    editing: boolean;
    plans:   PlanItem[];
}

function newJournalViewState(): JournalViewState {
    return {
        list:    newNavigableList(),
        editing: false,

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

export function imNoteJournalView(ctx: GlobalContext) {
    const s = imState(newJournalViewState);

    disableIm(); {
        const keyboard = ctx.keyboard;

        if (!ctx.handled && s.editing) {
            if (keyboard.escapeKey.pressed) {
                s.editing = false;
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

                s.editing = true;
                ctx.handled = true;
            }
        }
    } enableIm();


    imBeginNavigableListContainer(s.list); {

        imFor(); for (let i = 0; i < s.plans.length; i++) {
            imNextRoot();

            const focused = s.list.idx === i;
            const plan = s.plans[i];

            imBeginListRow(focused, s.editing); {
                imBegin(ROW); imListRowCellStyle(); imFlex(); {
                    if (imIf() && s.editing && focused) {
                        const [event] = imTextArea({
                            value: plan.text,
                            focus: true
                        });
                        if (event) {
                            if (event.input || event.change) {
                                plan.text = event.text;
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
