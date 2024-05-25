import { filterInPlace } from "src/utils/array-utils";

const state = {
    isShiftPressed: false,
    isCtrlPressed: false,
    isAltPressed: false,
    keys: Array<string>(),
    lastKey: "",
};

document.addEventListener("keydown", (e) => {
    state.lastKey = e.key;
    if (!state.keys.includes(e.key)) {
        state.keys.push(e.key);
    }

    switch(e.key) {
        case "Shift": return state.isShiftPressed = true;
        case "Control": return state.isCtrlPressed = true;
        case "Meta": return state.isCtrlPressed = true;
        case "Alt": return state.isAltPressed = true;
    }
});

document.addEventListener("keyup", (e) => {
    state.lastKey = "";
    filterInPlace(state.keys, (k) => k !== e.key);


    switch(e.key) {
        case "Shift": return state.isShiftPressed = false;
        case "Control": return state.isCtrlPressed = false;
        case "Meta": return state.isCtrlPressed = false;
        case "Alt": return state.isAltPressed = false;
    }
});

export function isShiftPressed() {
    return state.isShiftPressed;
}

export function isCtrlPressed() {
    return state.isCtrlPressed;
}

export function isAltPressed() {
    return state.isAltPressed;
}

export function isKeyDown(key: string) {
    return state.keys.includes(key);
}

export function isLastKey(key: string) {
    return state.lastKey === key;
}
