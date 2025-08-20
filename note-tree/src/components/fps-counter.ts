export type FpsCounterState = {
    renderStart: number;
    renderEnd: number;
    frameMs: number;
    renderMs: number;
}

export function newFpsCounterState(): FpsCounterState {
    return {
        renderStart: 0,
        renderEnd: 0,
        frameMs: 0,
        renderMs: 0,
    }
}

// It's a bit complicated and I've forgotten how it works, but it seems to be working so I'll keep it around for now
export function fpsMarkRenderingStart(fps: FpsCounterState) {
    const t = performance.now();;

    fps.renderMs = fps.renderEnd - fps.renderStart;
    fps.frameMs = t - fps.renderStart;

    fps.renderStart = t;
}

export function fpsMarkRenderingEnd(fps: FpsCounterState) {
    fps.renderEnd = performance.now();
}
