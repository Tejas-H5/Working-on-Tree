import { imListRowCellStyle } from "src/app-components/list-row";
import { AXIS_FLAG_BYPASS_TEXT_AREA, AXIS_VERTICAL, clampedListIdx, getNavigableListInput, imNavListBegin, imNavListEnd, imNavListNextItemArray, imNavListRowBegin, imNavListRowEnd, NavigableListState } from "src/app-components/navigable-list";
import { doExtraTextAreaInputHandling, imTextAreaBegin, imTextAreaEnd } from "src/components/editable-text-area";
import { imLine, LINE_HORIZONTAL, LINE_VERTICAL } from "src/components/im-line";
import { newScrollContainer } from "src/components/scroll-container";
import { imTextInputOneLine } from "src/components/text-input";
import { ALT, BYPASS_TEXT_AREA, CTRL, debouncedSave, GlobalContext, hasDiscoverableCommand, HIDDEN, REPEAT, SHIFT } from "src/global-context";
import { notesMutated, pushJournalActivity, state } from "src/state";
import { arrayAt } from "src/utils/array-utils";
import { assert } from "src/utils/assert";
import { DAYS_OF_THE_WEEK_ABBREVIATED, MONTH_NAMES, pad2 } from "src/utils/datetime";
import { fuzzyFind, FuzzyFindRange } from "src/utils/fuzzyfind";
import { el, ev, im, ImCache, imdom, key } from "src/utils/im-js";
import { BLOCK, COL, cssVars, imui, NA, PX, ROW } from "src/utils/im-js/im-ui";
import * as itree from "src/utils/int-tree";
import { imTextWithHighlightedRanges } from "./fuzzy-finder";
import { logTrace } from "src/utils/log";
import { getMappingGraphCount, imGraphMappingsEditorView, MappingGraph, MappingGraphView, newGraphMappingsViewState, newMappingGraph, newMappingGraphView } from "./graph-view";
import { cnApp } from "src/app-styling";


type FinderResult = {
    id: number;
    ranges: FuzzyFindRange[];
}

const VIEWING_PAGE  = 0;
const VIEWING_GRAPH = 1;
const VIEWING_CODE  = 2;
const VIEWING_NOTES = 3;

export type JournalViewState = {
    sidebarHasFocus: boolean;

    pages: {
        parents: TreePage[];
        version: number;
        isRenaming: boolean;
        view: number;
    };

    finder: {
        query: string;
        isFinding: boolean;
        results: FinderResult[] | null;
        resultsIdx: number;
    };
}

export function newJournalViewState(): JournalViewState {
    return {
        sidebarHasFocus: false,

        pages: {
            parents: [],
            version: 0,
            isRenaming: false,
            view: VIEWING_PAGE,
        },

        finder: {
            query: "",
            isFinding: false,
            results: null,
            resultsIdx: 0,
        },
    };
}

export function newJournal(): Journal {
    const rootPage = newJournalPage("Root page");

    return {
        // TODO: flatten - pageIdx = currentlyEditing.pageIdx
        currentlyEditing: {
            pageIdx: 0,
        },

        pages: itree.newTreeStore(rootPage),
    };
}

export type TreePage = itree.TreeNode<JournalPage>;

export type Journal = {
    currentlyEditing: {
        pageIdx: number;
    };

    pages: itree.TreeStore<JournalPage>;
};

export type JournalPage = {
    name: string;
    createdAt: Date;
    content: string;
    graph: { g: MappingGraph; v: MappingGraphView } | undefined;
    focusedChildIdx: number;
}

export function newJournalPage(name: string, createdAt = new Date()):JournalPage {
    return {
        name: name,
        createdAt: createdAt,
        content: "",
        graph: undefined,
        focusedChildIdx: 0,
    };
}

function findChildPageByName(journal: Journal, page: TreePage, name: string): TreePage | undefined {
    for (const id of page.childIds) {
        const childPage = getJournalPage(journal, id)
        if (childPage.data.name === name) return childPage;
    }
    return undefined;
}

function addJournalPageUnder(journal: Journal, parent: TreePage, name: string, content = ""): TreePage {
    return pushJournalPageInternal(journal, parent, name, content, false);
}

function addJournalPageAfter(journal: Journal, parent: TreePage, name: string, content = ""): TreePage {
    return pushJournalPageInternal(journal, parent, name, content, true);
}

function pushJournalPageInternal(journal: Journal, parent: TreePage, name: string, content: string, after: boolean): TreePage {
    logTrace("Created new page: " + name);

    const newPage = newJournalPage(name);
    newPage.content = content;
    const newPageNode = itree.newTreeNode(newPage);

    if (after) {
        itree.addAfter(journal.pages, parent, newPageNode);
    } else {
        itree.addUnder(journal.pages, parent, newPageNode);
    }

    return newPageNode;
}

function findOrPushChildPageByName(journal: Journal, parent: TreePage, name: string): TreePage {
    let page = findChildPageByName(journal, parent, name)
    if (!page) {
        page = addJournalPageUnder(journal, parent, name);
    }
    return page;
}

const JOURNAL_ROOT_NAME = "Journal"

// TODO: figure out a good time to call this
export function getOrCreateJournalLogPageForDate(journal: Journal, date: Date): TreePage {
    const root = itree.getNode(journal.pages, itree.ROOT_ID);
    let logPage = findOrPushChildPageByName(journal, root, JOURNAL_ROOT_NAME)

    const yearPageName = "" + date.getFullYear();
    let yearPage = findOrPushChildPageByName(journal, logPage, yearPageName);

    const monthPageName = MONTH_NAMES[date.getMonth()];
    const monthPage = findOrPushChildPageByName(journal, yearPage, monthPageName);

    const dayStr = DAYS_OF_THE_WEEK_ABBREVIATED[date.getDay()];
    const datePageName = dayStr + " " + pad2(date.getDate());
    const datePage = findOrPushChildPageByName(journal, monthPage, datePageName)

    return datePage;
}

function journalViewHasFocus(ctx: GlobalContext) {
    return ctx.currentView === ctx.views.noteTree && ctx.viewingJournal;
}

// Creates a first page if we don't have any pages!
function getCurrentPage(journal: Journal): TreePage {
    const root = itree.getNode(journal.pages, itree.ROOT_ID);

    let currentPage = itree.getNodeOrUndefined(journal.pages, journal.currentlyEditing.pageIdx);
    if (!currentPage || currentPage === root) {
        for (let pageIdx = 1; pageIdx < journal.pages.nodes.length; pageIdx++) {
            const page = journal.pages.nodes[pageIdx]
            if (page) {
                currentPage = page;
                journal.currentlyEditing.pageIdx = pageIdx;
                break
            }
        }

        if (!currentPage) {
            currentPage = addJournalPageUnder(journal, root, "First page", "This is the first ever page!!!");
            journal.currentlyEditing.pageIdx = currentPage.id;
        }
    }

    return currentPage;
}

export function imJournalView(
    c: ImCache,
    ctx: GlobalContext,
    s: JournalViewState,
    journal: Journal, // We edit this!
) {
    const viewHasFocus = journalViewHasFocus(ctx);

    if (im.Memo(c, viewHasFocus)) {
        s.sidebarHasFocus = true;
    }

    let currentPage = getCurrentPage(journal);

    if (im.Memo(c, currentPage) | im.Memo(c, s.pages.version)) {
        s.pages.parents.length = 0;
        let parent: TreePage | undefined = currentPage;
        while (parent) {
            parent = itree.getParent(journal.pages, parent);
            if (parent && parent.id !== itree.ROOT_ID) {
                s.pages.parents.push(parent);
            }
        }
        s.pages.parents.reverse();
    }

    if (!ctx.handled && viewHasFocus) {
        ctx.handled ||= handleKeyboardInput(ctx, s, journal, currentPage);
        // may have changed since.
        currentPage = getCurrentPage(journal);
    }

    if (im.Memo(c, s.finder.query) | im.Memo(c, s.finder.isFinding)) {
        if (!s.finder.isFinding || !s.finder.query) {
            s.finder.results = null
        } else {
            findJournalResults(s, journal, false);
            if (!s.finder.results) {
                findJournalResults(s, journal, true);
            }
        }
    }

    // Journal side bar
    imui.Begin(c, ROW); imui.Flex(c); {
        imui.Begin(c, COL); imui.MinSize(c, 200, PX, 0, NA); {
            if (im.If(c) && s.finder.isFinding && s.finder.results) {
                // Journal entries
                const sc = im.State(c, newScrollContainer);
                const list = imNavListBegin(c, sc, s.finder.resultsIdx, viewHasFocus && s.finder.isFinding); {
                    im.For(c); while (imNavListNextItemArray(list, s.finder.results)) {
                        const { i } = list;
                        const result = s.finder.results[i];

                        const itemHighlighted = viewHasFocus && s.finder.resultsIdx === i;
                        const itemSelected = s.finder.isFinding && itemHighlighted;

                        imNavListRowBegin(c, list, itemSelected, itemHighlighted); {
                            imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                                const page = getJournalPage(journal, result.id);
                                imdom.Str(c, getPageName(page.data));
                            } imui.End(c);
                        } imNavListRowEnd(c);
                    } im.ForEnd(c);
                } imNavListEnd(c, list);

            } else {
                im.Else(c);

                const currentPageParent = itree.getNode(journal.pages, currentPage.parentId);

                const sc = im.State(c, newScrollContainer);

                if (im.If(c) && !s.finder.isFinding && s.pages.parents.length > 0) {
                    let i = 0;
                    im.For(c); for (const page of s.pages.parents) {
                        imPageListRow(c, ctx, s, journal, null, page, i);
                        i++;
                    } im.ForEnd(c);

                    imLine(c, LINE_HORIZONTAL);
                } im.IfEnd(c);

                const list = imNavListBegin(c, sc, currentPageParent.data.focusedChildIdx, viewHasFocus && s.sidebarHasFocus); {
                    im.For(c); while (imNavListNextItemArray(list, currentPageParent.childIds)) {
                        const { i } = list;
                        const childId = currentPageParent.childIds[i];
                        const page = getJournalPage(journal, childId);

                        imPageListRow(c, ctx, s, journal, list, page, s.pages.parents.length);
                    } im.ForEnd(c);
                } imNavListEnd(c, list);
            } im.IfEnd(c);
        } imui.End(c);

        imLine(c, LINE_VERTICAL, 1);

        imui.Begin(c, COL); imui.Flex(c); {
            if (im.If(c) && s.finder.isFinding) {
                const finder = s.finder;

                const currentFilterResult = finder.results && arrayAt(finder.results, finder.resultsIdx);
                imdom.ElBegin(c, el.H2); imui.Layout(c, ROW); imui.Justify(c); {
                    if (im.If(c) && currentFilterResult == null) {
                        imdom.Str(c, "No results");
                    } else {
                        im.Else(c);
                        const page = getJournalPage(journal, currentFilterResult!.id);
                        imdom.Str(c, getPageName(page.data));
                    } im.IfEnd(c);
                } imdom.ElEnd(c, el.H2);

                imLine(c, LINE_HORIZONTAL, 1);

                imui.Begin(c, BLOCK); {
                    const ev = imTextInputOneLine(c, finder.query, "Search for text...", true, false);
                    if (ev) {
                        if (ev.newName !== undefined) {
                            finder.query = ev.newName;
                        }
                        if (ev.submit) {
                            finder.isFinding = false;
                            ctx.handled = true;

                            const result = s.finder.results && arrayAt(s.finder.results, s.finder.resultsIdx);
                            if (result) {
                                setCurrentlyEditingPageIdx(s, journal, result.id);
                            }
                        }
                        if (ev.cancel) {
                            finder.isFinding = false;
                            ctx.handled = true;
                        }
                    }
                } imui.End(c);

                imLine(c, LINE_HORIZONTAL, 1);

                imui.Begin(c, BLOCK); imui.Flex(c); {
                    if (im.If(c) && currentFilterResult) {
                        const page = getJournalPage(journal, currentFilterResult.id);
                        imTextWithHighlightedRanges(c, page.data.content, currentFilterResult.ranges, false);
                    } else {
                        im.Else(c);
                        imdom.Str(c, "No results");
                    } im.IfEnd(c);
                } imui.End(c);
            } else {
                im.Else(c);

                imui.Begin(c, ROW); imui.Align(c); {
                    imui.Begin(c, ROW); imui.Flex(c); imui.Gap(c, 10, PX); {
                        const graphCount = getMappingGraphCount(currentPage.data.graph?.g)
                        imToggleableViewIcon(c, s, VIEWING_GRAPH, "[G]raph", graphCount);

                        // TODO: implement code
                        imToggleableViewIcon(c, s, VIEWING_CODE, "[C]ode", graphCount);

                        // TODO: implement todo
                        imToggleableViewIcon(c, s, VIEWING_NOTES, "[N]otes", graphCount);
                    } imui.End(c);

                    imdom.ElBegin(c, el.H2); imui.Layout(c, ROW); imui.Justify(c); {
                        imdom.Str(c, "Page - ");
                        imdom.Str(c, getPageName(currentPage.data));
                    } imdom.ElEnd(c, el.H2);

                    imui.Flex1(c);
                } imui.End(c);

                imLine(c, LINE_HORIZONTAL, 1);

                imPageEditor(c, ctx, s, currentPage.data, viewHasFocus && !s.sidebarHasFocus, false);
            } im.IfEnd(c);
        } imui.End(c);
    } imui.End(c);

    if (!ctx.handled) {
        if (s.finder.isFinding && hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Stop finding", BYPASS_TEXT_AREA)) {
            s.finder.isFinding = false;
        } else if (!s.sidebarHasFocus && hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Sidebar", BYPASS_TEXT_AREA)) {
            s.sidebarHasFocus = true;
        } else if (s.pages.view !== VIEWING_PAGE && hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Back")) {
            s.pages.view = VIEWING_PAGE;
        }
    }
}


function imPageListRow(
    c: ImCache,
    ctx: GlobalContext,
    s: JournalViewState,
    journal: Journal,
    list: NavigableListState | null,
    page: TreePage,
    depth: number,
) {
    const viewHasFocus = journalViewHasFocus(ctx);
    const itemHighlighted = viewHasFocus && journal.currentlyEditing.pageIdx === page.id;
    const itemSelected = s.sidebarHasFocus && itemHighlighted;

    imNavListRowBegin(c, list, itemSelected, itemHighlighted); imui.Align(c); {
        imui.Begin(c, ROW); imui.Align(c); imListRowCellStyle(c); {
            imui.Begin(c, BLOCK); imui.Size(c, depth * 20, PX, 0, NA); imui.End(c);
            if (im.If(c) && itemSelected && s.pages.isRenaming) {
                const ev = imTextInputOneLine(c, page.data.name, "Name...", true, false);
                if (!ctx.handled && ev) {
                    if (ev.newName !== undefined) {
                        page.data.name = ev.newName;
                        debouncedSave(ctx, state, "imPageListRow - journal rename");
                    }
                    if (ev.submit || ev.cancel) {
                        stopRenaming(ctx, s, journal)
                    }
                }
            } else {
                im.IfElse(c);
                imdom.Str(c, getPageName(page.data));
            } im.IfEnd(c);
        } imui.End(c);

        if (im.If(c) && page.childIds.length > 0) {
            imui.Begin(c, BLOCK); imui.MinSize(c, 40, PX, 0, NA); imui.Flex(c); imui.End(c);

            imdom.Str(c, "(");
            imdom.Str(c, page.childIds.length);
            imdom.Str(c, ")");
        } im.IfEnd(c);
    } imNavListRowEnd(c);
}

function imPageEditor(
    c: ImCache,
    ctx: GlobalContext,
    journalViewState: JournalViewState,
    page: JournalPage,
    editing: boolean,
    readonly: boolean
) {
    const s = im.GetInline(c, imPageEditor)
        ?? im.Set(c, { version: 0 });

    if (im.If(c) && journalViewState.pages.view === VIEWING_GRAPH) {
        if (!page.graph) {
            // Lazily create this data directly in the UI render pass. React devs would not like this
            page.graph = {
                g: newMappingGraph(),
                v: newMappingGraphView(),
            };
            notesMutated(state);
        }

        imui.Begin(c, COL); imui.PaddingRL(c, 0, NA, 20, PX); imui.Flex(c); imui.PreWrap(c); {
            const graphViewState = im.State(c, newGraphMappingsViewState);
            imGraphMappingsEditorView(c, graphViewState, page.graph.g, page.graph.v)
        } imui.End(c);
    } else {
        im.Else(c);

        imui.Begin(c, BLOCK); imui.PaddingRL(c, 0, NA, 20, PX); imui.Flex(c); imui.PreWrap(c); {
            if (im.If(c) && editing) {
                const [root, textArea] = imTextAreaBegin(c, {
                    value: page.content,
                    version: s.version
                }); {
                    if (im.isFirstishRender(c)) {
                        imdom.setStyleProperty(c, "--focusColor", "", root);
                    }

                    const input = imdom.On(c, ev.INPUT);
                    const change = imdom.On(c, ev.CHANGE);

                    if (input || change) {
                        if (!readonly) {
                            page.content = textArea.value;
                            debouncedSave(ctx, state, "imPageEditor - journal edit");
                        }
                        s.version++;
                    }

                    const keyDown = imdom.On(c, ev.KEYDOWN);
                    if (keyDown) {
                        ctx.handled = doExtraTextAreaInputHandling(keyDown, textArea, {
                            tabStopSize: state.settings.tabStopSize,
                            useSpacesInsteadOfTabs: state.settings.spacesInsteadOfTabs,
                        })
                    }

                    ctx.textAreaToFocus = textArea;
                } imTextAreaEnd(c);
            } else {
                im.Else(c);

                imdom.Str(c, page.content);
            } im.IfEnd(c);
        } imui.End(c);
    } im.IfEnd(c);
}

export function getJournalPage(journal: Journal, id: number): TreePage {
    return itree.getNode(journal.pages, id);
}

export function getPageOrUndefined(journal: Journal, id: number): TreePage | undefined{
    return itree.getNodeOrUndefined(journal.pages, id);
}

function getPageName(page: JournalPage): string {
    if (!page.name) return "<Unnamed>";
    return page.name;
}

function stopRenaming(ctx: GlobalContext, s: JournalViewState, journal: Journal) {
    s.pages.isRenaming = false

    // Nothing needed here, yet.
}

function handleKeyboardInput(
    ctx: GlobalContext,
    s: JournalViewState,
    journal: Journal,
    currentPage: TreePage,
): boolean {
    let handled = false;

    if (s.finder.isFinding && s.finder.results) {
        const input = getNavigableListInput(ctx, s.finder.resultsIdx, 0, s.finder.results.length, AXIS_VERTICAL, AXIS_FLAG_BYPASS_TEXT_AREA);
        if (input) {
            s.finder.resultsIdx = input.newIdx;
            handled = true;
        }
    } else if (s.sidebarHasFocus) {
        const parent = itree.getNode(journal.pages, currentPage.parentId);
        const parentPage = parent.data;

        const keys = imdom.getKeyboard();
        const movePage = imdom.isKeyHeld(keys, ctx.keyboard.altKey);

        const input = getNavigableListInput(ctx, parentPage.focusedChildIdx, 0, parent.childIds.length, AXIS_VERTICAL, AXIS_FLAG_BYPASS_TEXT_AREA);
        if (input) {
            if (movePage) {
                itree.insertAt(journal.pages, parent, currentPage, input.newIdx);
                setCurrentlyEditingPageIdx(s, journal, journal.currentlyEditing.pageIdx);
            } else {
                const childId = parent.childIds[input.newIdx]; assert(childId != null);
                setCurrentlyEditingPageIdx(s, journal, childId);
            }

            handled = true;
        }

        // moving in/dragging in
        {
            const prevIdx = arrayAt(parent.childIds, currentPage.idxInParentList - 1);
            if (hasDiscoverableCommand(ctx, ctx.keyboard.rightKey, "Drag in", ALT | REPEAT)) {
                if (prevIdx != null) {
                    const prevPage = getJournalPage(journal, prevIdx);
                    let idxUnderPrev = clampedListIdx(prevPage.data.focusedChildIdx, prevPage.childIds.length) + 1;
                    itree.insertAt(journal.pages, prevPage, currentPage, idxUnderPrev);
                    setCurrentlyEditingPageIdx(s, journal, currentPage.id);
                }

                handled = true;
            }

            if (currentPage.childIds.length > 0 && hasDiscoverableCommand(ctx, ctx.keyboard.rightKey, "Move in", REPEAT | HIDDEN)) {
                let nextPageIdx = arrayAt(currentPage.childIds, currentPage.data.focusedChildIdx) ?? 0;
                setCurrentlyEditingPageIdx(s, journal, nextPageIdx);
                handled = true;
            }

        }

        // moving/dragging out
        {
            const parentParent = itree.getParent(journal.pages, parent);
            if (hasDiscoverableCommand(ctx, ctx.keyboard.leftKey, "Drag out", ALT | REPEAT)) {
                if (parentParent) {
                    let idx = clampedListIdx(parentParent.data.focusedChildIdx, parentParent.childIds.length) + 1;
                    itree.insertAt(journal.pages, parentParent, currentPage, idx);
                }

                handled = true;
            }

            if (parent.id !== itree.ROOT_ID && hasDiscoverableCommand(ctx, ctx.keyboard.leftKey, "Move out", REPEAT)) {
                setCurrentlyEditingPageIdx(s, journal, parent.id);
                handled = true;
            }
        }

        if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "New after", SHIFT)) {
            const node = addJournalPageAfter(journal, currentPage, "");
            setCurrentlyEditingPageIdx(s, journal, node.id);
            s.pages.isRenaming = true;
            handled = true;
        }

        if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "New under", CTRL)) {
            const node = addJournalPageUnder(journal, currentPage, "");
            setCurrentlyEditingPageIdx(s, journal, node.id);
            s.pages.isRenaming = true;
            handled = true;
        }

        if (currentPage && (
            hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Edit page") 
        )) {
            s.sidebarHasFocus = false;
            handled = true;
        }

        if (
            !s.pages.isRenaming &&
            hasDiscoverableCommand(ctx, ctx.keyboard.rKey, "Rename")
        ) {
            s.pages.isRenaming = true;
            handled = true;
        } else if (
            s.pages.isRenaming &&
            hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Stop renaming", BYPASS_TEXT_AREA)
        ) {
            stopRenaming(ctx, s, journal)
            handled = true;
        } else if (
            s.pages.isRenaming &&
            hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Stop renaming", BYPASS_TEXT_AREA)
        ) {
            stopRenaming(ctx, s, journal)
            handled = true;
        }

        if (handled) {
            s.pages.version++;
        }

        if (!handled) {
            const keys = imdom.getKeyboard();
            if (imdom.isKeyPressedOrRepeated(keys, key.ARROW_RIGHT) || imdom.isKeyPressedOrRepeated(keys, key.ARROW_LEFT)) {
                if (imdom.isKeyHeld(keys, key.ALT)) {
                    handled = true;
                }
            }
        }
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.tKey, "Today's page")) {
        const page = getOrCreateJournalLogPageForDate(journal, new Date());
        setCurrentlyEditingPageIdx(s, journal, page.id)
        handled = true;
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.gKey, "Graph", HIDDEN)) {
        if (s.pages.view !== VIEWING_GRAPH) {
            s.pages.view = VIEWING_GRAPH;
        } else {
            s.pages.view = VIEWING_PAGE;
        }
        handled = true;
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.cKey, "Code", HIDDEN)) {
        if (s.pages.view !== VIEWING_CODE) {
            s.pages.view = VIEWING_CODE;
        } else {
            s.pages.view = VIEWING_PAGE;
        }
        handled = true;
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.nKey, "Notes", HIDDEN)) {
        if (s.pages.view !== VIEWING_NOTES) {
            s.pages.view = VIEWING_NOTES;
        } else {
            s.pages.view = VIEWING_PAGE;
        }
        handled = true;
    }

    if ( hasDiscoverableCommand(ctx, ctx.keyboard.fKey, "Find", CTRL | BYPASS_TEXT_AREA)) {
        s.finder.isFinding = true;
        s.sidebarHasFocus = true;
        handled = true;
    }

    return handled;
}


export function setCurrentlyEditingPageIdx(s: JournalViewState, journal: Journal, pageIdx: number) {
    s.pages.view = VIEWING_PAGE;

    // Delete the last page, if applicable
    const prevPage = itree.getNodeOrUndefined(journal.pages, journal.currentlyEditing.pageIdx);
    if (prevPage) {
        if (
            prevPage.data.name === "" && 
            prevPage.data.content === "" && 
            prevPage.childIds.length === 0
        ) {
            // Delete the page we were on before, if it was empty
            itree.remove(journal.pages, prevPage)
        }
    }

    journal.currentlyEditing.pageIdx = pageIdx;

    // Update the current page's parent's focus index
    const currentPage = itree.getNode(journal.pages, journal.currentlyEditing.pageIdx);
    const parent = itree.getParent(journal.pages, currentPage);
    if (parent) {
        const newFocusedIdx = parent.childIds.indexOf(currentPage.id);
        if (newFocusedIdx !== -1) {
            parent.data.focusedChildIdx = newFocusedIdx;
        }
    }

    pushJournalActivity(state, pageIdx);
}

function findJournalResults(
    s: JournalViewState,
    journal: Journal,
    isFuzzySearch: boolean
) {
    const options = { allowableMistakes: isFuzzySearch ? 1 : 0 };
    const results: FinderResult[] = [];
    s.finder.results = results;

    itree.forEachNode(journal.pages, (n) => {
        if (n.id === itree.ROOT_ID) return;

        let findResults = fuzzyFind(n.data.name, s.finder.query, options);
        if (findResults.ranges.length > 0) {
            results.push({ id: n.id, ranges: [], });
            return;
        }

        findResults = fuzzyFind(n.data.content, s.finder.query, options);
        if (findResults.ranges.length > 0) {
            results.push({ id: n.id, ranges: findResults.ranges, });
            return;
        }
    });

    if (s.finder.results.length === 0) s.finder.results = null;
}

function imToggleableViewIcon(c: ImCache, s: JournalViewState, view: number, name: string, count: number) {
    imui.Begin(c, BLOCK); imui.Fg(c, s.pages.view === view ? "" :  cssVars.mg); {
        if (im.isFirstishRender(c)) imdom.setStyle(c, "fontWeight", "bold");
        imdom.Str(c, name)
        if (im.If(c) && count > 0) {
            imdom.Str(c, "("); imdom.Str(c, count); imdom.Str(c, ")");
        } im.IfEnd(c);
    } imui.End(c);
}
