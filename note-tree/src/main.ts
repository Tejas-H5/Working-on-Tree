import { activitiesViewTakeBreak, imActivitiesList } from "./activities-list";
import { imLine } from "./app-components/common";
import { imBeginAppHeading } from "./app-heading";
import { cssVarsApp } from "./app-styling";
import { imTimerRepeat } from "./app-utils/timer";
import { imAsciiIcon } from "./ascii-icon";
import { ASCII_MOON_STARS, ASCII_SUN } from "./assets/icons";
import {
    CENTER,
    CH,
    COL,
    imAlign,
    imBegin,
    imFixed,
    imFlex,
    imGap,
    imJustify,
    imSize,
    NA,
    PX,
    RIGHT,
    ROW
} from "./components/core/layout";
import { imStr } from "./components/core/text";
import {
    imFpsCounterOutputCompact,
    imFpsCounterOutputVerbose,
    newFpsCounterState,
    startFpsCounter,
    stopFpsCounter
} from "./components/fps-counter";
import { imFuzzyFinder } from "./fuzzy-finder";
import {
    BYPASS_TEXT_AREA,
    CTRL,
    debouncedSave,
    handleImKeysInput,
    hasDiscoverableCommand,
    TASK_IN_PROGRESS,
    newGlobalContext,
    preventImKeysDefault,
    SHIFT,
    updateDiscoverableCommands
} from "./global-context";
import { imNoteTraversal } from "./lateral-traversal";
import { addView, getTabInput, imViewsList, newFocusRef } from "./navigable-list";
import { imNoteTreeView } from "./note-tree-view";
import { imSettingsView } from "./settings-view";
import {
    applyPendingScratchpadWrites,
    AppTheme,
    getActivityTime,
    getLastActivity,
    getNoteOrUndefined,
    loadState,
    newBreakActivity,
    pushBreakActivity,
    saveState,
    setCurrentNote,
    setTheme,
    state
} from "./state";
import { imUrlViewer } from "./url-viewer";
import { getWrapped } from "./utils/array-utils";
import { initCssbStyles } from "./utils/cssb";
import { formatDateTime, getTimestamp, parseDateSafe } from "./utils/datetime";
import {
    elementHasMousePress,
    getDeltaTimeSeconds,
    getImKeys,
    HORIZONTAL,
    imCatch,
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imEndSwitch,
    imEndTry,
    imFor,
    imIf,
    imInit,
    imIsFirstishRender,
    imMemo,
    imMemoMany,
    imNextListRoot,
    imRef,
    imState,
    imSwitch,
    imTry,
    initImDomUtils,
    isEditingTextSomewhereInDocument,
    MEMO_CHANGED,
    newBoolean,
    newNumber,
    setStyle,
    setText,
    VERTICAL
} from "./utils/im-dom-utils";
import { logTrace } from "./utils/log";
import { bytesToMegabytes, utf8ByteLength } from "./utils/utf8";
import { newWebWorker } from "./utils/web-workers";
import { VERSION_NUMBER } from "./version-number";

const ERROR_TIMEOUT_TIME = 5000;

// TODO: expose via UI
console.log("Note tree v" + VERSION_NUMBER);

// Used by webworker and normal code
export const CHECK_INTERVAL_MS = 30000 * 10;


function getIcon(theme: AppTheme) {
    if (theme === "Light") return ASCII_SUN;
    if (theme === "Dark") return ASCII_MOON_STARS;
    return ASCII_MOON_STARS;
}


function imMain() {
    const fpsCounter = imState(newFpsCounterState);
    const ctx = imState(newGlobalContext);

    if (!ctx.leftTab) ctx.leftTab = ctx.views.activities;
    if (!ctx.currentView) ctx.currentView = ctx.views.settings;

    ctx.now = new Date();

    const errorRef = imRef();
    const framesSinceError = imState(newNumber);
    const irrecoverableErrorRef = imState(newBoolean);


    if (imInit()) {
        // some side-effects

        // NOTE: Running this setInterval in a web worker is far more reliable that running it in a normal setInterval, which is frequently 
        // throttled in the browser for many random reasons in my experience. However, web workers seem to only stop when a user closes their computer, or 
        // closes the tab, which is what we want here
        const worker = newWebWorker([CHECK_INTERVAL_MS], (checkIntervalMs: number) => {
            let started = false;
            setInterval(() => {
                postMessage("is-open-check");

                if (!started) {
                    started = true;
                    // logTrace isn't dfined inside of web workers, so using console.log instead
                    console.log("Web worker successfuly started! This page can now auto-insert breaks if you've closed this tab for extended periods of time");
                }
            }, checkIntervalMs);
        });
        worker.onmessage = () => {
            autoInsertBreakIfRequired();
        };
        worker.onerror = (e) => {
            console.error("Webworker error: ", e);
        }

        // NOTE: there may be a problem with this mechanism, although I'm not sure what it is.
        function autoInsertBreakIfRequired() {
            // This function is run inside of a setInterval that runs every CHECK_INTERVAL_MS, and when the 
            // webpage opens for the first time.
            // It may or may not need to be called more or less often, depending on what we add.

            // Need to automatically add breaks if we haven't called this method in a while.
            const time = new Date();
            const lastCheckTime = parseDateSafe(state.breakAutoInsertLastPolledTime);

            if (
                !!lastCheckTime &&
                (time.getTime() - lastCheckTime.getTime()) > CHECK_INTERVAL_MS * 2
            ) {
                // If this javascript was running, i.e the computer was open constantly, this code should never run.
                // So, we can insert a break now, if we aren't already taking one. 
                // This should solve the problem of me constantly forgetting to add breaks...
                const lastActivity = getLastActivity(state);
                const time = !lastActivity ? lastCheckTime.getTime() :
                    Math.max(lastCheckTime.getTime(), getActivityTime(lastActivity).getTime());

                pushBreakActivity(state, newBreakActivity("Auto-inserted break", new Date(time), true));
            }

            state.breakAutoInsertLastPolledTime = getTimestamp(time);
            debouncedSave(ctx, state);
        }
    }

    const l = imTry(); try {
        if (imIf() && !irrecoverableErrorRef.val) {
            handleImKeysInput(ctx);

            if (MEMO_CHANGED === imMemoMany(
                state._notesMutationCounter,
                state._activitiesMutationCounter
            )) {
                debouncedSave(ctx, state);
            }

            startFpsCounter(fpsCounter); {
                imBegin(COL); imFixed(0, 0, 0, 0); {
                    const error = state.criticalSavingError || state._criticalLoadingError;
                    if (imIf() && error) {
                        imBegin(); {
                            if (imIsFirstishRender()) {
                                setStyle("color", "white");
                                setStyle("backgroundColor", "red");
                            }

                            setText(error);
                        } imEnd();
                    } imEndIf();

                    const displayColon = imState(newBoolean);
                    if (imTimerRepeat(1.0)) {
                        displayColon.val = !displayColon.val;
                    }

                    if (imIf() && ctx.notLockedIn) {
                        imBegin(ROW); imAlign(); {
                            imBegin(); imSize(10, PX, 0, NA); imEnd();
                            imBegin(ROW); imSize(0, NA, 50, PX); imAlign(); imJustify(); {
                                if (imIsFirstishRender()) {
                                    setStyle("cursor", "pointer");
                                }

                                imAsciiIcon(getIcon(state.currentTheme), 4.5);

                                if (elementHasMousePress()) {
                                    setTheme(state.currentTheme === "Dark" ? "Light" : "Dark");
                                    debouncedSave(ctx, state);
                                }
                            } imEnd();
                            imBegin(); imSize(10, PX, 0, NA); imEnd();


                            imLine(VERTICAL);

                            imBegin(ROW); imFlex(); {
                                imBeginAppHeading(); {
                                    setText(formatDateTime(new Date(), displayColon.val ? ":" : "\xa0", true));
                                } imEnd();
                            } imEnd();

                            const root = imBegin(ROW); imFlex(); imAlign(); imJustify(); {
                                if (imIsFirstishRender()) {
                                    // TODO: standardize
                                    setStyle("fontSize", "20px");
                                    setStyle("fontWeight", "bold");
                                }

                                const tRef = imState(newNumber);

                                if (imIf() && ctx.status.statusTextTimeLeft > 0) {
                                    ctx.status.statusTextTimeLeft -= getDeltaTimeSeconds();
                                    tRef.val += getDeltaTimeSeconds();

                                    // bruh
                                    if (imIf() && ctx.status.statusTextType === TASK_IN_PROGRESS) {
                                        const sin01 = 0.5 * (1 + Math.sin(5 * tRef.val));

                                        setStyle("opacity", sin01 * 0.7 + 0.3 + "", root);

                                        imBegin(); {
                                            if (imIsFirstishRender()) {
                                                setStyle("width", "20px");
                                                setStyle("height", "20px");
                                            }

                                            setStyle("transform", "rotate(" + 5 * tRef.val + "rad)");
                                            setStyle("backgroundColor", cssVarsApp.fgColor);
                                        } imEnd();
                                    } imEndIf();

                                    imBegin(); imSize(10, PX, 0, NA); imEnd();

                                    imBegin(); setText(ctx.status.statusText); imEnd();

                                    if (imIf() && ctx.status.statusTextType === TASK_IN_PROGRESS) {
                                        imBegin(); {
                                            setText(".".repeat(Math.ceil(2 * tRef.val % 3)));
                                        } imEnd();
                                    } imEndIf();
                                } else {
                                    imElse();

                                    tRef.val = 0; // also, zero animation for status

                                    imFpsCounterOutputCompact(fpsCounter);

                                } imEndIf();
                            } imEnd();

                            imBegin(ROW); imFlex(2); imGap(1, CH); imJustify(RIGHT); {
                                // NOTE: these could be buttons.
                                if (imIsFirstishRender()) {
                                    // TODO: standardize
                                    setStyle("fontSize", "18px");
                                    setStyle("fontWeight", "bold");
                                }

                                const commands = ctx.discoverableCommands;
                                imFor(); {
                                    for (let i = 0; i < commands.stabilizedIdx; i++) {
                                        const command = commands.stabilized[i];
                                        if (!command.key) continue;

                                        imNextListRoot();

                                        imCommandDescription(command.key.stringRepresentation, command.desc);
                                    }

                                    const anyFulfilled = (ctx.keyboard.shiftKey.held && commands.shiftAvailable) ||
                                        (ctx.keyboard.ctrlKey.held && commands.ctrlAvailable) ||
                                        (ctx.keyboard.altKey.held && commands.altAvailable)

                                    if (!anyFulfilled) {
                                        imNextListRoot();
                                        if (commands.shiftAvailable) {
                                            imCommandDescription(ctx.keyboard.shiftKey.stringRepresentation, "Hold");
                                        }

                                        imNextListRoot();
                                        if (commands.ctrlAvailable) {
                                            imCommandDescription(ctx.keyboard.ctrlKey.stringRepresentation, "Hold");
                                        }

                                        imNextListRoot();
                                        if (commands.altAvailable) {
                                            imCommandDescription(ctx.keyboard.altKey.stringRepresentation, "Hold");
                                        }
                                    }

                                    commands.shiftAvailable = false;
                                    commands.ctrlAvailable = false;
                                    commands.altAvailable = false;
                                } imEndFor();

                                imBegin(); imSize(10, PX, 0, NA); imEnd();
                            } imEnd();
                        } imEnd();
                    } imEndIf();

                    imLine(HORIZONTAL, 4);

                    if (imIf() && ctx.currentView === ctx.views.settings) {
                        imSettingsView(ctx, ctx.views.settings);
                    } else {
                        imElse();


                        imBegin(ROW); imFlex(); {
                            // TODO: think about this.
                            const focusRef = imState(newFocusRef);
                            focusRef.focused = ctx.currentView;
                            const navList = imViewsList(focusRef);

                            imNoteTreeView(ctx, ctx.views.noteTree);
                            addView(navList, ctx.views.noteTree, "Notes");

                            imLine(VERTICAL, 1);
                            // imBegin(); {
                            //     imInitStyles(`width: 1px; background-color: ${cssVarsApp.fgColor};`)
                            // } imEnd();

                            if (ctx.currentView !== ctx.views.noteTree) {
                                ctx.leftTab = ctx.currentView;
                                ctx.notLockedIn = true;
                            } else {
                                ctx.leftTab = ctx.views.activities;
                            }

                            if (imIf() && ctx.notLockedIn) {
                                imBegin(COL); {
                                    if (imIsFirstishRender()) {
                                        setStyle("width", "33%");
                                    }

                                    imSwitch(ctx.leftTab); switch (ctx.leftTab) {
                                        case ctx.views.activities: 
                                            imActivitiesList(ctx, ctx.views.activities); 
                                            addView(navList, ctx.views.activities, "Activities");
                                            break;
                                        case ctx.views.fastTravel: 
                                            imNoteTraversal(ctx, ctx.views.fastTravel);  
                                            addView(navList, ctx.views.fastTravel, "Fast travel");
                                            break;
                                        case ctx.views.finder:     
                                            imFuzzyFinder(ctx, ctx.views.finder);        
                                            addView(navList, ctx.views.finder, "Finder");
                                            break;
                                        case ctx.views.urls:       
                                            imUrlViewer(ctx, ctx.views.urls);            
                                            addView(navList, ctx.views.urls, "Url opener");
                                            break;
                                    } imEndSwitch();
                                } imEnd();
                            } imEndIf();

                            // navigate list
                            {
                                const prev = getWrapped(navList.views, navList.idx - 1);
                                const next = getWrapped(navList.views, navList.idx + 1);
                                const tabInput = getTabInput(ctx, "Go to " + prev.name, "Go to " + next.name);
                                if (tabInput < 0) {
                                    ctx.currentView = prev.focusRef;
                                } else if (tabInput > 0) {
                                    ctx.currentView = next.focusRef;
                                }
                            }
                        } imEnd();
                    } imEndIf();
                } imEnd();

                if (imIf() && ctx.notLockedIn) {
                    imFpsCounterOutputVerbose(fpsCounter);
                } imEndIf();
            } stopFpsCounter(fpsCounter);


            // post-process events, etc
            {
                // toggle activity view open
                {
                    if (hasDiscoverableCommand(
                        ctx,
                        ctx.keyboard.spaceKey,
                        ctx.notLockedIn ? "Lock in" : "Stop locking in",
                        CTRL | BYPASS_TEXT_AREA,
                    )) {
                        ctx.notLockedIn = !ctx.notLockedIn;
                        ctx.currentView = ctx.views.noteTree;
                        ctx.handled = true;
                    }
                }

                // fuzzy finder
                if (
                    ctx.currentView !== ctx.views.finder &&
                    hasDiscoverableCommand(ctx, ctx.keyboard.fKey, "Find", CTRL | BYPASS_TEXT_AREA)
                ) {
                    ctx.currentView = ctx.views.finder;
                }

                // back to the last note when escape pressed
                {
                    if (imMemo(ctx.currentView)) {
                        const currentNote = getNoteOrUndefined(state, state.currentNoteId);
                        if (currentNote) {
                            ctx.noteBeforeFocus = currentNote;
                        }
                    }

                    if (
                        ctx.currentView !== ctx.views.noteTree &&
                        ctx.noteBeforeFocus &&
                        hasDiscoverableCommand(
                            ctx, ctx.keyboard.escapeKey, "Back to notes",
                            ctx.currentView === ctx.views.finder ? BYPASS_TEXT_AREA : 0
                        )
                    ) {
                        setCurrentNote(state, ctx.noteBeforeFocus.id);
                        ctx.currentView = ctx.views.noteTree;
                    }
                }

                if (
                    ctx.currentView !== ctx.views.settings,
                    hasDiscoverableCommand(ctx, ctx.keyboard.commaKey, "Settings", CTRL)
                ) {
                    ctx.currentView = ctx.views.settings;
                }

                // Take a break from any view.
                // Also, shouldn't bypass the text area - if it could, we wouldn't be able to type "B"
                if (hasDiscoverableCommand(ctx, ctx.keyboard.bKey, "Take a break", SHIFT)) {
                    ctx.currentView = ctx.views.activities;
                    activitiesViewTakeBreak(ctx, ctx.views.activities);
                    ctx.handled = true;
                }

                if (!ctx.handled) {
                    const keyboard = ctx.keyboard;
                    if (keyboard.aKey.pressed && keyboard.ctrlKey.held && !isEditingTextSomewhereInDocument()) {
                        // no, I don't want to select all text being in the DOM, actually
                        ctx.handled = true;
                    }

                    if (keyboard.tabKey.pressed && !isEditingTextSomewhereInDocument()) {
                        // no, I don't want to defucs the program, actually
                        ctx.handled = true;
                    }
                }

                if (ctx.handled) {
                    preventImKeysDefault();
                }

                // Only one text area can be focued at a time in the entire document.
                if (ctx.textAreaToFocus) {
                    const textArea = ctx.textAreaToFocus.root;
                    if (document.activeElement !== textArea) {
                        textArea.focus();
                        ctx.textAreaToFocus = null;
                        if (ctx.focusWithAllSelected) {
                            textArea.selectionStart = 0;
                            textArea.selectionEnd = textArea.value.length;
                            ctx.focusWithAllSelected = false;
                        }
                    }
                }

                // discoverable commands (at the very end).
                updateDiscoverableCommands(ctx.discoverableCommands);
            }

            framesSinceError.val++;
        } else {
            imElse();

            imBegin(); setText("An error occured in the main render loop. It's irrecoverable, I'm afraid"); imEnd();
        } imEndIf();
    } catch (e) {
        // unmounts imComponent1 immediately, rewinds the stack back to this list.
        imCatch(l);

        console.error("An error occured while rendering: ", e);
        errorRef.val = e;

        if (framesSinceError.val !== 0) {
            framesSinceError.val = 0;
        } else {
            irrecoverableErrorRef.val = true;
        }
    }
    imEndTry();
}

function imCommandDescription(key: string, action: string) {
    imBegin(COL); imAlign(CENTER); {
        imBegin(); imStr("["); imStr(key); imStr("]"); imEnd();
        imBegin(); imStr(action); imEnd();
    } imEnd();
}

loadState(() => {
    console.log("State: ", state);
    initImDomUtils(imMain);
    setTheme(state.currentTheme);
})

// Using a custom styling solution
initCssbStyles();
