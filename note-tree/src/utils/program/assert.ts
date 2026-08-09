export function assert(value: boolean): asserts value {
    if (value === false) { // Not using early return here, as this makes the code far slower with the debugger open.
        throw new Error("Assertion failed");
    }
}

export function assertUnreachable(value: never): never {
    throw new Error("Unhandled variant: " + value);
}
