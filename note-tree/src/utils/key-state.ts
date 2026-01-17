import { assert } from "./assert";

type PressedSymbols<T extends string> = {
    pressed: T[];
    held: T[];
    repeated: T[];
    released: T[];
};

export type KeysState = {
    keys:    PressedSymbols<Key>;
    letters: PressedSymbols<string>;
};

export function newKeysState(): KeysState {
    return {
        keys: {
            pressed:  [],
            held:     [],
            released: [],
            repeated: [],
        },
        letters: {
            pressed:  [],
            held:     [],
            released: [],
            repeated: [],
        }
    };
}

// https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values
// There are a LOT of them. So I won't bother holding state for every possible key like usual
// TODO: try using keyCode if available, then fall back on key
export type Key = string & { __Key: void };

export function getNormalizedKey(key: string): Key {
    if (key.length === 1) {
        key = key.toUpperCase();

        switch (key) {
            case "!": key = "1"; break;
            case "@": key = "2"; break;
            case "#": key = "3"; break;
            case "$": key = "4"; break;
            case "%": key = "5"; break;
            case "^": key = "6"; break;
            case "&": key = "7"; break;
            case "*": key = "8"; break;
            case "(": key = "9"; break;
            case ")": key = "0"; break;
            case "_": key = "-"; break;
            case "+": key = "+"; break;
            case "{": key = "["; break;
            case "}": key = "]"; break;
            case "|": key = "\\"; break;
            case ":": key = ";"; break;
            case "\"": key = "'"; break;
            case "<": key = ","; break;
            case ">": key = "."; break;
            case "?": key = "/"; break;
            case "~": key = "`"; break;
        }
    }

    return key as Key;
}

function updatePressedSymbols<T extends string>(
    s: PressedSymbols<T>,
    pressed: T | undefined,
    repeated: T | undefined,
    released: T | undefined,
    blur: boolean
) {

    for (let i = 0; i < s.pressed.length; i++) {
        s.held.push(s.pressed[i]);
    }
    s.pressed.length = 0;
    s.repeated.length = 0;
    s.released.length = 0;

    if (pressed !== undefined) {
        // It is assumed that the number of press events for a particular
        // key type will equal the number of release events, so no deduplication
        // is requried here. If this is not the case, then there's not much we can 
        // do about it really.
        assert(s.pressed.length < 1000);

        s.pressed.push(pressed);
    }

    if (repeated !== undefined) {
        if (s.repeated.indexOf(repeated) === -1) {
            s.repeated.push(repeated);
        }
    }

    if (released !== undefined) {
        // Ensure only one of that key is removed
        for (let i = 0; i < s.held.length; i++) {
            if (s.held[i] === released) {
                s.held[i] = s.held[s.held.length - 1];
                s.held.pop();
                break;
            }
        }
        s.released.push(released);
    }

    if (blur) {
        s.pressed.length = 0;
        s.released.length = 0;
        s.repeated.length = 0;
        s.held.length = 0;
    }
}

export function updateKeysState(
    keysState: KeysState,
    keyDown: KeyboardEvent | null,
    keyUp: KeyboardEvent | null,
    blur: boolean,
) {
    const keys = keysState.keys;
    {
        let keyPressed: Key | undefined;
        let keyRepeated: Key | undefined;
        let keyReleased: Key | undefined;

        if (keyDown) {
            if (keyDown.repeat === true) {
                keyRepeated = getNormalizedKey(keyDown.key);
            } else {
                keyPressed = getNormalizedKey(keyDown.key);
            }
        } 
        if (keyUp) {
            keyReleased = getNormalizedKey(keyUp.key);
        }

        updatePressedSymbols(keys, keyPressed, keyRepeated, keyReleased, blur);
    }

    const letters = keysState.letters;
    {
        let keyPressed:  string | undefined;
        let keyRepeated: string | undefined;
        let keyReleased: string | undefined;

        if (keyDown) {
            if (keyDown.repeat === true) {
                keyRepeated = keyDown.key;
            } else {
                keyPressed = keyDown.key;
            }
        } 
        if (keyUp) {
            keyReleased = keyUp.key;
        }

        updatePressedSymbols(letters, keyPressed, keyRepeated, keyReleased, blur);
    }
}

export function isKeyPressed(keysState: KeysState, key: Key): boolean {
    const keys = keysState.keys;
    for (let i = 0; i < keys.pressed.length; i++) {
        if (keys.pressed[i] === key) return true;
    }
    return false;
}

export function isKeyRepeated(keysState: KeysState, key: Key): boolean {
    const keys = keysState.keys;
    for (let i = 0; i < keys.repeated.length; i++) {
        if (keys.repeated[i] === key) return true;
    }
    return false;
}

export function isKeyPressedOrRepeated(keysState: KeysState, key: Key): boolean {
    if (isKeyPressed(keysState, key)) return true;
    if (isKeyRepeated(keysState, key)) return true;
    return false;
}

export function isKeyReleased(keysState: KeysState, key: Key): boolean {
    const keys = keysState.keys;
    for (let i = 0; i < keys.released.length; i++) {
        if (keys.released[i] === key) return true;
    }
    return false;
}

export function isKeyHeld(keysState: KeysState, key: Key): boolean {
    const keys = keysState.keys;
    for (let i = 0; i < keys.held.length; i++) {
        if (keys.held[i] === key) return true;
    }
    return false;
}


export function isLetterPressed(keysState: KeysState, letter: string): boolean {
    const letters = keysState.letters;
    for (let i = 0; i < letters.pressed.length; i++) {
        if (letters.pressed[i] === letter) return true;
    }
    return false;
}

export function isLetterRepeated(keysState: KeysState, letter: string): boolean {
    const letters = keysState.letters;
    for (let i = 0; i < letters.repeated.length; i++) {
        if (letters.repeated[i] === letter) return true;
    }
    return false;
}

export function isLetterPressedOrRepeated(keysState: KeysState, letter: string): boolean {
    if (isLetterPressed(keysState, letter)) return true;
    if (isLetterRepeated(keysState, letter)) return true;
    return false;
}

export function isLetterReleased(keysState: KeysState, letter: string): boolean {
    const letters = keysState.letters;
    for (let i = 0; i < letters.released.length; i++) {
        if (letters.released[i] === letter) return true;
    }
    return false;
}

export function isLetterHeld(keysState: KeysState, letter: string): boolean {
    const letters = keysState.letters;
    for (let i = 0; i < letters.held.length; i++) {
        if (letters.held[i] === letter) return true;
    }
    return false;
}


