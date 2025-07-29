import { ActivitiesViewState, newActivitiesViewState } from "./activities-list";
import { newNoteTreeViewState, NoteTreeViewState } from "./note-tree-view";
import { getDeltaTimeSeconds, getImKeys, isEditingTextSomewhereInDocument, UIRoot } from "./utils/im-dom-utils";

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
    activityViewVisible: boolean;
    currentScreen: AppView;

    navigationList: AppView[];
};

export type DiscoverableCommands = {
    thisFrame: DiscoverableCommand[];
    stabilized: DiscoverableCommand[];
    stabilizedIdx: number;

    changed: boolean;
    stableFrames: number;
    idx: number;

    shiftAvailable: boolean;
    ctrlAvailable: boolean;
    altAvailable: boolean;
}

export function newDiscoverableCommands(): DiscoverableCommands {
    const newCommandArray = () => Array(16).fill(null).map((): DiscoverableCommand => {
        return {
            key: null,
            desc: "",
            shift: false,
            ctrl: false,
            alt: false,
            bypassTextArea: false,
            repeat: false,
        };
    });

    return {
        // only 8 discoverable commands at any given time MAX.
        thisFrame: newCommandArray(),
        stabilized: [],
        idx: 0,
        stabilizedIdx: 0,
        changed: false,
        stableFrames: 0,

        shiftAvailable: false,
        ctrlAvailable: false,
        altAvailable: false,
    };
}


export type DiscoverableCommand = {
    key: KeyState | null;
    desc: string;

    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    repeat: boolean;
    bypassTextArea: boolean;

    // TODO: consider back and forth interaction here
    // active: boolean;
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
        activityViewVisible: true,
        currentScreen: APP_VIEW_NOTES,

        navigationList: [],

        discoverableCommands: newDiscoverableCommands(),
    };
}

type AppViewInstance = number & { __appView: void; };

export const APP_VIEW_NOTES       = 0 as AppViewInstance;
export const APP_VIEW_ACTIVITIES  = 1 as AppViewInstance;
export const APP_VIEW_PLAN        = 2 as AppViewInstance;
export const APP_VIEW_FAST_TRAVEL = 3 as AppViewInstance;
export const APP_VIEW_FUZZY_FIND  = 4 as AppViewInstance;

export type AppView
    = typeof APP_VIEW_NOTES
    | typeof APP_VIEW_ACTIVITIES
    | typeof APP_VIEW_PLAN
    | typeof APP_VIEW_FAST_TRAVEL
    | typeof APP_VIEW_FUZZY_FIND;

export function appViewToString(view: AppView): string {
    switch(view) {
        case APP_VIEW_NOTES:        return "Notes";
        case APP_VIEW_ACTIVITIES:   return "Activities";
        case APP_VIEW_PLAN:         return "Plan";
        case APP_VIEW_FAST_TRAVEL:  return "Traversal";
        case APP_VIEW_FUZZY_FIND:   return "Find";
    }
    return "??";
}

export const REPEAT = 1 << 0;
export const CTRL   = 1 << 1;
export const SHIFT  = 1 << 2;
export const ALT    = 1 << 3;
export const BYPASS_TEXT_AREA = 1 << 4;
export const HIDDEN = 1 << 5;

// NOTE: always false if ctx.handled.
// if true, will set ctx.handled = true.
export function hasDiscoverableCommand(
    ctx: GlobalContext,
    key: KeyState,
    actionDescription: string,
    flags = 0,
) {
    const command = pushDiscoverableCommand(ctx, key, actionDescription, flags);
    if (!command) return false;

    if (hasCommand(ctx, command)) {
        ctx.handled = true;
        return true;
    }

    return false;
}

// Mainly for when you don't want a command to be discoverable for some reason.
function hasCommand(ctx: GlobalContext, command: DiscoverableCommand) {
    if (ctx.handled) return false;

    if (!command.bypassTextArea && isEditingTextSomewhereInDocument()) return false;

    if (!command.key || !command.key.pressed)  return false;
    if (!command.repeat && command.key.repeat) return false;

    if (command.alt   && !ctx.keyboard.altKey.held)   return false;
    if (command.ctrl  && !ctx.keyboard.ctrlKey.held)  return false;
    if (command.shift && !ctx.keyboard.shiftKey.held) return false;

    return true;
}

export function addToNavigationList(ctx: GlobalContext, view: AppView) {
    if (ctx.navigationList.length > 10) return; // should ideally never happen, but it could happen in case of rendering error.
    ctx.navigationList.push(view);
}

function pushDiscoverableCommand(
    ctx: GlobalContext,
    key: KeyState,
    actionDescription: string,
    flags: number,
): DiscoverableCommand | null {
    if (!(flags & BYPASS_TEXT_AREA) && isEditingTextSomewhereInDocument()) {
        return null;
    }

    const commands = ctx.discoverableCommands;

    // Shouldn't accidentally trigger invisible commands imo.
    if (commands.idx >= commands.thisFrame.length) return null;

    let found = false;
    for (let i = 0; i < commands.idx; i++) {
        const command = commands.thisFrame[i];
        if (command.key === key) {
            found = true;
            break;
        }
    }

    // Can't handle the same command twice.
    if (found) return null;

    const command = commands.thisFrame[commands.idx];

    command.desc   = actionDescription;
    command.key    = key;
    command.ctrl   = !!(flags & CTRL);
    command.shift  = !!(flags & SHIFT);
    command.alt    = !!(flags & ALT);
    command.repeat = !!(flags & REPEAT);
    command.bypassTextArea = !!(flags & BYPASS_TEXT_AREA);

    const currentlyHeld = (
        (ctx.keyboard.ctrlKey.held ? CTRL : 0) |
        (ctx.keyboard.shiftKey.held ? SHIFT : 0) |
        (ctx.keyboard.altKey.held ? ALT : 0)
    );

    const commandWants = (CTRL | SHIFT | ALT) & flags;

    const excessKeys = currentlyHeld & (~commandWants);
    if (excessKeys) return null;

    const remainingToPress = commandWants & (~currentlyHeld);
    if (remainingToPress & CTRL) commands.ctrlAvailable = true;
    if (remainingToPress & SHIFT) commands.shiftAvailable = true;
    if (remainingToPress & ALT) commands.altAvailable = true;

    if (currentlyHeld !== commandWants) return null;

    if (!(flags & HIDDEN)) {
        // only increment when we reach the end
        commands.idx++;
    }

    return command;
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
    spaceKey:    KeyState;

    aKey: KeyState;
    sKey: KeyState;
    dKey: KeyState;
    bKey: KeyState;
    tKey: KeyState;
    fKey: KeyState;

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
        spaceKey:    newKeyState("Space", " "),

        aKey: newKeyState("A", "A", "a"),
        sKey: newKeyState("S", "S", "s"),
        dKey: newKeyState("D", "D", "d"),
        bKey: newKeyState("B", "B", "b"),
        tKey: newKeyState("T", "T", "t"),
        fKey: newKeyState("F", "F", "f"),

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
    let changed = s.idx !== s.stabilizedIdx;
    for (let i = 0; i < s.idx; i++) {
        let equal = false;

        equal =
            s.stabilized[i]?.key === s.thisFrame[i].key &&
            s.stabilized[i]?.desc === s.thisFrame[i].desc;

        if (!equal) changed = true;
    }

    if (changed && !s.changed) s.stableFrames = 0;
    s.changed ||= changed;

    if (changed) {
        const requiredStableFramesForSnapshot = 3;
        if (s.stableFrames < requiredStableFramesForSnapshot) {
            s.stableFrames++;
            if (s.stableFrames >= requiredStableFramesForSnapshot) {
                // command list actually stabilized. let's snapshot it

                s.stabilizedIdx = s.idx;
                for (let i = 0; i < s.idx; i++) {
                    s.stabilized[i] = { ...s.thisFrame[i] };
                }
                s.changed = false;
            }
        }
    }


    s.idx = 0;
}
