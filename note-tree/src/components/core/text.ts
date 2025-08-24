import { ImCache } from "src/utils/im-core";
import { EL_A, EL_B, EL_I, EL_S, EL_U, imElBegin, imElEnd } from "src/utils/im-dom";

export function imB(c: ImCache) { return imElBegin(c, EL_B); }
export function imBEnd(c: ImCache) { return imElEnd(c, EL_B); }
export function imI(c: ImCache) { return imElBegin(c, EL_I); }
export function imIEnd(c: ImCache) { return imElEnd(c, EL_I); }
export function imU(c: ImCache) { return imElBegin(c, EL_U); }
export function imUEnd(c: ImCache) { return imElEnd(c, EL_U); }
export function imA(c: ImCache) { return imElBegin(c, EL_A); }
export function imAEnd(c: ImCache) { return imElEnd(c, EL_A); }
export function imS(c: ImCache) { return imElBegin(c, EL_S); }
export function imSEnd(c: ImCache) { return imElEnd(c, EL_S); }

