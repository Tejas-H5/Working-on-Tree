import { imui, PX, NA } from "im-js/im-ui";
import { im, ImCache, imdom, el, } from "im-js";



export function imAppHeadingBegin(c: ImCache) {
    imdom.ElBegin(c, el.H1); 
    imui.Padding(c, 0, NA, 0, NA, 0, NA, 10, PX); {
        if (im.IsFirstRender(c)) {
            imdom.setStyle(c, "textOverflow", "ellipsis");
            imdom.setStyle(c, "fontSize", "28px");
        }
    } // imui.End(c);
}

export function imAppHeadingEnd(c: ImCache) {
    imdom.ElEnd(c, el.H1);
}

