import { imBeginRoot, imEnd, imMemo, } from "src/utils/im-utils-core";
import { imBeginSpan, setTextSafetyRemoved } from "src/utils/im-utils-dom";

interface Stringifyable {
    toString(): string;
}

export function imStr(stringifyable: Stringifyable) {
    imBeginSpan();

    if (imMemo(stringifyable)) {
        let str = stringifyable.toString()
        setTextSafetyRemoved(str);
    }

    imEnd();
}

// no imBeginX() convention here due to verbosity.
export function imB() { return imBeginRoot(newB); }
export function imI() { return imBeginRoot(newI); }
export function imU() { return imBeginRoot(newU); }
export function imA() { return imBeginRoot(newA); }
export function imS() { return imBeginRoot(newS); }
export function imPre() { return imBeginRoot(newPre); }

// You probably don't need these. but maybe you do?
export const newB = () => document.createElement("b");
export const newI = () => document.createElement("i");
export const newU = () => document.createElement("u");
export const newA = () => document.createElement("a");
export const newS = () => document.createElement("s");
export const newPre = () => document.createElement("pre");
