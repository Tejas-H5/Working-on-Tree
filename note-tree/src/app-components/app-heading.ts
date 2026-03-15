import { imui, BLOCK, ROW, COL, PX, NA } from "src/utils/im-js/im-ui";
import { im, ImCache, imdom, el, ev, } from "src/utils/im-js";



export function imAppHeadingBegin(c: ImCache) {
    imdom.ElBegin(c, el.H1); 
    imui.Padding(c, 0, NA, 0, NA, 0, NA, 10, PX); {
        if (im.isFirstishRender(c)) {
            imdom.setStyle(c, "textOverflow", "ellipsis");
            imdom.setStyle(c, "fontSize", "28px");
        }
    } // imui.End(c);
}

export function imAppHeadingEnd(c: ImCache) {
    imdom.ElEnd(c, el.H1);
}

