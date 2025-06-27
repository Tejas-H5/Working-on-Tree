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
    newGlobalContext
} from "./global-context";
import { imNoteTreeView } from "./note-tree-view";
import {
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
            imNoteTreeView(ctx);
            imFpsCounterOutput(fpsCounter);
        } imEnd();
    } stopFpsCounter(fpsCounter);
}


loadState(() => {
    recomputeState(state);
    console.log("State: ", state);
})

// Using a custom styling solution
initCssbStyles();
setTheme("Light");
initImDomUtils(imMain);
