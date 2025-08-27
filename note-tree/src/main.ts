import {
    getDeltaTimeSeconds,
    ImCache,
    imCacheBegin,
    imCacheEnd,
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
    imTryCatch,
    imTryEnd,
    inlineTypeId,
    isFirstishRender,
    MEMO_CHANGED
} from "src/utils/im-core";
import {
    elHasMouseDown,
    elHasMouseOver,
    elSetStyle,
    imDomRootBegin,
    imDomRootEnd,
    imGlobalEventSystemBegin,
    imGlobalEventSystemEnd,
    imStr
} from "src/utils/im-dom";
import { activitiesViewTakeBreak, imActivitiesList } from "./app-views/activities-list";
import { imLine, LINE_HORIZONTAL, LINE_VERTICAL } from "./app-components/im-line";
import { imAppHeadingBegin, imAppHeadingEnd, } from "./app-components/app-heading";
import { cssVarsApp } from "./app-styling";
import { imTimerRepeat } from "./app-utils/timer";
import { imAsciiIcon } from "./app-components/ascii-icon";
import { ASCII_MOON_STARS, ASCII_SUN } from "./assets/icons";
import {
    BLOCK,
    CENTER,
    CH,
    COL,
    imAlign,
    imButton,
    imFixed,
    imFlex,
    imGap,
    imJustify,
    imLayout,
    imLayoutEnd,
    imPre,
    imSize,
    INLINE_BLOCK,
    NA,
    PERCENT,
    PX,
    RIGHT,
    ROW
} from "./components/core/layout";
import {
    fpsMarkRenderingEnd,
    fpsMarkRenderingStart,
    newFpsCounterState,
} from "./components/fps-counter";
import { imDurationsView } from "./app-views/durations-view";
import { imFuzzyFinder } from "./app-views/fuzzy-finder";
import {
    AUTO_INSERT_BREAK_CHECK_INTERVAL,
    autoInsertBreakIfRequired,
    BYPASS_TEXT_AREA,
    CTRL,
    debouncedSave,
    handleImKeysInput,
    hasDiscoverableCommand,
    newGlobalContext,
    preventImKeysDefault,
    setCurrentView,
    SHIFT,
    TASK_IN_PROGRESS,
    updateDiscoverableCommands
} from "./global-context";
import { imNoteTraversal } from "./app-views/lateral-traversal";
import { addView, getTabInput, imViewsList, newFocusRef } from "./app-components/navigable-list";
import { imNoteTreeView } from "./app-views/note-tree-view";
import { imSettingsView } from "./app-views/settings-view";
import {
    AppTheme,
    getLastSavedTimestampLocalstate,
    loadState,
    setCurrentNote,
    setTheme,
    state
} from "./state";
import { imUrlViewer } from "./app-views/url-viewer";
import { get, getWrappedIdx } from "./utils/array-utils";
import { initCssbStyles } from "./utils/cssb";
import { formatDateTime } from "./utils/datetime";
import { isEditingTextSomewhereInDocument } from "./utils/dom-utils";
import { newWebWorker } from "./utils/web-workers";
import { logTrace } from "./utils/log";

function getIcon(theme: AppTheme) {
    if (theme === "Light") return ASCII_SUN;
    if (theme === "Dark")  return ASCII_MOON_STARS;
    return ASCII_MOON_STARS;
}

function imMainInner(c: ImCache) {
    let fpsCounter = imGet(c, newFpsCounterState);
    if (!fpsCounter) fpsCounter = imSet(c, newFpsCounterState());

    fpsMarkRenderingStart(fpsCounter); 

    let ctx = imGet(c, newGlobalContext);
    if (!ctx) ctx = imSet(c, newGlobalContext());

    imGlobalEventSystemBegin(c, ctx.ev);

    if (!ctx.leftTab) ctx.leftTab = ctx.views.activities;
    if (!ctx.currentView) ctx.currentView = ctx.views.noteTree;
    if (imMemo(c, state.currentTheme)) setTheme(state.currentTheme);


    if (imMemo(c, state.settings.tabStopSize)) {
        elSetStyle(c, "tabSize", "" + state.settings.tabStopSize);
    }

    ctx.now = new Date();

    let errorState; errorState = imGet(c, inlineTypeId(imTry));
    if (!errorState) {
        errorState = imSet(c, {
            error: null as any,
            framesSinceError: 0,
            irrecoverableError: null as any,
        })
    }

    if (!imGet(c, inlineTypeId(imGet))) {
        imSet(c, true);

        // some side-effects

        // NOTE: Running this setInterval in a web worker is far more reliable that running it in a normal setInterval, which is frequently 
        // throttled in the browser for many random reasons in my experience. However, web workers seem to only stop when a user closes their computer, or 
        // closes the tab, which is what we want here
        const worker = newWebWorker([AUTO_INSERT_BREAK_CHECK_INTERVAL], (checkIntervalMs: number) => {
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
        worker.onmessage = (e) => {
            if (e.data === "is-open-check") {
                autoInsertBreakIfRequired(state);
            }
        };
        worker.onerror = (e) => {
            console.error("Webworker error: ", e);
        }

        // Need to also run this as soon as we start.
        autoInsertBreakIfRequired(state);
    }

    const tryState = imTry(c); try {
        if (imIf(c) && !errorState.error && !errorState.irrecoverableError) {
            handleImKeysInput(ctx, ctx.ev);

            if (imMemo(c, state._notesMutationCounter) === MEMO_CHANGED) {
                if (state._notesMutationCounter !== 0) {
                    debouncedSave(ctx, state, "ImMain memoizer - notes mutation");
                }
            }
            if (imMemo(c, state._activitiesMutationCounter) === MEMO_CHANGED) {
                if (state._activitiesMutationCounter !== 0) {
                    debouncedSave(ctx, state, "ImMain memoizer - activities mutation");
                }
            }

            {
                imLayout(c, COL); imFixed(c, 0, PX, 0, PX, 0, PX, 0, PX); {
                    const error = state.criticalSavingError || state._criticalLoadingError;
                    if (imIf(c) && error) {
                        imLayout(c, BLOCK); {
                            if (isFirstishRender(c)) {
                                elSetStyle(c, "color", "white");
                                elSetStyle(c, "backgroundColor", "red");
                            }

                            imStr(c, error);
                        } imLayoutEnd(c);
                    } imIfEnd(c);

                    let displayColon; displayColon = imGet(c, inlineTypeId(Boolean));
                    if (!displayColon) displayColon = imSet(c, { val: false });

                    if (imTimerRepeat(c, 1.0)) {
                        displayColon.val = !displayColon.val;
                    }

                    if (imIf(c) && ctx.notLockedIn) {
                        imLayout(c, ROW); imAlign(c, CENTER); {
                            imLayout(c, ROW); imButton(c); imAlign(c); imJustify(c); imSize(c, 0, NA, 100, PERCENT); {
                                imLayout(c, BLOCK); imSize(c, 10, PX, 0, NA); imLayoutEnd(c);

                                const nextTheme = state.currentTheme === "Dark" ? "Light" : "Dark";
                                let icon = getIcon(state.currentTheme);
                                if (elHasMouseOver(c, ctx.ev)) {
                                    icon = getIcon(nextTheme);
                                }

                                imAsciiIcon(c, icon, 4.5);

                                if (elHasMouseDown(c, ctx.ev)) {
                                    state.currentTheme = nextTheme;
                                    debouncedSave(ctx, state, "Theme change");
                                }

                                imLayout(c, BLOCK); imSize(c, 10, PX, 0, NA); imLayoutEnd(c);
                            } imLayoutEnd(c);

                            imLine(c, LINE_VERTICAL);

                            imLayout(c, ROW); imFlex(c); {
                                imAppHeadingBegin(c); {
                                    imStr(c, formatDateTime(new Date(), displayColon.val ? ":" : "\xa0", true));
                                } imAppHeadingEnd(c);
                            } imLayoutEnd(c);

                            const root = imLayout(c, ROW); imFlex(c); imAlign(c); imJustify(c); {
                                if (isFirstishRender(c)) {
                                    // TODO: standardize
                                    elSetStyle(c, "fontSize", "20px");
                                    elSetStyle(c, "fontWeight", "bold");
                                }

                                if (imIf(c) && ctx.status.statusTextTimeLeftSeconds > 0) {
                                    ctx.status.statusTextTimeLeftSeconds -= getDeltaTimeSeconds(c);
                                    const statusTextChanged = imMemo(c, ctx.status.statusText);

                                    let t = imGet(c, Math.sin);
                                    if (t === undefined || statusTextChanged) t = 0;
                                    t = imSet(c, t + getDeltaTimeSeconds(c));

                                    // bruh
                                    if (imIf(c) && ctx.status.statusTextType === TASK_IN_PROGRESS) {
                                        const opacity = ctx.status.statusTextTimeLeftSeconds / ctx.status.statusTextTimeInitialSeconds;
                                        elSetStyle(c, "opacity", "" + opacity, root);

                                        imLayout(c, BLOCK); {
                                            if (isFirstishRender(c)) {
                                                elSetStyle(c, "width", "20px");
                                                elSetStyle(c, "height", "20px");
                                            }

                                            elSetStyle(c, "transform", "rotate(" + 5 * t + "rad)");
                                            elSetStyle(c, "backgroundColor", cssVarsApp.fgColor);
                                        } imLayoutEnd(c);
                                    } else {
                                        imIfElse(c);

                                        elSetStyle(c, "opacity", "1", root);
                                    } imIfEnd(c);

                                    imLayout(c, BLOCK); imSize(c, 10, PX, 0, NA); imLayoutEnd(c);

                                    imLayout(c, BLOCK); imStr(c, ctx.status.statusText); imLayoutEnd(c);

                                    if (imIf(c) && ctx.status.statusTextType === TASK_IN_PROGRESS) {
                                        imLayout(c, BLOCK); {
                                            imStr(c, ".".repeat(Math.ceil(2 * t % 3)));
                                        } imLayoutEnd(c);
                                    } imIfEnd(c);
                                } else {
                                    imIfElse(c);

                                    const RINGBUFFER_SIZE = 20;
                                    let arr; arr = imGet(c, inlineTypeId(Array));
                                    if (!arr) arr = imSet(c, {
                                        frameMsRingbuffer: new Array(RINGBUFFER_SIZE).fill(0),
                                        idx1: 0,
                                        renderMsRingbuffer: new Array(RINGBUFFER_SIZE).fill(0),
                                        idx2: 0,
                                    });

                                    arr.frameMsRingbuffer[arr.idx1] = fpsCounter.frameMs;
                                    arr.idx1 = (arr.idx1 + 1) % arr.frameMsRingbuffer.length;

                                    arr.renderMsRingbuffer[arr.idx2] = fpsCounter.renderMs;
                                    arr.idx2 = (arr.idx2 + 1) % arr.renderMsRingbuffer.length;

                                    let renderMs = 0;
                                    let frameMs = 0;
                                    for (let i = 0; i < arr.renderMsRingbuffer.length; i++) {
                                        renderMs += arr.renderMsRingbuffer[i];
                                        frameMs += arr.frameMsRingbuffer[i];
                                    }
                                    renderMs /= arr.frameMsRingbuffer.length;
                                    frameMs /= arr.frameMsRingbuffer.length;

                                    imLayout(c, BLOCK); imStr(c, Math.round(renderMs) + "ms/" + Math.round(frameMs) + "ms"); imLayoutEnd(c);
                                } imIfEnd(c);
                            } imLayoutEnd(c);

                            imLayout(c, BLOCK); imFlex(c, 2); imGap(c, 1, CH); imJustify(c, RIGHT); {
                                // NOTE: these could be buttons.
                                if (isFirstishRender(c)) {
                                    // TODO: standardize
                                    elSetStyle(c, "fontSize", "18px");
                                    elSetStyle(c, "fontWeight", "bold");
                                    elSetStyle(c, "textAlign", "right");
                                }

                                const commands = ctx.discoverableCommands; {
                                    imFor(c); for (let i = 0; i < commands.stabilizedIdx; i++) {
                                        const command = commands.stabilized[i];
                                        if (!command.key) continue;

                                        imCommandDescription(c, command.key.stringRepresentation, command.desc);
                                    } imForEnd(c);

                                    const anyFulfilled = (ctx.keyboard.shiftKey.held && commands.shiftAvailable) ||
                                        (ctx.keyboard.ctrlKey.held && commands.ctrlAvailable) ||
                                        (ctx.keyboard.altKey.held && commands.altAvailable)

                                    if (imIf(c) && !anyFulfilled) {
                                        if (imIf(c) && commands.shiftAvailable) {
                                            imCommandDescription(c, ctx.keyboard.shiftKey.stringRepresentation, "Hold");
                                        } imIfEnd(c);

                                        if (imIf(c) && commands.ctrlAvailable) {
                                            imCommandDescription(c, ctx.keyboard.ctrlKey.stringRepresentation, "Hold");
                                        } imIfEnd(c);

                                        if (imIf(c) && commands.altAvailable) {
                                            imCommandDescription(c, ctx.keyboard.altKey.stringRepresentation, "Hold");
                                        } imIfEnd(c);
                                    } imIfEnd(c);

                                    commands.shiftAvailable = false;
                                    commands.ctrlAvailable = false;
                                    commands.altAvailable = false;
                                } 

                                imLayout(c, BLOCK); imSize(c, 10, PX, 0, NA); imLayoutEnd(c);
                            } imLayoutEnd(c);
                        } imLayoutEnd(c);
                    } imIfEnd(c);

                    imLine(c, LINE_HORIZONTAL, 4);

                    if (imIf(c) && ctx.currentView === ctx.views.settings) {
                        imSettingsView(c, ctx, ctx.views.settings);
                    } else {
                        imIfElse(c);

                        imLayout(c, ROW); imFlex(c); {
                            // TODO: think about this.
                            let focusRef = imGet(c, newFocusRef);
                            if (!focusRef) focusRef = imSet(c, newFocusRef());

                            focusRef.focused = ctx.currentView;
                            const navList = imViewsList(c, focusRef);

                            imLayout(c, COL); imFlex(c); {
                                imNoteTreeView(c, ctx, ctx.views.noteTree);
                                addView(navList, ctx.views.noteTree, "Notes");

                                if (imIf(c) && ctx.viewingDurations) {
                                    imLine(c, LINE_HORIZONTAL, 1);

                                    imLayout(c, COL); imFlex(c); {
                                        if (isFirstishRender(c)) {
                                            elSetStyle(c, "maxHeight", "33%");
                                        }

                                        imDurationsView(c, ctx, ctx.views.durations);
                                        addView(navList, ctx.views.durations, "Durations");
                                    } imLayoutEnd(c);
                                } imIfEnd(c);
                            } imLayoutEnd(c);

                            imLine(c, LINE_VERTICAL, 1);
                            // imLayout(c, BLOCK); {
                            //     imInitStyles(`width: 1px; background-color: ${cssVarsApp.fgColor};`)
                            // } imLayoutEnd(c);

                            if (
                                ctx.currentView !== ctx.views.noteTree &&
                                ctx.currentView !== ctx.views.durations
                            ) {
                                ctx.leftTab = ctx.currentView;
                                ctx.notLockedIn = true;
                            } else {
                                ctx.leftTab = ctx.views.activities;
                            }

                            if (imIf(c) && ctx.notLockedIn) {
                                imLayout(c, COL); {
                                    if (isFirstishRender(c)) {
                                        elSetStyle(c, "width", "33%");
                                    }

                                    imSwitch(c, ctx.leftTab); switch (ctx.leftTab) {
                                        case ctx.views.activities: {
                                            imActivitiesList(c, ctx, ctx.views.activities);
                                            addView(navList, ctx.views.activities, "Activities");
                                        } break;
                                        case ctx.views.fastTravel: {
                                            imNoteTraversal(c, ctx, ctx.views.fastTravel);
                                            addView(navList, ctx.views.fastTravel, "Fast travel");
                                        } break;
                                        case ctx.views.finder: {
                                            imFuzzyFinder(c, ctx, ctx.views.finder);
                                            addView(navList, ctx.views.finder, "Finder");
                                        } break;
                                        case ctx.views.urls: {
                                            imUrlViewer(c, ctx, ctx.views.urls);
                                            addView(navList, ctx.views.urls, "Url opener");
                                        } break;
                                    } imSwitchEnd(c);
                                } imLayoutEnd(c);
                            } imIfEnd(c);

                            // navigate list
                            {
                                const prev = get(navList.views, getWrappedIdx(navList.idx - 1, navList.imLength));
                                const next = get(navList.views, getWrappedIdx(navList.idx + 1, navList.imLength));
                                if (prev && next) {
                                    const tabInput = getTabInput(ctx, "Go to " + prev.name, "Go to " + next.name);
                                    if (tabInput < 0) {
                                        setCurrentView(ctx, prev.focusRef);
                                    } else if (tabInput > 0) {
                                        setCurrentView(ctx, next.focusRef);
                                    }
                                }
                            }
                        } imLayoutEnd(c);
                    } imIfEnd(c);
                } imLayoutEnd(c);
            } 


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
                        setCurrentView(ctx, ctx.views.noteTree);
                    }

                    if (!ctx.notLockedIn && hasDiscoverableCommand(ctx, ctx.keyboard.escapeKey, "Stop locking in")) {
                        ctx.notLockedIn = true;
                        setCurrentView(ctx, ctx.views.noteTree);
                    }
                }

                // fuzzy finder
                if (
                    ctx.currentView !== ctx.views.finder &&
                    hasDiscoverableCommand(ctx, ctx.keyboard.fKey, "Find", CTRL | BYPASS_TEXT_AREA)
                ) {
                    setCurrentView(ctx, ctx.views.finder);
                }

                // timesheet

                if (
                    !ctx.viewingDurations && 
                    hasDiscoverableCommand(ctx, ctx.keyboard.dKey, "Duration timesheet")
                ) {
                    ctx.viewingDurations = true;
                    setCurrentView(ctx, ctx.views.durations);
                } else if (
                    ctx.viewingDurations &&
                    hasDiscoverableCommand(
                        ctx, ctx.keyboard.escapeKey, "Close timesheet",
                        ctx.currentView === ctx.views.finder ? BYPASS_TEXT_AREA : 0
                    )
                ) {
                    ctx.viewingDurations = false;
                    if (ctx.currentView === ctx.views.durations) {
                        setCurrentView(ctx, ctx.views.noteTree);
                    }
                    ctx.views.activities.inputs.activityFilter = null;
                }

                // close locoked-in mode
                ctx.notLockedIn

                // back to the last note when escape pressed
                {
                    if (
                        ctx.currentView !== ctx.views.noteTree &&
                        ctx.noteBeforeFocus &&
                        hasDiscoverableCommand(
                            ctx, ctx.keyboard.escapeKey, "Back to notes",
                            ctx.currentView === ctx.views.finder ? BYPASS_TEXT_AREA : 0
                        )
                    ) {
                        setCurrentNote(state, ctx.noteBeforeFocus.id);
                        setCurrentView(ctx, ctx.views.noteTree);
                    }
                }

                if (
                    ctx.currentView !== ctx.views.settings,
                    hasDiscoverableCommand(ctx, ctx.keyboard.commaKey, "Settings", CTRL)
                ) {
                    setCurrentView(ctx, ctx.views.settings);
                }

                // Take a break from any view.
                // Also, shouldn't bypass the text area - if it could, we wouldn't be able to type "B"
                if (hasDiscoverableCommand(ctx, ctx.keyboard.bKey, "Take a break", SHIFT)) {
                    setCurrentView(ctx, ctx.views.activities);
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
                    preventImKeysDefault(ctx.ev);
                }

                // Only one text area can be focued at a time in the entire document.
                // imMemo here, because we still want to select text with the mouse.
                // Not ideal for a real app, but preventing it makes it not feel like a real website.
                if (imMemo(c, ctx.textAreaToFocus) && ctx.textAreaToFocus) {
                    const textArea = ctx.textAreaToFocus;
                    textArea.focus();
                    if (ctx.focusWithAllSelected) {
                        textArea.selectionStart = 0;
                        textArea.selectionEnd = textArea.value.length;
                        ctx.focusWithAllSelected = false;
                    }
                }
                ctx.textAreaToFocus = null;

                // discoverable commands (at the very end).
                updateDiscoverableCommands(ctx.discoverableCommands);
            }

            // Need to make sure that we aren't overwriting the latest state. 
            {
                let mutationState; mutationState = imGet(c, inlineTypeId(getLastSavedTimestampLocalstate));
                if (!mutationState) mutationState = imSet(c, {
                    lastSyncTime: getLastSavedTimestampLocalstate(),
                });

                const val = getLastSavedTimestampLocalstate();
                if (val !== mutationState.lastSyncTime) {
                    if (mutationState.lastSyncTime !== null) {
                        // Another program has just saved the state. we need to reload it.
                        loadState(() => {
                            // TODO: showStatusText
                            logTrace("Reloaded the state!");
                        });
                    }

                    mutationState.lastSyncTime = val;
                }
            }

            errorState.framesSinceError++;
        } else {
            imIfElse(c);

            // TODO: provide a way to recover from errors that _are_ recoverable

            imLayout(c, BLOCK); imStr(c, "An error occured in the main render loop. It's irrecoverable, I'm afraid"); imLayoutEnd(c);
        } imIfEnd(c);
    } catch (e) {
        // unmounts imComponent1 immediately, rewinds the stack back to this list.
        imTryCatch(c, tryState, e);

        console.error("An error occured while rendering: ", e);

        errorState.error = e;

        if (errorState.framesSinceError !== 0) {
            errorState.framesSinceError = 0;
        } else {
            errorState.irrecoverableError = true;
            errorState.error = e;
        }
    } imTryEnd(c, tryState);

    imGlobalEventSystemEnd(c, ctx.ev);

    fpsMarkRenderingEnd(fpsCounter);
}

const cGlobal: ImCache = [];

function imMainEntry(c: ImCache) {
    imCacheBegin(c, imMainEntry); {
        imDomRootBegin(c, document.body); {
            imMainInner(c);
        } imDomRootEnd(c, document.body);
    } imCacheEnd(c);
};

function imCommandDescription(c: ImCache, key: string, action: string) {
    imLayout(c, INLINE_BLOCK); imAlign(c, CENTER); imPre(c); {
        imStr(c, "["); imStr(c, key); imStr(c, " - ");
        imStr(c, action);
        imStr(c, "]");
    } imLayoutEnd(c);
}

loadState(() => {
    imMainEntry(cGlobal);
});

// Using a custom styling solution
initCssbStyles();
