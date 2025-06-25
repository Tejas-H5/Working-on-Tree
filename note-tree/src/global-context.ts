import { newTimer, TimerState } from "./app-utils/timer";
import { newNoteTreeViewState, NoteTreeViewState } from "./note-tree-view-state";
import { getImKeys } from "./utils/im-dom-utils";

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

export function getAxisRaw(positive: boolean, negative: boolean): number {
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

export function handleImKeysInput(ctx: GlobalContext) {
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

export type GlobalContext = {
    keyboard:          KeyboardState;
    repeatTimer:       TimerState;
    noteTreeViewState: NoteTreeViewState;
};

export function newGlobalContext(): GlobalContext {
    return {
        keyboard:          newKeyboardState(),
        repeatTimer:       newTimer(),
        noteTreeViewState: newNoteTreeViewState(),
    };
}
