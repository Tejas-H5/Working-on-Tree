export type FpsCounterState = {
    renderStart: number;
    renderEnd: number;
    frameDuration: number;
}

export function newFpsCounterState(): FpsCounterState {
    return {
        renderStart: 0,
        renderEnd: 0,
        frameDuration: 0,
    }
}

// It's a bit complicated and I've forgotten how it works, but it seems to be working so I'll keep it around for now
export function fpsMarkRenderingStart(fps: FpsCounterState) {
    const lastRenderStart = fps.renderStart;
    fps.renderStart = performance.now();
    fps.frameDuration = fps.renderStart - lastRenderStart;
}

export function fpsMarkRenderingEnd(fps: FpsCounterState) {
    fps.renderEnd = performance.now();
}
