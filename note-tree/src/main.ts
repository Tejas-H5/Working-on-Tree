import { imDurationsView } from "src/app-views/durations-view";
import { imFuzzyFinder } from "src/app-views/fuzzy-finder";
import { imNoteTraversal } from "src/app-views/fast-travel";
import { imNoteTreeView } from "src/app-views/note-tree-view";
import { imSettingsView } from "src/app-views/settings-view";
import { imUrlViewer } from "src/app-views/url-viewer";
import { im, ImCache, imdom, el, ev, NormalizedKey, } from "src/utils/im-js";

import { imAppHeadingBegin, imAppHeadingEnd, } from "./app-components/app-heading";
import { imAsciiIcon } from "./app-components/ascii-icon";
import { addView, getTabInput, imViewsList, newFocusRef } from "./app-components/navigable-list";
import { cssVarsApp } from "./app-styling";
import { imTimerRepeat } from "./app-utils/timer";
import { activitiesViewTakeBreak, imActivitiesList } from "./app-views/activities-list";
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
    imLayoutBegin,
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
import { cssVars } from "./components/core/stylesheets";
import {
    fpsMarkRenderingEnd,
    fpsMarkRenderingStart,
    imExtraDiagnosticInfo,
    imFpsCounterSimple,
    newFpsCounterState,
} from "./components/fps-counter";
import { imLine, LINE_HORIZONTAL, LINE_VERTICAL } from "./components/im-line";
import {
    AUTO_INSERT_BREAK_CHECK_INTERVAL,
    autoInsertBreakIfRequired,
    BYPASS_TEXT_AREA,
    CTRL,
    debouncedSave,
    getKeyStringRepr,
    handleImKeysInput,
    hasDiscoverableCommand,
    HIDDEN,
    newGlobalContext,
    preventImKeysDefault,
    reloadStateIfNewer,
    REPEAT,
    setCurrentView,
    SHIFT,
    TASK_IN_PROGRESS,
    updateDiscoverableCommands
} from "./global-context";
import {
    Activity,
    AppTheme,
    getFirstActivityWithNoteIdx,
    getLastActivityWithNoteIdx,
    idIsNilOrRoot,
    loadState,
    setCurrentNote,
    setTheme,
    state
} from "./state";
import { arrayAt, getWrappedIdx } from "./utils/array-utils";
import { initCssbStyles } from "./utils/cssb";
import { formatDateTime } from "./utils/datetime";
import { isEditingTextSomewhereInDocument } from "./utils/dom-utils";
import { newWebWorker } from "./utils/web-workers";
import { NIL_ID } from "./utils/int-tree";
import { validateSchemas } from "./schema";
import { imGraphMappingsEditorView } from "./app-views/graph-view";


function getIcon(theme: AppTheme) {
    if (theme === "Light") return ASCII_SUN;
    if (theme === "Dark")  return ASCII_MOON_STARS;
    return ASCII_MOON_STARS;
}

const IS_RUNNING_FROM_FILE = window.location.protocol.startsWith("file");

function imMainInner(c: ImCache) {
    let fpsCounter = im.Get(c, newFpsCounterState);
    if (!fpsCounter) fpsCounter = im.Set(c, newFpsCounterState());

    fpsMarkRenderingStart(fpsCounter); 

    let ctx = im.Get(c, newGlobalContext);
    if (!ctx) ctx = im.Set(c, newGlobalContext());


    if (!ctx.leftTab) ctx.leftTab = ctx.views.activities;
    if (!ctx.currentView) ctx.currentView = ctx.views.noteTree;
    if (im.Memo(c, state.currentTheme)) setTheme(state.currentTheme);

    if (im.Memo(c, state.settings.tabStopSize)) {
        imdom.setStyle(c, "tabSize", "" + state.settings.tabStopSize);
    }

    ctx.now = new Date();

    let errorState; errorState = im.GetInline(c, im.Try);
    if (!errorState) {
        errorState = im.Set(c, {
            error: null as any,
            framesSinceError: 0,
            irrecoverableError: null as any,
        })
    }

    if (!im.GetInline(c, im.Get)) {
        im.Set(c, true);

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

    const tryState = im.Try(c); try {
        if (im.If(c) && !errorState.error && !errorState.irrecoverableError) {
            handleImKeysInput(ctx);

            if (im.Memo(c, state._notesMutationCounter) === im.MEMO_CHANGED) {
                if (state._notesMutationCounter !== 0) {
                    debouncedSave(ctx, state, "ImMain memoizer - notes mutation");
                }
            }
            if (im.Memo(c, state._activitiesMutationCounter) === im.MEMO_CHANGED) {
                if (state._activitiesMutationCounter !== 0) {
                    debouncedSave(ctx, state, "ImMain memoizer - activities mutation");
                }
            }

            {
                imLayoutBegin(c, COL); imFixed(c, 0, PX, 0, PX, 0, PX, 0, PX); {
                    const error = state.criticalSavingError || state._criticalLoadingError;
                    if (im.If(c) && error) {
                        imLayoutBegin(c, BLOCK); {
                            if (im.isFirstishRender(c)) {
                                imdom.setStyle(c, "color", "white");
                                imdom.setStyle(c, "backgroundColor", "red");
                            }

                            imdom.Str(c, error);
                        } imLayoutEnd(c);
                    } im.IfEnd(c);

                    let displayColon; displayColon = im.GetInline(c, Boolean);
                    if (!displayColon) displayColon = im.Set(c, { val: false });

                    if (imTimerRepeat(c, 1.0)) {
                        displayColon.val = !displayColon.val;
                    }

                    if (im.If(c) && ctx.notLockedIn) {
                        imLayoutBegin(c, ROW); imAlign(c, CENTER); {
                            imLayoutBegin(c, ROW); imButton(c); imAlign(c); imJustify(c); imSize(c, 0, NA, 100, PERCENT); {
                                imLayoutBegin(c, BLOCK); imSize(c, 10, PX, 0, NA); imLayoutEnd(c);

                                const nextTheme = state.currentTheme === "Dark" ? "Light" : "Dark";
                                let icon = getIcon(state.currentTheme);
                                if (imdom.hasMouseOver(c)) {
                                    icon = getIcon(nextTheme);
                                }

                                imAsciiIcon(c, icon, 4.5);

                                if (imdom.hasMousePress(c)) {
                                    state.currentTheme = nextTheme;
                                    debouncedSave(ctx, state, "Theme change");
                                }

                                imLayoutBegin(c, BLOCK); imSize(c, 10, PX, 0, NA); imLayoutEnd(c);
                            } imLayoutEnd(c);

                            imLine(c, LINE_VERTICAL);

                            imLayoutBegin(c, ROW); imFlex(c); {
                                imAppHeadingBegin(c); {
                                    imdom.Str(c, formatDateTime(new Date(), displayColon.val ? ":" : "\xa0", true));
                                } imAppHeadingEnd(c);
                            } imLayoutEnd(c);

                            const root = imLayoutBegin(c, ROW); imFlex(c); imAlign(c); imJustify(c); {
                                if (im.isFirstishRender(c)) {
                                    // TODO: standardize
                                    imdom.setStyle(c, "fontSize", "20px");
                                    imdom.setStyle(c, "fontWeight", "bold");
                                }

                                if (im.If(c) && ctx.status.statusTextTimeLeftSeconds > 0) {
                                    ctx.status.statusTextTimeLeftSeconds -= im.getDeltaTimeSeconds(c);
                                    const statusTextChanged = im.Memo(c, ctx.status.statusText);

                                    let t = im.Get(c, Math.sin);
                                    if (t === undefined || statusTextChanged) t = 0;
                                    t = im.Set(c, t + im.getDeltaTimeSeconds(c));

                                    // bruh
                                    if (im.If(c) && ctx.status.statusTextType === TASK_IN_PROGRESS) {
                                        const opacity = ctx.status.statusTextTimeLeftSeconds / ctx.status.statusTextTimeInitialSeconds;
                                        imdom.setStyle(c, "opacity", "" + opacity, root);

                                        imLayoutBegin(c, BLOCK); {
                                            if (im.isFirstishRender(c)) {
                                                imdom.setStyle(c, "width", "20px");
                                                imdom.setStyle(c, "height", "20px");
                                            }

                                            imdom.setStyle(c, "transform", "rotate(" + 5 * t + "rad)");
                                            imdom.setStyle(c, "backgroundColor", cssVarsApp.fgColor);
                                        } imLayoutEnd(c);
                                    } else {
                                        im.IfElse(c);

                                        imdom.setStyle(c, "opacity", "1", root);
                                    } im.IfEnd(c);

                                    imLayoutBegin(c, BLOCK); imSize(c, 10, PX, 0, NA); imLayoutEnd(c);

                                    imLayoutBegin(c, BLOCK); imdom.Str(c, ctx.status.statusText); imLayoutEnd(c);

                                    if (im.If(c) && ctx.status.statusTextType === TASK_IN_PROGRESS) {
                                        imLayoutBegin(c, BLOCK); {
                                            imdom.Str(c, ".".repeat(Math.ceil(2 * t % 3)));
                                        } imLayoutEnd(c);
                                    } im.IfEnd(c);
                                } else {
                                    im.IfElse(c);

                                    imLayoutBegin(c, COL); imAlign(c); {
                                        imFpsCounterSimple(c, fpsCounter);
                                        imExtraDiagnosticInfo(c);
                                    } imLayoutEnd(c);
                                } im.IfEnd(c);
                            } imLayoutEnd(c);

                            imLayoutBegin(c, BLOCK); imFlex(c, 2); imGap(c, 1, CH); imJustify(c, RIGHT); {
                                // NOTE: these could be buttons.
                                if (im.isFirstishRender(c)) {
                                    // TODO: standardize
                                    imdom.setStyle(c, "fontSize", "18px");
                                    imdom.setStyle(c, "fontWeight", "bold");
                                    imdom.setStyle(c, "textAlign", "right");
                                }

                                const commands = ctx.discoverableCommands; {
                                    im.For(c); for (let i = 0; i < commands.stabilizedIdx; i++) {
                                        const command = commands.stabilized[i];
                                        if (!command.key) continue;

                                        imCommandDescription(c, command.key, command.desc);
                                    } im.ForEnd(c);

                                    const keys = imdom.getKeyboard();

                                    const anyFulfilled = (imdom.isKeyHeld(keys, ctx.keyboard.shiftKey) && commands.shiftAvailable) ||
                                        (imdom.isKeyHeld(keys, ctx.keyboard.ctrlKey) && commands.ctrlAvailable) ||
                                        (imdom.isKeyHeld(keys, ctx.keyboard.altKey) && commands.altAvailable)

                                    if (im.If(c) && !anyFulfilled) {
                                        if (im.If(c) && commands.shiftAvailable) {
                                            imCommandDescription(c, ctx.keyboard.shiftKey, "Hold");
                                        } im.IfEnd(c);

                                        if (im.If(c) && commands.ctrlAvailable) {
                                            imCommandDescription(c, ctx.keyboard.ctrlKey, "Hold");
                                        } im.IfEnd(c);

                                        if (im.If(c) && commands.altAvailable) {
                                            imCommandDescription(c, ctx.keyboard.altKey, "Hold");
                                        } im.IfEnd(c);
                                    } im.IfEnd(c);

                                    commands.shiftAvailable = false;
                                    commands.ctrlAvailable = false;
                                    commands.altAvailable = false;
                                } 

                                imLayoutBegin(c, BLOCK); imSize(c, 10, PX, 0, NA); imLayoutEnd(c);
                            } imLayoutEnd(c);
                        } imLayoutEnd(c);
                    } im.IfEnd(c);

                    imLine(c, LINE_HORIZONTAL, 4);

                    if (im.If(c) && ctx.currentView === ctx.views.settings) {
                        imSettingsView(c, ctx, ctx.views.settings);
                    } else if (im.IfElse(c) && ctx.currentView === ctx.views.mappings) {
                        imGraphMappingsEditorView(c, ctx.views.mappings, state.mappingGraph, state.mappingGraphView);
                        const graphChanged = im.Memo(c, state.mappingGraph._version) === im.MEMO_CHANGED;
                        const graphViewChanged = im.Memo(c, state.mappingGraphView._version) === im.MEMO_CHANGED;
                        if (graphChanged || graphViewChanged) {
                            debouncedSave(ctx, state, "ImMain - graph edit");
                        }
                    } else {
                        im.IfElse(c);

                        imLayoutBegin(c, ROW); imFlex(c); {
                            // TODO: think about this.
                            let focusRef = im.Get(c, newFocusRef);
                            if (!focusRef) focusRef = im.Set(c, newFocusRef());

                            focusRef.focused = ctx.currentView;
                            const navList = imViewsList(c, focusRef);

                            imLayoutBegin(c, COL); imFlex(c); {
                                imNoteTreeView(c, ctx, ctx.views.noteTree);
                                addView(navList, ctx.views.noteTree, "Notes");

                                if (im.If(c) && ctx.viewingDurations) {
                                    imLine(c, LINE_HORIZONTAL, 1);

                                    imLayoutBegin(c, COL); imFlex(c); {
                                        if (im.isFirstishRender(c)) {
                                            imdom.setStyle(c, "maxHeight", "33%");
                                        }

                                        imDurationsView(c, ctx, ctx.views.durations);
                                        addView(navList, ctx.views.durations, "Durations");
                                    } imLayoutEnd(c);
                                } im.IfEnd(c);
                            } imLayoutEnd(c);

                            imLine(c, LINE_VERTICAL, 1);

                            if (
                                ctx.currentView !== ctx.views.noteTree &&
                                ctx.currentView !== ctx.views.durations
                            ) {
                                ctx.leftTab = ctx.currentView;
                                ctx.notLockedIn = true;
                            } else {
                                ctx.leftTab = ctx.views.activities;
                            }

                            if (im.If(c) && ctx.notLockedIn) {
                                imLayoutBegin(c, COL); {
                                    if (im.isFirstishRender(c)) {
                                        imdom.setStyle(c, "width", "33%");
                                    }

                                    im.Switch(c, ctx.leftTab); switch (ctx.leftTab) {
                                        case ctx.views.activities: {
                                            imLayoutBegin(c, COL); imFlex(c); {
                                                imActivitiesList(c, ctx, ctx.views.activities);
                                                addView(navList, ctx.views.activities, "Activities");

                                                if (!IS_RUNNING_FROM_FILE) {
                                                    imLayoutBegin(c, BLOCK); imButton(c); {
                                                        if (im.isFirstishRender(c)) {
                                                            imdom.setStyle(c, "padding", "10px");
                                                            imdom.setStyle(c, "borderTop", "1px solid " + cssVars.fg);
                                                            imdom.setStyle(c, "fontWeight", "bold");
                                                            imdom.setStyle(c, "textAlign", "center");
                                                        }

                                                        imdom.Str(c, "Download this page, and run it offline!");

                                                        if (imdom.hasMouseClick(c)) {
                                                            const linkEl = document.createElement("a");
                                                            linkEl.setAttribute("download", "note-tree.html");
                                                            linkEl.setAttribute("href", window.location.href);
                                                            linkEl.click();
                                                        }
                                                    } imLayoutEnd(c);
                                                }
                                            } imLayoutEnd(c);
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
                                    } im.SwitchEnd(c);
                                } imLayoutEnd(c);
                            } im.IfEnd(c);

                            // navigate list
                            {
                                const prev = arrayAt(navList.views, getWrappedIdx(navList.idx - 1, navList.imLength));
                                const next = arrayAt(navList.views, getWrappedIdx(navList.idx + 1, navList.imLength));
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
                    } im.IfEnd(c);
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


                if (
                    ctx.currentView !== ctx.views.settings &&
                    hasDiscoverableCommand(ctx, ctx.keyboard.commaKey, "Settings", CTRL)
                ) {
                    setCurrentView(ctx, ctx.views.settings);
                }

                if (
                    ctx.currentView !== ctx.views.mappings &&
                    hasDiscoverableCommand(ctx, ctx.keyboard.gKey, "Mappings Graph")
                ) {
                    setCurrentView(ctx, ctx.views.mappings);
                }

                // back to the last note when escape pressed
                {
                    if (
                        ctx.currentView !== ctx.views.noteTree &&
                        hasDiscoverableCommand(
                            ctx, ctx.keyboard.escapeKey, "Back to notes",
                            ctx.currentView === ctx.views.finder ? BYPASS_TEXT_AREA : 0
                        )
                    ) {
                        if (ctx.noteBeforeFocus) {
                            setCurrentNote(state, ctx.noteBeforeFocus.id);
                        }
                        setCurrentView(ctx, ctx.views.noteTree);
                    }
                }

                // Traverse the history
                {
                    const keys = imdom.getKeyboard();

                    const ctrlAndShiftHeld = imdom.isKeyHeld(keys, ctx.keyboard.shiftKey) && imdom.isKeyHeld(keys, ctx.keyboard.ctrlKey);
                    if (im.Memo(c, ctrlAndShiftHeld)) {
                        if (ctrlAndShiftHeld) {
                            // Start traversal from the most recent activity
                            const newActivityIdx = state.activities.length - 1;
                            state._activitiesTraversalIdx = newActivityIdx;
                        } else {
                            state._activitiesTraversalIdx = -1;
                        }
                    }

                    if (state._activitiesTraversalIdx !== -1) {
                        // Activities for the same note can re-appear at different indices, so it is more correct to
                        // use indices here instead of activity -> note id

                        const firstActivityIdx = getFirstActivityWithNoteIdx(state);
                        const lastActivityIdx = getLastActivityWithNoteIdx(state);

                        let newActivity: Activity | undefined;

                        // We actually are forced to handle repeats here - otherwise we'll start selecting text.
                        const flags = CTRL | SHIFT | REPEAT;
                        // And we need to handle this event all the time. Otherwise the default behaviour
                        // starts happening again when we reach either end of the activity list :D
                        const canGoBack = firstActivityIdx < state._activitiesTraversalIdx;
                        if (
                            hasDiscoverableCommand(ctx, ctx.keyboard.leftKey, "Last activity", flags | (canGoBack ? 0 : HIDDEN))
                        ) {
                            if (!idIsNilOrRoot(state._jumpBackToId)) {
                                setCurrentNote(state, state._jumpBackToId);
                                state._jumpBackToId = NIL_ID;
                            } else {
                                while (state._activitiesTraversalIdx > firstActivityIdx) {
                                    state._activitiesTraversalIdx--;
                                    newActivity = state.activities[state._activitiesTraversalIdx]
                                    if (newActivity.nId) break;
                                }
                            }
                        }

                        const canGoForward = state._activitiesTraversalIdx < lastActivityIdx;
                        if (
                            hasDiscoverableCommand(ctx, ctx.keyboard.rightKey, "Next activity", flags | (canGoForward ? 0 : HIDDEN))
                        ) {
                            while (state._activitiesTraversalIdx < lastActivityIdx) {
                                state._activitiesTraversalIdx++;
                                newActivity = state.activities[state._activitiesTraversalIdx]
                                if (newActivity.nId) break;
                            }
                        }

                        if (newActivity && newActivity.nId) {
                            setCurrentNote(state, newActivity.nId);
                        }
                    }
                }

                // Take a break from any view.
                // Also, shouldn't bypass the text area - if it could, we wouldn't be able to type "B"
                if (hasDiscoverableCommand(ctx, ctx.keyboard.bKey, "Take a break", SHIFT)) {
                    setCurrentView(ctx, ctx.views.activities);
                    activitiesViewTakeBreak(ctx, ctx.views.activities);
                    ctx.handled = true;
                }

                if (!ctx.handled) {
                    const keys = imdom.getKeyboard();

                    const keyboard = ctx.keyboard;
                    if (imdom.isKeyPressed(keys, keyboard.aKey) && imdom.isKeyPressed(keys, keyboard.ctrlKey) && !isEditingTextSomewhereInDocument()) {
                        // no, I don't want to select all text being in the DOM, actually
                        ctx.handled = true;
                    }

                    if (imdom.isKeyPressed(keys, keyboard.tabKey) && !isEditingTextSomewhereInDocument()) {
                        // no, I don't want to defucs the program, actually
                        ctx.handled = true;
                    }
                }

                if (ctx.handled) {
                    preventImKeysDefault();
                }


                const textAreaToFocusChanged = im.Memo(c, ctx.textAreaToFocus);

                // Only one text area can be focued at a time in the entire document.
                // im.Memo here, because we still want to select text with the mouse.
                // Not ideal for a real app, but preventing it makes it not feel like a real website.
                if (textAreaToFocusChanged || ctx.focusNextFrame) {
                    ctx.focusNextFrame = false;
                    const textArea = ctx.textAreaToFocus;
                    if (textArea) {
                        textArea.focus();
                        if (ctx.focusWithAllSelected) {
                            textArea.selectionStart = 0;
                            textArea.selectionEnd = textArea.value.length;
                            ctx.focusWithAllSelected = false;
                        }
                    }
                }
                ctx.textAreaToFocus = null;

                const lockedInChanged = im.Memo(c, ctx.notLockedIn);
                if (lockedInChanged) {
                    ctx.focusNextFrame = true;
                }

                // discoverable commands (at the very end).
                updateDiscoverableCommands(ctx.discoverableCommands);
            }

            // Need to make sure that we aren't overwriting the latest state. 
            {
                reloadStateIfNewer();
            }

            errorState.framesSinceError++;
        } else {
            im.IfElse(c);

            // TODO: provide a way to recover from errors that _are_ recoverable

            imLayoutBegin(c, BLOCK); imdom.Str(c, "An error occured in the main render loop. It's irrecoverable, I'm afraid"); imLayoutEnd(c);
        } im.IfEnd(c);
    } catch (e) {
        // unmounts imComponent1 immediately, rewinds the stack back to this list.
        im.Catch(c, tryState, e);

        console.error("An error occured while rendering: ", e);

        errorState.error = e;

        if (errorState.framesSinceError !== 0) {
            errorState.framesSinceError = 0;
        } else {
            errorState.irrecoverableError = true;
            errorState.error = e;
        }
    } im.TryEnd(c, tryState);


    fpsMarkRenderingEnd(fpsCounter);
}

const cGlobal: ImCache = [];

function imMainEntryPoint(c: ImCache) {
    im.CacheBegin(c, imMainEntryPoint); {
        imdom.RootBegin(c, document.body); {
            const ev = imdom.GlobalEventSystemBegin(c);

            imMainInner(c);

            imdom.GlobalEventSystemEnd(c, ev);
        } imdom.RootEnd(c, document.body);
    } im.CacheEnd(c);
};

function imCommandDescription(c: ImCache, key: NormalizedKey, action: string) {
    imLayoutBegin(c, INLINE_BLOCK); imAlign(c, CENTER); imPre(c); {
        imdom.Str(c, "["); imdom.StrFmt(c, key, getKeyStringRepr); imdom.Str(c, " - ");
        imdom.Str(c, action);
        imdom.Str(c, "]");
    } imLayoutEnd(c);
}

validateSchemas();

loadState(() => {
    imMainEntryPoint(cGlobal);
});

// Using a custom styling solution
initCssbStyles();
