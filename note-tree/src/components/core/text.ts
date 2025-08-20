import { ImCache } from "src/utils/im-core";
import { EL_A, EL_B, EL_I, EL_PRE, EL_S, EL_U, imEl, imElEnd } from "src/utils/im-dom";

// no imBeginX() convention here due to verbosity.
export function imB(c: ImCache) { return imEl(c, EL_B); }
export function imBEnd(c: ImCache) { return imElEnd(c, EL_B); }
export function imI(c: ImCache) { return imEl(c, EL_I); }
export function imIEnd(c: ImCache) { return imElEnd(c, EL_I); }
export function imU(c: ImCache) { return imEl(c, EL_U); }
export function imUEnd(c: ImCache) { return imElEnd(c, EL_U); }
export function imA(c: ImCache) { return imEl(c, EL_A); }
export function imAEnd(c: ImCache) { return imElEnd(c, EL_A); }
export function imS(c: ImCache) { return imEl(c, EL_S); }
export function imSEnd(c: ImCache) { return imElEnd(c, EL_S); }
export function imPre(c: ImCache) { return imEl(c, EL_PRE); }
export function imPreEnd(c: ImCache) { return imElEnd(c, EL_PRE); }

