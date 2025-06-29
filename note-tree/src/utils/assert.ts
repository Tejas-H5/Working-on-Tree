// I've found a significant speedup by writing code like
// if (x === false ) instaed of if (!x). 
// You won't need to do this in 99.9999% of your code, but it 
// would be nice if the library did it.
export function assert(value: boolean, message: string = "Open up the dev-tools debugger to find out why"): asserts value {
    if (value === true) return;
    throw new Error("Assertion failed - " + message);
}
