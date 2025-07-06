import {  newTimer, TimerState } from "./app-utils/timer";
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

    upKey:       KeyState;
    downKey:     KeyState;
    leftKey:     KeyState;
    rightKey:    KeyState;
    pageDownKey: KeyState;
    pageUpKey:   KeyState;

    enterKey:  KeyState;
    escapeKey: KeyState;

    ctrlKey:  KeyState;
    shiftKey: KeyState;
    altKey:   KeyState;
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

        upKey:       newKeyState(),
        downKey:     newKeyState(),
        leftKey:     newKeyState(),
        rightKey:    newKeyState(),
        pageDownKey: newKeyState(),
        pageUpKey:   newKeyState(),

        enterKey:  newKeyState(),
        escapeKey: newKeyState(),

        ctrlKey:  newKeyState(),
        shiftKey: newKeyState(),
        altKey:   newKeyState(),
    };

    state.keys.push(state.upKey);
    state.keys.push(state.downKey);
    state.keys.push(state.leftKey);
    state.keys.push(state.rightKey);
    state.keys.push(state.pageDownKey);
    state.keys.push(state.pageUpKey);
    state.keys.push(state.enterKey);
    state.keys.push(state.escapeKey);
    state.keys.push(state.ctrlKey);
    state.keys.push(state.shiftKey);
    state.keys.push(state.altKey);

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
        case "ArrowUp":    pressKey(s.upKey, e.repeat);       break;
        case "ArrowDown":  pressKey(s.downKey, e.repeat);     break;
        case "ArrowLeft":  pressKey(s.leftKey, e.repeat);     break;
        case "ArrowRight": pressKey(s.rightKey, e.repeat);    break;
        case "PageUp":     pressKey(s.pageUpKey, e.repeat);   break;
        case "PageDown":   pressKey(s.pageDownKey, e.repeat); break; 
        case "Enter":      pressKey(s.enterKey, e.repeat);    break;
        case "Escape":     pressKey(s.escapeKey, e.repeat);   break;
        case "Control":    pressKey(s.ctrlKey, e.repeat);     break;
        case "Meta":       pressKey(s.ctrlKey, e.repeat);     break;
        case "Shift":      pressKey(s.shiftKey, e.repeat);    break;
        case "Alt":        pressKey(s.altKey, e.repeat);      break;
        default: 
            return;
    }
}

function handleKeyUp(s: KeyboardState, e: KeyboardEvent) {
    switch (e.key) {
        case "ArrowUp":    releaseKey(s.upKey);        break;
        case "ArrowDown":  releaseKey(s.downKey);      break;
        case "ArrowLeft":  releaseKey(s.leftKey);      break;
        case "ArrowRight": releaseKey(s.rightKey);     break;
        case "PageUp":     releaseKey(s.pageUpKey);    break;
        case "PageDown":   releaseKey(s.pageDownKey);  break; 
        case "Enter":      releaseKey(s.enterKey);     break;
        case "Escape":     releaseKey(s.escapeKey);    break;
        case "Control":    releaseKey(s.ctrlKey);      break;
        case "Meta":       releaseKey(s.ctrlKey);      break;
        case "Shift":      releaseKey(s.shiftKey);     break;
        case "Alt":        releaseKey(s.altKey);       break;
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
