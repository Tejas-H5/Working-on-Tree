import { cnApp } from "./app-styling";
import { COL, imBegin, imFlex, imJustify, INLINE, ROW } from "./components/core/layout";
import { imBeginTextArea, imEndTextArea } from "./components/editable-text-area";
import { newScrollContainer, ScrollContainer } from "./components/scroll-container";
import { BYPASS_TEXT_AREA, CTRL, GlobalContext, hasDiscoverableCommand, SHIFT } from "./global-context";
import { imBeginListRow, imEndListRow, imListRowCellStyle } from "./list-row";
import {
    clampedListIdx,
    getNavigableListInput,
    imBeginNavList,
    imBeginNavListRow,
    imEndNavList,
    imEndNavListRow,
    imNavListNextItemArray
} from "./navigable-list";
import {
    dfsPre,
    forEachChildNote,
    forEachParentNote,
    getNoteOrUndefined,
    getRootNote,
    idIsNil,
    idIsRoot,
    isHigherLevelTask,
    isNoteRequestingShelf,
    NoteTreeGlobalState,
    setCurrentNote,
    state,
    STATUS_IN_PROGRESS,
    TreeNote
} from "./state";
import { truncate } from "./utils/datetime";
import { fuzzyFind, FuzzyFindRange } from "./utils/fuzzyfind";
import {
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imIsFirstishRender,
    imMemo,
    imNextListRoot,
    imOn,
    imState,
    setClass,
    setStyle,
    setText
} from "./utils/im-dom-utils";


const SCOPE_EVERTHING = 0;
const SCOPE_CHILDREN = 1;
const SCOPE_SHALLOW_PARENTS = 2;
const SCOPE_COUNT = 3;

type Scope 
    = typeof SCOPE_EVERTHING
    | typeof SCOPE_CHILDREN
    | typeof SCOPE_SHALLOW_PARENTS;

function getNextScope(scope: Scope): Scope {
    return ((scope + 1) % SCOPE_COUNT) as Scope;
}

function scopeToString(nextScope: number) {
    switch(nextScope) {
        case SCOPE_EVERTHING:        return "Everything";
        case SCOPE_CHILDREN:         return "Children";
        case SCOPE_SHALLOW_PARENTS:  return "Parents";
    }
    throw new Error("Scope's name not known: " + nextScope);
}

export type FuzzyFindState = {
    query: string;
    matches: NoteFuzzyFindMatches[];
    exactMatchSucceeded: boolean;
    counts: {
        numInProgress: number;
        numFinished: number;
        numShelved: number;
    },
    currentIdx: number;

    scope: Scope;
}

export function newFuzzyFindState(): FuzzyFindState {
    return {
        query: "",
        matches: [],
        exactMatchSucceeded: false,
        counts: {
            numInProgress: 0,
            numFinished: 0,
            numShelved: 0,
        },
        currentIdx: 0,
        scope: SCOPE_EVERTHING,
    };
}

type NoteFuzzyFindMatches = {
    note: TreeNote;
    ranges: FuzzyFindRange[] | null;
    score: number;
};


// NOTE: this thing currently populates the quicklist
export function searchAllNotesForText(state: NoteTreeGlobalState, rootNote: TreeNote, query: string, dstMatches: NoteFuzzyFindMatches[], {
    fuzzySearch,
    traverseUpwards,
}: {
    fuzzySearch: boolean,
    traverseUpwards: boolean;
}): void {
    dstMatches.length = 0;
    if (query.length === 0) return;

    const SORT_BY_SCORE = 1;
    const SORT_BY_RECENCY = 2;

    let sortMethod = SORT_BY_SCORE;

    // this can chain with the other two queries
    const isShelvedQuery = query.startsWith("||");
    if (isShelvedQuery) {
        query = query.substring(2).trim();
    }

    // Adding a few carve-outs specifically for finding tasks in progress and higher level tasks.
    // It's too hard to find them in the todo list, so I'm trying other options.
    const isHltQuery = query.startsWith(">>");
    const isInProgressQuery = query.startsWith(">") && !isHltQuery;

    if (isHltQuery) {
        query = query.substring(2).trim();
    } else if (isInProgressQuery) {
        query = query.substring(1).trim();
    }

    if (isHltQuery || isInProgressQuery || isShelvedQuery) {
        if (query.trim().length === 0) {
            sortMethod = SORT_BY_RECENCY;
        }
    }

    const processNote = (n: TreeNote) => {
        if (idIsNil(n.parentId)) {
            // ignore the root note
            return;
        }

        let text = n.data.text.toLowerCase();

        if (
            isShelvedQuery ||
            isHltQuery ||
            isInProgressQuery
        ) {
            if (isShelvedQuery !== isNoteRequestingShelf(n.data)) {
                return;
            }

            if (isShelvedQuery && isHltQuery) {
                if (!isNoteRequestingShelf(n.data)) {
                    return;
                }

                const parent = getNoteOrUndefined(state, n.parentId);
                if (parent && parent.data._shelved) {
                    // If `n` wants to be shelved but its parent is already shelved, 
                    // don't include this in the list of matches
                    return;
                }
            }

            if (isHltQuery && !isHigherLevelTask(n)) {
                return;
            }

            if (isInProgressQuery && isHigherLevelTask(n)) {
                return;
            }

            if (isHltQuery || isInProgressQuery) {
                if (n.data._status !== STATUS_IN_PROGRESS) {
                    return;
                }
            }
        }

        if (sortMethod === SORT_BY_SCORE && query.trim().length > 0) {
            let results = fuzzyFind(text, query, { allowableMistakes: fuzzySearch ? 1 : 0 });
            if (results.ranges.length > 0) {
                let score = 0;
                score = results.score;
                if (n.data._status === STATUS_IN_PROGRESS) {
                    score *= 2;
                }

                dstMatches.push({
                    note: n,
                    ranges: results.ranges,
                    score,
                });
            }
        } else {
            // score by recency by default
            let score = n.data._activityListMostRecentIdx;

            dstMatches.push({
                note: n,
                ranges: null,
                score,
            });
        }
    }

    if (idIsRoot(rootNote.id) || !traverseUpwards) {
        dfsPre(state, rootNote, processNote);
    } else {
        forEachParentNote(state, rootNote, note => forEachChildNote(state, note, processNote));
    }

    dstMatches.sort((a, b) => {
        return b.score - a.score;
    });
}

export type FuzzyFinderViewState = {
    scrollContainer: ScrollContainer;
    fuzzyFindState: FuzzyFindState;
    timeTakenMs: number;
};

export function newFuzzyFinderViewState(): FuzzyFinderViewState {
    return {
        fuzzyFindState: newFuzzyFindState(),
        timeTakenMs: 0,

        scrollContainer: newScrollContainer(),
    };
}

function setIdx(
    ctx: GlobalContext,
    s: FuzzyFinderViewState,
    idx: number
) {
    const matches = s.fuzzyFindState.matches;
    if (matches.length === 0) return;

    s.fuzzyFindState.currentIdx = clampedListIdx(idx, matches.length);
    const match = matches[s.fuzzyFindState.currentIdx];
    setCurrentNote(state, match.note.id, ctx.noteBeforeFocus?.id);
}

function handleKeyboardInput(ctx: GlobalContext, s: FuzzyFinderViewState) {
    const finderState = s.fuzzyFindState;
    const matches = finderState.matches;
    const listNavigation = getNavigableListInput(ctx, s.fuzzyFindState.currentIdx, 0, matches.length);

    if (listNavigation) {
        setIdx(ctx, s, listNavigation.newIdx);
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Go to note", BYPASS_TEXT_AREA)) {
        ctx.currentView = ctx.views.noteTree;
    }

    const nextScope = getNextScope(finderState.scope);
    if (
        ctx.noteBeforeFocus &&
        hasDiscoverableCommand(ctx, ctx.keyboard.fKey, "Scope search to " + scopeToString(nextScope), CTRL | BYPASS_TEXT_AREA)
    ) {
        finderState.scope = nextScope;
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Newline", SHIFT | BYPASS_TEXT_AREA)) {
        // let the text editor handle this one.
        ctx.handled = false;
    }
}

function recomputeFuzzyFinderMatches(ctx: GlobalContext, finderState: FuzzyFindState) {
    const dst = finderState.matches;
    dst.length = 0;

    const rootNote = finderState.scope === SCOPE_EVERTHING ? getRootNote(state)
        : finderState.scope === SCOPE_CHILDREN ? ctx.noteBeforeFocus
        : ctx.noteBeforeFocus;

    if (!rootNote) return;


    searchAllNotesForText(state, rootNote, finderState.query, dst, {
        fuzzySearch: false,
        traverseUpwards: finderState.scope === SCOPE_SHALLOW_PARENTS,
    });

    finderState.exactMatchSucceeded = dst.length > 0;
    if (!finderState.exactMatchSucceeded) {
        searchAllNotesForText(state, rootNote, finderState.query, dst, {
            fuzzySearch: true,
            traverseUpwards: finderState.scope === SCOPE_SHALLOW_PARENTS,
        });
    }

    const MAX_MATCHES = 100;
    if (dst.length > MAX_MATCHES) {
        dst.length = MAX_MATCHES;
    }

    const counts = finderState.counts;

    counts.numFinished = 0;
    counts.numInProgress = 0;
    counts.numShelved = 0;
    for (const match of dst) {
        if (match.note.data._status === STATUS_IN_PROGRESS) {
            counts.numInProgress++;
        } else {
            counts.numFinished++;
        }

        if (match.note.data._shelved) {
            counts.numShelved++;
        }
    }
}

function recomputeTraversal(ctx: GlobalContext, s: FuzzyFinderViewState) {
    recomputeFuzzyFinderMatches(ctx, s.fuzzyFindState);
    setIdx(ctx, s, s.fuzzyFindState.currentIdx);
}

export function imFuzzyFinder(ctx: GlobalContext, s: FuzzyFinderViewState) {
    const finderState = s.fuzzyFindState;
    const viewHasFocus = ctx.currentView === s;

    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);

    }

    const viewHasFocusChanged = imMemo(viewHasFocus);
    if (viewHasFocusChanged && viewHasFocus) {
        finderState.scope = SCOPE_EVERTHING;
    }

    const queryChanged = imMemo(finderState.query);
    const scopeChanged = imMemo(finderState.scope);
    let t0 = 0;
    if (queryChanged || scopeChanged) {
        t0 = performance.now();
        s.timeTakenMs = 0; // prob doesn't make a difference
        recomputeTraversal(ctx, s);

        // get the time at the end of this methd.
    } 
    
    // Both items are focused at the same time !!! LFG
    imBegin(COL); imFlex(); {

        imBegin(ROW); imListRowCellStyle(); imJustify(); {
            if (imIsFirstishRender()) {
                setStyle("fontWeight", "bold");
            }

            let scope = scopeToString(finderState.scope);
            setText(`Finder [${scope}]`);
        } imEnd();

        imBeginListRow(viewHasFocus, viewHasFocus, true); {
            imBegin(ROW); imFlex(); imListRowCellStyle(); {
                const [, textArea] = imBeginTextArea({
                    value: finderState.query,
                }); {
                    const input = imOn("input");
                    const change = imOn("change");

                    if (input || change) {
                        finderState.query = textArea.root.value;
                        ctx.handled = true;
                    }

                    if (viewHasFocusChanged && viewHasFocus) {
                        ctx.textAreaToFocus = textArea;
                        ctx.focusWithAllSelected = false;
                    }
                } imEndTextArea();
            } imEnd();
        } imEndListRow();

        if (imIf() && finderState.query.length > 0 && !finderState.exactMatchSucceeded) {
            imBegin(ROW); imListRowCellStyle(); {
                setText(`Found 0 exact matches, fell back to a fuzzy search`);
            } imEnd();
        } imEndIf();

        const list = imBeginNavList(
            s.scrollContainer,
            s.fuzzyFindState.currentIdx,
            viewHasFocus
        ); {
            const matches = s.fuzzyFindState.matches;
            while (imNavListNextItemArray(list, matches)) {
                const { i } = list;
                const item = matches[i];

                imBeginNavListRow(list); {
                    imBegin(); imListRowCellStyle(); {

                        if (imIf() && item.ranges) {
                            const diffState = imState((): {
                                text: string;
                                ranges: FuzzyFindRange[]
                            } => ({
                                text: "",
                                ranges: []
                            }), true);
                            if (imMemo(item)) {
                                let text = item.note.data.text;
                                let ranges = item.ranges;

                                if (item.ranges.length > 0) {
                                    // Let's truncate with context.

                                    const contextWindow = 10;

                                    let matchStart = item.ranges[0][0] - contextWindow;

                                    let truncateStart = matchStart !== 0;
                                    if (matchStart < 0) {
                                        matchStart = 0;
                                        truncateStart = false;
                                    }

                                    let matchEnd = item.ranges[item.ranges.length - 1][1] + contextWindow;
                                    let truncateEnd = matchEnd !== text.length;
                                    if (matchEnd > text.length) {
                                        matchEnd = text.length;
                                        truncateEnd = false;
                                    }

                                    text = text.substring(matchStart, matchEnd);

                                    let rangeOffset = matchStart;
                                    if (truncateStart) {
                                        text = "... " + text;
                                        rangeOffset -= "... ".length;
                                    }

                                    if (truncateEnd) text = text + " ...";

                                    ranges = ranges.map(r => [r[0] - rangeOffset, r[1] - rangeOffset]);
                                }

                                diffState.ranges = ranges;
                                diffState.text = text;
                            }

                            {
                                let lastStart = 0;
                                const { text, ranges } = diffState;
                                imFor();
                                for (let i = 0; i < ranges.length; i++) {
                                    imNextListRoot();

                                    const [start, nextLastStart] = ranges[i];

                                    const beforeHighlighted = text.substring(lastStart, start);
                                    const highlighted = text.substring(start, nextLastStart);

                                    lastStart = nextLastStart;

                                    imBegin(INLINE); setClass(cnApp.defocusedText); setText(beforeHighlighted); imEnd();
                                    imBegin(INLINE); setText(highlighted); imEnd();
                                }

                                imNextListRoot("end")
                                if (imIf() && lastStart !== text.length) {
                                    imBegin(INLINE); setClass(cnApp.defocusedText); setText(text.substring(lastStart)); imEnd();
                                } imEndIf();
                                imEndFor();
                            }
                        } else {
                            imElse();
                            imBegin(INLINE); setText(truncate(item.note.data.text, 50)); imEnd();
                        } imEndIf();
                    } imEnd();
                } imEndNavListRow();
            }
        } imEndNavList(list);

        imBegin(ROW); imJustify(); {
            const numMatches = finderState.matches.length;
            const resultType = finderState.exactMatchSucceeded ? "exact" : "fuzzy";
            const yourWelcome = numMatches === 0 ? " (you're welcome)" : "";
            setText(`Narrowed ${state.notes.nodes.length} to ${numMatches} ${resultType} results in ${s.timeTakenMs}ms${yourWelcome}`);
        } imEnd();
    } imEnd();

    if (queryChanged || scopeChanged) {
        s.timeTakenMs = performance.now() - t0;
    }
}
