export function assert(val: boolean): asserts val {
	if (val === false) {
		throw new Error("Assertion failed")
	}
}

export function assertNever(val: never): never {
	throw new Error("Unhandled expression type: " + val);
}
