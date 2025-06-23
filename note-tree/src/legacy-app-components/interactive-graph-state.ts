export type GraphArgs = {
    graphData?: GraphData;
    onClose(): void;

    // Should be called whenever any data at all changes
    onInput(): void;
};

export const EDGE_THICNKESSES = {
    THIN: 2,
    NORMAL: 5,
    THICK: 8,
};

export const Z_INDICES = {
    CONTEXT_MENU: "20",
    NODE_SELECTED: "10",
    NODE_UNSELECTED: "9",
    EDGE: "8",
    EDGE_CREATE_HANDLES: "7",
};

export type GraphNodeUIArgs = {
    node: GraphNode;

    graphState: GraphState;
    isEditing: boolean;
    isSelected: boolean;

    onMouseMove(e: MouseEvent): void;
    onMouseDown(e: MouseEvent): void;
    onMouseUp(e: MouseEvent): void;
    onContextMenu(e: MouseEvent): void;

    relativeContainer: Insertable<HTMLDivElement>;
    renderGraph(): void;

    graphArgs: GraphArgs;
};

export type GraphEdgeUIArgs = {
    edge: GraphEdge;
    srcNode: GraphNode | undefined;
    srcNodeEl: HTMLElement | undefined;
    dstNode: GraphNode | undefined;
    dstNodeEl: HTMLElement | undefined;
    graphState: GraphState;

    onMouseMove(e: MouseEvent): void;
    onMouseDown(e: MouseEvent): void;
    onMouseUp(e: MouseEvent): void;
    onContextMenu(e: MouseEvent): void;

    relativeContainer: Insertable<HTMLDivElement>;
    renderGraph(): void;

    graphArgs: GraphArgs;
};

// NOTE: this is the data that will actually be serialized.
// UI vars should go into GraphNodeArgs
export type GraphNode = {
    id: string;
    text: string;
    x: number;
    y: number;
};

export type GraphEdge = {
    id: string;
    text: string;

    // If srcNodeIdx is not -1, then srcXSliced etc. are sliced-normal offsets relative to the source node.
    // else, they are just normal x-y offsets. same with Y.
    srcNodeId: string | undefined;
    dstNodeId: string | undefined;
    srcX: number; srcY: number;
    srcXPivot: number; srcYPivot: number;
    dstX: number; dstY: number;
    dstXPivot: number; dstYPivot: number;
    thickness: number;
};

export type GraphState = {
    viewX: number;
    viewY: number;
    lastMouseX: number;
    lastMouseY: number;
    viewZoom: number;
    isDragging: boolean;
    isClickBlocked: boolean;
    isMouseDown: boolean;
    isEditing: boolean;
    isSnapepdToGrid: boolean;

    contextMenuItems: ContextMenuItem[];
    isContextMenuOpen: boolean;
    contextMenuX: number;
    contextMenuY: number;

    currentSelectedNodeId?: string;
    currentEdgeDragStartNodeIdx?: string;
    currentEdgeDragEndNodeIdx?: string;
    currentEdgeDragStartIsSrc?: boolean;
    currentEdgeDragEdgeId?: string;
}

export type GraphData = {
    nodes: Record<string, GraphNode>;
    edges: Record<string, GraphEdge>;
}

export function newGraphData(): GraphData {
    return {
        nodes: {},
        edges: {}
    };
}

export function getObj<T>(record: Record<string, T>, key: string | undefined): T | undefined {
    if (!key) {
        return undefined;
    }
    return record[key];
}

export function getMap<T>(record: Map<string, T>, key: string | undefined): T | undefined {
    if (!key) {
        return undefined;
    }
    return record.get(key);
}


export function forEachConnectedEdge(nodeId: string | undefined, edges: Record<string, GraphEdge>, fn: (edge: GraphEdge, i: string) => void) {
    if (!nodeId) {
        return;
    }

    for (const id in edges) {
        const edge = edges[id];
        if (
            edge.srcNodeId === nodeId ||
            edge.dstNodeId === nodeId
        ) {
            fn(edge, id);
        }
    }
}




export function rectIntersect(
    r0x0: number, r0y0: number, r0w: number, r0h: number,
    r1x0: number, r1y0: number, r1w: number, r1h: number,
): boolean {
    return (
        rangeIntersect(
            r0x0, r0x0 + r0w,
            r1x0, r1x0 + r1w,
        ) && rangeIntersect(
            r0y0, r0y0 + r0h,
            r1y0, r1y0 + r1h,
        )
    );
}

export function rangeIntersect(
    a0: number, a1: number,
    b0: number, b1: number,
): boolean {
    return (
        (a0 <= b0 && b0 <= a1) ||
        (a0 <= b1 && b1 <= a1) ||
        (b0 <= a0 && a1 <= b1)
    );
};

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, t: number): number {
    return (t - a) / (b - a);
}

export function clamp(val: number, a: number, b: number): number {
    return Math.max(a, Math.min(b, val));
}

export const CLAMP_PADDING = 20;

export function realXToSlicedNormEl(graphState: GraphState, relativeEl: HTMLElement, el: HTMLElement, real: number): [number, number] {
    const rect = el.getBoundingClientRect();
    const low = getRelativeX(relativeEl, rect.left);
    // const hi = getRelativeX(relativeEl, rect.left + rect.width);

    const widthZoomed = rect.width / graphState.viewZoom;
    let posZoomed = (real - low) / graphState.viewZoom;
    if (posZoomed < widthZoomed) {
        return [posZoomed, 0];
    }

    return [posZoomed - widthZoomed, 1];

    // return realToSlicedNorm(low, hi, real);
}

export function slicedNormXToRealEl(graphState: GraphState, relativeEl: HTMLElement, el: HTMLElement, x: number, pivotX: number): number {
    const rect = el.getBoundingClientRect();
    const low = getRelativeX(relativeEl, rect.left);
    // const hi = getRelativeX(relativeEl, rect.left + rect.width);

    return low + clamp(x * graphState.viewZoom, -CLAMP_PADDING, rect.width + CLAMP_PADDING) + rect.width * pivotX;

    // return slicedNormToReal(low, hi, slicedNorm);
}

export function realYToSlicedNormEl(graphState: GraphState, relativeEl: HTMLElement, el: HTMLElement, real: number): [number, number] {
    const rect = el.getBoundingClientRect();
    const low = getRelativeY(relativeEl, rect.top);
    // const hi = getRelativeY(relativeEl, rect.top + rect.height);

    const heightZoomed = rect.height / graphState.viewZoom;
    let posZoomed = (real - low) / graphState.viewZoom;
    if (posZoomed < heightZoomed) {
        return [posZoomed, 0];
    }

    return [posZoomed - heightZoomed, 1];
    // return realToSlicedNorm(low, hi, real);
}



export function slicedNormYToRealEl(graphState: GraphState, relativeEl: HTMLElement, el: HTMLElement, y: number, pivotY: number): number {
    const rect = el.getBoundingClientRect();
    const low = getRelativeY(relativeEl, rect.top);
    // const hi = getRelativeY(relativeEl, rect.top + rect.height);

    // return low + y + pivotY * rect.height;
    return low + clamp(y * graphState.viewZoom, -CLAMP_PADDING, rect.height + CLAMP_PADDING) + rect.height * pivotY;
    // return slicedNormToReal(low, hi, slicedNorm);
}

export function realToSlicedNorm(low: number, hi: number, real: number) {
    if (real < low) {
        // map all numbers below `low` to < 0
        return real - low - 0.5;
    }

    if (real > hi) {
        // map all numbers above `hi` to > 1
        return real - hi + 0.5;
    }

    // map all numbers between low and hi to be between -0.5 to 0.5 (we're centering around 0 so that scaling is easier)
    return lerp(-0.5, 0.5, inverseLerp(low, hi, real));
}


export function slicedNormToReal(low: number, hi: number, norm: number) {
    if (norm < -0.5) {
        return norm + low + 0.5;
    }

    if (norm > 0.5) {
        return hi + norm - 0.5;
    }

    return lerp(low, hi, inverseLerp(-0.5, 0.5, norm));
}

export function edgeSrcX(graphState: GraphState, relativeEl: HTMLElement, edge: GraphEdge, srcNode: GraphNode | undefined, nodeEl: HTMLElement | undefined) {
    if (!srcNode || !nodeEl) {
        return graphXToRealX(graphState, relativeEl, edge.srcX);
    }

    return slicedNormXToRealEl(graphState, relativeEl, nodeEl, edge.srcX, edge.srcXPivot);
}

export function edgeSrcY(graphState: GraphState, relativeEl: HTMLElement, edge: GraphEdge, srcNode: GraphNode | undefined, nodeEl: HTMLElement | undefined) {
    if (!srcNode || !nodeEl) {
        return graphYToRealY(graphState, relativeEl, edge.srcY);
    }

    return slicedNormYToRealEl(graphState, relativeEl, nodeEl, edge.srcY, edge.srcYPivot);
}

export function edgeDstX(graphState: GraphState, relativeEl: HTMLElement, edge: GraphEdge, dstNode: GraphNode | undefined, nodeEl: HTMLElement | undefined) {
    if (!dstNode || !nodeEl) {
        return graphXToRealX(graphState, relativeEl, edge.dstX);
    }

    return slicedNormXToRealEl(graphState, relativeEl, nodeEl, edge.dstX, edge.dstXPivot);
}

export function edgeDstY(graphState: GraphState, relativeEl: HTMLElement, edge: GraphEdge, dstNode: GraphNode | undefined, nodeEl: HTMLElement | undefined) {
    if (!dstNode || !nodeEl) {
        return graphYToRealY(graphState, relativeEl, edge.dstY);
    }

    return slicedNormYToRealEl(graphState, relativeEl, nodeEl, edge.dstY, edge.dstYPivot);
}

export function graphXToRealX(graphState: GraphState, root: HTMLElement, x: number) {
    return Math.floor(graphState.viewX + (x * graphState.viewZoom));
}

export function realXToGraphX(graphState: GraphState, root: HTMLElement, x: number) {
    return Math.floor(x - graphState.viewX) / graphState.viewZoom;
}

export function graphYToRealY(graphState: GraphState, root: HTMLElement, y: number) {
    return Math.floor(graphState.viewY + (y * graphState.viewZoom));
}

export function realYToGraphY(graphState: GraphState, root: HTMLElement, y: number) {
    return Math.floor(y - graphState.viewY) / graphState.viewZoom;
}

export function getRelativeX(parent: HTMLElement, pageX: number) {
    return pageX - parent.offsetLeft;
}

export function getRelativeY(parent: HTMLElement, pageY: number) {
    return pageY - parent.offsetTop;
}


export function magnitude(x: number, y: number) {
    return Math.sqrt(x * x + y * y);
}
