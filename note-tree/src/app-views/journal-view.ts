import { imListRowCellStyle } from "src/app-components/list-row";
import { clampedListIdx, getNavigableListInput, imNavListBegin, imNavListEnd, imNavListNextItemArray, imNavListRowBegin, imNavListRowEnd, NavigableListState } from "src/app-components/navigable-list";
import { doExtraTextAreaInputHandling, imTextAreaBegin, imTextAreaEnd } from "src/components/editable-text-area";
import { imLine, LINE_HORIZONTAL, LINE_VERTICAL } from "src/components/im-line";
import { newScrollContainer } from "src/components/scroll-container";
import { imTextInputOneLine } from "src/components/text-input";
import { ALT, BYPASS_TEXT_AREA, CTRL, debouncedSave, GlobalContext, hasDiscoverableCommand, REPEAT, setCurrentView, SHIFT } from "src/global-context";
import { state } from "src/state";
import { arrayAt } from "src/utils/array-utils";
import { assert } from "src/utils/assert";
import { formatDate, formatIsoDate } from "src/utils/datetime";
import { el, ev, im, ImCache, imdom, key } from "src/utils/im-js";
import { BLOCK, COL, imui, NA, PX, ROW } from "src/utils/im-js/im-ui";
import * as itree from "src/utils/int-tree";
import { logTrace } from "src/utils/log";

const JOURNAL = 1;
const PAGE = 2;

export type JournalViewState = {
    currentlyEditing: {
        type: number,
        entryIdx: number;
        pageIdx: number;
    };
    sidebarHasFocus: boolean;

    pages: {
        parents: TreePage[];
        version: number;
        isRenaming: boolean;
    };
}

export function newJournalViewState(): JournalViewState {
    return {
        currentlyEditing: {
            type: 0,
            entryIdx: 0,
            pageIdx: 0,
        },
        sidebarHasFocus: false,

        pages: {
            parents: [],
            version: 0,
            isRenaming: false,
        }
    };
}

export function newJournal(): Journal {
    const rootPage = newJournalPage("Root page");

    return {
        entries: [],
        pages: itree.newTreeStore(rootPage),
    };
}

type TreePage = itree.TreeNode<JournalPage>;

export type Journal = {
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

export function imJournalView(
    c: ImCache,
    ctx: GlobalContext,
    s: JournalViewState,
    journal: Journal, // We edit this!
) {
    const viewHasFocus = ctx.currentView === s;

    if (im.Memo(c, viewHasFocus)) {
        s.sidebarHasFocus = false;
    }

    if (!s.currentlyEditing.type) {
        s.currentlyEditing.type = PAGE;
        s.currentlyEditing.entryIdx = journal.entries.length - 1;
    }

    let currentJournalEntry = 
        s.currentlyEditing.type === JOURNAL && 
        arrayAt(journal.entries, s.currentlyEditing.entryIdx);

    let dontHaveEntryForToday = false;
    if (im.Memo(c, s.currentlyEditing.type)) {
        const lastEntry = arrayAt(journal.entries, journal.entries.length - 1);
        if (lastEntry) {
            const today = new Date();
            const isoDateKey = formatIsoDate(today);
            if (lastEntry.date !== isoDateKey) {
                dontHaveEntryForToday = true;
            }
        }
    }

    if (s.currentlyEditing.type === JOURNAL) {
        if (!currentJournalEntry || dontHaveEntryForToday) {
            // Create or edit today's journal entry
            const today = new Date();
            const isoDateKey = formatIsoDate(today);

            let entryIdx = getJournalEntryIdx(journal, isoDateKey);
            if (entryIdx === undefined) {
                entryIdx = makeJournalEntry(journal, isoDateKey);
            }

            s.currentlyEditing.type = JOURNAL;
            s.currentlyEditing.entryIdx = entryIdx;
            currentJournalEntry = journal.entries[entryIdx]; 
            assert(!!currentJournalEntry);
        }
    }

    const currentPage = 
        s.currentlyEditing.type === PAGE && 
        s.currentlyEditing.pageIdx > 0 && 
        itree.getNode(journal.pages, s.currentlyEditing.pageIdx);

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

    if (s.currentlyEditing.type === PAGE) {
        if (s.currentlyEditing.pageIdx <= 0) {
            const tree = journal.pages;

            let found = false;
            for (let pageIdx = 1; pageIdx < tree.nodes.length; pageIdx++) {
                const n = tree.nodes[pageIdx];
                if (n === null) continue;

                found = true;
                s.currentlyEditing.pageIdx = pageIdx;
            }

            if (!found) {
                // Let's make a new page for us to edit!

                const page = newJournalPage("First ever page");
                page.content = "This is the first ever page!!!";

                const root = itree.getNode(tree, itree.ROOT_ID);
                const node = itree.newTreeNode(page);
                itree.addUnder(tree, root, node);

                s.currentlyEditing.pageIdx = node.id;
            }
        }
    }


    if (!ctx.handled) {
        ctx.handled ||= handleKeyboardInput(
            ctx,
            s,
            journal,
            currentJournalEntry || undefined,
            currentPage || undefined,
        );
    }


    imui.Begin(c, ROW); imui.Flex(c); {
        if (im.If(c) && s.currentlyEditing.type === JOURNAL) {
            // Journal entries
            imui.Begin(c, COL); {
                const sc = im.State(c, newScrollContainer);
                const list = imNavListBegin(c, sc, s.currentlyEditing.entryIdx, viewHasFocus && s.sidebarHasFocus); {
                    im.For(c); while (imNavListNextItemArray(list, journal.entries)) {
                        const { i } = list;
                        const entry = journal.entries[i];

                        const itemHighlighted = viewHasFocus && s.currentlyEditing.entryIdx === i;
                        const itemSelected = s.sidebarHasFocus && itemHighlighted;

                        imNavListRowBegin(c, list, itemSelected, itemHighlighted); {
                            imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                                imdom.StrFmt(c, entry, getJournalEntryName);
                            } imui.End(c);
                        } imNavListRowEnd(c);
                    } im.ForEnd(c);
                } imNavListEnd(c, list);
            } imui.End(c);
        } else if (im.IfElse(c) && s.currentlyEditing.type === PAGE && currentPage) {
            const currentPageParent = itree.getNode(journal.pages, currentPage.parentId);

            imui.Begin(c, COL); {
                const sc = im.State(c, newScrollContainer);


                {
                    let i = 0;
                    im.For(c); for (const page of s.pages.parents) {
                        imPageListRow(c, ctx, s, null, page, i);
                        i++;
                    } im.ForEnd(c);
                }

                imLine(c, LINE_HORIZONTAL);

                const list = imNavListBegin(c, sc, currentPageParent.data.focusedChildIdx, viewHasFocus && s.sidebarHasFocus); {
                    im.For(c); while (imNavListNextItemArray(list, currentPageParent.childIds)) {
                        const { i } = list;
                        const childId = currentPageParent.childIds[i];
                        const page = getPage(journal, childId);

                        imPageListRow(c, ctx, s, list, page, s.pages.parents.length);
                    } im.ForEnd(c);
                } imNavListEnd(c, list);
            } imui.End(c);
        } im.IfEnd(c);

        imLine(c, LINE_VERTICAL, 1);

        imui.Begin(c, COL); imui.Flex(c); {
            if (im.If(c) && currentJournalEntry) {
                imdom.ElBegin(c, el.H2); imui.Layout(c, ROW); imui.Justify(c); {
                    imdom.Str(c, "Log - ");
                    imdom.StrFmt(c, currentJournalEntry, getJournalEntryName);
                } imdom.ElEnd(c, el.H2);

                imLine(c, LINE_HORIZONTAL, 1);

                const isReadonly = entryIsReadonly(journal, currentJournalEntry);
                imPageEditor(c, ctx, currentJournalEntry.page, !s.sidebarHasFocus, isReadonly);
            } else if (im.IfElse(c) && currentPage) {
                imdom.ElBegin(c, el.H2); imui.Layout(c, ROW); imui.Justify(c); {
                    imdom.Str(c, "Page - ");
                    imdom.Str(c, getPageName(currentPage.data));
                } imdom.ElEnd(c, el.H2);

                imLine(c, LINE_HORIZONTAL, 1);

                imPageEditor(c, ctx, currentPage.data, !s.sidebarHasFocus, false);
            } else {
                im.Else(c);

                imdom.ElBegin(c, el.H2); {
                    imdom.Str(c, "Not editing anything rn.");
                } imdom.ElEnd(c, el.H2);
            } im.IfEnd(c);
        } imui.End(c);
    } imui.End(c);

    const viewingPages = s.currentlyEditing.type === PAGE;
    if (hasDiscoverableCommand(ctx, ctx.keyboard.pKey, viewingPages ? "Journal" : "Pages", CTRL | BYPASS_TEXT_AREA)) {
        if (viewingPages) {
            s.currentlyEditing.type = JOURNAL;
        } else {
            s.currentlyEditing.type = PAGE;
        }
    }

    
    if (!s.sidebarHasFocus && hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Sidebar", BYPASS_TEXT_AREA)) {
        s.sidebarHasFocus = true;
    } else if (hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Back", BYPASS_TEXT_AREA)) {
        setCurrentView(ctx, ctx.views.noteTree);
    }
}


function imPageListRow(
    c: ImCache,
    ctx: GlobalContext,
    s: JournalViewState,
    list: NavigableListState | null,
    page: TreePage,
    depth: number,
) {
    const viewHasFocus = ctx.currentView === s;
    const itemHighlighted = viewHasFocus && s.currentlyEditing.pageIdx === page.id;
    const itemSelected = s.sidebarHasFocus && itemHighlighted;

    imNavListRowBegin(c, list, itemSelected, itemHighlighted); {
        if (im.If(c) && itemSelected && s.pages.isRenaming) {
            const ev = imTextInputOneLine(c, page.data.name, "Name...", true, true);
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
            imui.Begin(c, BLOCK); imui.Size(c, 40, PX, 0, NA); imui.End(c);

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

function getPage(journal: Journal, id: number): TreePage {
    return itree.getNode(journal.pages, id);
}

function getJournalEntryName(entry: JournalEntry): string {
    try {
        const [yyyy, mm, dd] = entry.date.split("-");
        const date = new Date();
        date.setFullYear(parseInt(yyyy));
        date.setMonth(parseInt(mm) - 1);
        date.setDate(parseInt(dd));

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

    if (s.sidebarHasFocus) {
        if (s.currentlyEditing.type === JOURNAL && currentJournalEntry) {
            const input = getNavigableListInput(ctx, s.currentlyEditing.entryIdx, 0, journal.entries.length);
            if (input) {
                s.currentlyEditing.entryIdx = input.newIdx;
                handled = true;
            }

            if (
                currentJournalEntry && 
                hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, entryIsReadonly(journal, currentJournalEntry)  ? "View entry" : "Edit entry") ||
                hasDiscoverableCommand(ctx, ctx.keyboard.tabKey,   entryIsReadonly(journal, currentJournalEntry)  ? "View entry" : "Edit entry")
            ) {
                s.sidebarHasFocus = false;
                handled = true;
            }
        } else if (s.currentlyEditing.type === PAGE && currentPage) {
            const parent = itree.getNode(journal.pages, currentPage.parentId);
            const parentPage = parent.data;

            const keys = imdom.getKeyboard();
            const movePage = imdom.isKeyHeld(keys, ctx.keyboard.altKey);

            const input = getNavigableListInput(ctx, parentPage.focusedChildIdx, 0, parent.childIds.length);
            if (input) {
                if (movePage) {
                    itree.insertAt(journal.pages, parent, currentPage, input.newIdx);
                } else {
                    const childId = parent.childIds[input.newIdx]; assert(childId != null);
                    s.currentlyEditing.pageIdx = childId;
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
                        s.currentlyEditing.pageIdx = currentPage.id;
                    }

                    handled = true;
                }

                if (currentPage.childIds.length > 0 && hasDiscoverableCommand(ctx, ctx.keyboard.rightKey, "Move in", REPEAT)) {
                    let nextPageIdx = arrayAt(currentPage.childIds, currentPage.data.focusedChildIdx) ?? 0;
                    s.currentlyEditing.pageIdx = nextPageIdx;
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
                    s.currentlyEditing.pageIdx = parent.id;
                    handled = true;
                }
            }

            if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "New after", SHIFT)) {
                const newPage = newJournalPage("");
                const node = itree.newTreeNode(newPage);
                itree.addAfter(journal.pages, currentPage, node);
                s.currentlyEditing.pageIdx = node.id;

                handled = true;
            }

            if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "New under", CTRL)) {
                const newPage = newJournalPage("");
                const node = itree.newTreeNode(newPage);
                itree.addUnder(journal.pages, currentPage, node);
                s.currentlyEditing.pageIdx = node.id;
                handled = true;
            }

            if (currentPage && (
                hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Edit page") ||
                hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, "Edit page")
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

                const currentPage = itree.getNode(journal.pages, s.currentlyEditing.pageIdx);
                const parent = itree.getParent(journal.pages, currentPage);
                if (parent) {
                    const newFocusedIdx = parent.childIds.indexOf(currentPage.id);
                    if (newFocusedIdx !== -1) {
                        parent.data.focusedChildIdx = newFocusedIdx;
                    }
                }
            }
        }
    }

    if (!handled) {
        const keys = imdom.getKeyboard();
        if (imdom.isKeyPressedOrRepeated(keys, key.ARROW_RIGHT) || imdom.isKeyPressedOrRepeated(keys, key.ARROW_LEFT)) {
            if (imdom.isKeyHeld(keys, key.ALT)) {
                handled = true;
            }
        }
    }

    return handled;
}

function entryIsReadonly(s: Journal, entry: JournalEntry): boolean {
    // Prob don't want to edit older entries. 
    const finalEntry = arrayAt(s.entries, s.entries.length - 1);
    return entry !== finalEntry;
}
