import {
    imPadding,
    NOT_SET,
    PX
} from "./components/core/layout";
import { newH1 } from "./components/core/new-dom-nodes";
import { imBeginTextBlock, imEndTextBlock } from "./components/core/text";
import {
    imBeginRoot,
    imEnd,
    isFirstRender,
    setStyle
} from "./utils/im-dom-utils";


export function imBeginAppHeading() {
    imBeginRoot(newH1);
    imPadding(10, PX, 0, NOT_SET, 0, NOT_SET, 0, NOT_SET); {
        if (isFirstRender()) {
            setStyle("textOverflow", "ellipsis");
            setStyle("whiteSpace", "nowrap");
        }

        imBeginTextBlock();  {
        }
    }
}

export function imEndAppHeading() {
    {
        {

        } imEndTextBlock();
    } imEnd();
}
