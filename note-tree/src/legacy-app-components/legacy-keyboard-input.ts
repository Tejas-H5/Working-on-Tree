// import { filterInPlace } from "src/utils/array-utils";
//


// Naww brooo xD aint no way

export type KeyboardState = {
    isShiftPressed: boolean;
    isCtrlPressed: boolean;
    isAltPressed: boolean;
    keys: string[];
    lastKey: string;
};

export function newKeyboardState(): KeyboardState {
    return {
        isShiftPressed: false,
        isCtrlPressed: false,
        isAltPressed: false,
        keys: Array<string>(),
        lastKey: "",
    };
}

// export function handleKeyDownKeyboardState(state: KeyboardState, e: KeyboardEvent) {
//     state.lastKey = e.key;
//     if (!state.keys.includes(e.key)) {
//         state.keys.push(e.key);
//     }
//
//     switch (e.key) {
//         case "Shift":
//             state.isShiftPressed = true;
//             break;
//         case "Control":
//             state.isCtrlPressed = true;
//             break;
//         case "Meta":
//             state.isCtrlPressed = true;
//             break;
//         case "Alt":
//             state.isAltPressed = true;
//             break;
//     }
// }
//
// export function handleKeyUpKeyboardState(state: KeyboardState, e: KeyboardEvent) {
//     state.lastKey = "";
//     filterInPlace(state.keys, (k) => k !== e.key);
//
//     switch (e.key) {
//         case "Shift":
//             state.isShiftPressed = false;
//             break;
//         case "Control":
//             state.isCtrlPressed = false;
//             break;
//         case "Meta":
//             state.isCtrlPressed = false;
//             break;
//         case "Alt":
//             state.isAltPressed = false;
//             break;
//     }
// }
