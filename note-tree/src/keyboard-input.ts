import { filterInPlace } from "src/utils/array-utils";

const state = {
    isShiftPressed: false,
    isCtrlPressed: false,
    isAltPressed: false,
    keys: Array<string>(),
    lastKey: "",
};

let init = false;

export function initKeyboardListeners(renderFn: () => void) {
    if (init) {
        throw new Error("Can't initialize this thing twice, ever!");
    }

    init = true;

    document.addEventListener("keydown", (e) => {
        state.lastKey = e.key;
        if (!state.keys.includes(e.key)) {
            state.keys.push(e.key);
        }

        switch (e.key) {
            case "Shift": 
                state.isShiftPressed = true;
                break;
            case "Control": 
                state.isCtrlPressed = true;
                break;
            case "Meta": 
                state.isCtrlPressed = true;
                break;
            case "Alt": 
                state.isAltPressed = true;
                break;
        }

        renderFn();
    });

    document.addEventListener("keyup", (e) => {
        state.lastKey = "";
        filterInPlace(state.keys, (k) => k !== e.key);

        switch (e.key) {
            case "Shift": 
                state.isShiftPressed = false;
                break;
            case "Control": 
                state.isCtrlPressed = false;
                break;
            case "Meta": 
                state.isCtrlPressed = false;
                break;
            case "Alt": 
                state.isAltPressed = false;
                break;
        }

        renderFn();
    });

    document.addEventListener("blur", () => {
        state.isShiftPressed = false;
        state.isCtrlPressed = false;
        state.isCtrlPressed = false;
        state.isAltPressed = false;

        renderFn();
    });
}

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
