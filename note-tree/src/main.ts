import { imHLineDivider } from "./app-components/common";
import {
    COL,
    imBegin,
    imFixed,
    imPadding,
    INLINE,
    NOT_SET,
    PX
} from "./components/core/layout";
import { newH1 } from "./components/core/new-dom-nodes";
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
import { imNoteTreeView } from "./note-tree-view";
import {
    getNoteOrUndefined,
    loadState,
    recomputeState,
    setTheme,
    state
} from "./state";
import { initCssbStyles } from "./utils/cssb";
import {
    imBeginRoot,
    imEnd,
    imEndIf,
    imIf,
    imState,
    initImDomUtils,
    isFirstRender,
    setStyle,
    setText
} from "./utils/im-dom-utils";

function imMain() {
    const fpsCounter = imState(newFpsCounterState);
    const ctx = imState(newGlobalContext);

    handleImKeysInput(ctx);

    startFpsCounter(fpsCounter); {
        imBegin(COL); imFixed(0, 0, 0, 0); {
            imBeginRoot(newH1); 
            imPadding(10, PX, 0, NOT_SET, 0, NOT_SET, 0, NOT_SET); {
                if (isFirstRender()) {
                    setStyle("textOverflow", "ellipsis");
                    setStyle("whiteSpace", "nowrap");
                }

                imBegin(INLINE); setText("Note tree"); imEnd();

                const headerNote = getNoteOrUndefined(state, state._currentFlatNotesRootId);
                if (imIf() && headerNote) {
                    imBegin(INLINE); setText(" :: "); imEnd();
                    imBegin(INLINE); setText(headerNote.data.text); imEnd();
                } imEndIf();
            } imEnd();

            imHLineDivider();

            imNoteTreeView(ctx);

            imFpsCounterOutput(fpsCounter);
        } imEnd();
    } stopFpsCounter(fpsCounter);

    if (ctx.handled) {
        preventImKeysDefault();
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
