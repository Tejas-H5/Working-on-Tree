import { cnApp } from "src/app-styling";
import { BLOCK, COL, imFlex, imJustify, imLayoutBegin, imLayoutEnd, INLINE, ROW } from "src/components/core/layout";
import { imTextAreaBegin, imTextAreaEnd } from "src/components/editable-text-area";
import { newScrollContainer, ScrollContainer } from "src/components/scroll-container";
import { BYPASS_TEXT_AREA, CTRL, GlobalContext, hasDiscoverableCommand, setCurrentView, SHIFT } from "src/global-context";
import { imListRowBegin, imListRowCellStyle, imListRowEnd } from "src/app-components/list-row";
import {
    AXIS_FLAG_BYPASS_TEXT_AREA,
    AXIS_VERTICAL,
    clampedListIdx,
    getNavigableListInput,
    imNavListBegin,
    imNavListEnd,
    imNavListNextItemArray,
    imNavListRowBegin,
    imNavListRowEnd
} from "src/app-components/navigable-list";
import {
    dfsPre,
    forEachChildNote,
    forEachParentNote,
    getRootNote,
    idIsNil,
    idIsRoot,
    NoteTreeGlobalState,
    setCurrentNote,
    state,
    STATUS_IN_PROGRESS,
    STATUS_SHELVED,
    TreeNote
} from "src/state";
import { truncate } from "src/utils/datetime";
import { fuzzyFind, FuzzyFindRange } from "src/utils/fuzzyfind";
import { ImCache, imFor, imForEnd, imGet, imIf, imIfElse, imIfEnd, imMemo, imSet, inlineTypeId, isFirstishRender } from "src/utils/im-core";
import { elSetClass, elSetStyle, EV_CHANGE, EV_INPUT, imOn, imStr } from "src/utils/im-dom";


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

    const fzfOptions = { allowableMistakes: fuzzySearch ? 1 : 0 };

    const processNote = (n: TreeNote) => {
        if (idIsNil(n.parentId)) {
            // ignore the root note
            return;
        }

        let text = n.data.text.toLowerCase();

        let results = fuzzyFind(text, query, fzfOptions);
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
    }

    if (idIsRoot(rootNote.id) || !traverseUpwards) {
        dfsPre(state, rootNote, processNote);
    } else {
        forEachParentNote(state.notes, rootNote, note => forEachChildNote(state, note, processNote));
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
    const listNavigation = getNavigableListInput(
        ctx, s.fuzzyFindState.currentIdx, 0, matches.length, 
        AXIS_VERTICAL, AXIS_FLAG_BYPASS_TEXT_AREA
    );

    if (listNavigation) {
        setIdx(ctx, s, listNavigation.newIdx);
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Go to note", BYPASS_TEXT_AREA)) {
        setCurrentView(ctx, ctx.views.noteTree);
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

        if (match.note.data._status === STATUS_SHELVED) {
            counts.numShelved++;
        }
    }
}

function recomputeTraversal(ctx: GlobalContext, s: FuzzyFinderViewState) {
    recomputeFuzzyFinderMatches(ctx, s.fuzzyFindState);
    setIdx(ctx, s, s.fuzzyFindState.currentIdx);
}

export function imFuzzyFinder(c: ImCache, ctx: GlobalContext, s: FuzzyFinderViewState) {
    const finderState = s.fuzzyFindState;
    const viewHasFocus = ctx.currentView === s;

    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);

    }

    const viewHasFocusChanged = imMemo(c, viewHasFocus);
    if (viewHasFocusChanged && viewHasFocus) {
        finderState.scope = SCOPE_EVERTHING;
    }

    const queryChanged = imMemo(c, finderState.query);
    const scopeChanged = imMemo(c, finderState.scope);
    let t0 = 0;
    if (queryChanged || scopeChanged) {
        t0 = performance.now();
        s.timeTakenMs = 0; // prob doesn't make a difference
        recomputeTraversal(ctx, s);

        // get the time at the end of this methd.
    } 
    
    // Both items are focused at the same time !!! LFG
    imLayoutBegin(c, COL); imFlex(c); {

        imLayoutBegin(c, ROW); imListRowCellStyle(c); imJustify(c); {
            if (isFirstishRender(c)) {
                elSetStyle(c, "fontWeight", "bold");
            }

            let scope = scopeToString(finderState.scope);
            imStr(c, `Finder [${scope}]`);
        } imLayoutEnd(c);

        imListRowBegin(c, viewHasFocus, viewHasFocus, true); {
            imLayoutBegin(c, ROW); imFlex(c); imListRowCellStyle(c); {
                const [, textArea] = imTextAreaBegin(c, {
                    value: finderState.query,
                }); {
                    const input = imOn(c, EV_INPUT);
                    const change = imOn(c, EV_CHANGE);

                    if (input || change) {
                        finderState.query = textArea.value;
                        ctx.handled = true;
                    }

                    if (viewHasFocusChanged && viewHasFocus) {
                        ctx.textAreaToFocus = textArea;
                        ctx.focusWithAllSelected = false;
                    }
                } imTextAreaEnd(c);
            } imLayoutEnd(c);
        } imListRowEnd(c);

        if (imIf(c) && finderState.query.length > 0 && !finderState.exactMatchSucceeded) {
            imLayoutBegin(c, ROW); imListRowCellStyle(c); {
                imStr(c, `Found 0 exact matches, fell back to a fuzzy search`);
            } imLayoutEnd(c);
        } imIfEnd(c);

        const list = imNavListBegin(
            c,
            s.scrollContainer,
            s.fuzzyFindState.currentIdx,
            viewHasFocus
        ); {
            const matches = s.fuzzyFindState.matches;
            imFor(c); while (imNavListNextItemArray(list, matches)) {
                const { i } = list;
                const item = matches[i];

                imNavListRowBegin(c, list, false, false); {
                    imLayoutBegin(c, BLOCK); imListRowCellStyle(c); {

                        if (imIf(c) && item.ranges) {
                            let diffState; diffState = imGet(c, inlineTypeId(imFuzzyFinder));
                            if (!diffState) diffState = imSet<{
                                text: string;
                                ranges: FuzzyFindRange[]
                            }>(c, {
                                text: "",
                                ranges: []
                            });
                            if (imMemo(c, item)) {
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
                                imFor(c); for (let i = 0; i < ranges.length; i++) {
                                    const [start, nextLastStart] = ranges[i];

                                    const beforeHighlighted = text.substring(lastStart, start);
                                    const highlighted = text.substring(start, nextLastStart);

                                    lastStart = nextLastStart;

                                    imLayoutBegin(c, INLINE); {
                                        if (isFirstishRender(c)) {
                                            elSetClass(c, cnApp.defocusedText); 
                                        }

                                        imStr(c, beforeHighlighted); 
                                    } imLayoutEnd(c);
                                    imLayoutBegin(c, INLINE); imStr(c, highlighted); imLayoutEnd(c);
                                } imForEnd(c);

                                if (imIf(c) && lastStart !== text.length) {
                                    imLayoutBegin(c, INLINE); {
                                        if (isFirstishRender(c)) {
                                            elSetClass(c, cnApp.defocusedText);
                                        }

                                        imStr(c, text.substring(lastStart)); 
                                    } imLayoutEnd(c);
                                } imIfEnd(c);
                            }
                        } else {
                            imIfElse(c);
                            imLayoutBegin(c, INLINE); imStr(c, truncate(item.note.data.text, 50)); imLayoutEnd(c);
                        } imIfEnd(c);
                    } imLayoutEnd(c);
                } imNavListRowEnd(c);
            } imForEnd(c);
        } imNavListEnd(c, list);

        imLayoutBegin(c, ROW); imJustify(c); {
            const numMatches = finderState.matches.length;
            const resultType = finderState.exactMatchSucceeded ? "exact" : "fuzzy";
            const yourWelcome = numMatches === 0 ? " (you're welcome)" : "";
            imStr(c, `Narrowed ${state.notes.nodes.length} to ${numMatches} ${resultType} results in ${s.timeTakenMs}ms${yourWelcome}`);
        } imLayoutEnd(c);
    } imLayoutEnd(c);

    if (queryChanged || scopeChanged) {
        s.timeTakenMs = performance.now() - t0;
    }
}
