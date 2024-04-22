// NOTE: This file will run in a web-worker thread, sending a signal to the main thread every CHECK_INTERVAL_MS milliseconds.
// It's supposed to be more reliable than setInterval (I think), since setInterval is frequently throttled for random reasons in my experience.
// Basically we've just swapped out the setInterval call to a web worker. Nice.
//
import { CHECK_INTERVAL_MS } from "./activitycheckconstants";

setInterval(() => { 
    postMessage("is-open-check");
}, CHECK_INTERVAL_MS);
