import { cnApp } from "src/app-styling";
import { imui, BLOCK, ROW, COL, PX, NA, INLINE } from "src/utils/im-js/im-ui";
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
import { im, ImCache, imdom, el, ev, } from "src/utils/im-js";



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

    const viewHasFocusChanged = im.Memo(c, viewHasFocus);
    if (viewHasFocusChanged && viewHasFocus) {
        finderState.scope = SCOPE_EVERTHING;
    }

    const queryChanged = im.Memo(c, finderState.query);
    const scopeChanged = im.Memo(c, finderState.scope);
    let t0 = 0;
    if (queryChanged || scopeChanged) {
        t0 = performance.now();
        s.timeTakenMs = 0; // prob doesn't make a difference
        recomputeTraversal(ctx, s);

        // get the time at the end of this methd.
    } 
    
    // Both items are focused at the same time !!! LFG
    imui.Begin(c, COL); imui.Flex(c); {

        imui.Begin(c, ROW); imListRowCellStyle(c); imui.Justify(c); {
            if (im.isFirstishRender(c)) {
                imdom.setStyle(c, "fontWeight", "bold");
            }

            let scope = scopeToString(finderState.scope);
            imdom.Str(c, `Finder [${scope}]`);
        } imui.End(c);

        imListRowBegin(c, viewHasFocus, viewHasFocus, true); {
            imui.Begin(c, ROW); imui.Flex(c); imListRowCellStyle(c); {
                const [, textArea] = imTextAreaBegin(c, {
                    value: finderState.query,
                }); {
                    const input = imdom.On(c, ev.INPUT);
                    const change = imdom.On(c, ev.CHANGE);

                    if (input || change) {
                        finderState.query = textArea.value;
                        ctx.handled = true;
                    }

                    if (viewHasFocusChanged && viewHasFocus) {
                        ctx.textAreaToFocus = textArea;
                        ctx.focusWithAllSelected = false;
                    }
                } imTextAreaEnd(c);
            } imui.End(c);
        } imListRowEnd(c);

        if (im.If(c) && finderState.query.length > 0 && !finderState.exactMatchSucceeded) {
            imui.Begin(c, ROW); imListRowCellStyle(c); {
                imdom.Str(c, `Found 0 exact matches, fell back to a fuzzy search`);
            } imui.End(c);
        } im.IfEnd(c);

        const list = imNavListBegin(
            c,
            s.scrollContainer,
            s.fuzzyFindState.currentIdx,
            viewHasFocus
        ); {
            const matches = s.fuzzyFindState.matches;
            im.For(c); while (imNavListNextItemArray(list, matches)) {
                const { i } = list;
                const item = matches[i];

                imNavListRowBegin(c, list, false, false); {
                    imui.Begin(c, BLOCK); imListRowCellStyle(c); {

                        if (im.If(c) && item.ranges) {
                            imTextWithHighlightedRanges(c, item.note.data.text, item.ranges, true);
                        } else {
                            im.IfElse(c);
                            imui.Begin(c, INLINE); imdom.Str(c, truncate(item.note.data.text, 50)); imui.End(c);
                        } im.IfEnd(c);
                    } imui.End(c);
                } imNavListRowEnd(c);
            } im.ForEnd(c);
        } imNavListEnd(c, list);

        imui.Begin(c, ROW); imui.Justify(c); {
            const numMatches = finderState.matches.length;
            const resultType = finderState.exactMatchSucceeded ? "exact" : "fuzzy";
            const yourWelcome = numMatches === 0 ? " (you're welcome)" : "";
            imdom.Str(c, `Narrowed ${state.notes.nodes.length} to ${numMatches} ${resultType} results in ${s.timeTakenMs}ms${yourWelcome}`);
        } imui.End(c);
    } imui.End(c);

    if (queryChanged || scopeChanged) {
        s.timeTakenMs = performance.now() - t0;
    }
}

export function imTextWithHighlightedRanges(c: ImCache, text: string, ranges: FuzzyFindRange[], truncate: boolean) {
    const diffState = im.GetInline(c, imFuzzyFinder) ??
        im.Set<{ text: string; ranges: FuzzyFindRange[] }>(c, {
            text: "",
            ranges: []
        });

    if (im.Memo(c, text) | im.Memo(c, ranges) | im.Memo(c, truncate)) {
        if (ranges.length > 0 && truncate) {
            // Let's truncate with context.

            const contextWindow = 10;

            let matchStart = ranges[0][0] - contextWindow;

            let truncateStart = matchStart !== 0;
            if (matchStart < 0) {
                matchStart = 0;
                truncateStart = false;
            }

            let matchEnd = ranges[ranges.length - 1][1] + contextWindow;
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

    imui.Begin(c, INLINE); {
        if (im.Memo(c, truncate)) imdom.setStyle(c, "whiteSpace", truncate ? "" : "pre-wrap");

        let lastStart = 0;
        const { text, ranges } = diffState;
        im.For(c); for (let i = 0; i < ranges.length; i++) {
            const [start, nextLastStart] = ranges[i];

            const beforeHighlighted = text.substring(lastStart, start);
            const highlighted = text.substring(start, nextLastStart);

            lastStart = nextLastStart;

            imui.Begin(c, INLINE); {
                if (im.isFirstishRender(c)) {
                    imdom.setClass(c, cnApp.defocusedText);
                }

                imdom.Str(c, beforeHighlighted);
            } imui.End(c);
            imui.Begin(c, INLINE); imdom.Str(c, highlighted); imui.End(c);
        } im.ForEnd(c);

        if (im.If(c) && lastStart !== text.length) {
            imui.Begin(c, INLINE); {
                if (im.isFirstishRender(c)) {
                    imdom.setClass(c, cnApp.defocusedText);
                }

                imdom.Str(c, text.substring(lastStart));
            } imui.End(c);
        } im.IfEnd(c);
    } imui.End(c);
}
