import { imPadding, NA, PX } from "../components/core/layout";
import { ImCache, isFirstishRender } from "../utils/im-core";
import { EL_H1, elSetStyle, imEl, imElEnd } from "../utils/im-dom";


export function imAppHeadingBegin(c: ImCache) {
    imEl(c, EL_H1); 
    imPadding(c, 0, NA, 0, NA, 0, NA, 10, PX); {
        if (isFirstishRender(c)) {
            elSetStyle(c, "textOverflow", "ellipsis");
            elSetStyle(c, "fontSize", "28px");
        }
    } // imLayoutEnd(c);
}

export function imAppHeadingEnd(c: ImCache) {
    imElEnd(c, EL_H1);
}

