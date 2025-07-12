import {
    COL,
    imBegin,
    imFixed
} from "./components/core/layout";
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
import { imAppViewJournal } from "./note-journal-view";
import { imAppViewTree } from "./note-tree-view";
import {
    loadState,
    recomputeState,
    setTheme,
    state
} from "./state";
import { initCssbStyles } from "./utils/cssb";
import {
    imEnd,
    imEndIf,
    imIf,
    imState,
    initImDomUtils,
    isFirstishRender,
    setStyle,
    setText,
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

            if (0) {
                imAppViewTree(ctx); 
            } else {
                imAppViewJournal(ctx); 
            }

            imFpsCounterOutput(fpsCounter);
        } imEnd();
    } stopFpsCounter(fpsCounter);


    // post-process events, etc
    {
        if (!ctx.handled) {
            const keyboard = ctx.keyboard;
            if (keyboard.aKey.pressed && keyboard.ctrlKey.held) {
                // no, I don't want to select all text being in the DOM, actually
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
