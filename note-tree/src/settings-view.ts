import { imBeginAppHeading, imBold } from "./app-heading";
import { cssVarsApp } from "./app-styling";
import { COL, imAlign, imBegin, imFlex, imGap, imJustify, imSize, NA, PERCENT, PX, ROW, STRETCH } from "./components/core/layout";
import { imB, imI, imStr } from "./components/core/text";
import { newScrollContainer, } from "./components/scroll-container";
import { GlobalContext, hasDiscoverableCommand, saveCurrentState, SHIFT } from "./global-context";
import { imBeginListRow, imEndListRow, imListRowCellStyle } from "./list-row";
import {
    addView,
    getNavigableListInput,
    getTabInput,
    imBeginNavList,
    imBeginNavListRow,
    imEndNavList,
    imEndNavListRow,
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
    getCurrentRoot,
    getDeltaTimeSeconds,
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imEndSwitch,
    imFor,
    imIf,
    imIsFirstishRender,
    imMemo,
    imNextListRoot,
    imRef,
    imState,
    imSwitch,
    newBoolean,
    newNumber,
    setStyle,
    setText
} from "./utils/im-dom-utils";


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
    imComponent: (ctx: GlobalContext, s: SettingsViewState, hasFocus: boolean) => void;
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
        name: "Download JSON",
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
        name: "Load from JSON",
        desc: "Import your data from a JSON file you exported",
        imComponent: (ctx, s, hasFocus) => {
            imBegin(COL); imFlex(); {
                imBegin(COL); imFlex(); imAlign(); imJustify(); {
                    const importModalState = imState(importModal);

                    if (imMemo(hasFocus)) {
                        resetImportModal(importModalState);
                    }

                    const loadResult = importModalState.state;
                    if (imIf() && loadResult) {
                        const current = imState(newFocusRef);
                        const navList = imViewsList(current);

                        imBegin(); {
                            const loadedState = loadResult.state;
                            if (imIf() && loadedState) {
                                const lastOnline = parseDateSafe(loadedState.breakAutoInsertLastPolledTime);

                                imBegin(ROW); {
                                    imB(); imJustify(); imStr("Make sure this looks reasonable before you load the backup"); imEnd(); 
                                } imEnd();

                                imBegin(); imSize(0, NA, 30, PX); imEnd();

                                imBegin(); {
                                    imB(); imStr("Filename: "); imEnd(); imStr(importModalState.filename);
                                } imEnd();
                                imBegin(); imB(); imStr("Notes: "); imEnd(); imStr(loadedState.notes.nodes.length); imEnd();
                                imBegin(); imB(); imStr("Activities: "); imEnd(); imStr(loadedState.activities.length); imEnd();
                                imBegin(); imB(); imStr("Last Online: "); imEnd(); imStr(!lastOnline ? "No idea" : formatDateTime(lastOnline)); imEnd();
                                imBegin(); imB(); imStr("Last Theme: "); imEnd(); imStr(loadedState.currentTheme); imEnd();

                                imBegin(); imSize(0, NA, 30, PX); imEnd();

                                imBegin(ROW); imGap(50, PX); {
                                    addView(navList, 0, "Accept button"); {
                                        const focused = current.focused === 0;
                                        imBeginListRow(focused, focused && hasFocus, false); {
                                            imBegin(); imBold(); imListRowCellStyle(); setText("Accept"); imEnd();
                                        } imEndListRow();

                                        if (
                                            focused &&
                                            hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Reject")
                                        ) {
                                            importModalState.acceptPresses++;
                                            if (importModalState.acceptPresses >= REQUIRED_PRESSES && !importModalState.imported) {
                                                setState(loadedState);
                                                saveCurrentState(ctx, state, { debounced: false });
                                                ctx.currentView = ctx.views.noteTree;
                                            }
                                        }
                                    }

                                    addView(navList, 1, "Reject button"); {
                                        const focused = current.focused === 1;
                                        imBeginListRow(focused, focused && hasFocus, false); {
                                            imBegin(); imBold(); imListRowCellStyle(); setText("Reject"); imEnd();
                                        } imEndListRow();

                                        if (
                                            focused &&
                                            hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Reject")
                                        ) {
                                            resetImportModal(importModalState);
                                        }
                                    }
                                } imEnd();

                                if (imIf() && importModalState.acceptPresses > 0) {
                                    imBegin(); imB(); imListRowCellStyle(); setText("Your existing data will be wiped and replaced with this new state"); imEnd(); imEnd();

                                    imBegin(ROW); imGap(10, PX); imSize(100, PERCENT, 30, PX); imAlign(STRETCH); {
                                        const countChanged = imMemo(importModalState.acceptPresses);

                                        const col = "rgb(0, 255, 20)";

                                        imFor(); for (let i = 0; i < REQUIRED_PRESSES; i++) {
                                            imNextListRoot();
                                            imBegin(); imFlex(); {
                                                if (countChanged) {
                                                    setStyle(
                                                        "backgroundColor",
                                                        importModalState.acceptPresses >= REQUIRED_PRESSES ? col
                                                            : importModalState.acceptPresses > i ? cssVarsApp.fgColor
                                                                : ""
                                                    );
                                                }
                                            } imEnd();
                                        } imEndFor();
                                    } imEnd();
                                } imEndIf();
                            } else {
                                imElse();

                                imBegin(); {
                                    imBegin(); imB(); imStr("An error occured while loading the file. It cannot be imported."); imEnd(); imEnd();
                                    imBegin(); imStr(loadResult.error ?? loadResult.criticalError ?? "unknown error"); imEnd();
                                } imEnd();

                                addView(navList, 0, "Back button"); {
                                    const focused = current.focused === 0;
                                    imBeginListRow(focused, hasFocus && focused, false); {
                                        imBegin(); imBold(); imListRowCellStyle(); setText("Back"); imEnd();
                                    } imEndListRow();
                                    if (hasFocus && focused) {
                                        if (
                                            hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Back") ||
                                            hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Back")
                                        ) {
                                            resetImportModal(importModalState);
                                        }
                                    }
                                }
                            } imEndIf();
                        } imEnd();


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
                        imElse();

                        imBeginListRow(true, hasFocus, false); {
                            imBegin(); imBold(); imListRowCellStyle(); setText("Import JSON"); imEnd();
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
                        } imEndListRow();
                    } imEndIf();
                } imEnd();
            } imEnd();
        }
    },
    // I'm not sure why you would ever want to do this in practice.
    // Like. Why would I ever delete my years worth of notes? Doesn't make any sense.
    // It's great for development tho.
    // Maybe for when you're moving computers or something, and you don't want to leave any data in the database?.
    {
        name: "Clear",
        desc: "Clear all your data, and start fresh",
        imComponent: (ctx, s, hasFocus) => {
            imBegin(COL); imFlex(); {
                imBegin(COL); imFlex(); imAlign(); imJustify(); {
                    imBegin(); imSize(0, NA, 50, PX); imEnd();

                    imBegin(); imListRowCellStyle(); {
                        imB(); imStr("Be sure to download your JSON"); imI(); imStr(" before "); imEnd(); imStr("you do this."); imEnd();
                    } imEnd();

                    imBegin(); imSize(0, NA, 50, PX); imEnd();

                    // bruh... 

                    const countRef = imState(newNumber);
                    const countChanged = imMemo(countRef.val);
                    const wiped = imState(newBoolean);

                    if (imMemo(hasFocus)) {
                        countRef.val = 0;
                        wiped.val = false;
                    }

                    imBeginListRow(true, hasFocus, false); {
                        imBegin(); imBold(); imListRowCellStyle(); {
                            if (imIsFirstishRender()) {
                                setStyle("fontSize", "30px");
                            }

                            const col = countRef.val < REQUIRED_PRESSES ? "red" : "white";
                            setStyle("color", col);

                            imStr("Delete all data"); 

                            imBegin(ROW); imGap(10, PX); imSize(100, PERCENT, 30, PX); imAlign(STRETCH); {
                                imFor(); for (let i = 0; i < REQUIRED_PRESSES; i++) {
                                    imNextListRoot();
                                    imBegin(); imFlex(); { 
                                        if (countChanged) {
                                            setStyle(
                                                "backgroundColor",
                                                countRef.val >= REQUIRED_PRESSES ? col
                                                    : countRef.val > i ? cssVarsApp.fgColor
                                                        : ""
                                            );
                                        }
                                    } imEnd();
                                } imEndFor();
                            } imEnd();
                        } imEnd();

                        if (hasFocus) {
                            if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Delete all data")) {
                                countRef.val++;
                            }
                        }
                    } imEndListRow();

                    imBegin(); imSize(0, NA, 50, PX); imEnd();

                    if (imIf() && countRef.val >= REQUIRED_PRESSES) {
                        const REQUIRED_TIME_SECONDS = 1;

                        const timerRef = imState(newNumber);
                        timerRef.val += getDeltaTimeSeconds();

                        getCurrentRoot().debug = true;

                        if (imMemo(hasFocus)) {
                            timerRef.val = 0;
                        }

                        imBegin(); imBold(); {


                            if (imIsFirstishRender()) {
                                setStyle("fontSize", "30px");
                                setStyle("color", "red");
                            }

                            imStr("SYSTEM WIPE IMMINENT"); 

                            imBegin(ROW); imAlign(STRETCH); imSize(100, PERCENT, 30, PX); {
                                imBegin(); {
                                    setStyle("width", ((timerRef.val / REQUIRED_TIME_SECONDS) * 100) + "%");
                                    setStyle("backgroundColor", "red");
                                } imEnd();
                            } imEnd();

                        } imEnd();

                        if ((timerRef.val / REQUIRED_TIME_SECONDS) > 1 && !wiped.val) {
                            wiped.val = true;

                            resetState();

                            ctx.noteBeforeFocus = null;

                            setTimeout(() => {
                                ctx.currentView = ctx.views.noteTree;
                            }, 1000);
                        }
                    } imEndIf();
                } imEnd();
            } imEnd();
        }
    },
];

export function imSettingsView(ctx: GlobalContext, s: SettingsViewState) {
    const viewHasFocus = ctx.currentView === s;
    const vPos = imState(newListPosition);

    if (imMemo(viewHasFocus) && viewHasFocus) {
        vPos.idx = 0;
        s.mainListHasFocus = false;
    }

    imBegin(COL); imFlex(); {
        imBegin(COL); imAlign(); imFlex(); {
            imBegin(ROW); {
                imBegin(COL); {
                    if (imIsFirstishRender()) {
                        setStyle("minWidth", "100px");
                    }

                    imBegin(ROW); imListRowCellStyle(); imAlign(); imJustify(); {
                        imB(); imStr("Settings"); imEnd(); 
                    } imEnd();

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
                    } imEndNavList(hallwayList);
                } imEnd();

                imBegin(); imSize(10, PX, 0, NA); imEnd();

                imBegin(COL); imFlex(); {
                    if (imIsFirstishRender()) {
                        setStyle("width", "800px");
                    }

                    imBegin(ROW); imAlign(); imJustify(); {
                        imBeginAppHeading(); {
                            let text = "Settings";

                            if (s.selectedMenu) {
                                text = s.selectedMenu.desc;
                            }

                            setText(text);
                        } imEnd();
                    } imEnd();

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
