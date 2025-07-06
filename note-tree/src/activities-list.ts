import { imBegin, imFlex, imScrollContainer } from "./components/core/layout";
import { imBeginText, imEndText, imT } from "./components/core/text";
import { GlobalContext } from "./global-context";
import { getNoteOrUndefined, state } from "./state";
import { imEnd, imEndFor, imFor, imNextRoot, imState, UIRoot } from "./utils/im-dom-utils";


export type ActivitiesViewState = {
    scrollContainer: UIRoot<HTMLElement> | null;
}

function newActivitiesViewState(): ActivitiesViewState {
    return {
        scrollContainer: null
    };
}

// TODO: finish, or delete. we don't use this right now.
export function imActivitiesList(ctx: GlobalContext) {
    const s = imState(newActivitiesViewState);
    const scrollParent = imBegin(); imFlex(); imScrollContainer(); 
    s.scrollContainer = scrollParent; {
        imFor(); for (const a of state.activities) {
            imNextRoot();

            imBegin(); {
                imBeginText(); {
                    if (a.breakInfo) {
                        imT(a.breakInfo);
                    } else if (a.nId) {
                        const note = getNoteOrUndefined(state, a.nId);
                        if (note) {
                            imT(note.data.text);
                        } else if (a.deleted) {
                            imT("Note was deleted");
                        } else {
                            imT("Note couldn't be found");
                        }
                    }
                } imEndText();
            } imEnd();
        } imEndFor();
    } imEnd();
}
