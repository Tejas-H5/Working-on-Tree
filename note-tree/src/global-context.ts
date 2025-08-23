import { ActivitiesViewState, newActivitiesViewState } from "./activities-list";
import { DurationsViewState, newDurationsViewState } from "./durations-view";
import { FuzzyFinderViewState, newFuzzyFinderViewState } from "./fuzzy-finder";
import { newNoteTraversalViewState, NoteTraversalViewState } from "./lateral-traversal";
import { newNoteTreeViewState, NoteTreeViewState } from "./note-tree-view";
import { newSettingsViewState, SettingsViewState } from "./settings-view";
import { applyPendingScratchpadWrites, NoteTreeGlobalState, TreeNote, saveState } from "./state";
import { newUrlListViewState, UrlListViewState } from "./url-viewer";
import { isEditingTextSomewhereInDocument } from "./utils/dom-utils";
import { ImGlobalEventSystem, newImGlobalEventSystem } from "./utils/im-dom";
import { logTrace } from "./utils/log";
import { bytesToMegabytes, utf8ByteLength } from "./utils/utf8";

const SAVE_DEBOUNCE = 1500;

export type GlobalContext = {
    ev: ImGlobalEventSystem;

    now: Date;

    keyboard:          KeyboardState;
    handled:           boolean;
    noteTreeViewState: NoteTreeViewState;

    textAreaToFocus:     HTMLTextAreaElement | null;
    focusWithAllSelected: boolean;

    discoverableCommands: DiscoverableCommands;

    views: {
        noteTree: NoteTreeViewState;
        activities: ActivitiesViewState;
        urls: UrlListViewState;
        fastTravel: NoteTraversalViewState;
        finder: FuzzyFinderViewState;
        settings: SettingsViewState;
        durations: DurationsViewState;
    };
    currentView: unknown;
    leftTab: unknown;

    notLockedIn: boolean;

    navListPrevious: NavigationListLink;
    navListNext: NavigationListLink;
    foundFocused: boolean;

    noteBeforeFocus: TreeNote | null;

    status: {
        statusTextTimeLeft: number;
        statusText: string;
        statusTextType: typeof TASK_IN_PROGRESS | typeof TASK_DONE | typeof TASK_FAILED;
    };
};

export const TASK_IN_PROGRESS = 0;
export const TASK_DONE = 1;
export const TASK_FAILED = 2;

type NavigationListLink = {
    view: unknown | null;
    name: string;
}

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
    const newCommandArray = () => Array(32).fill(null).map((): DiscoverableCommand => {
        return {
            key: null,
            desc: "",
            flags: 0,
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
    flags: number;

    // TODO: consider back and forth interaction here
    // active: boolean;
}

export function newGlobalContext(): GlobalContext {
    const keyboard = newKeyboardState();

    return {
        ev: newImGlobalEventSystem(),

        now: new Date(),

        keyboard,
        handled:           false,
        noteTreeViewState: newNoteTreeViewState(),

        textAreaToFocus:      null,
        focusWithAllSelected: false,

        views: {
            noteTree: newNoteTreeViewState(),
            activities: newActivitiesViewState(),
            urls: newUrlListViewState(),
            fastTravel: newNoteTraversalViewState(),
            finder: newFuzzyFinderViewState(),
            settings: newSettingsViewState(),
            durations: newDurationsViewState(),
        },
        notLockedIn: true,
        currentView: null,
        leftTab: null,

        navListPrevious: { view: null, name: "" },
        navListNext: { view: null, name: "" },
        foundFocused: false,

        noteBeforeFocus: null,

        discoverableCommands: newDiscoverableCommands(),

        status: {
            statusTextTimeLeft: -1,
            statusText: "",
            statusTextType: TASK_IN_PROGRESS,
        }
    };
}

export const REPEAT = 1 << 0;
export const CTRL   = 1 << 1;
export const SHIFT  = 1 << 2;
export const ALT    = 1 << 3;
export const HIDDEN = 1 << 4;
export const BYPASS_TEXT_AREA = 1 << 5;
export const ANY_MODIFIERS = 1 << 6;

// NOTE: always false if ctx.handled.
// if true, will set ctx.handled = true.
// TODO: maybe SHIFT and BYPASS_TEXT_AREA at the same time should throw?
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

    if (!(command.flags & BYPASS_TEXT_AREA) && isEditingTextSomewhereInDocument()) return false;

    if (!command.key || !command.key.pressed)  return false;
    if (!(command.flags & REPEAT) && command.key.repeat) return false;

    if (!(command.flags & ANY_MODIFIERS)) {
        if ((command.flags & ALT) && !ctx.keyboard.altKey.held) return false;
        if ((command.flags & CTRL) && !ctx.keyboard.ctrlKey.held) return false;
        if ((command.flags & SHIFT) && !ctx.keyboard.shiftKey.held) return false;
    }

    return true;
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
        if (command.key === key && command.flags === flags) {
            found = true;
            break;
        }
    }

    // Can't handle the same command twice.
    if (found) return null;

    const command = commands.thisFrame[commands.idx];

    command.desc   = actionDescription;
    command.key    = key;
    command.flags  = flags;

    if (!(flags & ANY_MODIFIERS)) {
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
    }

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
    slashKey:    KeyState;
    commaKey:    KeyState;

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
        slashKey:    newKeyState("/", "?", "/"),
        commaKey:    newKeyState(",", ",", "<"),

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

export function handleImKeysInput(
    ctx: GlobalContext,
    eventSystem: ImGlobalEventSystem,
) {
    const keyboard = ctx.keyboard;

    ctx.handled = false;

    const { keyDown, keyUp, blur } = eventSystem.keyboard;

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

export function preventImKeysDefault(ev: ImGlobalEventSystem) {
    const { keyDown, keyUp } = ev.keyboard;
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


const GITHUB_PAGE = "https://github.com/Tejas-H5/Working-on-Tree";
const GITHUB_PAGE_ISSUES = "https://github.com/Tejas-H5/Working-on-Tree/issues/new?template=Blank+issue";

// TODO: expose via UI
console.log({
    github_page: GITHUB_PAGE,
    if_you_encounter_bugs: GITHUB_PAGE_ISSUES
});

let saveTimeout = 0;
export function saveCurrentState(ctx: GlobalContext, state: NoteTreeGlobalState, { debounced } = { debounced: false }) {
    // user can switch to a different note mid-debounce, so we need to save
    // these here before the debounce

    const thisState = state;

    const save = () => {
        if (state !== thisState) {
            logTrace("The state changed unexpectedly! let's not save...");
            return;
        }

        // We need to apply the current scratch pad state to the current note just before we save, so that we don't lose what
        // we were working on in the scratchpad.
        applyPendingScratchpadWrites(thisState);


        // save current note
        saveState(thisState, (serialized) => {
            // notification

            // JavaScript strings are UTF-16 encoded
            const bytes = utf8ByteLength(serialized);
            const mb = bytesToMegabytes(bytes);

            // in case the storage.estimate().then never happens, lets just show something.
            showStatusText(ctx, `Saved (` + mb.toFixed(2) + `mb)`, TASK_DONE);

            // A shame we need to do this :(
            navigator.storage.estimate().then((data) => {
                state.criticalSavingError = "";

                const estimatedMbUsage = bytesToMegabytes(data.usage ?? 0);
                if (estimatedMbUsage < 100) {
                    // don't bother showing this warning if we're using way less than 100 mb. it will
                    // cause unnecessary panic. We're more concerned about when it starts taking up 15gb and
                    // then locking up/freezing/crashing the site.
                    return;
                }

                showStatusText(ctx, `Saved (` + mb.toFixed(2) + `mb / ` + estimatedMbUsage.toFixed(2) + `mb)`, TASK_DONE);

                const baseErrorMessage = "WARNING: Your browser is consuming SIGNIFICANTLY more disk space on this site than what should be required: " +
                    estimatedMbUsage.toFixed(2) + "mb being used instead of an expected " + (mb * 2).toFixed(2) + "mb.";

                const COMPACTION_THRESHOLD = 20;
                const CRITICAL_ERROR_THRESHOLD = 40;

                if (mb * COMPACTION_THRESHOLD < estimatedMbUsage) {
                    console.warn(baseErrorMessage);
                }

                if (mb * CRITICAL_ERROR_THRESHOLD < estimatedMbUsage) {
                    // This should be fixed. I guess we're keeping this code here 'just in case'.

                    const criticalSavingError = baseErrorMessage + " You should start backing up your data ever day, and anticipate a crash of some sort. Also consider using this website in another browser. This bug should be reported as a github issue on " + GITHUB_PAGE

                    state.criticalSavingError = criticalSavingError;
                    console.error(criticalSavingError);
                }
            });

        });
    };

    if (!debounced) {
        save();
        return;
    }

    showStatusText(ctx, `Saving`, TASK_IN_PROGRESS, SAVE_DEBOUNCE);
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        save();
    }, SAVE_DEBOUNCE);
};

const STATUS_TEXT_PERSIST_TIME = 1;
function showStatusText(
    ctx: GlobalContext,
    text: string,
    type: typeof TASK_IN_PROGRESS | typeof TASK_DONE | typeof TASK_FAILED,
    timeout: number = STATUS_TEXT_PERSIST_TIME,
) {
    ctx.status.statusText = text;
    ctx.status.statusTextType = type;
    ctx.status.statusTextTimeLeft = timeout;
}

export function debouncedSave(ctx: GlobalContext, state: NoteTreeGlobalState) {
    saveCurrentState(ctx, state, { debounced: true });
};
