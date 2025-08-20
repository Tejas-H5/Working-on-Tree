import { ImCache, imGet, imSet } from "src/utils/im-core";

export type TimerState = {
    t0: number;
    ticks: number;
    enabled: boolean;
};

export function newTimer(): TimerState {
    return {
        t0: 0,
        ticks: 0,
        enabled: true,
    };
}

export function timerRepeat(s: TimerState, t: number, repeatTime: number | null, enabled: boolean): boolean {
    if (s.enabled !== enabled) {
        if (!s.enabled) {
            s.t0 = t;
            s.ticks = 0;
        }

        s.enabled = enabled;
    }
    if (!enabled) return false;

    const currentTime = t - s.t0;

    if (repeatTime) {
        if (currentTime > repeatTime) {
            s.t0 = t;
            s.ticks++;
            return true;
        }
    }

    return false;
}

export function getTimeElapsedSinceRepeat(s: TimerState, t: number) {
    if (!s.enabled) return 0;
    return t - s.t0;
}

// NOTE: There will reach a point where you'll want to put this timer into your state, which should be easy enough
export function imTimerRepeat(c: ImCache, repeatTime: number, enabled = true) {
    let s = imGet(c, newTimer);
    if (!s) s = imSet(c, newTimer());
    // TODO: proper timer
    return timerRepeat(s, performance.now() / 1000, repeatTime, enabled);
}
