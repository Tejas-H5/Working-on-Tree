import { activitiesViewTakeBreak, imActivitiesList } from "./activities-list";
import { imLine } from "./app-components/common";
import { cssVarsApp } from "./app-styling";
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
    INLINE_BLOCK,
    NOT_SET,
    PX,
    ROW,
    STRETCH
} from "./components/core/layout";
import {
    imFpsCounterOutputCompact,
    imFpsCounterOutputVerbose,
    newFpsCounterState,
    startFpsCounter,
    stopFpsCounter
} from "./components/fps-counter";
import {
    BYPASS_TEXT_AREA,
    handleImKeysInput,
    hasDiscoverableCommand,
    hasDiscoverableHold,
    newGlobalContext,
    preventImKeysDefault,
    REPEAT,
    updateDiscoverableCommands,
} from "./global-context";
import { imNoteTreeView } from "./note-tree-view";
import {
    APP_VIEW_ACTIVITIES,
    APP_VIEW_NOTES,
    applyPendingScratchpadWrites,
    appViewToString,
    getActivityTime,
    getLastActivity,
    isCurrentlyTakingABreak,
    loadState,
    newBreakActivity,
    pushBreakActivity,
    recomputeState,
    saveState,
    setTheme,
    state,
} from "./state";
import { getWrapped } from "./utils/array-utils";
import { initCssbStyles } from "./utils/cssb";
import { formatDateTime, getTimestamp, parseDateSafe } from "./utils/datetime";
import {
    getDeltaTimeSeconds,
    HORIZONTAL,
    imBeginSpan,
    imCatch,
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imEndTry,
    imFor,
    imIf,
    imNextRoot,
    imRef,
    imState,
    imTry,
    initImDomUtils,
    isEditingTextSomewhereInDocument,
    isFirstishRender,
    newBoolean,
    newNumber,
    setStyle,
    setText
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

                    imBegin(ROW); imAlign(); {
                        if (isFirstishRender()) {
                            // TODO: standardize
                            setStyle("fontSize", "28px");
                            setStyle("fontWeight", "bold");
                        }

                        imBegin(ROW); imFlex(); {
                            imBegin(); imSize(10, PX, 0, NOT_SET); imEnd();
                            imBegin(INLINE_BLOCK); {
                                setText(formatDateTime(new Date(), displayColon.val ? ":" : "\xa0", true));
                            } imEnd();
                        } imEnd();

                        const root = imBegin(ROW); imFlex(); imAlign(); imJustify(); {
                            if (isFirstishRender()) {
                                // TODO: standardize
                                setStyle("fontSize", "20px");
                                setStyle("fontWeight", "bold");
                            }

                            const tRef = imState(newNumber);

                            if (imIf() && statusTextTimeLeft > 0) {
                                statusTextTimeLeft -= getDeltaTimeSeconds();
                                tRef.val += getDeltaTimeSeconds();

                                // bruh
                                if (imIf() && statusTextType === IN_PROGRESS) {
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
                                } imEndIf();

                                imBegin(); imSize(10, PX, 0, NOT_SET); imEnd();

                                imBegin(); setText(statusText); imEnd();

                                if (imIf() && statusTextType === IN_PROGRESS) {
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

                        imBegin(ROW); imFlex(2); imGap(1, CH); imAlign(); {
                            // NOTE: these could be buttons.
                            if (isFirstishRender()) {
                                // TODO: standardize
                                setStyle("fontSize", "18px");
                                setStyle("fontWeight", "bold");
                                setStyle("textAlign", "right");
                            }

                            const commands = ctx.discoverableCommands;
                            imFor(); {
                                for (const command of commands.stablized) {
                                    if (!command.key) continue;

                                    imNextRoot();

                                    imCommandDescription(command.key.stringRepresentation, command.actionDescription);
                                }

                                const anyFulfilled = (ctx.keyboard.shiftKey.held && commands.shiftHeld) ||
                                                     (ctx.keyboard.ctrlKey.held  && commands.ctrlHeld)  ||
                                                     (ctx.keyboard.altKey.held   && commands.altHeld)

                                if (!anyFulfilled) {
                                    imNextRoot();
                                    if (commands.shiftHeld) {
                                        imCommandDescription(ctx.keyboard.shiftKey.stringRepresentation, "Hold");
                                        commands.shiftHeld = false;
                                    }

                                    imNextRoot();
                                    if (commands.ctrlHeld) {
                                        imCommandDescription(ctx.keyboard.ctrlKey.stringRepresentation, "Hold");
                                        commands.ctrlHeld = false;
                                    }

                                    imNextRoot();
                                    if (commands.altHeld) {
                                        imCommandDescription(ctx.keyboard.ctrlKey.stringRepresentation, "Hold");
                                        commands.altHeld = false;
                                    }
                                }
                            } imEndFor();

                            imBegin(); imSize(10, PX, 0, NOT_SET); imEnd();
                        } imEnd();
                    } imEnd();

                    imLine(HORIZONTAL, 4);

                    imBegin(ROW); imFlex(); {
                        imNoteTreeView(ctx, ctx.noteTreeView, state._currentScreen === APP_VIEW_NOTES);

                        imBegin(); {
                            imInitStyles(`width: 1px; background-color: ${cssVarsApp.fgColor};`)
                        } imEnd();

                        if (imIf() && ctx.activityViewVisible) {
                            imBegin(COL); {
                                if (isFirstishRender()) {
                                    setStyle("width", "33%");
                                }
                                imActivitiesList(ctx, ctx.activityView, state._currentScreen === APP_VIEW_ACTIVITIES);
                            } imEnd();
                        } imEndIf();
                    } imEnd();

                } imEnd();

                imFpsCounterOutputVerbose(fpsCounter);
            } stopFpsCounter(fpsCounter);


            // post-process events, etc
            {
                // toggle activity view open
                {
                    // ensure visible when it needs to be
                    if (state._currentScreen === APP_VIEW_ACTIVITIES) {
                        ctx.activityViewVisible = true;
                    }

                    if (hasDiscoverableHold(ctx, ctx.keyboard.ctrlKey)) {
                        if (hasDiscoverableCommand(
                            ctx,
                            ctx.keyboard.spaceKey,
                            !ctx.activityViewVisible ? "Open activity view" : "Close activity view",
                            BYPASS_TEXT_AREA,
                        )) {
                            ctx.activityViewVisible = !ctx.activityViewVisible;
                            state._currentScreen = APP_VIEW_NOTES;
                            ctx.handled = true;
                        }
                    }
                }

                // navigate between every view
                if (!isEditingTextSomewhereInDocument()) {
                    const idx = ctx.navigationList.indexOf(state._currentScreen);
                    if (!ctx.handled && ctx.navigationList.length > 0) {
                        let next, prev;
                        if (idx === -1) {
                            next = getWrapped(ctx.navigationList, 0);
                            prev = getWrapped(ctx.navigationList, -1);
                        } else {
                            next = getWrapped(ctx.navigationList, idx + 1);
                            prev = getWrapped(ctx.navigationList, idx - 1);
                        }

                        if (
                            hasDiscoverableHold(ctx, ctx.keyboard.shiftKey) &&
                            hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, appViewToString(prev), REPEAT)
                        ) {
                            state._currentScreen = prev;
                            ctx.handled = true;
                        } else if (
                            hasDiscoverableCommand(ctx, ctx.keyboard.tabKey, appViewToString(next), REPEAT)
                        ) {
                            state._currentScreen = next;
                            ctx.handled = true;
                        }

                        // clear it out, so that other things can push to it later
                        ctx.navigationList.length = 0;
                    }
                }

                // take a break from any view
                if (!ctx.handled && hasDiscoverableHold(ctx, ctx.keyboard.shiftKey)) {
                    if (hasDiscoverableCommand(ctx, ctx.keyboard.bKey, "Take a break", BYPASS_TEXT_AREA)) {
                        state._currentScreen = APP_VIEW_ACTIVITIES;
                        activitiesViewTakeBreak(ctx, ctx.activityView);
                        ctx.handled = true;
                    }
                }

                if (!ctx.handled) {
                    const keyboard = ctx.keyboard;
                    if (keyboard.aKey.pressed && keyboard.ctrlKey.held) {
                        if (!ctx.textAreaToFocus) {
                            // no, I don't want to select all text being in the DOM, actually
                            ctx.handled = true;
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
            realShitRef.val = true;
        }
    } 
    imEndTry();
}

function imCommandDescription(key: string, action: string) {
    imBegin(INLINE_BLOCK); {
        imBeginSpan(); setText("["); imEnd();
        imBeginSpan(); setText(key); imEnd();
        imBeginSpan(); setText("] " + action); imEnd();
    } imEnd();
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
        // TODO: fix this mechanism
        return;

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

            if (!isCurrentlyTakingABreak(state)) {
                pushBreakActivity(state, newBreakActivity("Auto-inserted break", new Date(time), false));
            }
            debouncedSave();
        }

        state.breakAutoInsertLastPolledTime = getTimestamp(time);
    }
}

const IN_PROGRESS = 0;
const DONE = 1;
const FAILED = 2;

let statusTextTimeLeft = 0;
let statusText = "";
let statusTextType = IN_PROGRESS;

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
            showStatusText(`Saved (` + mb.toFixed(2) + `mb)`, DONE);

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

                showStatusText(`Saved (` + mb.toFixed(2) + `mb / ` + estimatedMbUsage.toFixed(2) + `mb)`, DONE);

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

    showStatusText(`Saving`, IN_PROGRESS, SAVE_DEBOUNCE);
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        save();
    }, SAVE_DEBOUNCE);
};

const STATUS_TEXT_PERSIST_TIME = 1;
function showStatusText(
    text: string,
    type: typeof IN_PROGRESS | typeof DONE | typeof FAILED,
    timeout: number = STATUS_TEXT_PERSIST_TIME,
) {
    statusText = text;
    statusTextType = type;
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
