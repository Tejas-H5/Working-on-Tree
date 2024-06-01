export function assert(trueVal: any, ...msg: any[]): asserts trueVal {
    if (!trueVal) { 
        console.error(...msg); 
        throw new Error("assertion failed!"); 
    } 
};

