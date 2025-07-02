import { newTimer, TimerState } from "./app-utils/timer";
import { newNoteTreeViewState, NoteTreeViewState } from "./note-tree-view";
import { getImKeys, isEditingTextSomewhereInDocument } from "./utils/im-dom-utils";

type KeyState = {
    pressed:  boolean;
    repeat:   boolean;
    held:     boolean;
    released: boolean;

    numPressed:  number;
    numHeld:     number;
    numReleased: number;
}

type KeyboardState = {
    keys: KeyState[];

    up:       KeyState;
    down:     KeyState;
    left:     KeyState;
    right:    KeyState;
    pageDown: KeyState;
    pageUp:   KeyState;

    enter:  KeyState;
    escape: KeyState;

    ctrl:  KeyState;
    shift: KeyState;
    alt:   KeyState;
};

function newKeyState(): KeyState {
    return {
        pressed:  false,
        held:     false,
        released: false,
        repeat:   false,

        numPressed:  0,
        numHeld:     0,
        numReleased: 0,
    };
}

function newKeyboardState(): KeyboardState {
    const state: KeyboardState = {
        keys: [],

        up:       newKeyState(),
        down:     newKeyState(),
        left:     newKeyState(),
        right:    newKeyState(),
        pageDown: newKeyState(),
        pageUp:   newKeyState(),

        enter:  newKeyState(),
        escape: newKeyState(),

        ctrl:  newKeyState(),
        shift: newKeyState(),
        alt:   newKeyState(),
    };

    state.keys.push(state.up);
    state.keys.push(state.down);
    state.keys.push(state.left);
    state.keys.push(state.right);
    state.keys.push(state.pageDown);
    state.keys.push(state.pageUp);
    state.keys.push(state.enter);
    state.keys.push(state.escape);
    state.keys.push(state.ctrl);
    state.keys.push(state.shift);
    state.keys.push(state.alt);

    return state;
}

export function getAxisRaw(positive: boolean, negative: boolean): number {
    let result = 0;
    if (positive) result += 1;
    if (negative) result -= 1;
    return result;
}

function pressKey(state: KeyState, repeat: boolean) {
    if (!repeat) {
        state.numPressed++;
        state.numHeld++;
    }

    state.pressed = true;
    state.repeat = repeat;
    state.held = true;
}

function releaseKey(state: KeyState) {
    state.numHeld--;
    state.numReleased++;

    state.held     = state.numHeld > 0;
    state.released = true;
}

function stepKey(state: KeyState) {
    state.numPressed  = 0;
    state.numReleased = 0;

    state.pressed  = false;
    state.repeat = false;
    state.released = false;
}

function resetKey(state: KeyState) {
    state.numPressed  = 0;
    state.numHeld     = 0;
    state.numReleased = 0;

    state.pressed  = false;
    state.held     =
    state.released = false;
}

function handleKeyDown(s: KeyboardState, e: KeyboardEvent) {
    // vim-query-replace-driven naming
    switch (e.key) {
        case "ArrowUp":    pressKey(s.up, e.repeat);       break;
        case "ArrowDown":  pressKey(s.down, e.repeat);     break;
        case "ArrowLeft":  pressKey(s.left, e.repeat);     break;
        case "ArrowRight": pressKey(s.right, e.repeat);    break;
        case "PageUp":     pressKey(s.pageUp, e.repeat);   break;
        case "PageDown":   pressKey(s.pageDown, e.repeat); break; 
        case "Enter":      pressKey(s.enter, e.repeat);    break;
        case "Escape":     pressKey(s.escape, e.repeat);   break;
        case "Control":    pressKey(s.ctrl, e.repeat);     break;
        case "Meta":       pressKey(s.ctrl, e.repeat);     break;
        case "Shift":      pressKey(s.shift, e.repeat);    break;
        case "Alt":        pressKey(s.alt, e.repeat);      break;
        default: 
            return;
    }
}

function handleKeyUp(s: KeyboardState, e: KeyboardEvent) {
    switch (e.key) {
        case "ArrowUp":    releaseKey(s.up);        break;
        case "ArrowDown":  releaseKey(s.down);      break;
        case "ArrowLeft":  releaseKey(s.left);      break;
        case "ArrowRight": releaseKey(s.right);     break;
        case "PageUp":     releaseKey(s.pageUp);    break;
        case "PageDown":   releaseKey(s.pageDown);  break; 
        case "Enter":      releaseKey(s.enter);     break;
        case "Escape":     releaseKey(s.escape);    break;
        case "Control":    releaseKey(s.ctrl);      break;
        case "Meta":       releaseKey(s.ctrl);      break;
        case "Shift":      releaseKey(s.shift);     break;
        case "Alt":        releaseKey(s.alt);       break;
        default: 
            return;
    }
}

function stepKeyboardState(s: KeyboardState) {
    for (let i = 0; i < s.keys.length; i++) {
        stepKey(s.keys[i]);
    }
}

function resetKeyboardState(s: KeyboardState) {
    for (let i = 0; i < s.keys.length; i++) {
        resetKey(s.keys[i]);
    }
}

export function handleImKeysInput(ctx: GlobalContext) {
    const keyboard = ctx.keyboard;

    ctx.handled = false;

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

export function preventImKeysDefault() {
    const { keyDown, keyUp } = getImKeys();
    if (keyDown) keyDown.preventDefault();
    if (keyUp)   keyUp.preventDefault();
}

export type GlobalContext = {
    keyboard:          KeyboardState;
    handled:           boolean;
    repeatTimer:       TimerState;
    noteTreeViewState: NoteTreeViewState;
};

export function newGlobalContext(): GlobalContext {
    return {
        keyboard:          newKeyboardState(),
        handled:           false,
        repeatTimer:       newTimer(),
        noteTreeViewState: newNoteTreeViewState(),
    };
}
