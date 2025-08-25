import { imAppHeadingBegin, imAppHeadingEnd } from "./app-heading";
import { cssVarsApp } from "./app-styling";
import { BLOCK, COL, imAlign, imFlex, imGap, imJustify, imLayout, imLayoutEnd, imNoWrap, imSize, NA, PERCENT, PX, ROW, STRETCH } from "./components/core/layout";
import { cn } from "./components/core/stylesheets";
import { imB, imBEnd, imI, imIEnd, imS } from "./components/core/text";
import { newScrollContainer, } from "./components/scroll-container";
import { debouncedSave, GlobalContext, hasDiscoverableCommand, saveCurrentState, setCurrentView, SHIFT } from "./global-context";
import { imListRowBegin, imListRowEnd, imListRowCellStyle } from "./list-row";
import {
    addView,
    getNavigableListInput,
    getTabInput,
    imNavListBegin,
    imNavListRowBegin,
    imNavListEnd,
    imNavListRowEnd,
    imNavListNextItem,
    imNavListNextItemArray,
    imViewsList,
    newFocusRef,
    newListPosition
} from "./navigable-list";
import { getCurrentStateAsJSON, loadStateFromJSON, LoadStateFromJSONResult, resetState, setState, state } from "./state";
import { get } from "./utils/array-utils";
import { formatDateTime, parseDateSafe } from "./utils/datetime";
import { downloadTextAsFile, loadFile } from "./utils/file-download";
import {
    getDeltaTimeSeconds,
    ImCache,
    imFor,
    imForEnd,
    imGet,
    imIf,
    imIfElse,
    imIfEnd,
    imMemo,
    imSet,
    imSwitch,
    imSwitchEnd,
    imTry,
    inlineTypeId,
    isFirstishRender
} from "./utils/im-core";
import { EL_B, elSetClass, elSetStyle, imElBegin, imElEnd, imStr } from "./utils/im-dom";
import { ROOT_ID } from "./utils/int-tree";
import { VERSION_NUMBER } from "./version-number";

const REQUIRED_PRESSES = 5;

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
    imComponent: (
        c: ImCache,
        ctx: GlobalContext,
        s: SettingsViewState,
        hasFocus: boolean
    ) => void;
}


type ImportModal = {
    filename: string;
    state: LoadStateFromJSONResult | null;
    acceptPresses: number;
    imported: boolean;
};


function importModal(): ImportModal {
    return {
        filename: "",
        state: null,
        acceptPresses: 0,
        imported: false,
    };
}



function resetImportModal(state: ImportModal) {
    state.filename = "";
    state.state = null;
    state.acceptPresses = 0;
    state.imported = false;
}

const menus: MenuItem[] = [
    {
        name: "UI",
        desc: "Fine-tune UI interactions",
        imComponent: (c, ctx, s, hasFocus) => {
            imLayout(c, COL); imFlex(c); {
                imLayout(c, COL); imFlex(c); imAlign(c); imJustify(c); {
                    // TODO: tab stop, tabs vs spaces, all on multiple lines -> parents on one line -> all on one line except selection

                    let vSc = imGet(c, newScrollContainer);
                    if (!vSc) vSc = imSet(c, newScrollContainer());

                    let vPos = imGet(c, newListPosition);
                    if (!vPos) vPos = imSet(c, newListPosition());

                    const settings = state.settings;

                    const itemList = imNavListBegin(c, vSc, vPos.idx, hasFocus, false); {
                        imNavListNextItem(itemList); {
                            imNavListRowBegin(c, itemList); {
                                imLayout(c, ROW); imListRowCellStyle(c); {
                                    imB(c); imStr(c, "Spaces or tabs?"); imBEnd(c);

                                    imLayout(c, BLOCK); imSize(c, 20, PX, 0, NA); imLayoutEnd(c);

                                    // nonEditingNotesOnOneLine: boolean;
                                    // parentNotesOnOneLine: boolean;
                                    // tabStopSize: number;

                                    imStr(c, settings.spacesInsteadOfTabs ? "Spaces" : "Tabs");

                                } imLayoutEnd(c);
                            } imNavListRowEnd(c);

                            if (hasFocus && itemList.itemSelected) {
                                if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Toggle")) {
                                    settings.spacesInsteadOfTabs = !settings.spacesInsteadOfTabs;
                                    debouncedSave(ctx, state, "Settings");
                                }
                            }
                        }

                        imNavListNextItem(itemList); {
                            let canWiden = hasFocus && settings.tabStopSize < 12;
                            let canNarrow = hasFocus && settings.tabStopSize > 1;

                            imNavListRowBegin(c, itemList); {
                                imLayout(c, ROW); imListRowCellStyle(c); {
                                    if (isFirstishRender(c)) {
                                        elSetClass(c, cn.preWrap);
                                    }

                                    imB(c); imStr(c, "Tab width"); imBEnd(c);

                                    imLayout(c, BLOCK); imSize(c, 20, PX, 0, NA); imLayoutEnd(c);

                                    imStr(c, canNarrow ? "< " : "  ");
                                    imStr(c, settings.tabStopSize);
                                    imStr(c, " ".repeat(settings.tabStopSize));
                                    imStr(c, canWiden ? ">" : "|");
                                } imLayoutEnd(c);
                            } imNavListRowEnd(c);

                            if (hasFocus && itemList.itemSelected) {
                                if (
                                    canWiden &&
                                    hasDiscoverableCommand(ctx, ctx.keyboard.rightKey, "Wider")
                                ) {
                                    settings.tabStopSize++;
                                    debouncedSave(ctx, state, "settings");
                                }

                                if (
                                    canNarrow &&
                                    hasDiscoverableCommand(ctx, ctx.keyboard.leftKey, "Narrower")
                                ) {
                                    settings.tabStopSize--;
                                    debouncedSave(ctx, state, "settings");
                                }
                            }
                        }
                    } imNavListEnd(c, itemList);
                    if (hasFocus) {
                        const vListInput = getNavigableListInput(ctx, vPos.idx, 0, itemList.i + 1);
                        if (vListInput) {
                            vPos.idx = vListInput.newIdx;
                        }
                    }
                } imLayoutEnd(c);
            } imLayoutEnd(c);
        }
    },
    {
        name: "Download JSON",
        desc: "Export your data to a JSON file to import later/elsewhere",
        imComponent: (c, ctx, s, hasFocus) => {
            imLayout(c, COL); imFlex(c); {
                // NOTE: Don't want the export view to look similar to the import view. need to avoid action capture.
                imLayout(c, COL); imFlex(c); imAlign(c); imJustify(c); {
                    let errRef; errRef = imGet(c, inlineTypeId(imTry))
                    if (!errRef) errRef = imSet(c, { val: null as any });

                    if (imIf(c) && !errRef.val) {
                        imLayout(c, BLOCK); imListRowCellStyle(c); imB(c); imStr(c, state.notes.nodes.length + " notes"); imBEnd(c); imLayoutEnd(c);
                        imLayout(c, BLOCK); imListRowCellStyle(c); imB(c); imStr(c, state.activities.length + " activities"); imBEnd(c); imLayoutEnd(c);

                        imListRowBegin(c, true, hasFocus, false); {
                            imLayout(c, BLOCK); imListRowCellStyle(c); {
                                imElBegin(c, EL_B); imStr(c, "Download JSON"); imElEnd(c, EL_B); 
                            } imLayoutEnd(c);
                        } imListRowEnd(c);

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
                        imIfElse(c);

                        imLayout(c, BLOCK); imStr(c, "An error occured: " + errRef.val); imLayoutEnd(c);

                        if (hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Dismiss")) {
                            errRef.val = null;
                        }
                    } imIfEnd(c);
                } imLayoutEnd(c);
            } imLayoutEnd(c);
        }
    },
    {
        name: "Load from JSON",
        desc: "Import your data from a JSON file you exported",
        imComponent: (c, ctx, s, hasFocus) => {
            imLayout(c, COL); imFlex(c); {
                imLayout(c, COL); imFlex(c); imAlign(c); imJustify(c); {
                    let importModalState = imGet(c, importModal);
                    if (!importModalState) importModalState = imSet(c, importModal());

                    if (imMemo(c, hasFocus)) {
                        resetImportModal(importModalState);
                    }

                    const loadResult = importModalState.state;
                    if (imIf(c) && loadResult) {
                        let current = imGet(c, newFocusRef);
                        if (!current) current = imSet(c, newFocusRef());
                        const navList = imViewsList(c, current);

                        imLayout(c, BLOCK); {
                            const loadedState = loadResult.state;
                            if (imIf(c) && loadedState) {
                                const lastOnline = parseDateSafe(loadedState.breakAutoInsertLastPolledTime);

                                imLayout(c, ROW); imJustify(c); {
                                    imB(c); imStr(c, "Make sure this looks reasonable before you load the backup"); imBEnd(c); 
                                } imLayoutEnd(c);

                                imLayout(c, BLOCK); imSize(c, 0, NA, 30, PX); imLayoutEnd(c);

                                imLayout(c, BLOCK); {
                                    imB(c); imStr(c, "Filename: "); imLayoutEnd(c); imStr(c, importModalState.filename); imBEnd(c);
                                } imLayoutEnd(c);
                                imLayout(c, BLOCK); imB(c); imStr(c, "Notes: "); imLayoutEnd(c); imStr(c, loadedState.notes.nodes.length); imBEnd(c);
                                imLayout(c, BLOCK); imB(c); imStr(c, "Activities: "); imLayoutEnd(c); imStr(c, loadedState.activities.length); imBEnd(c);
                                imLayout(c, BLOCK); imB(c); imStr(c, "Last Online: "); imLayoutEnd(c); imStr(c, !lastOnline ? "No idea" : formatDateTime(lastOnline)); imBEnd(c);
                                imLayout(c, BLOCK); imB(c); imStr(c, "Last Theme: "); imLayoutEnd(c); imStr(c, loadedState.currentTheme); imBEnd(c);

                                imLayout(c, BLOCK); imSize(c, 0, NA, 30, PX); imLayoutEnd(c);

                                imLayout(c, ROW); imGap(c, 50, PX); {
                                    addView(navList, 0, "Accept button"); {
                                        const focused = current.focused === 0;
                                        imListRowBegin(c, focused, focused && hasFocus, false); {
                                            imLayout(c, BLOCK); imListRowCellStyle(c); {
                                                imB(c); imStr(c, "Accept"); imBEnd(c); 
                                            } imLayoutEnd(c);
                                        } imListRowEnd(c);

                                        if (
                                            focused &&
                                            hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Reject")
                                        ) {
                                            importModalState.acceptPresses++;
                                            if (importModalState.acceptPresses >= REQUIRED_PRESSES && !importModalState.imported) {
                                                setState(loadedState);
                                                saveCurrentState(ctx, state, { debounced: false });
                                                setCurrentView(ctx, ctx.views.noteTree);
                                            }
                                        }
                                    }

                                    addView(navList, 1, "Reject button"); {
                                        const focused = current.focused === 1;
                                        imListRowBegin(c, focused, focused && hasFocus, false); {
                                            imLayout(c, BLOCK); imListRowCellStyle(c); {
                                                imB(c); imStr(c, "Reject"); imBEnd(c);
                                            } imLayoutEnd(c);
                                        } imListRowEnd(c);

                                        if (
                                            focused &&
                                            hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Reject")
                                        ) {
                                            resetImportModal(importModalState);
                                        }
                                    }
                                } imLayoutEnd(c);

                                if (imIf(c) && importModalState.acceptPresses > 0) {
                                    imLayout(c, BLOCK); imB(c); imListRowCellStyle(c); imStr(c, "Your existing data will be wiped and replaced with this new state"); imLayoutEnd(c); imBEnd(c);

                                    imLayout(c, ROW); imGap(c, 10, PX); imSize(c, 100, PERCENT, 30, PX); imAlign(c, STRETCH); {
                                        const countChanged = imMemo(c, importModalState.acceptPresses);

                                        const col = "rgb(0, 255, 20)";

                                        imFor(c); for (let i = 0; i < REQUIRED_PRESSES; i++) {
                                            imLayout(c, BLOCK); imFlex(c); {
                                                if (countChanged) {
                                                    elSetStyle(
                                                        c,
                                                        "backgroundColor",
                                                        importModalState.acceptPresses >= REQUIRED_PRESSES ? col
                                                            : importModalState.acceptPresses > i ? cssVarsApp.fgColor
                                                                : ""
                                                    );
                                                }
                                            } imLayoutEnd(c);
                                        } imForEnd(c);
                                    } imLayoutEnd(c);
                                } imIfEnd(c);
                            } else {
                                imIfElse(c);

                                imLayout(c, BLOCK); {
                                    imLayout(c, BLOCK); imB(c); imStr(c, "An error occured while loading the file. It cannot be imported."); imLayoutEnd(c); imBEnd(c);
                                    imLayout(c, BLOCK); imStr(c, loadResult.error ?? loadResult.criticalError ?? "unknown error"); imLayoutEnd(c);
                                } imLayoutEnd(c);

                                addView(navList, 0, "Back button"); {
                                    const focused = current.focused === 0;
                                    imListRowBegin(c, focused, hasFocus && focused, false); {
                                        imLayout(c, BLOCK); imListRowCellStyle(c); {
                                            imB(c); imStr(c, "Back");  imBEnd(c);
                                        } imLayoutEnd(c);
                                    } imListRowEnd(c);

                                    if (hasFocus && focused) {
                                        if (
                                            hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Back") ||
                                            hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Back")
                                        ) {
                                            resetImportModal(importModalState);
                                        }
                                    }
                                }
                            } imIfEnd(c);
                        } imLayoutEnd(c);


                        // navigate the buttons
                        // TODO: make fn
                        {
                            const prev = get(navList.views, navList.idx - 1);
                            const next = get(navList.views, navList.idx + 1);
                            const tabInput = getTabInput(
                                ctx,
                                prev ? "Go to " + prev.name : null,
                                next ? "Go to " + next.name : null,
                            );
                            if (tabInput < 0 &&  prev) {
                                current.focused = prev.focusRef;
                            } else if (tabInput > 0 && next) {
                                current.focused = next.focusRef;
                            }
                        }
                    } else {
                        imIfElse(c);

                        imListRowBegin(c, true, hasFocus, false); {
                            imLayout(c, BLOCK); imListRowCellStyle(c); imB(c); imStr(c, "Import JSON"); imBEnd(c); imLayoutEnd(c);
                            if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Import JSON")) {
                                loadFile((file) => {
                                    if (!file) {
                                        return;
                                    }

                                    file.text().then((text) => {
                                        importModalState.filename = file.name;
                                        importModalState.state = loadStateFromJSON(text);
                                    });
                                });
                            }
                        } imListRowEnd(c);
                    } imIfEnd(c);
                } imLayoutEnd(c);
            } imLayoutEnd(c);
        }
    },
    // I'm not sure why you would ever want to do this in practice.
    // Like. Why would I ever delete my years worth of notes? Doesn't make any sense.
    // It's great for development tho.
    // Maybe for when you're moving computers or something, and you don't want to leave any data in the database?.
    {
        name: "Clear",
        desc: "Clear all your data, and start fresh",
        imComponent: (c, ctx, s, hasFocus) => {
            imLayout(c, COL); imFlex(c); {
                imLayout(c, COL); imFlex(c); imAlign(c); imJustify(c); {
                    imLayout(c, BLOCK); imSize(c, 0, NA, 50, PX); imLayoutEnd(c);

                    imLayout(c, BLOCK); imListRowCellStyle(c); {
                        imB(c); {
                            imStr(c, "Be sure to download your JSON"); imI(c); imStr(c, " before "); imIEnd(c); imStr(c, "you do this."); 
                        } imBEnd(c);
                    } imLayoutEnd(c);

                    imLayout(c, BLOCK); imSize(c, 0, NA, 50, PX); imLayoutEnd(c);

                    // bruh... 

                    const focusChanged = imMemo(c, hasFocus)
                    let clearDataState; clearDataState = imGet(c, inlineTypeId(imLayoutEnd));
                    if (!clearDataState || focusChanged) clearDataState = imSet(c, {
                        count: 0,
                        wiped: false,
                    });

                    const countChanged = imMemo(c, clearDataState.count);

                    imListRowBegin(c, true, hasFocus, false); {
                        imLayout(c, BLOCK); imListRowCellStyle(c); {
                            if (isFirstishRender(c)) {
                                elSetStyle(c, "fontSize", "30px");
                            }

                            const col = clearDataState.count < REQUIRED_PRESSES ? "red" : "white";
                            elSetStyle(c, "color", col);

                            imB(c); {
                                imStr(c, "Delete all data"); 
                            } imBEnd(c);

                            imLayout(c, ROW); imGap(c, 10, PX); imSize(c, 100, PERCENT, 30, PX); imAlign(c, STRETCH); {
                                imFor(c); for (let i = 0; i < REQUIRED_PRESSES; i++) {
                                    imLayout(c, BLOCK); imFlex(c); { 
                                        if (countChanged) {
                                            elSetStyle(
                                                c,
                                                "backgroundColor",
                                                clearDataState.count >= REQUIRED_PRESSES ? col
                                                    : clearDataState.count > i ? cssVarsApp.fgColor
                                                        : ""
                                            );
                                        }
                                    } imLayoutEnd(c);
                                } imForEnd(c);
                            } imLayoutEnd(c);
                        } imLayoutEnd(c);

                        if (hasFocus) {
                            if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Delete all data")) {
                                clearDataState.count++;
                            }
                        }
                    } imListRowEnd(c);

                    imLayout(c, BLOCK); imSize(c, 0, NA, 50, PX); imLayoutEnd(c);

                    if (imIf(c) && clearDataState.count >= REQUIRED_PRESSES) {
                        const REQUIRED_TIME_SECONDS = 1;

                        const focusChanged = imMemo(c, hasFocus);

                        let timer = imGet(c, Math.sin);
                        if (timer === undefined || focusChanged) {
                            timer = imSet(c, 0);
                        }
                        timer = imSet(c, timer + getDeltaTimeSeconds(c));

                        imLayout(c, BLOCK); {
                            if (isFirstishRender(c)) {
                                elSetStyle(c, "fontSize", "30px");
                                elSetStyle(c, "color", "red");
                            }

                            imB(c); {
                                imStr(c, "SYSTEM WIPE IMMINENT"); 
                            } imBEnd(c);

                            imLayout(c, ROW); imAlign(c, STRETCH); imSize(c, 100, PERCENT, 30, PX); {
                                imLayout(c, BLOCK); {
                                    elSetStyle(c, "width", ((timer / REQUIRED_TIME_SECONDS) * 100) + "%");
                                    elSetStyle(c, "backgroundColor", "red");
                                } imLayoutEnd(c);
                            } imLayoutEnd(c);

                        } imLayoutEnd(c);

                        if ((timer / REQUIRED_TIME_SECONDS) > 1 && !clearDataState.wiped) {
                            clearDataState.wiped = true;

                            resetState();

                            setCurrentView(ctx, null);

                            setTimeout(() => {
                                setCurrentView(ctx, ctx.views.noteTree);
                            }, 1000);
                        }
                    } imIfEnd(c);
                } imLayoutEnd(c);
            } imLayoutEnd(c);
        }
    },
];

export function imSettingsView(c: ImCache, ctx: GlobalContext, s: SettingsViewState) {
    const viewHasFocus = ctx.currentView === s;
    let vPos = imGet(c, newListPosition);
    if (!vPos) vPos = imSet(c, newListPosition());

    if (imMemo(c, viewHasFocus) && viewHasFocus) {
        vPos.idx = 0;
        s.mainListHasFocus = false;
    }

    imLayout(c, COL); imFlex(c); {
        imLayout(c, COL); imAlign(c); imFlex(c); {
            imLayout(c, ROW); imSize(c, 0, NA, 100, PERCENT); {
                imLayout(c, COL);  {
                    if (isFirstishRender(c)) {
                        elSetStyle(c, "minWidth", "100px");
                    }

                    imLayout(c, ROW); imListRowCellStyle(c); imAlign(c); imJustify(c); {
                        imB(c); imStr(c, "Note Tree v" + VERSION_NUMBER); imBEnd(c); 
                    } imLayoutEnd(c);

                    imLayout(c, ROW); imListRowCellStyle(c); imAlign(c); imJustify(c); {
                        imB(c); imStr(c, "Settings"); imBEnd(c); 
                    } imLayoutEnd(c);

                    let vSc = imGet(c, newScrollContainer);
                    if (!vSc) vSc = imSet(c, newScrollContainer());

                    const hasFocus = viewHasFocus && !s.mainListHasFocus;
                    const hallwayList = imNavListBegin(c, vSc, vPos.idx, hasFocus, false); {
                        while (imNavListNextItemArray(hallwayList, menus)) {
                            const menu = menus[hallwayList.i];
                            if (hallwayList.itemSelected) {
                                s.selectedMenu = menu;
                            }
                            imNavListRowBegin(c, hallwayList); {
                                imLayout(c, BLOCK); imListRowCellStyle(c); {
                                    imB(c); imStr(c, menu.name); imBEnd(c);
                                } imLayoutEnd(c);
                            } imNavListRowEnd(c);
                        }

                        if (hasFocus) {
                            const vListInput = getNavigableListInput(ctx, vPos.idx, 0, hallwayList.i);
                            if (vListInput) vPos.idx = vListInput.newIdx;

                            if (
                                s.selectedMenu && (
                                    (
                                        hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, "Go to " + s.selectedMenu.name, SHIFT) ||
                                        hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, "Go to " + s.selectedMenu.name)
                                    ) ||
                                    hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Go to " + s.selectedMenu.name)
                                )
                            ) {
                                s.mainListHasFocus = true;
                            }
                        }
                    } imNavListEnd(c, hallwayList);

                } imLayoutEnd(c);

                imLayout(c, BLOCK); imSize(c, 10, PX, 0, NA); imLayoutEnd(c);

                imLayout(c, COL); imFlex(c); {
                    if (isFirstishRender(c)) {
                        elSetStyle(c, "width", "800px");
                    }

                    imLayout(c, ROW); imAlign(c); imJustify(c); {
                        imAppHeadingBegin(c); {
                            let text = "Settings";

                            if (s.selectedMenu) {
                                text = s.selectedMenu.desc;
                            }

                            imStr(c, text);
                        } imAppHeadingEnd(c);
                    } imLayoutEnd(c);

                    const mainListHasFocus = viewHasFocus && s.mainListHasFocus;

                    imSwitch(c, s.selectedMenu); 
                    if (s.selectedMenu) s.selectedMenu.imComponent(c, ctx, s, mainListHasFocus);
                    imSwitchEnd(c);

                    if (mainListHasFocus) {
                        if (
                            hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Back to hallway") ||
                            hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, "Back to hallway", SHIFT) ||
                            hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, "Back to hallway") 
                        ) {
                            s.mainListHasFocus = false;
                        }
                    }
                } imLayoutEnd(c);
            } imLayoutEnd(c);
        } imLayoutEnd(c);
    } imLayoutEnd(c);
}
