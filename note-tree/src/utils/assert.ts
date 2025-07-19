// I've found a significant speedup by writing code like
// if (x === false ) instaed of if (!x). 
// You won't need to do this in 99.9999% of your code, but it 
// would be nice if the library did it.
export function assert(value: boolean): asserts value {
    // Funnily enough - writing it like this ends up being very slow with the dev tools open. 
    // I'm guessing the JIT can't inline methods with early returns when some debug=true setting has been set somewhere.
    // if (value === true) return;
    // throw new Error("Assertion failed - " + message);

    if (value === false) {
        // passing in a custon message is slow here for some reason.
        throw new Error("Assertion failed");
    }
}
