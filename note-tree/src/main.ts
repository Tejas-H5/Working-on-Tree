import { imActivitiesList } from "./activities-list";
import { imLine } from "./app-components/common";
import { cnApp, cssVarsApp } from "./app-styling";
import { imTimerRepeat } from "./app-utils/timer";
import {
    CH,
    COL,
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
    loadState,
    recomputeState,
    setTheme,
    state
} from "./state";
import { initCssbStyles } from "./utils/cssb";
import { formatDateTime } from "./utils/datetime";
import {
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
    setClass,
    setStyle,
    setText
} from "./utils/im-dom-utils";

function imMain() {
    const fpsCounter = imState(newFpsCounterState);
    const ctx = imState(newGlobalContext);
    ctx.now = new Date();

    const errorRef = imRef();
    
    const l = imTry(); try {
        handleImKeysInput(ctx);

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

                        imSpan("Note tree - " + formatDateTime(new Date(), displayColon.val ? ":" : " ", true)); imEnd();
                    } imEnd();
                    imBegin(ROW); imFlex(2); imJustify(RIGHT); imGap(1, CH); {
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

                        imBegin(); imSize(10, PX, 0, NOT_SET); imEnd();
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
    } catch (e) {
         // unmounts imComponent1 immediately, rewinds the stack back to this list.
         imCatch(l);

         console.error("An error occured while rendering: ", e);
         errorRef.val = e;
    } 
    imEndTry();
}

loadState(() => {
    recomputeState(state);
    console.log("State: ", state);
    initImDomUtils(imMain);
})

// Using a custom styling solution
initCssbStyles();
setTheme("Light");
