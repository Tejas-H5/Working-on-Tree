import { imActivitiesList } from "./activities-list";
import { imLine } from "./app-components/common";
import { cnApp, cssVarsApp } from "./app-styling";
import { imTimerRepeat } from "./app-utils/timer";
import {
    CH,
    COL,
    imAlign,
    imBegin,
    imFixed,
    imFlex,
    imGap,
    imInitStyles,
    imJustify,
    imSize,
    NOT_SET,
    PX,
    RIGHT,
    ROW
} from "./components/core/layout";
import { imSpan } from "./components/core/text";
import {
    imFpsCounterOutput,
    newFpsCounterState,
    startFpsCounter,
    stopFpsCounter
} from "./components/fps-counter";
import {
    handleImKeysInput,
    newGlobalContext,
    preventImKeysDefault
} from "./global-context";
import { imNotePlanView } from "./note-plan-view";
import { imNoteTreeView } from "./note-tree-view";
import {
    APP_VIEW_ACTIVITIES,
    APP_VIEW_PLAN,
    APP_VIEW_TREE,
    applyPendingScratchpadWrites,
    getActivityTime,
    getLastActivity,
    loadState,
    newBreakActivity,
    pushBreakActivity,
    recomputeState,
    setTheme,
    state,
    saveState,
} from "./state";
import { initCssbStyles } from "./utils/cssb";
import { formatDateTime, getTimestamp, parseDateSafe } from "./utils/datetime";
import {
    getDeltaTimeSeconds,
    HORIZONTAL,
    imCatch,
    imElseIf,
    imEnd,
    imEndIf,
    imEndTry,
    imIf,
    imRef,
    imState,
    imTry,
    initImDomUtils,
    isFirstishRender,
    newBoolean,
    newNumber,
    setClass,
    setStyle,
    setText,
    getTimeSeconds,
    imElse,
    imInit,
    imStateInline
} from "./utils/im-dom-utils";
import { logTrace } from "./utils/log";
import { bytesToMegabytes, utf8ByteLength } from "./utils/utf8";
import { newWebWorker } from "./utils/web-workers";
import { VERSION_NUMBER } from "./version-number";

const SAVE_DEBOUNCE = 1500;
const ERROR_TIMEOUT_TIME = 5000;

const GITHUB_PAGE = "https://github.com/Tejas-H5/Working-on-Tree";
const GITHUB_PAGE_ISSUES = "https://github.com/Tejas-H5/Working-on-Tree/issues/new?template=Blank+issue";

// TODO: expose via UI
console.log("Note tree v" + VERSION_NUMBER);
console.log({
    github_page: GITHUB_PAGE,
    if_you_encounter_bugs: GITHUB_PAGE_ISSUES
});

// Used by webworker and normal code
export const CHECK_INTERVAL_MS = 1000 * 10;

function imMain() {
    const fpsCounter = imState(newFpsCounterState);
    const ctx = imState(newGlobalContext);
    ctx.now = new Date();

    const errorRef = imRef();
    const framesSinceError = imState(newNumber);
    const realShitRef = imState(newBoolean);
    
    const l = imTry(); try {
        if (imIf() && !realShitRef.val) {
            handleImKeysInput(ctx);

            if (ctx.requestSaveState) {
                ctx.requestSaveState = false;
                debouncedSave();
            }

            startFpsCounter(fpsCounter); {
                imBegin(COL); imFixed(0, 0, 0, 0); {
                    const error = state.criticalSavingError || state._criticalLoadingError;
                    if (imIf() && error) {
                        imBegin(); {
                            if (isFirstishRender()) {
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

                    imBegin(ROW); {
                        if (isFirstishRender()) {
                            // TODO: standardize
                            setStyle("fontSize", "28px");
                            setStyle("fontWeight", "bold");
                        }

                        imBegin(ROW); imFlex(); {
                            imBegin(); imSize(10, PX, 0, NOT_SET); imEnd();

                            imSpan(formatDateTime(new Date(), displayColon.val ? ":" : " ", true)); imEnd();
                        } imEnd();

                        const root = imBegin(ROW); imFlex(); imAlign(); imJustify(); {
                            if (isFirstishRender()) {
                                // TODO: standardize
                                setStyle("fontSize", "23px");
                                setStyle("fontWeight", "bold");
                            }

                            const tRef = imState(newNumber);

                            if (imIf() && statusTextTimeLeft > 0) {
                                statusTextTimeLeft -= getDeltaTimeSeconds();
                                tRef.val += getDeltaTimeSeconds();

                                // bruh
                                const sin01 = 0.5 * (1 + Math.sin(5 * tRef.val));

                                setStyle("opacity", sin01 * 0.7 + 0.3 + "", root);

                                imBegin(); {
                                    if (isFirstishRender()) {
                                        setStyle("width", "20px");
                                        setStyle("height", "20px");
                                    }

                                    setStyle("transform", "rotate(" + 5 * tRef.val + "rad)");
                                    setStyle("backgroundColor", cssVarsApp.fgColor);
                                } imEnd();

                                imBegin(); imSize(10, PX, 0, NOT_SET); imEnd();

                                imBegin(); setStyle("color", statusTextColor); setText(statusText); imEnd();
                                imBegin(); {
                                    setText(".".repeat(Math.ceil(2 * tRef.val % 3)));
                                    setStyle("color", statusTextColor);
                                } imEnd();
                            } else {
                                tRef.val = 0;
                            } imEndIf();
                        } imEnd();

                        imBegin(ROW); imFlex(3); imJustify(RIGHT); imGap(1, CH); {
                            // NOTE: these could be buttons.
                            if (isFirstishRender()) {
                                // TODO: standardize
                                setStyle("fontSize", "23px");
                                setStyle("fontWeight", "bold");
                            }

                            imSpan("[1]Notes"); {
                                setClass(cnApp.defocusedText, state._currentScreen !== APP_VIEW_TREE);
                            } imEnd();

                            imSpan("[2]Activities"); {
                                setClass(cnApp.defocusedText, state._currentScreen !== APP_VIEW_ACTIVITIES);
                            } imEnd();

                            imSpan("[3]Plan"); {
                                setClass(cnApp.defocusedText, state._currentScreen !== APP_VIEW_PLAN);
                            } imEnd();

                            imSpan("[?]Statistics"); {
                                // TODO: canvas view
                                // setClass(cnApp.defocusedText, state._currentScreen !== APP_VIEW_PLAN);
                            } imEnd();

                            imSpan("[?]Ascii canvas"); {
                                // TODO: canvas view
                                // setClass(cnApp.defocusedText, state._currentScreen !== APP_VIEW_PLAN);
                            } imEnd();

                            imSpan("[?]Graph"); {
                                // TODO: canvas view
                                // setClass(cnApp.defocusedText, state._currentScreen !== APP_VIEW_PLAN);
                            } imEnd();

                        } imEnd();
                    } imEnd();

                    imLine(HORIZONTAL, 4);

                    if (
                        imIf() &&
                        state._currentScreen === APP_VIEW_TREE ||
                        state._currentScreen === APP_VIEW_ACTIVITIES
                    ) {
                        imBegin(ROW); imFlex(); {
                            imNoteTreeView(ctx, state._currentScreen === APP_VIEW_TREE);

                            imBegin(); {
                                imInitStyles(`width: 1px; background-color: ${cssVarsApp.fgColor};`)
                            } imEnd();

                            imBegin(COL); {
                                if (isFirstishRender()) {
                                    setStyle("width", "33%");
                                }
                                imActivitiesList(ctx, state._currentScreen === APP_VIEW_ACTIVITIES);
                            } imEnd();
                        } imEnd();
                    } else if (imElseIf() && state._currentScreen === APP_VIEW_PLAN) {
                        imNotePlanView(ctx, state._currentScreen === APP_VIEW_PLAN);
                    } imEndIf();

                    imFpsCounterOutput(fpsCounter);
                } imEnd();
            } stopFpsCounter(fpsCounter);


            // post-process events, etc
            {
                if (!ctx.handled) {
                    const keyboard = ctx.keyboard;
                    if (keyboard.aKey.pressed && keyboard.ctrlKey.held) {
                        if (!ctx.textAreaToFocus) {
                            // no, I don't want to select all text being in the DOM, actually
                            ctx.handled = true;
                        }
                    }

                    // Use numbers to navigate. Other view inputs must be handled before this one, always.
                    if (!ctx.handled) {
                        ctx.handled = true;
                        if (ctx.keyboard.num1Key.pressed) {
                            state._currentScreen = APP_VIEW_TREE;
                        } else if (ctx.keyboard.num2Key.pressed) {
                            state._currentScreen = APP_VIEW_ACTIVITIES;
                        } else if (ctx.keyboard.num3Key.pressed) {
                            state._currentScreen = APP_VIEW_PLAN;
                        } else {
                            ctx.handled = false;
                        }
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
            realShitRef.val = true;
        }
    } 
    imEndTry();
}

// some side-effects
{
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

            pushBreakActivity(state, newBreakActivity("Auto-inserted break", new Date(time), false));
            debouncedSave();
        }

        state.breakAutoInsertLastPolledTime = getTimestamp(time);
    }
}

let statusTextTimeLeft = 0;
let statusText = "";
let statusTextColor = "";

let saveTimeout = 0;
function saveCurrentState({ debounced } = { debounced: false }) {
    // user can switch to a different note mid-debounce, so we need to save
    // these here before the debounce

    const thisState = state;

    const save = () => {
        if (state !== thisState) {
            logTrace("The state changed unexpectedly! let's not save...");
            return;
        }

        // We need to apply the current scratch pad state to the current note just before we save, so that we don't lose what
        // we were working on in the scratchpad.
        applyPendingScratchpadWrites(thisState);


        // save current note
        saveState(thisState, (serialized) => {
            // notification

            // JavaScript strings are UTF-16 encoded
            const bytes = utf8ByteLength(serialized);
            const mb = bytesToMegabytes(bytes);

            // in case the storage.estimate().then never happens, lets just show something.
            showStatusText(`Saved (` + mb.toFixed(2) + `mb)`);

            // A shame we need to do this :(
            navigator.storage.estimate().then((data) => {
                state.criticalSavingError = "";

                const estimatedMbUsage = bytesToMegabytes(data.usage ?? 0);
                if (estimatedMbUsage < 100) {
                    // don't bother showing this warning if we're using way less than 100 mb. it will
                    // cause unnecessary panic. We're more concerned about when it starts taking up 15gb and
                    // then locking up/freezing/crashing the site.
                    return;
                }

                showStatusText(`Saved (` + mb.toFixed(2) + `mb / ` + estimatedMbUsage.toFixed(2) + `mb)`);

                const baseErrorMessage = "WARNING: Your browser is consuming SIGNIFICANTLY more disk space on this site than what should be required: " +
                    estimatedMbUsage.toFixed(2) + "mb being used instead of an expected " + (mb * 2).toFixed(2) + "mb.";

                const COMPACTION_THRESHOLD = 20;
                const CRITICAL_ERROR_THRESHOLD = 40;

                if (mb * COMPACTION_THRESHOLD < estimatedMbUsage) {
                    console.warn(baseErrorMessage);
                }

                if (mb * CRITICAL_ERROR_THRESHOLD < estimatedMbUsage) {
                    // This should be fixed. I guess we're keeping this code here 'just in case'.
                    
                    const criticalSavingError = baseErrorMessage + " You should start backing up your data ever day, and anticipate a crash of some sort. Also consider using this website in another browser. This bug should be reported as a github issue on " + GITHUB_PAGE

                    state.criticalSavingError = criticalSavingError;
                    console.error(criticalSavingError);
                }
            });

        });
    };

    if (!debounced) {
        save();
        return;
    }

    showStatusText(`Saving`, SAVE_DEBOUNCE);
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        save();
    }, SAVE_DEBOUNCE);
};

const STATUS_TEXT_PERSIST_TIME = 1;
function showStatusText(
    text: string,
    timeout: number = STATUS_TEXT_PERSIST_TIME,
    // TODO: change this to _status_
    color: string = cssVarsApp.fgColor,
) {
    statusText = text;
    statusTextColor = color;
    statusTextTimeLeft = timeout;
}

function debouncedSave() {
    saveCurrentState({ debounced: true });
};

loadState(() => {
    recomputeState(state);
    console.log("State: ", state);
    initImDomUtils(imMain);
})

// Using a custom styling solution
initCssbStyles();
setTheme("Light");
