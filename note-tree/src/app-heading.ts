import { imPadding, NA, PX } from "./components/core/layout";
import { newH1 } from "./components/core/new-dom-nodes";
import {
    imBeginRoot,
    imIsFirstishRender,
    setStyle
} from "./utils/im-dom-utils";


export function imBeginAppHeading() {
    imBeginRoot(newH1);
    imPadding(10, PX, 0, NA, 0, NA, 0, NA); {
        if (imIsFirstishRender()) {
            setStyle("textOverflow", "ellipsis");
            setStyle("fontSize", "28px");
        }
    } // imEnd();
}

export function imBold() {
    if (imIsFirstishRender()) {
        setStyle("fontWeight", "bold");
    }
}
