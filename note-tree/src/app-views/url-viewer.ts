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
import { imui, BLOCK, ROW, COL, PX, NA } from "src/utils/im-js/im-ui";
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
import { arrayAt } from "src/utils/array-utils";
import { im, ImCache, imdom, el, ev, } from "src/utils/im-js";

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
    const url = arrayAt(s.urls, s.listPosition.idx);

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

    if (im.Memo(c, viewHasFocus)) {
        recomputeUrls(s);
    }

    imui.Begin(c, COL); imListRowCellStyle(c); imui.Align(c); {
        if (im.isFirstishRender(c)) {
            imdom.setStyle(c, "fontWeight", "bold");
        }

        imui.Begin(c, BLOCK); imdom.Str(c, "Nearby URLs"); imui.End(c);
    } imui.End(c);

    imLine(c, LINE_HORIZONTAL, 1);

    let renderedAny = false;
    const list = imNavListBegin(c, s.scrollContainer, s.listPosition.idx, viewHasFocus); {
        im.For(c); while (imNavListNextItemArray(list, s.urls)) {
            renderedAny = true;
            const { i } = list;
            const url = s.urls[i];

            imNavListRowBegin(c, list, false, false); {
                imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                    imdom.ElBegin(c, el.A); {
                        if (im.Memo(c,url)) {
                            imdom.setAttr(c,"href", url.url);
                        }

                        imdom.Str(c, url.url);
                    } imdom.ElEnd(c, el.A);
                } imui.End(c);
            } imNavListRowEnd(c);
        } im.ForEnd(c);

        im.KeyedBegin(c, "empty"); {
            if (im.If(c) && !renderedAny) {
                imui.Begin(c, ROW); imui.Flex(c); imui.Align(c); imui.Justify(c); {
                    imdom.Str(c, "No URLs found here.");
                } imui.End(c);
            } im.IfEnd(c);
        } im.KeyedEnd(c);
    } imNavListEnd(c, list);
}
