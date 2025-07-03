import { assert } from 'src/utils/assert';
import {
    imBeginContext,
    imBeginList,
    imEnd,
    imEndContext,
    imEndList,
    imGetContext,
    imNextRoot,
    imState,
    setText
} from 'src/utils/im-dom-utils.ts';
import { imBegin, INLINE } from './layout';

export type TextBuilderState = {
    init: boolean;
};

export function newTextContext(): TextBuilderState {
    const state = { init: false };
    return state;
}

export function imBeginTextBlock() {
    const tb = imBeginContext(newTextContext);
    imBeginList();
    assert(!tb.init, "You forgot to call `imEndTextBuilder`");
    return tb;
}

export function imT(str: string) {
    const tb = imGetContext(newTextContext);
    if (!tb.init) {
        tb.init = true;
    } else {
        imEnd();
    }

    imNextRoot();
    imBegin(INLINE);
    setText(str);

    // User can set their styles and stuff here. they can't mount children though.
}

export function imEndTextBlock() {
    const tb = imEndContext(newTextContext);

    if (tb.init) {
        imEnd();
        tb.init = false;
    }

    imEndList();
}

