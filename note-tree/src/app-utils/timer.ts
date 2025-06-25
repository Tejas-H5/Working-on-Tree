export type TimerState = {
    t: number;
    ticks: number;
    enabled: boolean;
    enabledLast: boolean;
};

export function newTimer(): TimerState {
    return {
        t: 0,
        ticks: 0,
        enabled: true,
        enabledLast: true,
    };
}

export function updateTimer(s: TimerState, dt: number) {
    if (s.enabled) {
        if (!s.enabledLast) {
            s.t = 0;
            s.ticks = 0;
        }

        s.t += dt;
    }
    s.enabledLast = s.enabled;
}

export function timerHasReached(s: TimerState, seconds: number) {
    if (!s.enabled) return false;
    if (s.t > seconds) {
        s.t = 0;
        s.ticks++;
        return true;
    }
    return false;
}
