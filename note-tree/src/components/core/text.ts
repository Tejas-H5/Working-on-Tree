import { imBeginSpan, setText } from "src/utils/im-dom-utils";

// Shorthand
export function imT(str: string) {
    imBeginSpan();
    setText(str);
}
