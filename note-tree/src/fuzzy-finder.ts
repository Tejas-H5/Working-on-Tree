import { cnApp } from "./app-styling";
import { COL, imAlign, imBegin, imFlex, imInitStyles, imJustify, INLINE, ROW } from "./components/core/layout";
import { imBeginTextArea, imEndTextArea } from "./components/editable-text-area";
import { newScrollContainer, ScrollContainer } from "./components/scroll-container";
import { addToNavigationList, APP_VIEW_FAST_TRAVEL, APP_VIEW_NOTES, BYPASS_TEXT_AREA, CTRL, GlobalContext, hasDiscoverableCommand, SHIFT } from "./global-context";
import { imBeginListRow, imEndListRow, imListRowCellStyle } from "./list-row";
import {
    clampedListIdx,
    getNavigableListInput,
    imBeginNavList,
    imBeginNavListRow,
    imEndNavList,
    imEndNavListRow,
    imNavListNextArray
} from "./navigable-list";
import {
    FuzzyFindState,
    getCurrentNote,
    getNote,
    getNoteTextWithoutPriority,
    getRootNote,
    idIsNil,
    idIsNilOrRoot,
    newFuzzyFindState,
    searchAllNotesForText,
    setCurrentNote,
    state,
    STATUS_IN_PROGRESS,
    TreeNote
} from "./state";
import { assert } from "./utils/assert";
import { truncate } from "./utils/datetime";
import { FuzzyFindRange } from "./utils/fuzzyfind";
import {
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imFor,
    imIf,
    imIsFirstishRender,
    imMemo,
    imMemoMany,
    imNextListRoot,
    imOn,
    imState,
    imStateInline,
    setClass,
    setStyle,
    setText
} from "./utils/im-dom-utils";
import { NIL_ID } from "./utils/int-tree";

export type FuzzyFinderViewState = {
    scrollContainer: ScrollContainer;
    fuzzyFindState: FuzzyFindState;
    timeTakenMs: number;

    noteBeforeFocus: TreeNote | null;
};

export function newFuzzyFinderViewState(): FuzzyFinderViewState {
    return {
        noteBeforeFocus: null,
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
    setCurrentNote(
        state,
        match.note.id,
        s.noteBeforeFocus?.id
    );
}

function handleKeyboardInput(ctx: GlobalContext, s: FuzzyFinderViewState) {
    const finderState = s.fuzzyFindState;
    const matches = finderState.matches;
    const listNavigation = getNavigableListInput(ctx, s.fuzzyFindState.currentIdx, 0, matches.length);

    if (listNavigation) {
        setIdx(ctx, s, listNavigation.newIdx);
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Go to note", BYPASS_TEXT_AREA)) {
        ctx.currentScreen = APP_VIEW_NOTES;
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.fKey, "Toggle scope", CTRL | BYPASS_TEXT_AREA)) {
        assert(!!s.noteBeforeFocus);
        finderState.scopedToNoteId = idIsNilOrRoot(finderState.scopedToNoteId) ? s.noteBeforeFocus.id : NIL_ID;
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Newline", SHIFT | BYPASS_TEXT_AREA)) {
        // let the text editor handle this one.
        ctx.handled = false;
    }

    if (hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Back", BYPASS_TEXT_AREA)) {
        if (s.noteBeforeFocus) {
            setCurrentNote(state, s.noteBeforeFocus.id);
        }
        ctx.currentScreen = APP_VIEW_NOTES;
    }
}

function recomputeFuzzyFinderMatches(finderState: FuzzyFindState) {
    const rootNote = !idIsNil(finderState.scopedToNoteId) ? getNote(state, finderState.scopedToNoteId)
        : getRootNote(state);

    const matches = finderState.matches;

    searchAllNotesForText(state, rootNote, finderState.query, matches, false);
    finderState.exactMatchSucceeded = matches.length > 0;
    if (!finderState.exactMatchSucceeded) {
        searchAllNotesForText(state, rootNote, finderState.query, matches, true);
    }

    const MAX_MATCHES = 100;
    if (matches.length > MAX_MATCHES) {
        matches.length = MAX_MATCHES;
    }

    const counts = finderState.counts;

    counts.numFinished = 0;
    counts.numInProgress = 0;
    counts.numShelved = 0;
    for (const match of matches) {
        if (match.note.data._status === STATUS_IN_PROGRESS) {
            counts.numInProgress++;
        } else {
            counts.numFinished++;
        }

        if (match.note.data._shelved) {
            counts.numShelved++;
        }
    }

    if (!idIsNil(finderState.scopedToNoteId)) {
        finderState.currentIdx = finderState.currentIdxLocal;
    } else {
        finderState.currentIdx = finderState.currentIdxGlobal;
    }
}

function recomputeTraversal(ctx: GlobalContext, s: FuzzyFinderViewState) {
    recomputeFuzzyFinderMatches(s.fuzzyFindState);
    setIdx(ctx, s, s.fuzzyFindState.currentIdx);
}

export function imFuzzyFinder(
    ctx: GlobalContext,
    viewHasFocus: boolean
) {
    addToNavigationList(ctx, APP_VIEW_FAST_TRAVEL);

    const s = imState(newFuzzyFinderViewState);
    const finderState = s.fuzzyFindState;

    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);

    }

    const viewHasFocusChanged = imMemo(viewHasFocus);
    if (viewHasFocusChanged && viewHasFocus) {
        s.noteBeforeFocus = getCurrentNote(state);
        finderState.scopedToNoteId = NIL_ID;
    }

    const queryChanged = imMemoMany(finderState.query, finderState.scopedToNoteId);
    let t0 = 0;
    if (queryChanged) {
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

            let scope = idIsNilOrRoot(finderState.scopedToNoteId) ? "Everywhere" : "Under initial note";
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
            while (imNavListNextArray(list, matches)) {
                const { i } = list;
                const item = matches[i];

                imBeginNavListRow(list); {
                    imBegin(); imListRowCellStyle(); {

                        if (imIf() && item.ranges) {
                            const diffState = imStateInline((): {
                                text: string;
                                ranges: FuzzyFindRange[]
                            } => ({
                                text: "",
                                ranges: []
                            }));
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
                } imEndNavListRow(list);
            }
        } imEndNavList(list);

        imBegin(ROW); imJustify(); {
            const numMatches = finderState.matches.length;
            const resultType = finderState.exactMatchSucceeded ? "exact" : "fuzzy";
            const yourWelcome = numMatches === 0 ? " (you're welcome)" : "";
            setText(`Narrowed ${state.notes.nodes.length} to ${numMatches} ${resultType} results in ${s.timeTakenMs}ms${yourWelcome}`);
        } imEnd();
    } imEnd();

    if (queryChanged) {
        s.timeTakenMs = performance.now() - t0;
    }
}
