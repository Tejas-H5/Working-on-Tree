import { imBeginSpan, setText } from "src/utils/im-dom-utils";

// Shorthand
export function imSpan(str: string) {
    imBeginSpan();
    setText(str);
    // imEnd();
}
