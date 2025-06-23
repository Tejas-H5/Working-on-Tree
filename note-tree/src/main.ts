import { imBegin } from "./components/core/layout";
import { imFpsCounterOutput, newFpsCounterState, startFpsCounter, stopFpsCounter } from "./components/fps-counter";
import { loadState, setTheme, state } from "./state";
import { initCssbStyles } from "./utils/cssb";
import { imEnd, imState, initImDomUtils, setInnerText } from "./utils/im-dom-utils";

function imMain() {
    const fpsCounter = imState(newFpsCounterState);
    startFpsCounter(fpsCounter); {
        imBegin(); {
            setInnerText("Hello");
        } imEnd();

        imFpsCounterOutput(fpsCounter);
    } stopFpsCounter(fpsCounter);
}

loadState(() => {
    console.log("State: ", state);
})


// Using a custom styling solution
initCssbStyles();
setTheme("Light");

initImDomUtils(imMain);
