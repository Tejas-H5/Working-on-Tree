import { ActivitiesViewState, newActivitiesViewState } from "./activities-list";
import { newPlanViewState, PlanViewState } from "./note-plan-view";
import { newNoteTreeViewState, NoteTreeViewState } from "./note-tree-view";
import { getImKeys, UIRoot } from "./utils/im-dom-utils";

export type GlobalContext = {
    now: Date;

    keyboard:          KeyboardState;
    handled:           boolean;
    noteTreeViewState: NoteTreeViewState;

    textAreaToFocus:     UIRoot<HTMLTextAreaElement> | null;
    focusWithAllSelected: boolean;

    discoverableCommands: DiscoverableCommand[];
    discoverableCommandIdx: number;
    discoverableCtrlShiftTempArray: [boolean, boolean];

    noteTreeView: NoteTreeViewState;
    activityView: ActivitiesViewState;
    plansView:    PlanViewState;

    requestSaveState: boolean; // set this to true to ask the app to save the current state.
};

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
        plansView:    newPlanViewState(),
        activityView: newActivitiesViewState(),

        requestSaveState: false,

        // only 8 discoverable commands at any given time MAX.
        discoverableCommands: Array(8).fill(null).map((): DiscoverableCommand => {
            return {
                key: null,
                actionDescription: "",
            };
        }),
        discoverableCommandIdx: 0,
        discoverableCtrlShiftTempArray: [false, false],
    };
}

export function hasDiscoverableCtrlOrShiftActions(ctx: GlobalContext): readonly [ctrl: boolean, shift: boolean] {
    ctx.discoverableCtrlShiftTempArray[0] = false;
    ctx.discoverableCtrlShiftTempArray[1] = false;

    if (ctx.keyboard.ctrlKey.held) {
        ctx.discoverableCtrlShiftTempArray[0] = true;
    } else if (ctx.keyboard.shiftKey.held) {
        ctx.discoverableCtrlShiftTempArray[1] = true;
    } else {
        hasDiscoverableHold(ctx, ctx.keyboard.ctrlKey);
        hasDiscoverableHold(ctx, ctx.keyboard.shiftKey);
    }

    return ctx.discoverableCtrlShiftTempArray;
}

function hasDiscoverableHold(
    ctx: GlobalContext,
    key:    KeyState,
) {
    if (key.held) return true;

    pushDiscoverableCommand(ctx, key, "actions");
    return false;
}

export function hasDiscoverableCommand(
    ctx: GlobalContext,
    key:    KeyState,
    actionDescription: string,
    repeat = false,
) {
    if (!pushDiscoverableCommand(ctx, key, actionDescription)) return false;

    if (!ctx.handled && key.pressed) {
        if (repeat === true) {
            return true;
        }

        return !key.repeat;
    }

    return false;
}

function pushDiscoverableCommand(
    ctx: GlobalContext,
    key: KeyState,
    actionDescription: string,
): boolean {
    const idx = ctx.discoverableCommandIdx;
    // Shouldn't accidentally trigger invisible commands imo.
    if (idx >= ctx.discoverableCommands.length) return false;

    ctx.discoverableCommands[idx].key               = key;
    ctx.discoverableCommands[idx].actionDescription = actionDescription;

    ctx.discoverableCommandIdx = idx + 1;

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

