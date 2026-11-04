import { imListRowCellStyle } from "app-components/list-row";
import { getNavigableListInput, imNavListBegin, imNavListEnd, imNavListNextItemArray, imNavListRowBegin, imNavListRowEnd, ListPosition, newListPosition } from "app-components/navigable-list";
import { arrayAt } from "array-utils";
import { imLine, LINE_HORIZONTAL } from "components/im-line";
import { newScrollContainer, ScrollContainer } from "components/scroll-container";
import { GlobalContext, hasDiscoverableCommand, setCurrentView } from "global-context";
import { im, ImCache, imdom } from "imcf";
import { COL, imui, PX, ROW } from "imcf/im-ui";
import * as itree from "int-tree";
import { journalMutated, state } from "state";
import { getPage, Journal, setCurrentlyViewingPage, TreePage } from "./journal-view";

type TodoItem = {
    journalPageId: number;
    text:          string;
    status:        string;
    cursorPos:     number;
};

export type TodosViewState = {
    todoItems: TodoItem[];
    listPosition: ListPosition;
    scrollContainer: ScrollContainer;
}

export function newTodosViewState(): TodosViewState {
    return {
        todoItems: [],
        listPosition: newListPosition(),
        scrollContainer: newScrollContainer(),
    };
}

export function recomputeAllTodos(ctx: GlobalContext, journal: Journal, s: TodosViewState) {
    const dfs = (page: TreePage, dst: TodoItem[], currentPageId: number) => {
        // Skip done items that aren't from the current page
        const includeDone = page.id === currentPageId;
        parseAllTodos(page, dst, includeDone);

        for (const id of page.childIds) {
            const childPage = getPage(journal, id);
            dfs(childPage, dst, currentPageId);
        }
    }
    
    const currentPageId = journal.currentlyEditing.pageIdx;
    const currentPage = getPage(journal, currentPageId);
    const cursorPos = currentPage.data.cursorEnd;

    const rootPage = getPage(journal, itree.ROOT_ID);
    s.todoItems.length = 0;

    dfs(rootPage, s.todoItems, currentPageId)

    let currentTodoItemIdx = -1;
    for (let i = 0; i < s.todoItems.length; i++) {
        const todoItem = s.todoItems[i];
        if (todoItem.journalPageId !== currentPageId) continue;

        if (currentTodoItemIdx === -1) {
            // At the very least, select the first todo item on this page
            currentTodoItemIdx = i;
        }

        const cursorInsideTodo = todoItem.cursorPos <= cursorPos && cursorPos <= todoItem.cursorPos + todoItem.text.length;
        if (!cursorInsideTodo) continue;

        // However, if we can select the exact todo item our cursor is in, that would be epic
        currentTodoItemIdx = i;
        break;
    }

    if (currentTodoItemIdx !== -1) {
        s.listPosition.idx = currentTodoItemIdx;
    }
}

function parseAllTodos(page: TreePage, dst: TodoItem[], includeDone: boolean) {
    const text = page.data.content;
    let i = 0;
    while (i < text.length) {
        if (text[i] !== "[") {
            i++;
            continue;
        }
        i++;

        let cursorPos = i;
        let done = false;
        let j = i;
        if (
            text[j] === "x" ||  // DONE
            text[j] === "~"     // DECLINED/I dont wanna do this
        ) {
            j++;
            if (text[j] === "]") {
                done = true;
            }
        }

        if (done) {
            if (!includeDone) {
                continue;
            }
        }

        if (!done) {
            // i + 1 because I dont want [] to count as a TODO item.
            j = i + 1;
            for (let k = 0; k < 20; k++) {
                if (text[j] === "]") break;
                if (text[j] === "\n") break;
                j++;
            }
            if (text[j] !== "]") {
                // We fr didn't find a closing bracket.
                i++;
                continue;
            }
        }

        const status = text.slice(i, j);

        i = j;
        i++;
        const todoTextStart = i;
        while(i < text.length && text[i] !== "\n") {
            i++;
        }
        const todoText = text.slice(todoTextStart, i);
        dst.push({journalPageId: page.id, cursorPos, text: todoText, status});
    }

    for (let i = 0; i < text.length; i++) {
        if (text[i] !== "[")   continue;
        if (text[i+1] === "x") continue;
    }
}

function handleKeyboardInput(ctx: GlobalContext, s: TodosViewState): boolean {
    let handled = false;

    // Moving up/down in the list
    const listNavigation = getNavigableListInput(ctx, s.listPosition.idx, 0, s.todoItems.length);
    if (listNavigation) {
        s.listPosition.idx = listNavigation.newIdx;

        const todoItem = arrayAt(s.todoItems, s.listPosition.idx);
        if (todoItem) {
            const page = getPage(state.journal, todoItem.journalPageId);
            setCurrentlyViewingPage(ctx, page, todoItem.cursorPos);
        }
        handled = true;
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.xKey, "Toggle")) {
        toggleCurrentTodo(ctx, s);
        handled = true;
    }


    if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Go to note")) {
        setCurrentView(ctx, ctx.views.journalView);
        ctx.sideTabExpanded = false;
        handled = true;
    }

    return handled;
}

export function imTodosList(c: ImCache, ctx: GlobalContext, s: TodosViewState) {
    const viewHasFocus = ctx.currentView === s;

    if (im.Memo(c, viewHasFocus)) {
        recomputeAllTodos(ctx, state.journal, s);
    }

    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);
    }

    imui.Begin(c, COL); imui.Flex(c); {
        imui.Begin(c, ROW); imListRowCellStyle(c); imui.Align(c); imui.Justify(c); {
            if (im.IsFirstRender(c)) {
                imdom.setStyle(c, "fontWeight", "bold");
            }

            imdom.Str(c, "TODO items");
        } imui.End(c);

        imLine(
            c,
            LINE_HORIZONTAL, 1,
            !!s.scrollContainer.root && s.scrollContainer.root.scrollTop > 1,
        );

        const list = imNavListBegin(c, s.scrollContainer, s.listPosition.idx, viewHasFocus, false); {
            im.For(c); while (imNavListNextItemArray( list, s.todoItems)) {
                const { i, itemSelected } = list;

                const todoItem = arrayAt(s.todoItems, i);
                if (!todoItem) continue;

                im.KeyedBegin(c, todoItem); {
                    imNavListRowBegin(c, list, itemSelected, itemSelected); {
                        imui.Begin(c, ROW); imListRowCellStyle(c); imui.Gap(c, 10, PX); imui.Flex(c); imui.Align(c); {
                            imdom.Str(c, "["); imdom.Str(c, todoItem.status); imdom.Str(c, "] ");
                            imdom.Str(c, todoItem.text);
                        } imui.End(c);
                    } imNavListRowEnd(c);
                } im.KeyedEnd(c);
            } im.ForEnd(c);

            const hasTodoItems = s.todoItems.length > 0;

            im.KeyedBegin(c, "footer"); {
                if (im.If(c) && !hasTodoItems) {
                    imui.Begin(c, ROW); imui.Flex(c); imui.Align(c); imui.Justify(c); {
                        imdom.Str(c, "[x] Nothing left to do!");
                    } imui.End(c);
                } im.IfEnd(c);
            } im.KeyedEnd(c);
        } imNavListEnd(c, list);
    } imui.End(c);
}

function toggleCurrentTodo(ctx: GlobalContext, s: TodosViewState) {
    const todoItem = arrayAt(s.todoItems, s.listPosition.idx);
    if (todoItem) {
        const prevStatus = todoItem.status;
        if (todoItem.status !== "x") {
            todoItem.status = "x";
        } else {
            todoItem.status = " ";
        }

        const page = getPage(state.journal, todoItem.journalPageId);
        page.data.content 
            = page.data.content.slice(0, todoItem.cursorPos) 
            + todoItem.status 
            + page.data.content.slice(todoItem.cursorPos + prevStatus.length) 
        journalMutated(state);
    }
}
