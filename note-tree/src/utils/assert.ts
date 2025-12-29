export function assert(value: boolean): asserts value {
    if (value === false) { // Not using early return here, as this makes the code far slower with the debugger open.
        throw new Error("Assertion failed");
    }
}

export function mustGetDefined<T>(val: T | undefined, field = "this value"): T {
    if (val === undefined) throw new Error(`Expected ${field} to not be undefined`);
    return val;
}

