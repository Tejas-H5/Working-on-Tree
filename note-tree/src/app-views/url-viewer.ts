import { imListRowCellStyle } from "src/app-components/list-row";
import {
    clampedListIdx,
    getNavigableListInput,
    imNavListBegin,
    imNavListEnd,
    imNavListNextItemArray,
    imNavListRowBegin,
    imNavListRowEnd,
    ListPosition,
    newListPosition
} from "src/app-components/navigable-list";
import { BLOCK, COL, imAlign, imFlex, imJustify, imLayout, imLayoutEnd, ROW } from "src/components/core/layout";
import { imLine, LINE_HORIZONTAL } from "src/components/im-line";
import { newScrollContainer, ScrollContainer } from "src/components/scroll-container";
import { GlobalContext, hasDiscoverableCommand } from "src/global-context";
import {
    dfsPre,
    forEachParentNote,
    getCurrentNote,
    getNote,
    setCurrentNote,
    state,
    TreeNote
} from "src/state";
import { get } from "src/utils/array-utils";
import { ImCache, imFor, imForEnd, imIf, imIfEnd, imKeyedBegin, imKeyedEnd, imMemo, isFirstishRender } from "src/utils/im-core";
import { EL_A, elSetAttr, elSetStyle, imEl, imElEnd, imStr } from "src/utils/im-dom";
import { forEachUrlPosition, openUrlInNewTab } from "src/utils/url";

type UrlListViewUrl = {
    url: string;
    note: TreeNote;
    range: [start: number, end: number];
};

export type UrlListViewState = {
    urls: UrlListViewUrl[];

    scrollContainer: ScrollContainer;
    listPosition: ListPosition;
};

export function newUrlListViewState(): UrlListViewState {
    return {
        urls: [],
        scrollContainer: newScrollContainer(),
        listPosition: newListPosition(),
    };
}

function setIdx(s: UrlListViewState, idx: number) {
    if (s.urls.length === 0) return;

    s.listPosition.idx = clampedListIdx(idx, s.urls.length);
    const url = s.urls[s.listPosition.idx];
    setCurrentNote(state, url.note.id);
}

function handleKeyboardInput(ctx: GlobalContext, s: UrlListViewState) {
    const url = get(s.urls, s.listPosition.idx);

    const listNavigation = getNavigableListInput(ctx, s.listPosition.idx, 0, s.urls.length);
    if (listNavigation) {
        setIdx(s, listNavigation.newIdx);
    }

    if (url && hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Open in new tab")) {
        openUrlInNewTab(url.url);
    }
}

function recomputeUrls(s: UrlListViewState) {
    s.urls.length = 0;

    function pushAllUrls(note: TreeNote) {
        forEachUrlPosition(note.data.text, (start, end) => {
            const url = note.data.text.substring(start, end);
            s.urls.push({
                url,
                note,
                range: [start, end],
            });
        });
    }

    const currentNote = getCurrentNote(state);

    // traverse all parents, and 1 level under the parents.
    let notes: TreeNote[] = []; 
    let lastNote = currentNote;
    forEachParentNote(state.notes, currentNote, note => {
        notes.push(note)
        for (let i = note.childIds.length - 1; i >= 0; i--) {
            const id = note.childIds[i];
            const child = getNote(state.notes, id);
            notes.push(child)
        }

        lastNote = note;
    });

    // we want the urls to appear highest to lowest.
    for (let i = notes.length - 1; i >= 0; i--) {
        pushAllUrls(notes[i]);
    }

    const wantedIdx = s.urls.length;

    // Dont even need to collect these into an array before rendering them. lmao. 
    dfsPre(state, currentNote, (note) => {
        pushAllUrls(note);
    });

    setIdx(s, wantedIdx);
}

export function imUrlViewer(c: ImCache, ctx: GlobalContext, s: UrlListViewState) {
    const viewHasFocus = ctx.currentView === s;
    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);
    }

    if (imMemo(c, viewHasFocus)) {
        recomputeUrls(s);
    }

    imLayout(c, COL); imListRowCellStyle(c); imAlign(c); {
        if (isFirstishRender(c)) {
            elSetStyle(c, "fontWeight", "bold");
        }

        imLayout(c, BLOCK); imStr(c, "Nearby URLs"); imLayoutEnd(c);
    } imLayoutEnd(c);

    imLine(c, LINE_HORIZONTAL, 1);

    let renderedAny = false;
    const list = imNavListBegin(c, s.scrollContainer, s.listPosition.idx, viewHasFocus); {
        imFor(c); while (imNavListNextItemArray(list, s.urls)) {
            renderedAny = true;
            const { i } = list;
            const url = s.urls[i];

            imNavListRowBegin(c, list); {
                imLayout(c, BLOCK); imListRowCellStyle(c); {
                    imEl(c, EL_A); {
                        if (imMemo(c,url)) {
                            elSetAttr(c,"href", url.url);
                        }

                        imStr(c, url.url);
                    } imElEnd(c, EL_A);
                } imLayoutEnd(c);
            } imNavListRowEnd(c);
        } imForEnd(c);

        imKeyedBegin(c, "empty"); {
            if (imIf(c) && !renderedAny) {
                imLayout(c, ROW); imFlex(c); imAlign(c); imJustify(c); {
                    imStr(c, "No URLs found here.");
                } imLayoutEnd(c);
            } imIfEnd(c);
        } imKeyedEnd(c);
    } imNavListEnd(c, list);
}
