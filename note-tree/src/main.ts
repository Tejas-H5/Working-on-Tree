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
    NOT_SET,
    PX,
    RIGHT,
    ROW
} from "./components/core/layout";
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
    handleImKeysInput,
    hasDiscoverableCommand,
    newGlobalContext,
    preventImKeysDefault,
    SHIFT,
    updateDiscoverableCommands
} from "./global-context";
import { imNoteTraversal, newNoteTraversalViewState } from "./lateral-traversal";
import { addView, AXIS_TAB, getNavigableListInput, getTabInput, imViewsList, } from "./navigable-list";
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
import { getWrapped, getWrappedIdx } from "./utils/array-utils";
import { initCssbStyles } from "./utils/cssb";
import { formatDateTime, getTimestamp, parseDateSafe } from "./utils/datetime";
import {
    elementHasMousePress,
    getDeltaTimeSeconds,
    HORIZONTAL,
    imArray,
    imCatch,
    imElse,
    imEnd,
    imEndFor,
    imEndIf,
    imEndSwitch,
    imEndTry,
    imFor,
    imIf,
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

    const l = imTry(); try {
        if (imIf() && !irrecoverableErrorRef.val) {
            handleImKeysInput(ctx);

            if (MEMO_CHANGED === imMemoMany(
                state._notesMutationCounter,
                state._activitiesMutationCounter
            )) {
                debouncedSave();
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
                            imBegin(); imSize(10, PX, 0, NOT_SET); imEnd();
                            imBegin(ROW); imSize(0, NOT_SET, 50, PX); imAlign(); imJustify(); {
                                if (imIsFirstishRender()) {
                                    setStyle("cursor", "pointer");
                                }

                                imAsciiIcon(getIcon(state.currentTheme), 4.5);

                                if (elementHasMousePress()) {
                                    setTheme(state.currentTheme === "Dark" ? "Light" : "Dark");
                                    debouncedSave();
                                }
                            } imEnd();
                            imBegin(); imSize(10, PX, 0, NOT_SET); imEnd();


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

                                if (imIf() && statusTextTimeLeft > 0) {
                                    statusTextTimeLeft -= getDeltaTimeSeconds();
                                    tRef.val += getDeltaTimeSeconds();

                                    // bruh
                                    if (imIf() && statusTextType === IN_PROGRESS) {
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

                                imBegin(); imSize(10, PX, 0, NOT_SET); imEnd();
                            } imEnd();
                        } imEnd();
                    } imEndIf();

                    imLine(HORIZONTAL, 4);

                    if (imIf() && ctx.currentView === ctx.views.settings) {
                        imSettingsView(ctx, ctx.views.settings);
                    } else {
                        imElse();

                        const navList = imArray();
                        navList.length = 2;

                        imBegin(ROW); imFlex(); {
                            const navList = imViewsList(ctx.currentView);

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

                            const prev = getWrapped(navList.views, navList.idx - 1);
                            const next = getWrapped(navList.views, navList.idx + 1);
                            const tabInput = getTabInput(ctx, "Go to " + prev.name, "Go to " + next.name);
                            if (tabInput < 0) {
                                ctx.currentView = prev.focusRef;
                            } else if (tabInput > 0) {
                                ctx.currentView = next.focusRef;
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
        imBegin(); setText("[" + key + "]"); imEnd();
        imBegin(); setText(action); imEnd();
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
        debouncedSave();
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
    console.log("State: ", state);
    initImDomUtils(imMain);
    setTheme(state.currentTheme);
})

// Using a custom styling solution
initCssbStyles();
