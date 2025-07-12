import { imState, timeSeconds } from "src/utils/im-dom-utils";

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

export function timerRepeat(s: TimerState, t: number, repeatTime: number, enabled: boolean): boolean {
    if (s.enabled !== enabled) {
        if (!s.enabled) {
            s.t0 = t;
            s.ticks = 0;
        }

        s.enabled = enabled;
    }
    if (!enabled) return false;

    const currentTime = t - s.t0;

    if (currentTime > repeatTime) {
        s.t0 = t;
        s.ticks++;
        return true;
    }

    return false;
}

export function imTimerRepeat(repeatTime: number, enabled = true) {
    const s = imState(newTimer);
    return timerRepeat(s, timeSeconds(), repeatTime, enabled);
}
