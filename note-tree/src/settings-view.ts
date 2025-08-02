import { imBeginAppHeading, imBold } from "./app-heading";
import { COL, imAlign, imBegin, imFlex, imJustify, imSize, NOT_SET, PX, ROW } from "./components/core/layout";
import { newScrollContainer, } from "./components/scroll-container";
import { GlobalContext, hasDiscoverableCommand, SHIFT } from "./global-context";
import { imBeginListRow, imEndListRow, imListRowCellStyle } from "./list-row";
import {
    AXIS_HORIZONTAL,
    getNavigableListInput,
    imBeginNavList,
    imBeginNavListRow,
    imEndNavList,
    imEndNavListRow,
    imNavListNextItemArray,
    imNavListNextItem,
    newListPosition
} from "./navigable-list";
import { getCurrentStateAsJSON, state } from "./state";
import { formatDateTime } from "./utils/datetime";
import { downloadTextAsFile } from "./utils/file-download";
import {
    imElse,
    imEnd,
    imEndIf,
    imEndSwitch,
    imIf,
    imIsFirstishRender,
    imRef,
    imState,
    imSwitch,
    setStyle,
    setText
} from "./utils/im-dom-utils";

export type SettingsViewState = {
    mainListHasFocus: boolean;
    selectedMenu: MenuItem | null;
};

export function newSettingsViewState(): SettingsViewState {
    return {
        mainListHasFocus: false,
        selectedMenu: null,
    };
}

type MenuItem =  {
    name: string;
    desc: string;
    imComponent: (ctx: GlobalContext, s: SettingsViewState, hasFocus: boolean) => void;
}

const menus: MenuItem[] = [
    {
        name: "UI",
        desc: "Fine-tune UI interactions",
        imComponent: (ctx, s) => {
            imBegin(COL); imFlex(); {
                imBegin(COL); imFlex(); imAlign(); imJustify(); {
                    // TODO: tab stop, tabs vs spaces, all on multiple lines -> parents on one line -> all on one line except selection
                    setText("We don't have any UI option yet. Check back again later!");
                } imEnd();
            } imEnd();
        }
    },
    {
        name: "Export",
        desc: "Export your data to a JSON file to import later/elsewhere",
        imComponent: (ctx, s, hasFocus) => {
            imBegin(COL); imFlex(); {
                // NOTE: Don't want the export view to look similar to the import view. need to avoid action capture.
                imBegin(COL); imFlex(); imAlign(); imJustify(); {
                    const errRef = imRef();

                    if (imIf() && !errRef.val) {
                        imBegin(); imBold(); imListRowCellStyle(); setText(state.notes.nodes.length + " notes"); imEnd();
                        imBegin(); imBold(); imListRowCellStyle();setText(state.activities.length + " activities"); imEnd();

                        imBeginListRow(true, hasFocus, false); {
                            imBegin(); imBold(); imListRowCellStyle(); setText("Download JSON"); imEnd();
                        } imEndListRow();

                        if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Download JSON")) {
                            try {
                                // TODO: custom method to generate a new file name
                                downloadTextAsFile(
                                    getCurrentStateAsJSON(),
                                    `Note-Tree Backup - ${formatDateTime(new Date(), "-").replace(/\//g, "-")}.json`
                                );
                            } catch (e) {
                                errRef.val = e;
                            }
                        }
                    } else {
                        imElse();

                        imBegin(); setText("An error occured: " + errRef.val); imEnd();

                        if (hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Dismiss")) {
                            errRef.val = null;
                        }
                    } imEndIf();
                } imEnd();
            } imEnd();
        }
    },
    {
        name: "Import",
        desc: "Import your data from a JSON file you exported",
        imComponent: (ctx, s) => {
            imBegin(COL); imFlex(); {
                imBegin(COL); imFlex(); imAlign(); imJustify(); {
                    setText("TODO: implement data import");
                } imEnd();
            } imEnd();
        }
    },
];

export function imSettingsView(ctx: GlobalContext, s: SettingsViewState) {
    const viewHasFocus = ctx.currentView === s;
    const vPos = imState(newListPosition);

    imBegin(COL); imFlex(); {
        imBegin(ROW); imAlign(); imJustify(); {
            imBeginAppHeading(); {
                let text = "Settings";

                if (s.selectedMenu) {
                    text = s.selectedMenu.desc;
                }

                setText(text);
            } imEnd();
        } imEnd();

        imBegin(COL); imAlign(); imFlex(); {
            imBegin(ROW); {
                imBegin(COL); {
                    if (imIsFirstishRender()) {
                        setStyle("minWidth", "100px");
                    }

                    const vSc = imState(newScrollContainer);
                    const hasFocus = viewHasFocus && !s.mainListHasFocus;
                    const hallwayList = imBeginNavList(vSc, vPos.idx, hasFocus, false); {
                        while (imNavListNextItemArray(hallwayList, menus)) {
                            const menu = menus[hallwayList.i];
                            if (hallwayList.itemSelected) {
                                s.selectedMenu = menu;
                            }
                            imBeginNavListRow(hallwayList); {
                                imBegin(); imListRowCellStyle(); imBold(); setText(menu.name); imEnd();
                            } imEndNavListRow();
                        }

                        if (hasFocus) {
                            const vListInput = getNavigableListInput(ctx, vPos.idx, 0, hallwayList.i);
                            if (vListInput) vPos.idx = vListInput.newIdx;

                            if (
                                s.selectedMenu && 
                                (hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, "Back to hallway", SHIFT) ||
                                hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, "Back to hallway") ||
                                hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Go to " + s.selectedMenu.name))
                            ) {
                                s.mainListHasFocus = true;
                            }
                        }
                    } imEndNavList(hallwayList);
                } imEnd();

                imBegin(); imSize(10, PX, 0, NOT_SET); imEnd();

                imBegin(COL); imFlex(); {
                    if (imIsFirstishRender()) {
                        setStyle("width", "700px");
                    }

                    const mainListHasFocus = viewHasFocus && s.mainListHasFocus;

                    imSwitch(s.selectedMenu); 
                    if (s.selectedMenu) s.selectedMenu.imComponent(ctx, s, mainListHasFocus);
                    imEndSwitch();

                    if (mainListHasFocus) {
                        if (
                            hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Back to hallway") ||
                            hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, "Back to hallway", SHIFT) ||
                            hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, "Back to hallway") 
                        ) {
                            s.mainListHasFocus = false;
                        }
                    }
                } imEnd();
            } imEnd();
        } imEnd();
    } imEnd();
}
