import { getAttr, imInit, setAttr } from "./utils/im-dom-utils";

export const BLOCK = 0;
export const ROW = 1;
export const COL = 2;

export function imInitStyles(styles: string): boolean {
    if (imInit()) {
        setAttr("style", getAttr("style") + ";" + styles);
        return true;
    }
    return false;
}
