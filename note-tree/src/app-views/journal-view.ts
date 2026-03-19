import { imListRowCellStyle } from "src/app-components/list-row";
import { AXIS_FLAG_BYPASS_TEXT_AREA, AXIS_VERTICAL, clampedListIdx, getNavigableListInput, imNavListBegin, imNavListEnd, imNavListNextItemArray, imNavListRowBegin, imNavListRowEnd, NavigableListState } from "src/app-components/navigable-list";
import { doExtraTextAreaInputHandling, imTextAreaBegin, imTextAreaEnd } from "src/components/editable-text-area";
import { imLine, LINE_HORIZONTAL, LINE_VERTICAL } from "src/components/im-line";
import { newScrollContainer } from "src/components/scroll-container";
import { imTextInputOneLine } from "src/components/text-input";
import { ALT, BYPASS_TEXT_AREA, CTRL, debouncedSave, GlobalContext, hasDiscoverableCommand, REPEAT, setCurrentView, SHIFT } from "src/global-context";
import { JOURNAL_TYPE_JOURNAL, JOURNAL_TYPE_PAGE, JournalId, pushJournalActivity, state } from "src/state";
import { arrayAt } from "src/utils/array-utils";
import { assert } from "src/utils/assert";
import { formatDate, formatIsoDate, isSameDate } from "src/utils/datetime";
import { fuzzyFind, FuzzyFindRange } from "src/utils/fuzzyfind";
import { el, ev, im, ImCache, imdom, key } from "src/utils/im-js";
import { BLOCK, COL, imui, NA, PX, ROW } from "src/utils/im-js/im-ui";
import * as itree from "src/utils/int-tree";
import { logTrace } from "src/utils/log";
import { imTextWithHighlightedRanges } from "./fuzzy-finder";


type FinderResult = {
    id: number;
    ranges: FuzzyFindRange[];
}

export type JournalViewState = {
    sidebarHasFocus: boolean;

    pages: {
        parents: TreePage[];
        version: number;
        isRenaming: boolean;
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
        currentlyEditing: {
            type: 0,
            entryIdx: 0,
            pageIdx: 0,
        },

        entries: [],
        pages: itree.newTreeStore(rootPage),
    };
}

type TreePage = itree.TreeNode<JournalPage>;

export type Journal = {
    currentlyEditing: {
        type: number,
        entryIdx: number;
        pageIdx: number;
    };

    entries: JournalEntry[];
    pages: itree.TreeStore<JournalPage>;
};

export type JournalPage = {
    name: string;
    createdAt: Date;
    content: string;
    focusedChildIdx: number;
}

export function newJournalPage(name: string, createdAt = new Date()):JournalPage {
    return {
        name: name,
        createdAt: createdAt,
        content: "",
        focusedChildIdx: 0,
    };
}

export function newJournalEntry(name: string, createdAt = new Date()): JournalEntry {
    return {
        date: formatIsoDate(createdAt),
        page: newJournalPage(name, createdAt),
    };
}

export type JournalEntry = {
    date: string; // yyyy-mm-dd
    page: JournalPage;
};

export function getJournalEntryIdx(journal: Journal, isoDate: string): number | undefined {
    validateJournalKey(isoDate);

    // I want finding today's entry in particular to be very fast
    for (let i = journal.entries.length - 1; i >= 0; i--) {
        const entry = journal.entries[i];
        if (entry.date === isoDate) {
            return i;
        }
    }

    return undefined;
}

export function makeJournalEntry(journal: Journal, key: string): number {
    validateJournalKey(key);

    const entry = newJournalEntry(key);
    journal.entries.push(entry);
    logTrace("Made new journal entry for " + key);

    return journal.entries.length - 1;
}

function validateJournalKey(key: string) {
    assert(key.length === 10);
    assert(key[4] === "-");
    assert(key[7] === "-");
}

export function getJournalEntry(journal: Journal, idx: number): JournalEntry {
    const val = getJournalEntryOrUndefined(journal, idx);
    assert(!!val);
    return val;
}

export function getJournalEntryOrUndefined(journal: Journal, idx: number): JournalEntry | undefined {
    return journal.entries[idx];
}

function journalViewHasFocus(ctx: GlobalContext) {
    return ctx.currentView === ctx.views.noteTree && ctx.viewingJournal;
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

    if (!journal.currentlyEditing.type) {
        journal.currentlyEditing.type = JOURNAL_TYPE_PAGE;
        setCurrentlyEditingJournalIdx(s, journal, journal.entries.length - 1);
    }

    let currentJournalEntry = 
        journal.currentlyEditing.type === JOURNAL_TYPE_JOURNAL && 
        getJournalEntryOrUndefined(journal, journal.currentlyEditing.entryIdx);

    let dontHaveEntryForToday = false;
    if (im.Memo(c, journal.currentlyEditing.type)) {
        const lastEntry = getJournalEntryOrUndefined(journal, journal.entries.length - 1);
        if (lastEntry) {
            const today = new Date();
            const isoDateKey = formatIsoDate(today);
            if (lastEntry.date !== isoDateKey) {
                dontHaveEntryForToday = true;
            }
        }
    }

    if (journal.currentlyEditing.type === JOURNAL_TYPE_JOURNAL) {
        if (!currentJournalEntry || dontHaveEntryForToday) {
            // Create or edit today's journal entry
            const today = new Date();
            const isoDateKey = formatIsoDate(today);

            let entryIdx = getJournalEntryIdx(journal, isoDateKey);
            if (entryIdx === undefined) {
                entryIdx = makeJournalEntry(journal, isoDateKey);
            }

            journal.currentlyEditing.type = JOURNAL_TYPE_JOURNAL;
            setCurrentlyEditingJournalIdx(s, journal, entryIdx);
            currentJournalEntry = getJournalEntry(journal, entryIdx);
            assert(!!currentJournalEntry);
        }
    }

    const currentPage = 
        journal.currentlyEditing.type === JOURNAL_TYPE_PAGE && 
        journal.currentlyEditing.pageIdx > 0 && 
        itree.getNode(journal.pages, journal.currentlyEditing.pageIdx);

    if (im.Memo(c, currentPage) | im.Memo(c, s.pages.version)) {
        if (currentPage) {
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
    }

    if (journal.currentlyEditing.type === JOURNAL_TYPE_PAGE) {
        if (journal.currentlyEditing.pageIdx <= 0) {
            const tree = journal.pages;

            let found = false;
            for (let pageIdx = 1; pageIdx < tree.nodes.length; pageIdx++) {
                const n = tree.nodes[pageIdx];
                if (n === null) continue;

                found = true;
                setCurrentlyEditingPageIdx(s, journal, pageIdx);
            }

            if (!found) {
                // Let's make a new page for us to edit!

                const page = newJournalPage("First ever page");
                page.content = "This is the first ever page!!!";

                const root = itree.getNode(tree, itree.ROOT_ID);
                const node = itree.newTreeNode(page);
                itree.addUnder(tree, root, node);

                setCurrentlyEditingPageIdx(s, journal, node.id);
            }
        }
    }


    if (!ctx.handled && viewHasFocus) {
        ctx.handled ||= handleKeyboardInput(
            ctx,
            s,
            journal,
            currentJournalEntry || undefined,
            currentPage || undefined,
        );
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

                                if (im.If(c) && journal.currentlyEditing.type === JOURNAL_TYPE_JOURNAL) {
                                    const entry = getJournalEntry(journal, result.id);
                                    imdom.StrFmt(c, entry, getJournalEntryName);
                                } else if (im.IfElse(c) && journal.currentlyEditing.type === JOURNAL_TYPE_PAGE) {
                                    im.Else(c);

                                    const page = getPage(journal, result.id);
                                    imdom.Str(c, getPageName(page.data));
                                } im.IfEnd(c);
                            } imui.End(c);
                        } imNavListRowEnd(c);
                    } im.ForEnd(c);
                } imNavListEnd(c, list);

            } else if (im.IfElse(c) && journal.currentlyEditing.type === JOURNAL_TYPE_JOURNAL) {
                // Journal entries
                const sc = im.State(c, newScrollContainer);
                const list = imNavListBegin(c, sc, journal.currentlyEditing.entryIdx, viewHasFocus && s.sidebarHasFocus); {
                    im.For(c); while (imNavListNextItemArray(list, journal.entries)) {
                        const { i } = list;
                        const entry = journal.entries[i];

                        const itemHighlighted = viewHasFocus && journal.currentlyEditing.entryIdx === i;
                        const itemSelected = s.sidebarHasFocus && itemHighlighted;

                        imNavListRowBegin(c, list, itemSelected, itemHighlighted); {
                            imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                                imdom.StrFmt(c, entry, getJournalEntryName);
                            } imui.End(c);
                        } imNavListRowEnd(c);
                    } im.ForEnd(c);
                } imNavListEnd(c, list);
            } else if (im.IfElse(c) && journal.currentlyEditing.type === JOURNAL_TYPE_PAGE && currentPage) {
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
                        const page = getPage(journal, childId);

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
                    } else if (im.ElseIf(c) && journal.currentlyEditing.type === JOURNAL_TYPE_JOURNAL) {
                        const entry = getJournalEntry(journal, currentFilterResult!.id);
                        imdom.Str(c, "Log - ");
                        imdom.StrFmt(c, entry, getJournalEntryName);
                    } else if (im.ElseIf(c) && journal.currentlyEditing.type === JOURNAL_TYPE_PAGE) {
                        const page = getPage(journal, currentFilterResult!.id);
                        imdom.Str(c, "Page - ");
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
                                if (journal.currentlyEditing.type === JOURNAL_TYPE_JOURNAL) {
                                    setCurrentlyEditingJournalIdx(s, journal, result.id);
                                } else if (journal.currentlyEditing.type === JOURNAL_TYPE_PAGE) {
                                    setCurrentlyEditingPageIdx(s, journal, result.id);
                                }
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
                    if (im.If(c) && currentFilterResult == null) {
                        imdom.Str(c, "No results");
                    } else if (im.ElseIf(c) && journal.currentlyEditing.type === JOURNAL_TYPE_JOURNAL) {
                        assert(!!currentFilterResult);
                        const entry = getJournalEntry(journal, currentFilterResult!.id);
                        // imdom.Str(c, entry.page.content);
                        imTextWithHighlightedRanges(c, entry.page.content, currentFilterResult.ranges, false);
                    } else if (im.ElseIf(c) && journal.currentlyEditing.type === JOURNAL_TYPE_PAGE) {
                        assert(!!currentFilterResult);
                        const page = getPage(journal, currentFilterResult.id);
                        // imdom.Str(c, page.data.content);
                        imTextWithHighlightedRanges(c, page.data.content, currentFilterResult.ranges, false);
                    } im.IfEnd(c);
                } imui.End(c);
            } else if (im.ElseIf(c) && currentJournalEntry) {
                imdom.ElBegin(c, el.H2); imui.Layout(c, ROW); imui.Justify(c); {
                    imdom.Str(c, "Log - ");
                    imdom.StrFmt(c, currentJournalEntry, getJournalEntryName);
                } imdom.ElEnd(c, el.H2);

                imLine(c, LINE_HORIZONTAL, 1);

                const isReadonly = entryIsReadonly(journal, currentJournalEntry);
                imPageEditor(c, ctx, currentJournalEntry.page, viewHasFocus && !s.sidebarHasFocus, isReadonly);
            } else if (im.IfElse(c) && currentPage) {
                imdom.ElBegin(c, el.H2); imui.Layout(c, ROW); imui.Justify(c); {
                    imdom.Str(c, "Page - ");
                    imdom.Str(c, getPageName(currentPage.data));
                } imdom.ElEnd(c, el.H2);

                imLine(c, LINE_HORIZONTAL, 1);


                imPageEditor(c, ctx, currentPage.data, viewHasFocus && !s.sidebarHasFocus, false);
            } else {
                im.Else(c);

                imdom.ElBegin(c, el.H2); {
                    imdom.Str(c, "Not editing anything rn.");
                } imdom.ElEnd(c, el.H2);
            } im.IfEnd(c);
        } imui.End(c);
    } imui.End(c);

    const viewingPages = journal.currentlyEditing.type === JOURNAL_TYPE_PAGE;
    if (hasDiscoverableCommand(ctx, ctx.keyboard.jKey, viewingPages ? "Journal" : "Pages", CTRL | BYPASS_TEXT_AREA | REPEAT)) {
        if (viewingPages) {
            journal.currentlyEditing.type = JOURNAL_TYPE_JOURNAL;
        } else {
            journal.currentlyEditing.type = JOURNAL_TYPE_PAGE;
        }
    }

    if (s.finder.isFinding && hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Stop finding", BYPASS_TEXT_AREA)) {
        s.finder.isFinding = false;
    } else if (!s.sidebarHasFocus && hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Sidebar", BYPASS_TEXT_AREA)) {
        s.sidebarHasFocus = true;
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

    imNavListRowBegin(c, list, itemSelected, itemHighlighted); {
        if (im.If(c) && itemSelected && s.pages.isRenaming) {
            const ev = imTextInputOneLine(c, page.data.name, "Name...", true, false);
            if (ev) {
                if (ev.newName !== undefined) {
                    page.data.name = ev.newName;
                    debouncedSave(ctx, state, "imPageListRow - journal rename");
                }
                if (ev.submit || ev.cancel) {
                    s.pages.isRenaming = false;
                }
            }
        } else {
            im.IfElse(c);
            imui.Begin(c, ROW); imui.Align(c); imListRowCellStyle(c); {
                imui.Begin(c, BLOCK); imui.Size(c, depth * 20, PX, 0, NA); imui.End(c);
                imdom.Str(c, getPageName(page.data));
            } imui.End(c);
        } im.IfEnd(c);

        if (im.If(c) && page.childIds.length > 0) {
            imui.Begin(c, BLOCK); imui.MinSize(c, 40, PX, 0, NA); imui.Flex(c); imui.End(c);

            imdom.Str(c, "(");
            imdom.Str(c, page.childIds.length);
            imdom.Str(c, ")");
        } im.IfEnd(c);
    } imNavListRowEnd(c);
}

function imPageEditor(c: ImCache, ctx: GlobalContext, page: JournalPage, editing: boolean, readonly: boolean) {
    const s = im.GetInline(c, imPageEditor)
        ?? im.Set(c, { version: 0 });

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
}

export function getPage(journal: Journal, id: number): TreePage {
    return itree.getNode(journal.pages, id);
}

export function getPageOrUndefined(journal: Journal, id: number): TreePage | undefined{
    return itree.getNodeOrUndefined(journal.pages, id);
}

export function getJournalEntryName(entry: JournalEntry): string {
    try {
        const [yyyy, mm, dd] = entry.date.split("-");
        const date = new Date();
        date.setFullYear(parseInt(yyyy));
        date.setMonth(parseInt(mm) - 1);
        date.setDate(parseInt(dd));

        if (isSameDate(date, new Date())) {
            return "> " + formatDate(date, true);
        }

        return formatDate(date, true);
    } catch(err) {
        return "??"
    }
}

function getPageName(page: JournalPage): string {
    if (!page.name) return "<Unnamed>";
    return page.name;
}

function handleKeyboardInput(
    ctx: GlobalContext,
    s: JournalViewState,
    journal: Journal,
    currentJournalEntry: JournalEntry | null | undefined,
    currentPage: TreePage | null | undefined,
): boolean {
    let handled = false;

    if (s.finder.isFinding && s.finder.results) {
        const input = getNavigableListInput(ctx, s.finder.resultsIdx, 0, s.finder.results.length, AXIS_VERTICAL, AXIS_FLAG_BYPASS_TEXT_AREA);
        if (input) {
            s.finder.resultsIdx = input.newIdx;
            handled = true;
        }
    } else if (journal.currentlyEditing.type === JOURNAL_TYPE_JOURNAL && currentJournalEntry) {
        if (s.sidebarHasFocus) {
            const input = getNavigableListInput(ctx, journal.currentlyEditing.entryIdx, 0, journal.entries.length, AXIS_VERTICAL, AXIS_FLAG_BYPASS_TEXT_AREA);
            if (input) {
                setCurrentlyEditingJournalIdx(s, journal, input.newIdx);
                handled = true;
            }

            if (
                currentJournalEntry &&
                hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, entryIsReadonly(journal, currentJournalEntry) ? "View entry" : "Edit entry")
            ) {
                s.sidebarHasFocus = false;
                handled = true;
            }
        }
    } else if (journal.currentlyEditing.type === JOURNAL_TYPE_PAGE && currentPage) {
        if (s.sidebarHasFocus) {
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
                        const prevPage = getPage(journal, prevIdx);
                        let idxUnderPrev = clampedListIdx(prevPage.data.focusedChildIdx, prevPage.childIds.length) + 1;
                        itree.insertAt(journal.pages, prevPage, currentPage, idxUnderPrev);
                        setCurrentlyEditingPageIdx(s, journal, currentPage.id);
                    }

                    handled = true;
                }

                if (currentPage.childIds.length > 0 && hasDiscoverableCommand(ctx, ctx.keyboard.rightKey, "Move in", REPEAT)) {
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
                const newPage = newJournalPage("");
                const node = itree.newTreeNode(newPage);
                itree.addAfter(journal.pages, currentPage, node);
                setCurrentlyEditingPageIdx(s, journal, node.id);

                handled = true;
            }

            if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "New under", CTRL)) {
                const newPage = newJournalPage("");
                const node = itree.newTreeNode(newPage);
                itree.addUnder(journal.pages, currentPage, node);
                setCurrentlyEditingPageIdx(s, journal, node.id);
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
                s.pages.isRenaming = false;
                handled = true;
            } else if (
                s.pages.isRenaming &&
                hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Stop renaming", BYPASS_TEXT_AREA)
            ) {
                s.pages.isRenaming = false;
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
    }

    if (
        !s.finder.isFinding &&
        hasDiscoverableCommand(ctx, ctx.keyboard.fKey, "Find", CTRL | BYPASS_TEXT_AREA)
    ) {
        s.finder.isFinding = true;
        s.sidebarHasFocus = true;
        handled = true;
    }

    return handled;
}


function setCurrentlyEditingPageIdx(s: JournalViewState, journal: Journal, pageIdx: number) {
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

    pushJournalActivity(state, JOURNAL_TYPE_PAGE, pageIdx);
}

export function journalSetCurrentlyEditing(s: Journal, id: JournalId) {
    const { type, idx } = id;
    s.currentlyEditing.type = type;
    if (type === JOURNAL_TYPE_PAGE) {
        s.currentlyEditing.pageIdx = idx;
    } else {
        s.currentlyEditing.entryIdx = idx;
    }
}

// NOTE: not the standard way to get a journal page
export function getJournalEntryOrPageById(s: Journal, id: JournalId): JournalPage | undefined {
    if (id.type === JOURNAL_TYPE_JOURNAL) return getJournalEntry(s, id.idx).page;
    if (id.type === JOURNAL_TYPE_PAGE) return getPageOrUndefined(s, id.idx)?.data;
    return undefined;
}

export function getJournalEntryOrPageName(s: Journal, id: JournalId): string {
    const page = getJournalEntryOrPageById(s, id);
    if (!page) return "<deleted>";
    if (id.type === JOURNAL_TYPE_JOURNAL) {
        const entry = getJournalEntry(s, id.idx)
        return "Journal: " + getJournalEntryName(entry);
    }
    if (id.type === JOURNAL_TYPE_PAGE) {
        const page = getPageOrUndefined(s, id.idx);
        if (!page) return "<deleted>";
        return "Page: " + page.data.name;
    } 
    throw new Error("Unhandled type!");
}

function setCurrentlyEditingJournalIdx(s: JournalViewState, journal: Journal, entryIdx: number) {
    journal.currentlyEditing.entryIdx = entryIdx;

    pushJournalActivity(state, JOURNAL_TYPE_JOURNAL, entryIdx);
}

function entryIsReadonly(s: Journal, entry: JournalEntry): boolean {
    // Prob don't want to edit older entries. 
    const finalEntry = arrayAt(s.entries, s.entries.length - 1);
    return entry !== finalEntry;
}
function findJournalResults(
    s: JournalViewState,
    journal: Journal,
    isFuzzySearch: boolean
) {
    const options = { allowableMistakes: isFuzzySearch ? 1 : 0 };
    const results: FinderResult[] = [];
    s.finder.results = results;

    if (journal.currentlyEditing.type === JOURNAL_TYPE_PAGE) {
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
    } else if (journal.currentlyEditing.type === JOURNAL_TYPE_JOURNAL) {
        for (let entryIdx = 0; entryIdx < journal.entries.length; entryIdx++) {
            const entry = journal.entries[entryIdx];
            if (entry.date.includes(s.finder.query)) {
                results.push({ id: entryIdx, ranges: [], });
                continue
            }

            let findResults = fuzzyFind(entry.page.content, s.finder.query, options);
            if (findResults.ranges.length > 0) {
                results.push({ id: entryIdx, ranges: findResults.ranges, });
                continue
            }
        }
    }

    if (s.finder.results.length === 0) s.finder.results = null;
}
