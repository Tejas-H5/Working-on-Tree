import { forEachUrlPosition, openUrlInNewTab } from "src/utils/url";
import { imLine } from "./app-components/common";
import { COL, imAlign, imBegin, imFlex, imJustify, INLINE, ROW } from "./components/core/layout";
import { newScrollContainer, ScrollContainer } from "./components/scroll-container";
import { addToNavigationList, APP_VIEW_NOTES, APP_VIEW_URL_LIST, GlobalContext, hasDiscoverableCommand } from "./global-context";
import { imListRowCellStyle } from "./list-row";
import {
    clampedListIdx,
    getNavigableListInput,
    imBeginNavList,
    imBeginNavListRow,
    imEndNavList,
    imEndNavListRow,
    imNavListNextArray,
    ListPosition,
    newListPosition
} from "./navigable-list";
import {
    dfsPre,
    getCurrentNote,
    getNote,
    idIsNilOrRoot,
    state,
    TreeNote
} from "./state";
import { get } from "./utils/array-utils";
import {
    HORIZONTAL,
    imBeginRoot,
    imEnd,
    imEndIf,
    imIf,
    imIsFirstishRender,
    imMemo,
    imNextListRoot,
    imState,
    setAttr,
    setStyle,
    setText
} from "./utils/im-dom-utils";

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
    // TODO: make this a finder scope
    let notes: TreeNote[] = []; 
    {
        let note = currentNote;
        let lastNote = note;
        while (!idIsNilOrRoot(note.parentId)) {
            note = getNote(state, note.parentId);

            notes.push(note);

            // Also search children 1 level underneath parents. This is very very helpful.
            for (let id of note.childIds) {
                const note = getNote(state, id);
                if (note === lastNote) {
                    // don't collect urls from the same note twice.
                    continue;
                }

                notes.push(note);
            }

            lastNote = note;
        }
    }

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

export function imUrlList(
    ctx: GlobalContext,
    viewHasFocus: boolean
) {
    const s = imState(newUrlListViewState);

    addToNavigationList(ctx, APP_VIEW_URL_LIST);

    if (viewHasFocus) {
        handleKeyboardInput(ctx, s);
    }

    if (imMemo(state.currentNoteId)) {
        recomputeUrls(s);
    }

    imBegin(COL); imListRowCellStyle(); imAlign(); {
        if (imIsFirstishRender()) {
            setStyle("fontWeight", "bold");
        }

        imBegin(); setText("Nearby URLs"); imEnd();
    } imEnd();

    imLine(HORIZONTAL, 1);

    let renderedAny = false;
    const list = imBeginNavList(s.scrollContainer, s.listPosition.idx, viewHasFocus); {
        while (imNavListNextArray(list, s.urls)) {
            renderedAny = true;
            const { i } = list;
            const url = s.urls[i];

            imBeginNavListRow(list); {
                imBegin(); imListRowCellStyle(); {
                    imBeginRoot(newA); {
                        if (imMemo(url)) {
                            setAttr("href", url.url);
                        }

                        imBegin(INLINE); setText(url.url); imEnd();
                    } imEnd();
                } imEnd();
            } imEndNavListRow(list);
        }

        imNextListRoot("empty");
        if (imIf() && !renderedAny) {
            imBegin(ROW); imFlex(); imAlign(); imJustify(); {
                setText("No URLs found here.");
            } imEnd();
        } imEndIf();
    } imEndNavList(list);

}

function newA() {
    return document.createElement("a");
}
