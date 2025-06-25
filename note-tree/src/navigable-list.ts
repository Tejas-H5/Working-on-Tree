import { timerHasReached, updateTimer } from "./app-utils/timer";
import { getAxisRaw, GlobalContext } from "./global-context";
import {
    deltaTimeSeconds
} from "./utils/im-dom-utils";


export function getNavigableListInput(ctx: GlobalContext): number {
    const keyboard = ctx.keyboard;

    const heldDelta = getAxisRaw(keyboard.down.held, keyboard.up.held) +
        getAxisRaw(keyboard.pageDown.held, keyboard.pageUp.held) * 10;

    const pressedDelta = getAxisRaw(keyboard.down.pressed, keyboard.up.pressed) +
        getAxisRaw(keyboard.pageDown.pressed, keyboard.pageUp.pressed) * 10;

    const hasHold = heldDelta !== 0;
    ctx.repeatTimer.enabled = hasHold;

    updateTimer(ctx.repeatTimer, deltaTimeSeconds());
    const repeatIntervalSeconds = ctx.repeatTimer.ticks === 0 ? 0.2 : 0.02;
    const shouldRepeat = timerHasReached(ctx.repeatTimer, repeatIntervalSeconds);
    if (shouldRepeat || pressedDelta) {
        return heldDelta;
    }

    return 0;
}

export type NavigableList = {
    idx: number;
};

export function newListState(): NavigableList {
    return { idx: 0 };
}

export function clampedListIdx(idx: number, len: number): number {
    if (idx < 0) idx = 0;
    if (idx >= len) idx = len - 1;
    return idx;
}


