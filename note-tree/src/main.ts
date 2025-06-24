import { cssVarsApp } from "./app-styling";
import { COL, imBegin, imFixed, imFlex, imInitClasses, imInitStyles, imPadding, imSize, NOT_SET, PX, ROW } from "./components/core/layout";
import { newH1 } from "./components/core/new-dom-nodes";
import { cn } from "./components/core/stylesheets";
import { imFpsCounterOutput, newFpsCounterState, startFpsCounter, stopFpsCounter } from "./components/fps-counter";
import { cnApp } from "./legacy-styling";
import { getNote, loadState, NoteId, recomputeState, setTheme, state, TreeNote } from "./state";
import { boundsCheck } from "./utils/array-utils";
import { assert } from "./utils/assert";
import { initCssbStyles } from "./utils/cssb";
import {
    deltaTimeSeconds,
    disableIm,
    enableIm,
    getImKeys,
    imBeginRoot,
    imEnd,
    imEndFor,
    imFor,
    imMemo,
    imNextRoot,
    imState,
    initImDomUtils,
    setInnerText,
    setStyle
} from "./utils/im-dom-utils";
import { ROOT_ID } from "./utils/int-tree";

type GlobalContext = {
    keyboard: KeyboardState;
    repeatTimer: TimerState;

    noteTreeViewState: NoteTreeViewState;
};

function newGlobalContext(): GlobalContext {
    return {
        keyboard: newKeyboardState(),
        repeatTimer: newTimer(),
        noteTreeViewState: newNoteTreeViewState(),
    };
}

function imMain() {
    const fpsCounter = imState(newFpsCounterState);

    const ctx = imState(newGlobalContext);

    handleImKeysInput(ctx);

    startFpsCounter(fpsCounter); {
        imBegin(COL); imFixed(0, 0, 0, 0); {
            imBeginRoot(newH1); 
            imPadding( 
                10, PX, 0, NOT_SET, 0, NOT_SET, 0, NOT_SET
            ); setInnerText("Note tree"); imEnd();

            imNoteTreeView(ctx);

            imFpsCounterOutput(fpsCounter);
        } imEnd();
    } stopFpsCounter(fpsCounter);
}


type NoteTreeViewState = {
    currentRootId: NoteId;
    list: NavigableList;
};

function newNoteTreeViewState(): NoteTreeViewState {
    return {
        currentRootId: ROOT_ID,
        list: newListState(),
    };
}

function setIdx(s: NoteTreeViewState, idx: number) {
    const note = getNote(state, s.currentRootId);
    const childIds = note.childIds;

    s.list.idx = clampedListIdx(idx, childIds.length);
    note.data.lastSelectedChildIdx = s.list.idx;
}

function moveIdx(s: NoteTreeViewState, amount: number) {
    setIdx(s, s.list.idx + amount);
}

function moveOutOfCurrent(s: NoteTreeViewState) {
    const note = getNote(state, s.currentRootId);
    if (note.id === ROOT_ID) return;

    const parent = getNote(state, note.parentId);

    s.currentRootId = parent.id;
    const thisIdx = parent.childIds.indexOf(note.id);
    assert(thisIdx !== -1);
    setIdx(s, thisIdx);

}

function moveIntoCurrent(s: NoteTreeViewState) {
    const note = getNote(state, s.currentRootId);
    const childIds = note.childIds;

    if (!boundsCheck(childIds, s.list.idx)) return;

    const nextRoot = getNote(state, childIds[s.list.idx]);
    if (nextRoot.childIds.length === 0) return;

    s.currentRootId = nextRoot.id;
    setIdx(s, nextRoot.data.lastSelectedChildIdx);
}

function getNavigableListInput(ctx: GlobalContext): number {
    const keyboard = ctx.keyboard;

    const heldDelta = getAxisRaw(keyboard.down.held, keyboard.up.held) +
        getAxisRaw(keyboard.pageDown.held, keyboard.pageUp.held) * 10;

    const pressedDelta = getAxisRaw(keyboard.down.pressed, keyboard.up.pressed) +
        getAxisRaw(keyboard.pageDown.pressed, keyboard.pageUp.pressed) * 10;

    const hasHold = heldDelta !== 0;

    ctx.repeatTimer.enabled = hasHold;
    updateTimer(ctx.repeatTimer);
    const repeatIntervalSeconds = ctx.repeatTimer.ticks === 0 ? 0.2 : 0.02;
    if (timerHasReached(ctx.repeatTimer, repeatIntervalSeconds) || pressedDelta) {
        return heldDelta;
    }

    return 0;
}

function imNoteTreeView(ctx: GlobalContext) {
    const s = ctx.noteTreeViewState;

    disableIm(); {
        const delta = getNavigableListInput(ctx);

        if (delta) {
            moveIdx(s, delta);
        } else if (ctx.keyboard.left.pressed) {
            moveOutOfCurrent(s);
        } else if (ctx.keyboard.right.pressed) {
            moveIntoCurrent(s);
        } 
    } enableIm();

    imBegin(); imPadding(
        10, PX, 0, NOT_SET, 0, NOT_SET, 0, NOT_SET
    ); imFlex(); {
        const note = getNote(state, s.currentRootId);
        const childIds = note.childIds;

        imFor(); for (let i = 0; i < childIds.length; i++) {
            imNextRoot();

            const note = getNote(state, childIds[i]);
            const focused = s.list.idx === i;

            imBegin(ROW); {
                imInitClasses(cn.preWrap);

                imBegin(); imSize(10, PX, 0, NOT_SET); {
                    if (imMemo(focused)) {
                        setStyle("backgroundColor", focused ? cssVarsApp.fgColor : "");
                    }
                } imEnd();
                imBegin(); imFlex(); imPadding(8, PX, 3, PX, 3, PX, 3, PX); {
                    if (imMemo(focused)) {
                        setStyle("backgroundColor", focused ? cssVarsApp.bgColorFocus : "");
                    }

                    setInnerText(note.data.text);
                } imEnd();
            } imEnd();
        } imEndFor();
    } imEnd();
}

type NavigableList = {
    idx: number;
};

function newListState(): NavigableList {
    return { idx: 0 };
}

function clampedListIdx(idx: number, len: number): number {
    if (idx < 0) idx = 0;
    if (idx >= len) idx = len - 1;
    return idx;
}

type TimerState = {
    t: number;
    ticks: number;
    enabled: boolean;
    enabledLast: boolean;
};

function newTimer(): TimerState {
    return {
        t: 0,
        ticks: 0,
        enabled: true,
        enabledLast: true,
    };
}

function updateTimer(s: TimerState) {
    if (s.enabled) {
        if (!s.enabledLast) {
            s.t = 0;
            s.ticks = 0;
        }

        s.t += deltaTimeSeconds();
    }
    s.enabledLast = s.enabled;
}

function timerHasReached(s: TimerState, seconds: number) {
    if (!s.enabled) return false;
    if (s.t > seconds) {
        s.t = 0;
        s.ticks++;
        return true;
    }
    return false;
}

type KeyState = {
    pressed: boolean;
    held: boolean;
    released: boolean;
}

type KeyboardState = {
    up: KeyState;
    down: KeyState;
    left: KeyState;
    right: KeyState;
    pageDown: KeyState;
    pageUp: KeyState;
};

function newKeyState(): KeyState {
    return {
        pressed: false,
        held: false,
        released: false,
    };
}

function newKeyboardState(): KeyboardState {
    return {
        up: newKeyState(),
        down: newKeyState(),
        left: newKeyState(),
        right: newKeyState(),
        pageDown: newKeyState(),
        pageUp: newKeyState(),
    }
}

function getAxisRaw(positive: boolean, negative: boolean): number {
    let result = 0;
    if (positive) result += 1;
    if (negative) result -= 1;
    return result;
}

function pressKey(state: KeyState) {
    state.pressed = true;
    state.held = true;
}

function releaseKey(state: KeyState) {
    state.held = false;
    state.pressed = false;
    state.released = true;
}

function stepKey(state: KeyState) {
    state.pressed = false;
    state.released = false;
}

function resetKey(state: KeyState) {
    state.pressed = false;
    state.held = false;
    state.released = false;
}

function handleKeyDown(s: KeyboardState, e: KeyboardEvent) {
    // vim-query-replace-driven naming
    switch (e.key) {
        case "ArrowUp":    pressKey(s.up);    break;
        case "ArrowDown":  pressKey(s.down);  break;
        case "ArrowLeft":  pressKey(s.left);  break;
        case "ArrowRight": pressKey(s.right); break;
        case "PageUp":     pressKey(s.pageUp); break;
        case "PageDown":   pressKey(s.pageDown); break; 
        default: 
            return;
    }

    // Probably not needed for a release event
    e.preventDefault();
}

function handleKeyUp(s: KeyboardState, e: KeyboardEvent) {
    switch (e.key) {
        case "ArrowUp":    releaseKey(s.up);    break;
        case "ArrowDown":  releaseKey(s.down);  break;
        case "ArrowLeft":  releaseKey(s.left);  break;
        case "ArrowRight": releaseKey(s.right); break;
        case "PageUp":     releaseKey(s.pageUp); break;
        case "PageDown":   releaseKey(s.pageDown); break; 
        default: 
            return;
    }
}

function stepKeyboardState(s: KeyboardState) {
    stepKey(s.up);
    stepKey(s.down);
    stepKey(s.left);
    stepKey(s.right);
    stepKey(s.pageUp);
    stepKey(s.pageDown);
}

function resetKeyboardState(s: KeyboardState) {
    resetKey(s.up);
    resetKey(s.down);
    resetKey(s.left);
    resetKey(s.right);
    resetKey(s.pageUp);
    resetKey(s.pageDown);
}

function handleImKeysInput(ctx: GlobalContext) {
    const keyboard = ctx.keyboard;

    const { keyDown, keyUp, blur } = getImKeys();

    stepKeyboardState(keyboard);
    if (keyDown) {
        handleKeyDown(keyboard, keyDown);
    }
    if (keyUp) {
        handleKeyUp(keyboard, keyUp);
    }
    if (blur) {
        resetKeyboardState(keyboard);
    }

    return keyboard;
}

loadState(() => {
    recomputeState(state);
    console.log("State: ", state);
})

// Using a custom styling solution
initCssbStyles();
setTheme("Light");
initImDomUtils(imMain);
