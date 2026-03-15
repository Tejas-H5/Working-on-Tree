import { imAppHeadingBegin, imAppHeadingEnd } from "src/app-components/app-heading";
import {
    addView,
    getNavigableListInput,
    getTabInput,
    imNavListBegin,
    imNavListEnd,
    imNavListNextItem,
    imNavListNextItemArray,
    imNavListRowBegin,
    imNavListRowEnd,
    imViewsList,
    newFocusRef,
    newListPosition
} from "src/app-components/navigable-list";
import { cssVarsApp } from "src/app-styling";
import { imui, BLOCK, ROW, COL, PX, NA, PERCENT, STRETCH } from "src/utils/im-js/im-ui";
import { imB, imBEnd, imI, imIEnd } from "src/components/core/text";
import { newScrollContainer, } from "src/components/scroll-container";
import {
    debouncedSave,
    GlobalContext,
    hasDiscoverableCommand,
    saveCurrentState,
    setCurrentView,
    SHIFT
} from "src/global-context";
import {
    getCurrentStateAsJSON,
    getLastActivity,
    loadStateFromJSON,
    LoadStateFromJSONResult,
    resetState,
    setState,
    state
} from "src/state";
import { arrayAt } from "src/utils/array-utils";
import { formatDateTime } from "src/utils/datetime";
import { downloadTextAsFile, loadFile } from "src/utils/file-download";
import { im, ImCache, imdom, el, ev, } from "src/utils/im-js";

import { VERSION_NUMBER } from "src/version-number";
import { imListRowBegin, imListRowCellStyle, imListRowEnd } from "src/app-components/list-row";

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
        imComponent: (c, ctx, _s, hasFocus) => {
            imui.Begin(c, COL); imui.Flex(c); {
                imui.Begin(c, COL); imui.Flex(c); imui.Align(c); imui.Justify(c); {
                    // TODO: tab stop, tabs vs spaces, all on multiple lines -> parents on one line -> all on one line except selection

                    let vSc = im.Get(c, newScrollContainer);
                    if (!vSc) vSc = im.Set(c, newScrollContainer());

                    let vPos = im.Get(c, newListPosition);
                    if (!vPos) vPos = im.Set(c, newListPosition());

                    const settings = state.settings;

                    const itemList = imNavListBegin(c, vSc, vPos.idx, hasFocus, false); {
                        imNavListNextItem(itemList); {
                            imNavListRowBegin(c, itemList, false, false); {
                                imui.Begin(c, ROW); imListRowCellStyle(c); {
                                    imB(c); imdom.Str(c, "Spaces or tabs?"); imBEnd(c);

                                    imui.Begin(c, BLOCK); imui.Size(c, 20, PX, 0, NA); imui.End(c);

                                    // nonEditingNotesOnOneLine: boolean;
                                    // parentNotesOnOneLine: boolean;
                                    // tabStopSize: number;

                                    imdom.Str(c, settings.spacesInsteadOfTabs ? "Spaces" : "Tabs");

                                } imui.End(c);
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

                            imNavListRowBegin(c, itemList, false, false); {
                                imui.Begin(c, ROW); imListRowCellStyle(c); {
                                    if (im.isFirstishRender(c)) {
                                        imdom.setStyle(c, "whiteSpace", "pre-wrap");
                                    }

                                    imB(c); imdom.Str(c, "Tab width"); imBEnd(c);

                                    imui.Begin(c, BLOCK); imui.Size(c, 20, PX, 0, NA); imui.End(c);

                                    imdom.Str(c, canNarrow ? "< " : "  ");
                                    imdom.Str(c, settings.tabStopSize);
                                    imdom.Str(c, " ".repeat(settings.tabStopSize));
                                    imdom.Str(c, canWiden ? ">" : "|");
                                } imui.End(c);
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
                } imui.End(c);
            } imui.End(c);
        }
    },
    {
        name: "Download JSON",
        desc: "Export your data to a JSON file to import later/elsewhere",
        imComponent: (c, ctx, _s, hasFocus) => {
            imui.Begin(c, COL); imui.Flex(c); {
                // NOTE: Don't want the export view to look similar to the import view. need to avoid action capture.
                imui.Begin(c, COL); imui.Flex(c); imui.Align(c); imui.Justify(c); {
                    let errRef; errRef = im.GetInline(c, im.Try)
                    if (!errRef) errRef = im.Set(c, { val: null as any });

                    if (im.If(c) && !errRef.val) {
                        imui.Begin(c, BLOCK); imListRowCellStyle(c); imB(c); imdom.Str(c, state.notes.nodes.length + " notes"); imBEnd(c); imui.End(c);
                        imui.Begin(c, BLOCK); imListRowCellStyle(c); imB(c); imdom.Str(c, state.activities.length + " activities"); imBEnd(c); imui.End(c);

                        imListRowBegin(c, true, hasFocus, false); {
                            imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                                imdom.ElBegin(c, el.B); imdom.Str(c, "Download JSON"); imdom.ElEnd(c, el.B); 
                            } imui.End(c);
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
                        im.IfElse(c);

                        imui.Begin(c, BLOCK); imdom.Str(c, "An error occured: " + errRef.val); imui.End(c);

                        if (hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Dismiss")) {
                            errRef.val = null;
                        }
                    } im.IfEnd(c);
                } imui.End(c);
            } imui.End(c);
        }
    },
    {
        name: "Load from JSON",
        desc: "Import your data from a JSON file you exported",
        imComponent: (c, ctx, _s, hasFocus) => {
            imui.Begin(c, COL); imui.Flex(c); {
                imui.Begin(c, COL); imui.Flex(c); imui.Align(c); imui.Justify(c); {
                    let importModalState = im.Get(c, importModal);
                    if (!importModalState) importModalState = im.Set(c, importModal());

                    if (im.Memo(c, true)) {
                        resetImportModal(importModalState);
                    }

                    const loadResult = importModalState.state;
                    if (im.If(c) && loadResult) {
                        let current = im.Get(c, newFocusRef);
                        if (!current) current = im.Set(c, newFocusRef());
                        const navList = imViewsList(c, current);

                        imui.Begin(c, BLOCK); {
                            const loadedState = loadResult.state;
                            if (im.If(c) && loadedState) {
                                const lastOnline = getLastActivity(loadedState)?.t;

                                imui.Begin(c, ROW); imui.Justify(c); {
                                    imB(c); imdom.Str(c, "Make sure this looks reasonable before you load the backup"); imBEnd(c); 
                                } imui.End(c);

                                imui.Begin(c, BLOCK); imui.Size(c, 0, NA, 30, PX); imui.End(c);

                                imui.Begin(c, BLOCK); {
                                    imB(c); imdom.Str(c, "Filename: "); imBEnd(c);
                                    imdom.Str(c, importModalState.filename); 
                                } imui.End(c);
                                imui.Begin(c, BLOCK); {
                                    imB(c); imdom.Str(c, "Notes: "); imBEnd(c);
                                    imdom.Str(c, loadedState.notes.nodes.length);
                                } imui.End(c);
                                imui.Begin(c, BLOCK); {
                                    imB(c); imdom.Str(c, "Activities: "); imBEnd(c); 
                                    imdom.Str(c, loadedState.activities.length); 
                                } imui.End(c);
                                imui.Begin(c, BLOCK); {
                                    imB(c); imdom.Str(c, "Last Online: "); imBEnd(c);
                                    imdom.Str(c, !lastOnline ? "No idea" : formatDateTime(lastOnline));
                                } imui.End(c);
                                imui.Begin(c, BLOCK); {
                                    imB(c); imdom.Str(c, "Last Theme: "); imBEnd(c); 
                                    imdom.Str(c, loadedState.currentTheme);
                                } imui.End(c);

                                imui.Begin(c, BLOCK); imui.Size(c, 0, NA, 30, PX); imui.End(c);

                                imui.Begin(c, ROW); imui.Gap(c, 50, PX); {
                                    addView(navList, 0, "Accept button"); {
                                        const focused = current.focused === 0;
                                        imListRowBegin(c, focused, focused && hasFocus, false); {
                                            imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                                                imB(c); imdom.Str(c, "Accept"); imBEnd(c); 
                                            } imui.End(c);
                                        } imListRowEnd(c);

                                        if (
                                            focused &&
                                            hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Reject")
                                        ) {
                                            importModalState.acceptPresses++;
                                            if (importModalState.acceptPresses >= REQUIRED_PRESSES && !importModalState.imported) {
                                                setState(loadedState);
                                                saveCurrentState(ctx, state, { debounced: false, where: "Backup import" });
                                                setCurrentView(ctx, ctx.views.noteTree);
                                            }
                                        }
                                    }

                                    addView(navList, 1, "Reject button"); {
                                        const focused = current.focused === 1;
                                        imListRowBegin(c, focused, focused && hasFocus, false); {
                                            imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                                                imB(c); imdom.Str(c, "Reject"); imBEnd(c);
                                            } imui.End(c);
                                        } imListRowEnd(c);

                                        if (
                                            focused &&
                                            hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Reject")
                                        ) {
                                            resetImportModal(importModalState);
                                        }
                                    }
                                } imui.End(c);

                                if (im.If(c) && importModalState.acceptPresses > 0) {
                                    imui.Begin(c, BLOCK); imB(c); imListRowCellStyle(c); imdom.Str(c, "Your existing data will be wiped and replaced with this new state"); imBEnd(c); imui.End(c);

                                    imui.Begin(c, ROW); imui.Gap(c, 10, PX); imui.Size(c, 100, PERCENT, 30, PX); imui.Align(c, STRETCH); {
                                        const countChanged = im.Memo(c, importModalState.acceptPresses);

                                        const col = "rgb(0, 255, 20)";

                                        im.For(c); for (let i = 0; i < REQUIRED_PRESSES; i++) {
                                            imui.Begin(c, BLOCK); imui.Flex(c); {
                                                if (countChanged) {
                                                    imdom.setStyle(
                                                        c,
                                                        "backgroundColor",
                                                        importModalState.acceptPresses >= REQUIRED_PRESSES ? col
                                                            : importModalState.acceptPresses > i ? cssVarsApp.fgColor
                                                                : ""
                                                    );
                                                }
                                            } imui.End(c);
                                        } im.ForEnd(c);
                                    } imui.End(c);
                                } im.IfEnd(c);
                            } else {
                                im.IfElse(c);

                                imui.Begin(c, BLOCK); {
                                    imui.Begin(c, BLOCK); imB(c); imdom.Str(c, "An error occured while loading the file. It cannot be imported."); imBEnd(c); imui.End(c);
                                    imui.Begin(c, BLOCK); imdom.Str(c, loadResult.error ?? loadResult.criticalError ?? "unknown error"); imui.End(c);
                                } imui.End(c);

                                addView(navList, 0, "Back button"); {
                                    const focused = current.focused === 0;
                                    imListRowBegin(c, focused, hasFocus && focused, false); {
                                        imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                                            imB(c); imdom.Str(c, "Back");  imBEnd(c);
                                        } imui.End(c);
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
                            } im.IfEnd(c);
                        } imui.End(c);


                        // navigate the buttons
                        // TODO: make fn
                        {
                            const prev = arrayAt(navList.views, navList.idx - 1);
                            const next = arrayAt(navList.views, navList.idx + 1);
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
                        im.IfElse(c);

                        imListRowBegin(c, true, hasFocus, false); {
                            imui.Begin(c, BLOCK); imListRowCellStyle(c); imB(c); imdom.Str(c, "Import JSON"); imBEnd(c); imui.End(c);
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
                    } im.IfEnd(c);
                } imui.End(c);
            } imui.End(c);
        }
    },
    // I'm not sure why you would ever want to do this in practice.
    // Like. Why would I ever delete my years worth of notes? Doesn't make any sense.
    // It's great for development tho.
    // Maybe for when you're moving computers or something, and you don't want to leave any data in the database?.
    {
        name: "Clear",
        desc: "Clear all your data, and start fresh",
        imComponent: (c, ctx, _s, hasFocus) => {
            imui.Begin(c, COL); imui.Flex(c); {
                imui.Begin(c, COL); imui.Flex(c); imui.Align(c); imui.Justify(c); {
                    imui.Begin(c, BLOCK); imui.Size(c, 0, NA, 50, PX); imui.End(c);

                    imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                        imB(c); {
                            imdom.Str(c, "Be sure to download your JSON"); imI(c); imdom.Str(c, " before "); imIEnd(c); imdom.Str(c, "you do this."); 
                        } imBEnd(c);
                    } imui.End(c);

                    imui.Begin(c, BLOCK); imui.Size(c, 0, NA, 50, PX); imui.End(c);

                    // bruh... 

                    const focusChanged = im.Memo(c, hasFocus)
                    let clearDataState; clearDataState = im.GetInline(c, imui.End);
                    if (!clearDataState || focusChanged) clearDataState = im.Set(c, {
                        count: 0,
                        wiped: false,
                    });

                    const countChanged = im.Memo(c, clearDataState.count);

                    imListRowBegin(c, true, hasFocus, false); {
                        imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                            if (im.isFirstishRender(c)) {
                                imdom.setStyle(c, "fontSize", "30px");
                            }

                            const col = clearDataState.count < REQUIRED_PRESSES ? "red" : "white";
                            imdom.setStyle(c, "color", col);

                            imB(c); {
                                imdom.Str(c, "Delete all data"); 
                            } imBEnd(c);

                            imui.Begin(c, ROW); imui.Gap(c, 10, PX); imui.Size(c, 100, PERCENT, 30, PX); imui.Align(c, STRETCH); {
                                im.For(c); for (let i = 0; i < REQUIRED_PRESSES; i++) {
                                    imui.Begin(c, BLOCK); imui.Flex(c); { 
                                        if (countChanged) {
                                            imdom.setStyle(
                                                c,
                                                "backgroundColor",
                                                clearDataState.count >= REQUIRED_PRESSES ? col
                                                    : clearDataState.count > i ? cssVarsApp.fgColor
                                                        : ""
                                            );
                                        }
                                    } imui.End(c);
                                } im.ForEnd(c);
                            } imui.End(c);
                        } imui.End(c);

                        if (hasFocus) {
                            if (hasDiscoverableCommand(ctx, ctx.keyboard.enterKey, "Delete all data")) {
                                clearDataState.count++;
                            }
                        }
                    } imListRowEnd(c);

                    imui.Begin(c, BLOCK); imui.Size(c, 0, NA, 50, PX); imui.End(c);

                    if (im.If(c) && clearDataState.count >= REQUIRED_PRESSES) {
                        const REQUIRED_TIME_SECONDS = 1;

                        const focusChanged = im.Memo(c, hasFocus);

                        let timer = im.Get(c, Math.sin);
                        if (timer === undefined || focusChanged) {
                            timer = im.Set(c, 0);
                        }
                        timer = im.Set(c, timer + im.getDeltaTimeSeconds(c));

                        imui.Begin(c, BLOCK); {
                            if (im.isFirstishRender(c)) {
                                imdom.setStyle(c, "fontSize", "30px");
                                imdom.setStyle(c, "color", "red");
                            }

                            imB(c); {
                                imdom.Str(c, "SYSTEM WIPE IMMINENT"); 
                            } imBEnd(c);

                            imui.Begin(c, ROW); imui.Align(c, STRETCH); imui.Size(c, 100, PERCENT, 30, PX); {
                                imui.Begin(c, BLOCK); {
                                    imdom.setStyle(c, "width", ((timer / REQUIRED_TIME_SECONDS) * 100) + "%");
                                    imdom.setStyle(c, "backgroundColor", "red");
                                } imui.End(c);
                            } imui.End(c);

                        } imui.End(c);

                        if ((timer / REQUIRED_TIME_SECONDS) > 1 && !clearDataState.wiped) {
                            clearDataState.wiped = true;

                            resetState();

                            setCurrentView(ctx, null);

                            setTimeout(() => {
                                setCurrentView(ctx, ctx.views.noteTree);
                            }, 1000);
                        }
                    } im.IfEnd(c);
                } imui.End(c);
            } imui.End(c);
        }
    },
];

export function imSettingsView(c: ImCache, ctx: GlobalContext, s: SettingsViewState) {
    const viewHasFocus = ctx.currentView === s;
    let vPos = im.Get(c, newListPosition);
    if (!vPos) vPos = im.Set(c, newListPosition());

    if (im.Memo(c, viewHasFocus) && viewHasFocus) {
        vPos.idx = 0;
        s.mainListHasFocus = false;
    }

    imui.Begin(c, COL); imui.Flex(c); {
        imui.Begin(c, COL); imui.Align(c); imui.Flex(c); {
            imui.Begin(c, ROW); imui.Size(c, 0, NA, 100, PERCENT); {
                imui.Begin(c, COL);  {
                    if (im.isFirstishRender(c)) {
                        imdom.setStyle(c, "minWidth", "100px");
                    }

                    imui.Begin(c, ROW); imListRowCellStyle(c); imui.Align(c); imui.Justify(c); {
                        imB(c); imdom.Str(c, "Note Tree v" + VERSION_NUMBER); imBEnd(c); 
                    } imui.End(c);

                    imui.Begin(c, ROW); imListRowCellStyle(c); imui.Align(c); imui.Justify(c); {
                        imB(c); imdom.Str(c, "Settings"); imBEnd(c); 
                    } imui.End(c);

                    let vSc = im.Get(c, newScrollContainer);
                    if (!vSc) vSc = im.Set(c, newScrollContainer());

                    const hasFocus = viewHasFocus && !s.mainListHasFocus;
                    const hallwayList = imNavListBegin(c, vSc, vPos.idx, hasFocus, false); {
                        im.For(c); while (imNavListNextItemArray(hallwayList, menus)) {
                            const menu = menus[hallwayList.i];
                            if (hallwayList.itemSelected) {
                                s.selectedMenu = menu;
                            }
                            imNavListRowBegin(c, hallwayList, false, false); {
                                imui.Begin(c, BLOCK); imListRowCellStyle(c); {
                                    imB(c); imdom.Str(c, menu.name); imBEnd(c);
                                } imui.End(c);
                            } imNavListRowEnd(c);
                        } im.ForEnd(c);

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

                } imui.End(c);

                imui.Begin(c, BLOCK); imui.Size(c, 10, PX, 0, NA); imui.End(c);

                imui.Begin(c, COL); imui.Flex(c); {
                    if (im.isFirstishRender(c)) {
                        imdom.setStyle(c, "width", "800px");
                    }

                    imui.Begin(c, ROW); imui.Align(c); imui.Justify(c); {
                        imAppHeadingBegin(c); {
                            let text = "Settings";

                            if (s.selectedMenu) {
                                text = s.selectedMenu.desc;
                            }

                            imdom.Str(c, text);
                        } imAppHeadingEnd(c);
                    } imui.End(c);

                    const mainListHasFocus = viewHasFocus && s.mainListHasFocus;

                    im.Switch(c, s.selectedMenu); 
                    if (s.selectedMenu) s.selectedMenu.imComponent(c, ctx, s, mainListHasFocus);
                    im.SwitchEnd(c);

                    if (mainListHasFocus) {
                        if (
                            hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Back to hallway") ||
                            hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, "Back to hallway", SHIFT) ||
                            hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, "Back to hallway") 
                        ) {
                            s.mainListHasFocus = false;
                        }
                    }
                } imui.End(c);
            } imui.End(c);
        } imui.End(c);
    } imui.End(c);
}
