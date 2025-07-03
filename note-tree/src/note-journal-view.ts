import { imBegin, imFlex, imScrollContainer } from "./components/core/layout";
import { imBeginTextBlock, imEndTextBlock, imT } from "./components/core/text";
import { GlobalContext } from "./global-context";
import { imEnd, imState, UIRoot } from "./utils/im-dom-utils";

export type JournalViewState = {
    scrollContainer: UIRoot<HTMLElement> | null;
}

function newJournalViewState(): JournalViewState {
    return {
        scrollContainer: null
    };
}

export function imNoteJournalView(ctx: GlobalContext) {
    const s = imState(newJournalViewState);
    const scrollParent = imBegin(); imFlex(); imScrollContainer(); 
    s.scrollContainer = scrollParent; {
        imBeginTextBlock(); {
            imT("Hello there!");
        } imEndTextBlock();
    } imEnd();
}
