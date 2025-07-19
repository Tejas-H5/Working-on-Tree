import { imActivitiesList } from "./activities-list";
import { imHLine } from "./app-components/common";
import { cnApp, cssVarsApp } from "./app-styling";
import { imTimerRepeat } from "./app-utils/timer";
import {
    COL,
    imAlign,
    imBegin,
    imFixed,
    imFlex,
    imGap,
    imH100,
    imInitStyles,
    imJustify,
    imSize,
    NOT_SET,
    PX,
    RIGHT,
    ROW
} from "./components/core/layout";
import { imT } from "./components/core/text";
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
import { imNotePlanView } from "./note-journal-view";
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
    imEnd,
    imEndIf,
    imEndSwitch,
    imIf,
    imState,
    imSwitch,
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

                    imT("Note tree - " + formatDateTime(new Date(), displayColon.val ? ":" : " ")); imEnd();
                } imEnd();
                imBegin(ROW); imFlex(); imAlign(); imJustify(); imGap(10, PX); {
                } imEnd();
                imBegin(ROW); imFlex(); imJustify(RIGHT); {
                    // NOTE: these could be buttons.

                    imT("[1] Notes"); {
                        setClass(cnApp.defocusedText, state._currentScreen !== APP_VIEW_TREE);
                    } imEnd();

                    imT("[2] Activities"); {
                        setClass(cnApp.defocusedText, state._currentScreen !== APP_VIEW_ACTIVITIES);
                    } imEnd();

                    imT("[3] Plan"); {
                        setClass(cnApp.defocusedText, state._currentScreen !== APP_VIEW_PLAN);
                    } imEnd();

                    imBegin(); imSize(10, PX, 0, NOT_SET); imEnd();
                } imEnd();
            } imEnd();

            imHLine(4);

            imSwitch(state._currentScreen);
            switch (state._currentScreen) {
                case APP_VIEW_TREE: 
                case APP_VIEW_ACTIVITIES: 
                {
                    imBegin(ROW); imH100(); {
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
                } break;
                case APP_VIEW_PLAN: {
                    imNotePlanView(ctx, state._currentScreen === APP_VIEW_ACTIVITIES);
                } break;
            } imEndSwitch();
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
}

loadState(() => {
    recomputeState(state);
    console.log("State: ", state);
    initImDomUtils(imMain);
})

// Using a custom styling solution
initCssbStyles();
setTheme("Light");
