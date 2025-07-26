import { ActivitiesViewState, newActivitiesViewState } from "./activities-list";
import { newNoteTreeViewState, NoteTreeViewState } from "./note-tree-view";
import { AppView } from "./state";
import { getImKeys, isEditingTextSomewhereInDocument, UIRoot } from "./utils/im-dom-utils";

export type GlobalContext = {
    now: Date;

    keyboard:          KeyboardState;
    handled:           boolean;
    noteTreeViewState: NoteTreeViewState;

    textAreaToFocus:     UIRoot<HTMLTextAreaElement> | null;
    focusWithAllSelected: boolean;

    discoverableCommands: DiscoverableCommands;

    noteTreeView: NoteTreeViewState;
    activityView: ActivitiesViewState;

    navigationList: AppView[];

    requestSaveState: boolean; // set this to true to ask the app to save the current state.
};

export type DiscoverableCommands = {
    thisFrame: DiscoverableCommand[];
    lastFrame: DiscoverableCommand[];
    stablized: DiscoverableCommand[];

    changed: boolean;
    idx: number;

    shiftHeld: boolean;
    ctrlHeld: boolean;
    altHeld: boolean;
}

export function newDiscoverableCommands(): DiscoverableCommands {
    const thisFrame = Array(8).fill(null).map((): DiscoverableCommand => {
        return {
            key: null,
            actionDescription: "",
        };
    });
    return {
        // only 8 discoverable commands at any given time MAX.
        thisFrame: thisFrame,
        lastFrame: [],
        stablized: [],
        idx: 0,
        changed: false,
        shiftHeld: false,
        ctrlHeld: false,
        altHeld: false,
    };
}


export type DiscoverableCommand = {
    key:    KeyState | null;
    actionDescription: string;
}

export function newGlobalContext(): GlobalContext {
    const keyboard = newKeyboardState();

    return {
        now: new Date(),

        keyboard,
        handled:           false,
        noteTreeViewState: newNoteTreeViewState(),

        textAreaToFocus:      null,
        focusWithAllSelected: false,

        noteTreeView: newNoteTreeViewState(),
        activityView: newActivitiesViewState(),

        requestSaveState: false,

        navigationList: [],

        discoverableCommands: newDiscoverableCommands(),
    };
}

export const REPEAT           = 1 << 0;
export const BYPASS_TEXT_AREA = 1 << 1;

export function hasDiscoverableCommand(
    ctx: GlobalContext,
    key: KeyState,
    actionDescription: string,
    flags = 0,
) {
    if (!pushDiscoverableCommand(ctx, key, actionDescription, !!(flags & BYPASS_TEXT_AREA))) return false;

    return hasCommand(ctx, key, actionDescription, flags);
}

// Mainly to switch quickly back and forth between this and `hasDiscoverableCommand`.
export function hasCommand(
    ctx: GlobalContext,
    key: KeyState,
    _actionDescription: string, 
    flags = 0,
) {
    if (!(flags & BYPASS_TEXT_AREA) && isEditingTextSomewhereInDocument()) {
        return false;
    }

    if (!ctx.handled && key.pressed) {
        if (flags & REPEAT) {
            return true;
        }

        return !key.repeat;
    }

    return false;
}

export function addToNavigationList(ctx: GlobalContext, view: AppView) {
    if (ctx.navigationList.length > 10) return; // should ideally never happen, but it could happen in case of rendering error.
    ctx.navigationList.push(view);
}

export function hasDiscoverableHold(ctx: GlobalContext, key: KeyState): boolean {
    const commands = ctx.discoverableCommands;

    if (key === ctx.keyboard.ctrlKey) {
        commands.ctrlHeld = true;
    } else if (key === ctx.keyboard.shiftKey) {
        commands.shiftHeld = true;
    } else if (key === ctx.keyboard.altKey) {
        commands.altHeld = true;
    } else {
        throw new Error("Key not accounted for: " + key.stringRepresentation);
    }

    return key.held;
}

function pushDiscoverableCommand(
    ctx: GlobalContext,
    key: KeyState,
    actionDescription: string,
    bypassTextArea: boolean,
): boolean {
    if (!bypassTextArea && isEditingTextSomewhereInDocument()) {
        return false;
    }

    const commands = ctx.discoverableCommands;

    const idx = commands.idx;
    // Shouldn't accidentally trigger invisible commands imo.
    if (idx >= commands.thisFrame.length) return false;

    let found = false;
    for (let i = 0; i < commands.idx; i++) {
        const command = commands.thisFrame[i];
        if (command.key === key) {
            found = true;
            break;
        }
    }

    // Can't handle the same command twice.
    if (found) return false;

    commands.thisFrame[idx].key               = key;
    commands.thisFrame[idx].actionDescription = actionDescription;
    commands.idx++;

    return true;
}

type KeyState = {
    stringRepresentation: string;
    key:  string;
    key2: string | undefined;

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
    homeKey:     KeyState;
    endKey:      KeyState;

    aKey: KeyState;
    sKey: KeyState;
    dKey: KeyState;
    bKey: KeyState;

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

function newKeyState(
    stringRepresentation: string,
    key: string,
    key2?: string
): KeyState {
    return {
        stringRepresentation,
        key, 
        key2,

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
        upKey:       newKeyState("↑", "ArrowUp"),
        downKey:     newKeyState("↓", "ArrowDown"),
        leftKey:     newKeyState("←", "ArrowLeft"),
        rightKey:    newKeyState("→", "ArrowRight"),
        pageDownKey: newKeyState("PgDn", "PageDown"),
        pageUpKey:   newKeyState("PgUp", "PageUp"),
        homeKey:     newKeyState("Home", "Home"),
        endKey:      newKeyState("End", "End"),

        aKey: newKeyState("A", "A", "a"),
        sKey: newKeyState("S", "S", "s"),
        dKey: newKeyState("D", "D", "d"),
        bKey: newKeyState("B", "B", "b"),

        enterKey:  newKeyState("Enter", "Enter"),
        escapeKey: newKeyState("Esc", "Escape"),

        ctrlKey:  newKeyState("Ctrl", "Control", "Meta"),
        shiftKey: newKeyState("Shift", "Shift"),
        altKey:   newKeyState("Alt", "Alt"),
        tabKey:   newKeyState("Tab", "Tab"),

        num0Key: newKeyState("0", "0"),
        num1Key: newKeyState("1", "1"),
        num2Key: newKeyState("2", "2"),
        num3Key: newKeyState("3", "3"),
        num4Key: newKeyState("4", "4"),
        num5Key: newKeyState("5", "5"),
        num6Key: newKeyState("6", "6"),
        num7Key: newKeyState("7", "7"),
        num8Key: newKeyState("8", "8"),
        num9Key: newKeyState("9", "9"),
    };

    for (const k in state) {
        const key = k as keyof typeof state;
        if (key !== "keys") state.keys.push(state[key]); 
    }

    return state;
}

// <- negative | positive ->
export function getAxisRaw(negative: boolean, positive: boolean): number {
    let result = 0;
    if (negative) result -= 1;
    if (positive) result += 1;
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
    for (let i = 0; i < s.keys.length; i++) {
        const key = s.keys[i];
        if (e.key === key.key || e.key === key.key2) {
            pressKey(key, e.repeat);
        }
    }
}

function handleKeyUp(s: KeyboardState, e: KeyboardEvent) {
    for (let i = 0; i < s.keys.length; i++) {
        const key = s.keys[i];
        if (e.key === key.key || e.key === key.key2) {
            releaseKey(key);
        }
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


export function updateDiscoverableCommands(s: DiscoverableCommands) {
    const didChange = s.changed;

    s.changed = s.idx !== s.lastFrame.length;
    for (let i = 0; i < s.idx; i++) {
        let equal = false;

        if (i < s.lastFrame.length) {
            equal =
                s.lastFrame[i].key === s.thisFrame[i].key &&
                s.lastFrame[i].actionDescription === s.thisFrame[i].actionDescription;
        }

        if (!equal) s.changed = true;

        s.lastFrame[i] = s.thisFrame[i];
    }
    s.idx = 0;

    if (!s.changed && didChange) {
        s.stablized.length = 0;
        for (let i = 0; i < s.lastFrame.length; i++) {
            s.stablized.push(s.lastFrame[i]);
        }
    }
}
