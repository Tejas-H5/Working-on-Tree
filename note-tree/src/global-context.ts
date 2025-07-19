import {  newTimer, TimerState } from "./app-utils/timer";
import { newNoteTreeViewState, NoteTreeViewState } from "./note-tree-view";
import { getImKeys, UIRoot } from "./utils/im-dom-utils";

export type GlobalContext = {
    keyboard:          KeyboardState;
    handled:           boolean;
    noteTreeViewState: NoteTreeViewState;

    textAreaToFocus:     UIRoot<HTMLTextAreaElement> | null;
    focusWithAllSelected: boolean;
};

export function newGlobalContext(): GlobalContext {
    return {
        keyboard:          newKeyboardState(),
        handled:           false,
        noteTreeViewState: newNoteTreeViewState(),

        textAreaToFocus:      null,
        focusWithAllSelected: false,
    };
}

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

    aKey: KeyState;
    sKey: KeyState;
    dKey: KeyState;

    enterKey:  KeyState;
    escapeKey: KeyState;

    ctrlKey:  KeyState;
    shiftKey: KeyState;
    altKey:   KeyState;
    tabKey:   KeyState;

    num0Key: KeyState;
    num1Key: KeyState;
    num2Key: KeyState;
    num3Key: KeyState;
    num4Key: KeyState;
    num5Key: KeyState;
    num6Key: KeyState;
    num7Key: KeyState;
    num8Key: KeyState;
    num9Key: KeyState;
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

        // CONSIDER: hjkl to move around, as well as arrows!
        upKey:       newKeyState(),
        downKey:     newKeyState(),
        leftKey:     newKeyState(),
        rightKey:    newKeyState(),
        pageDownKey: newKeyState(),
        pageUpKey:   newKeyState(),

        aKey: newKeyState(),
        sKey: newKeyState(),
        dKey: newKeyState(),

        enterKey:  newKeyState(),
        escapeKey: newKeyState(),

        ctrlKey:  newKeyState(),
        shiftKey: newKeyState(),
        altKey:   newKeyState(),
        tabKey:   newKeyState(),

        num0Key: newKeyState(),
        num1Key: newKeyState(),
        num2Key: newKeyState(),
        num3Key: newKeyState(),
        num4Key: newKeyState(),
        num5Key: newKeyState(),
        num6Key: newKeyState(),
        num7Key: newKeyState(),
        num8Key: newKeyState(),
        num9Key: newKeyState(),
    };

    state.keys.push(state.upKey);
    state.keys.push(state.downKey);
    state.keys.push(state.leftKey);
    state.keys.push(state.rightKey);
    state.keys.push(state.pageDownKey);
    state.keys.push(state.pageUpKey);
    state.keys.push(state.aKey);
    state.keys.push(state.sKey);
    state.keys.push(state.dKey);
    state.keys.push(state.enterKey);
    state.keys.push(state.escapeKey);
    state.keys.push(state.ctrlKey);
    state.keys.push(state.shiftKey);
    state.keys.push(state.altKey);
    state.keys.push(state.tabKey);
    state.keys.push(state.num0Key);
    state.keys.push(state.num1Key);
    state.keys.push(state.num2Key);
    state.keys.push(state.num3Key);
    state.keys.push(state.num4Key);
    state.keys.push(state.num5Key);
    state.keys.push(state.num6Key);
    state.keys.push(state.num7Key);
    state.keys.push(state.num8Key);
    state.keys.push(state.num9Key);



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
        case "ArrowUp":     pressKey(s.upKey, e.repeat);       break;
        case "ArrowDown":   pressKey(s.downKey, e.repeat);     break;
        case "ArrowLeft":   pressKey(s.leftKey, e.repeat);     break;
        case "ArrowRight":  pressKey(s.rightKey, e.repeat);    break;
        case "PageUp":      pressKey(s.pageUpKey, e.repeat);   break;
        case "PageDown":    pressKey(s.pageDownKey, e.repeat); break; 
        case "A": case "a": pressKey(s.aKey, e.repeat);        break;
        case "S": case "s": pressKey(s.sKey, e.repeat);        break;
        case "D": case "d": pressKey(s.dKey, e.repeat);        break;
        case "Enter":       pressKey(s.enterKey, e.repeat);    break;
        case "Escape":      pressKey(s.escapeKey, e.repeat);   break;
        case "Control":     pressKey(s.ctrlKey, e.repeat);     break;
        case "Meta":        pressKey(s.ctrlKey, e.repeat);     break;
        case "Shift":       pressKey(s.shiftKey, e.repeat);    break;
        case "Alt":         pressKey(s.altKey, e.repeat);      break;
        case "Tab":         pressKey(s.tabKey, e.repeat);      break;
        case "0":           pressKey(s.num0Key, e.repeat);     break;
        case "1":           pressKey(s.num1Key, e.repeat);     break;
        case "2":           pressKey(s.num2Key, e.repeat);     break;
        case "3":           pressKey(s.num3Key, e.repeat);     break;
        case "4":           pressKey(s.num4Key, e.repeat);     break;
        case "5":           pressKey(s.num5Key, e.repeat);     break;
        case "6":           pressKey(s.num6Key, e.repeat);     break;
        case "7":           pressKey(s.num7Key, e.repeat);     break;
        case "8":           pressKey(s.num8Key, e.repeat);     break;
        case "9":           pressKey(s.num9Key, e.repeat);     break;
        default: 
            return;
    }
}

function handleKeyUp(s: KeyboardState, e: KeyboardEvent) {
    switch (e.key) {
        case "ArrowUp":     releaseKey(s.upKey);        break;
        case "ArrowDown":   releaseKey(s.downKey);      break;
        case "ArrowLeft":   releaseKey(s.leftKey);      break;
        case "ArrowRight":  releaseKey(s.rightKey);     break;
        case "PageUp":      releaseKey(s.pageUpKey);    break;
        case "PageDown":    releaseKey(s.pageDownKey);  break; 
        case "A": case "a": releaseKey(s.aKey);         break;
        case "S": case "s": releaseKey(s.sKey);         break;
        case "D": case "d": releaseKey(s.dKey);         break;
        case "Enter":       releaseKey(s.enterKey);     break;
        case "Escape":      releaseKey(s.escapeKey);    break;
        case "Control":     releaseKey(s.ctrlKey);      break;
        case "Meta":        releaseKey(s.ctrlKey);      break;
        case "Shift":       releaseKey(s.shiftKey);     break;
        case "Alt":         releaseKey(s.altKey);       break;
        case "Tab":         releaseKey(s.tabKey);       break;
        case "0":           releaseKey(s.num0Key);      break;
        case "1":           releaseKey(s.num1Key);      break;
        case "2":           releaseKey(s.num2Key);      break;
        case "3":           releaseKey(s.num3Key);      break;
        case "4":           releaseKey(s.num4Key);      break;
        case "5":           releaseKey(s.num5Key);      break;
        case "6":           releaseKey(s.num6Key);      break;
        case "7":           releaseKey(s.num7Key);      break;
        case "8":           releaseKey(s.num8Key);      break;
        case "9":           releaseKey(s.num9Key);      break;
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

