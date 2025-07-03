import { imBeginAppHeading, imEndAppHeading } from "./app-heading";
import {
    COL,
    imBegin,
    imFixed
} from "./components/core/layout";
import { imT } from "./components/core/text";
import {
    imFpsCounterOutput,
    newFpsCounterState,
    startFpsCounter,
    stopFpsCounter
} from "./components/fps-counter";
import {
    GlobalContext,
    handleImKeysInput,
    newGlobalContext,
    preventImKeysDefault
} from "./global-context";
import { imNoteJournalView } from "./note-journal-view";
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
    imEnd,
    imState,
    initImDomUtils
} from "./utils/im-dom-utils";

function imMain() {
    const fpsCounter = imState(newFpsCounterState);
    const ctx = imState(newGlobalContext);

    handleImKeysInput(ctx);

    startFpsCounter(fpsCounter); {
        imBegin(COL); imFixed(0, 0, 0, 0); {
            if (0) {
                imAppViewTree(ctx); 
            } else {
                imAppViewJournal(ctx); 
            }

            imFpsCounterOutput(fpsCounter);
        } imEnd();
    } stopFpsCounter(fpsCounter);

    if (ctx.handled) {
        preventImKeysDefault();
    }
}

function imAppViewTree(ctx: GlobalContext) {
    imBeginAppHeading(); {
        imT("Tree"); 
        const headerNote = getNoteOrUndefined(state, state._currentFlatNotesRootId);
        if (headerNote) {
            imT(" :: ");
            imT(headerNote.data.text);
        }
    } imEndAppHeading();

    imNoteTreeView(ctx);
}

function imAppViewJournal(ctx: GlobalContext) {
    imBeginAppHeading(); {
        imT("Journal"); 
    } imEndAppHeading();

    imNoteJournalView(ctx);
}


loadState(() => {
    recomputeState(state);
    console.log("State: ", state);
    initImDomUtils(imMain);
})

// Using a custom styling solution
initCssbStyles();
setTheme("Light");
