import { el, ImCache, imdom } from "src/utils/im-js";

export function imB(c: ImCache) { return imdom.ElBegin(c, el.B); }
export function imBEnd(c: ImCache) { return imdom.ElEnd(c, el.B); }
export function imI(c: ImCache) { return imdom.ElBegin(c, el.I); }
export function imIEnd(c: ImCache) { return imdom.ElEnd(c, el.I); }
export function imU(c: ImCache) { return imdom.ElBegin(c, el.U); }
export function imUEnd(c: ImCache) { return imdom.ElEnd(c, el.U); }
export function imA(c: ImCache) { return imdom.ElBegin(c, el.A); }
export function imAEnd(c: ImCache) { return imdom.ElEnd(c, el.A); }
export function imS(c: ImCache) { return imdom.ElBegin(c, el.S); }
export function imSEnd(c: ImCache) { return imdom.ElEnd(c, el.S); }

