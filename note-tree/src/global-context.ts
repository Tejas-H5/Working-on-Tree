import { getNormalizedKey, isKeyHeld, isKeyPressedOrRepeated, isKeyRepeated, Key } from "src/utils/key-state";
import { ActivitiesViewState, newActivitiesViewState } from "./app-views/activities-list";
import { DurationsViewState, newDurationsViewState } from "./app-views/durations-view";
import { newNoteTraversalViewState, NoteTraversalViewState } from "./app-views/fast-travel";
import { FuzzyFinderViewState, newFuzzyFinderViewState } from "./app-views/fuzzy-finder";
import { GraphMappingsViewState, newGraphMappingsViewState } from "./app-views/graph-view";
import { newNoteTreeViewState, NoteTreeViewState } from "./app-views/note-tree-view";
import { newSettingsViewState, SettingsViewState } from "./app-views/settings-view";
import { newUrlListViewState, UrlListViewState } from "./app-views/url-viewer";
import { getActivityDate, getBreakAutoInsertLastPolledTime, getLastActivity, getLastSavedForAllTabs, getLastSavedForThisTab, getNoteOrUndefined, isLoadingState, loadState, newBreakActivity, NoteTreeGlobalState, pushBreakActivity, saveState, state, toDateOrZero, TreeNote, updateBreakAutoInsertLastPolledTime } from "./state";
import { assert } from "./utils/assert";
import { parseDateSafe } from "./utils/datetime";
import { isEditingTextSomewhereInDocument } from "./utils/dom-utils";
import { getGlobalEventSystem } from "./utils/im-dom";
import { logTrace } from "./utils/log";
import { bytesToMegabytes, utf8ByteLength } from "./utils/utf8";
import { VERSION_NUMBER, VERSION_NUMBER_MONOTONIC } from "./version-number";

const SAVE_DEBOUNCE = 1500;

export type GlobalContext = {
    now: Date;

    keyboard:          KeyboardState;
    handled:           boolean;
    noteTreeViewState: NoteTreeViewState;

    textAreaToFocus:     HTMLTextAreaElement | null;
    focusNextFrame:      boolean;

    focusWithAllSelected: boolean;

    discoverableCommands: DiscoverableCommands;

    views: {
        noteTree:   NoteTreeViewState;
        activities: ActivitiesViewState;
        urls:       UrlListViewState;
        fastTravel: NoteTraversalViewState;
        finder:     FuzzyFinderViewState;
        settings:   SettingsViewState;
        durations:  DurationsViewState;
        mappings:   GraphMappingsViewState;
    };
    currentView: unknown;
    leftTab: unknown;
    viewingDurations: boolean;

    notLockedIn: boolean;

    requestSave: boolean;

    navListPrevious: NavigationListLink;
    navListNext: NavigationListLink;
    foundFocused: boolean;

    noteBeforeFocus: TreeNote | null;

    status: {
        statusTextTimeLeftSeconds: number;
        statusTextTimeInitialSeconds: number;
        statusText: string;
        statusTextType: typeof TASK_IN_PROGRESS | typeof TASK_DONE | typeof TASK_FAILED;
    };
};

export function setCurrentView(ctx: GlobalContext, view: unknown) {
    ctx.currentView = view;
    const currentNote = getNoteOrUndefined(state.notes, state.currentNoteId);
    if (view !== ctx.views.noteTree) {
        if (currentNote) {
            ctx.noteBeforeFocus = currentNote;
        }
    }
}

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
    const newCommandArray = () => Array(64).fill(null).map((): DiscoverableCommand => {
        return {
            key: null,
            desc: "",
            flags: 0,
        };
    });

    return {
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
    key: Key | null;
    desc: string;
    flags: number;

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
        focusNextFrame:       false,

        focusWithAllSelected: false,

        views: {
            noteTree:   newNoteTreeViewState(),
            activities: newActivitiesViewState(),
            urls:       newUrlListViewState(),
            fastTravel: newNoteTraversalViewState(),
            finder:     newFuzzyFinderViewState(),
            settings:   newSettingsViewState(),
            durations:  newDurationsViewState(),
            mappings:   newGraphMappingsViewState(),
        },
        notLockedIn: true,

        requestSave: false,

        currentView: null,
        leftTab: null,
        viewingDurations: false,

        navListPrevious: { view: null, name: "" },
        navListNext: { view: null, name: "" },
        foundFocused: false,

        noteBeforeFocus: null,

        discoverableCommands: newDiscoverableCommands(),

        status: {
            statusTextTimeLeftSeconds: -1,
            statusTextTimeInitialSeconds: 1,
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
    key: Key,
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

function hasCommand(ctx: GlobalContext, command: DiscoverableCommand) {
    const keys = getGlobalEventSystem().keyboard.keys;

    if (ctx.handled) return false;

    if (!(command.flags & BYPASS_TEXT_AREA) && isEditingTextSomewhereInDocument()) return false;

    if (!command.key || !isKeyPressedOrRepeated(keys, command.key)) return false;
    if (!(command.flags & REPEAT) && isKeyRepeated(keys, command.key)) return false;

    if (!(command.flags & ANY_MODIFIERS)) {
        if ((command.flags & ALT)   && !isKeyHeld(keys, ctx.keyboard.altKey))   return false;
        if ((command.flags & CTRL)  && !isKeyHeld(keys, ctx.keyboard.ctrlKey))  return false;
        if ((command.flags & SHIFT) && !isKeyHeld(keys, ctx.keyboard.shiftKey)) return false;
    }

    return true;
}

function pushDiscoverableCommand(
    ctx: GlobalContext,
    key: Key,
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
        const keys = getGlobalEventSystem().keyboard.keys;

        const currentlyHeld = (
            (isKeyHeld(keys, ctx.keyboard.ctrlKey) ? CTRL : 0) |
            (isKeyHeld(keys, ctx.keyboard.shiftKey) ? SHIFT : 0) |
            (isKeyHeld(keys, ctx.keyboard.altKey) ? ALT : 0)
        );

        const commandWants = (CTRL | SHIFT | ALT) & flags;

        const excessKeys = currentlyHeld & (~commandWants);
        if (excessKeys) {
            return null;
        }

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


type KeyboardState = {
    upKey:       Key;
    downKey:     Key;
    leftKey:     Key;
    rightKey:    Key;
    pageDownKey: Key;
    pageUpKey:   Key;
    homeKey:     Key;
    endKey:      Key;
    spaceKey:    Key;
    slashKey:    Key;
    commaKey:    Key;

    aKey: Key;
    sKey: Key;
    dKey: Key;
    bKey: Key;
    tKey: Key;
    fKey: Key;
    mKey: Key;
    hKey: Key;
    gKey: Key;

    enterKey:  Key;
    escapeKey: Key;

    ctrlKey:  Key;
    shiftKey: Key;
    altKey:   Key;
    tabKey:   Key;

    num0Key: Key;
    num1Key: Key;
    num2Key: Key;
    num3Key: Key;
    num4Key: Key;
    num5Key: Key;
    num6Key: Key;
    num7Key: Key;
    num8Key: Key;
    num9Key: Key;
};


function newKeyboardState(): KeyboardState {
    const state: KeyboardState = {
        // CONSIDER: hjkl to move around, as well as arrows!
        upKey:       getNormalizedKey("ArrowUp"),
        downKey:     getNormalizedKey("ArrowDown"),
        leftKey:     getNormalizedKey("ArrowLeft"),
        rightKey:    getNormalizedKey("ArrowRight"),
        pageDownKey: getNormalizedKey("PageDown"),
        pageUpKey:   getNormalizedKey("PageUp"),
        homeKey:     getNormalizedKey("Home"),
        endKey:      getNormalizedKey("End"),
        spaceKey:    getNormalizedKey(" "),
        slashKey:    getNormalizedKey("?"),
        commaKey:    getNormalizedKey(","),

        aKey: getNormalizedKey("A"),
        sKey: getNormalizedKey("S"),
        dKey: getNormalizedKey("D"),
        bKey: getNormalizedKey("B"),
        tKey: getNormalizedKey("T"),
        fKey: getNormalizedKey("F"),
        mKey: getNormalizedKey("M"),
        hKey: getNormalizedKey("H"),
        gKey: getNormalizedKey("G"),

        enterKey:  getNormalizedKey("Enter"),
        escapeKey: getNormalizedKey("Escape"),

        ctrlKey:  getNormalizedKey("Modifier"),
        shiftKey: getNormalizedKey("Shift"),
        altKey:   getNormalizedKey("Alt"),
        tabKey:   getNormalizedKey("Tab"),

        num0Key: getNormalizedKey("0"),
        num1Key: getNormalizedKey("1"),
        num2Key: getNormalizedKey("2"),
        num3Key: getNormalizedKey("3"),
        num4Key: getNormalizedKey("4"),
        num5Key: getNormalizedKey("5"),
        num6Key: getNormalizedKey("6"),
        num7Key: getNormalizedKey("7"),
        num8Key: getNormalizedKey("8"),
        num9Key: getNormalizedKey("9"),
    };

    return state;
}

export function getKeyStringRepr(key: Key) {
    switch (key) {
        case "ArrowUp":    return "↑";
        case "ArrowDown":  return "↓";
        case "ArrowLeft":  return "←";
        case "ArrowRight": return "→";
        case "PageDown":   return "PgDn";
        case "PageUp":     return "PgUp";
        case "Home":       return "Home";
        case "End":        return "End";
        case " ":          return "Space";
        case "?":          return "/";
        case ",":          return ",";

        case "A":          return "A";
        case "S":          return "S";
        case "D":          return "D";
        case "B":          return "B";
        case "T":          return "T";
        case "F":          return "F";
        case "M":          return "M";
        case "H":          return "H";
        case "G":          return "G";

        case "Enter":      return "Enter";
        case "Escape":     return "Esc";

        case "Modifier":    return "Ctrl/Cmd";
        case "Shift":      return "Shift";
        case "Alt":        return "Alt";
        case "Tab":        return "Tab";

        case "0":          return "0";
        case "1":          return "1";
        case "2":          return "2";
        case "3":          return "3";
        case "4":          return "4";
        case "5":          return "5";
        case "6":          return "6";
        case "7":          return "7";
        case "8":          return "8";
        case "9":          return "9";
    }

    return key;
}




// <- negative | positive ->
export function getAxisRaw(negative: boolean, positive: boolean): number {
    let result = 0;
    if (negative) result -= 1;
    if (positive) result += 1;
    return result;
}

export function handleImKeysInput(ctx: GlobalContext) {
    ctx.handled = false;
}

export function preventImKeysDefault() {
    const { keyDown, keyUp } = getGlobalEventSystem().keyboard;
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
    version: VERSION_NUMBER,
    versionMonotonic: VERSION_NUMBER_MONOTONIC,
    github_page: GITHUB_PAGE,
    if_you_encounter_bugs: GITHUB_PAGE_ISSUES
});

// NOTE: this method may be called in a 60fps loop continuously.
export function reloadStateIfNewer(isRecursivePath = false): boolean {
    if (isLoadingState()) {
        return false;
    }

    const allTabsLastSaved = toDateOrZero(getLastSavedForAllTabs());
    const thisLastSaved = toDateOrZero(getLastSavedForThisTab());

    if (allTabsLastSaved.getTime() < thisLastSaved.getTime()) {
        logTrace("[reload] Data corruption may have occured - we'll just save over it, what could go wrong...");
    } else if (allTabsLastSaved.getTime() > thisLastSaved.getTime()) {
        logTrace("[reload] A newer version exists. We will load that instead of saving over it");
        loadState(() => {
            logTrace("reloaded via saveCurrentState");
            reloadStateIfNewer(true);
        });
        return true;
    } else {
        if (isRecursivePath) {
            logTrace("[reload] No reload required");
        }
    }

    return false;
}

let saveTimeout = 0;
export function saveCurrentState(ctx: GlobalContext, state: NoteTreeGlobalState, { debounced, where } = { debounced: false, where: "unknown" }) {
    if (reloadStateIfNewer()) {
        return;
    }

    // user can switch to a different note mid-debounce, so we need to save
    // these here before the debounce

    const thisState = state;

    const save = () => {
        if (state !== thisState) {
            logTrace("The state changed unexpectedly! let's not save...");
            return;
        }

        logTrace("Save initiated via " + where);

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

    // An expensive operation that would be catastrophic if we called it hundreds of times very quickly.
    // It's always debounced, by at least some tiny amount.

    const debounceAmount = !debounced ? 10 : SAVE_DEBOUNCE;
    showStatusText(ctx, `Saving`, TASK_IN_PROGRESS, SAVE_DEBOUNCE);
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        save();
    }, debounceAmount);
};

const STATUS_TEXT_PERSIST_TIME = 1000;
function showStatusText(
    ctx: GlobalContext,
    text: string,
    type: typeof TASK_IN_PROGRESS | typeof TASK_DONE | typeof TASK_FAILED,
    timeout: number = STATUS_TEXT_PERSIST_TIME,
) {
    ctx.status.statusText = text;
    ctx.status.statusTextType = type;
    ctx.status.statusTextTimeLeftSeconds = timeout / 1000;
    ctx.status.statusTextTimeInitialSeconds = timeout / 1000;
}

export function debouncedSave(ctx: GlobalContext, state: NoteTreeGlobalState, where: string) {
    assert(!!where);
    saveCurrentState(ctx, state, { debounced: true, where });
};


// Used by webworker and normal code
export const AUTO_INSERT_BREAK_CHECK_INTERVAL = 5000;

// NOTE: there may be a problem with this mechanism, although I'm not sure what it is.
export function autoInsertBreakIfRequired(state: NoteTreeGlobalState) {
    // This function is run inside of a setInterval that runs every CHECK_INTERVAL_MS, and when the 
    // webpage opens for the first time.
    // It may or may not need to be called more or less often, depending on what we add.

    // Need to automatically add breaks if we haven't called this method in a while.
    const time = new Date();
    const lastTime = getBreakAutoInsertLastPolledTime();
    const lastCheckTime = parseDateSafe(lastTime);

    if (
        !!lastCheckTime &&
        (time.getTime() - lastCheckTime.getTime()) > AUTO_INSERT_BREAK_CHECK_INTERVAL + 5000
    ) {
        // If this javascript was running, i.e the computer was open constantly, this code should never run.
        // So, we can insert a break now, if we aren't already taking one. 
        // This should solve the problem of me constantly forgetting to add breaks...
        const lastActivity = getLastActivity(state);
        const time = !lastActivity ? lastCheckTime.getTime() :
            Math.max(lastCheckTime.getTime(), getActivityDate(lastActivity).getTime());

        pushBreakActivity(state, newBreakActivity("Auto-inserted break", new Date(time), true));
    }

    updateBreakAutoInsertLastPolledTime();
}


