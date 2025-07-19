import {
    imPadding,
    NOT_SET,
    PX
} from "./components/core/layout";
import { newH1 } from "./components/core/new-dom-nodes";
import {
    imBeginRoot,
    isFirstishRender,
    setStyle
} from "./utils/im-dom-utils";


export function imBeginAppHeading() {
    imBeginRoot(newH1);
    imPadding(10, PX, 0, NOT_SET, 0, NOT_SET, 0, NOT_SET); {
        if (isFirstishRender()) {
            setStyle("textOverflow", "ellipsis");
            setStyle("whiteSpace", "nowrap");
        }
    } // imEnd();
}
