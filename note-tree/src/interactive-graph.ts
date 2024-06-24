import { makeButton } from "./components";
import { filterInPlace } from "./utils/array-utils";
import { Insertable, addChildren, div, el, elSvg, isVisible, newComponent, newRenderGroup, newState, newStyleGenerator, on, setAttr, setClass, setInputValue, setStyle, setText, setVisible, setVisibleGroup } from "./utils/dom-utils";
import { newDragManager } from "./utils/drag-handlers";

const sg = newStyleGenerator();

type GraphArgs = {
    onClose(): void;
};

const Z_INDICES = {
    NODE_SELECTED: "10",
    NODE_UNSELECTED: "9",
    EDGE: "8",
    EDGE_CREATE_HANDLES: "7",
};

type GraphNodeUIArgs = {
    node: GraphNode;

    idx: number;
    graphState: GraphState;
    isEditing: boolean;
    isSelected: boolean;

    onMouseMove(e: MouseEvent): void;
    onMouseDown(e: MouseEvent): void;
    onMouseUp(e: MouseEvent): void;

    relativeContainer: Insertable<HTMLElement>;
    renderGraph(): void;
};

type GraphEdgeUIArgs = {
    edge: GraphEdge;
    srcNode: GraphNode | undefined;
    dstNode: GraphNode | undefined;
    graphState: GraphState;

    relativeContainer: Insertable<HTMLElement>;
};



// NOTE: this is the data that will actually be serialized.
// UI vars should go into GraphNodeArgs
export type GraphNode = {
    text: string;
    x: number;
    y: number;
};

type GraphState = {
    viewX: number;
    viewY: number;
    isDragging: boolean;
    isClickBlocked: boolean;
    isMouseDown: boolean;
    isEditing: boolean;

    currentSelectedNode: number;
    currentEdgeDragSrcNodeIdx: number;
    currentEdgeDragDstNodeIdx: number;
    currentEdgeDragEdgeIdx: number;
}

export type GraphEdge = {
    srcNodeIdx: number;
    srcX: number; srcY: number;
    dstNodeIdx: number;
    dstX: number; dstY: number;
};

// TODO: inject these
const graphNodes: GraphNode[] = [];
const graphEdges: GraphEdge[] = [];

export function InteractiveGraph() {
    const s = newState<GraphArgs>();

    const rg = newRenderGroup();

    const graphRoot = div({ 
        class: "absolute-fill",
        style: "border: 2px solid var(--fg-color); overflow: hidden; cursor: move;", 
    });

    // const testEdgeEl = GraphEdge();
    // const testEdge: GraphEdge = {
    //     srcX: 0, srcY: 0,
    //     dstX: 0, dstY: 0,
    //     srcNodeIdx: -1,
    //     dstNodeIdx: -1,
    // }

    const svgRoot = elSvg("svg", { 
            class: "absolute-fill",
        }, [
            // rg.cArgs(testEdgeEl, () => {
            //     testEdge.srcY = 0;
            //     testEdge.srcX = 0;
            //
            //     const realX = realXToGraphX(graphState, relativeContainer.el, mouseX);
            //     const graphX = graphXToRealX(graphState, relativeContainer.el, realX);
            //     testEdge.dstX = realXToGraphX(graphState, relativeContainer.el, graphX);
            //
            //     const realY = realYToGraphY(graphState, relativeContainer.el, mouseY);
            //     const graphY = graphYToRealY(graphState, relativeContainer.el, realY);
            //     testEdge.dstY = realYToGraphY(graphState, relativeContainer.el, graphY);
            //
            //     return {
            //         srcNode: undefined,
            //         dstNode: undefined,
            //         edge: testEdge,
            //         graphState,
            //         relativeContainer,
            //     }
            // }),
            rg.list(elSvg("g"), GraphEdge, (getNext) => {
                const svgRootRect = graphRoot.el.getBoundingClientRect();
                setAttr(svgRoot, "width", "" + Math.floor(svgRootRect.width));
                setAttr(svgRoot, "height", "" + Math.floor(svgRootRect.height));

                for (let i = 0; i < graphEdges.length; i++) {
                    const edge = graphEdges[i];
                    const c = getNext();

                    if (!c.state.hasArgs()) {
                        c.state.args = {
                            srcNode: graphNodes[edge.srcNodeIdx],
                            dstNode: graphNodes[edge.dstNodeIdx],
                            graphState: graphState,
                            edge,
                            relativeContainer,
                        };
                    }

                    c.state.args.edge = graphEdges[i];
                    c.state.args.srcNode = graphNodes[edge.srcNodeIdx];
                    c.state.args.dstNode = graphNodes[edge.dstNodeIdx];
                    c.state.args.graphState = graphState;

                    c.render(c.state.args);
                }
            }),
        ]
    );

    const relativeContainer = div({ class: "col relative flex-1" });

    const root = div({
        class: "flex-1 w-100 h-100 col",
    }, [
        addChildren(relativeContainer, [
        // NOTE: not quite right to use graphRoot as the root of the list...
            rg.list(graphRoot, GraphNode, (getNext) => {
                for (let i = 0; i < graphNodes.length; i++) {
                    const c = getNext();
                    if (!c.state.hasArgs()) {
                        c.render({
                            node: graphNodes[i],

                            idx: 0,
                            isEditing: false,
                            isSelected: false,
                            graphState,

                            onMouseDown,
                            onMouseUp,
                            onMouseMove,

                            relativeContainer,
                            renderGraph,
                        })
                    }

                    c.state.args.node = graphNodes[i];
                    c.state.args.idx = i;
                    c.state.args.graphState = graphState;
                    c.state.args.isSelected = graphState.currentSelectedNode === i;
                    c.state.args.isEditing = graphState.isEditing && c.state.args.isSelected;

                    c.render(c.state.args);
                }
            }),
            svgRoot,
        ]),
        div({class: "row align-items-center"}, [
            on(makeButton("Recenter"), "click", () => {
                recenter();
                renderGraph();
            }),
            div({ class: "flex-1" }),
            on(makeButton("New node"), "click", () => {
                addNewNode();
                renderGraph();
            }),
        ]),
    ]);

    const graphState: GraphState = {
        viewX: 0,
        viewY: 0,
        isDragging: false,
        isClickBlocked: false, 
        isMouseDown: false,
        isEditing: false,
        currentSelectedNode: -1,
        currentEdgeDragSrcNodeIdx: -1,
        currentEdgeDragDstNodeIdx: -1,
        currentEdgeDragEdgeIdx: -1,
    };

    let viewDxStart = 0, viewDyStart = 0;
    let nodeDxStart = 0, nodeDyStart = 0;
    let edgeDragDxStart = 0, edgeDragDyStart = 0;

    function moveGraph(x: number, y: number) {
        graphState.viewY = x;
        graphState.viewX = y;
    }

    function recenter() {
        // move all the elements themselves by their mean.
        let meanX = 0, meanY = 0;
        for (const node of graphNodes) {
            meanX += node.x / graphNodes.length;
            meanY += node.y / graphNodes.length;
        }

        for (const node of graphNodes) {
            node.x -= meanX;
            node.y -= meanY;
        }

        moveGraph(0, 0);
    }

    function addNewNode() {
        const idx = graphNodes.length;
        graphNodes.push({ 
            text: "New node " + graphNodes.length, 
            x: 0,
            y: 0,
        });
        return idx;
    }

    let domRect = root.el.getBoundingClientRect();


    function renderGraph() {
        domRect = root.el.getBoundingClientRect();

        filterInPlace(graphEdges, (edge) => {
            return (
                (edge.dstNodeIdx !== -1 && edge.srcNodeIdx !== -1) ||
                graphState.currentEdgeDragSrcNodeIdx === edge.srcNodeIdx
            );
        });

        rg.render();
    }

    function startEdgeDrag(e: MouseEvent) {
        const srcX = realXToGraphX(graphState, relativeContainer.el, getMouseX(relativeContainer.el, e));
        const srcY = realYToGraphY(graphState, relativeContainer.el, getMouseY(relativeContainer.el, e));

        const srcNode = graphNodes[graphState.currentEdgeDragSrcNodeIdx];
        if (!srcNode) {
            return;
        }

        edgeDragDxStart = srcX;
        edgeDragDyStart = srcY;

        const newEdgeIdx = graphEdges.length;
        graphEdges.push({
            srcNodeIdx: graphState.currentEdgeDragSrcNodeIdx,
            srcX: srcX - srcNode.x, 
            srcY: srcY - srcNode.y,

            dstNodeIdx: -1,
            dstX: srcX,
            dstY: srcY,
        });

        graphState.currentSelectedNode = -1;
        graphState.currentEdgeDragEdgeIdx = newEdgeIdx;
    }

    function finishEdgeDrag(e: MouseEvent) {
        const currentEdgeDragDstNodeIdx = graphState.currentEdgeDragDstNodeIdx;
        const currentEdgeDragEdgeIdx = graphState.currentEdgeDragEdgeIdx;

        const dstNode = graphNodes[currentEdgeDragDstNodeIdx];
        const currentEdge = graphEdges[currentEdgeDragEdgeIdx];

        graphState.currentEdgeDragDstNodeIdx = -1;
        graphState.currentEdgeDragEdgeIdx = -1;
        graphState.currentEdgeDragSrcNodeIdx = -1;

        if (!currentEdge || !dstNode) {
            return;
        }

        const dstX = realXToGraphX(graphState, relativeContainer.el, getMouseX(relativeContainer.el, e));
        const dstY = realYToGraphY(graphState, relativeContainer.el, getMouseY(relativeContainer.el, e));

        const dstNodeToX = dstX - dstNode.x;
        const dstNodeToY = dstY - dstNode.y;

        currentEdge.dstNodeIdx = currentEdgeDragDstNodeIdx;
        currentEdge.dstX = dstNodeToX;
        currentEdge.dstY = dstNodeToY;

        renderGraph();
    }

    const dragManager = newDragManager({
        onDragStart(e) {
            graphState.isDragging = true;
            if (graphState.currentEdgeDragSrcNodeIdx !== -1) {
                startEdgeDrag(e);
            } else if (graphState.currentSelectedNode !== -1) {
                const currentNode = graphNodes[graphState.currentSelectedNode];
                nodeDxStart = currentNode.x;
                nodeDyStart = currentNode.y;
            } else {
                viewDxStart = graphState.viewX;
                viewDyStart = graphState.viewY;
            }
        },
        onDrag(dx: number, dy: number) {
            if (graphState.isEditing) {
                return;
            }

            if (graphState.currentSelectedNode !== -1) {
                const currentNode = graphNodes[graphState.currentSelectedNode];
                currentNode.x = nodeDxStart + dx;
                currentNode.y = nodeDyStart + dy;
                return;
            }

            if (graphState.currentEdgeDragEdgeIdx !== -1) {
                const currentEdge = graphEdges[graphState.currentEdgeDragEdgeIdx];
                currentEdge.dstX = edgeDragDxStart + dx;
                currentEdge.dstY = edgeDragDyStart + dy;
                return;
            }

            graphState.viewX = viewDxStart + dx;
            graphState.viewY = viewDyStart + dy;
            return;
        },
        onDragEnd(e) {
            graphState.isDragging = false;

            finishEdgeDrag(e);
        }, 
    });

    let mouseX = 0, mouseY = 0;
    function onMouseMove(e: MouseEvent) {
        graphState.isMouseDown = e.buttons !== 0;

        dragManager.onMouseMove(e);

        mouseX = getMouseX(relativeContainer.el, e);
        mouseY = getMouseY(relativeContainer.el, e);

        if (!graphState.isDragging) {
            // reset a bunch of things that were set in drag operations
            graphState.isClickBlocked = false;
            graphState.currentEdgeDragSrcNodeIdx = -1;
        } else {
            graphState.currentEdgeDragDstNodeIdx = -1;
        }
    }

    function onMouseUp(e: MouseEvent) {
        graphState.isMouseDown = e.buttons !== 0;

        dragManager.onMouseUp(e);
    }

    function onMouseDown(e: MouseEvent) {
        graphState.isMouseDown = e.buttons !== 0;

        dragManager.onMouseDown(e);

        setTimeout(() => {
            if (graphState.isClickBlocked) {
                return;
            }

            graphState.currentSelectedNode = -1;
            graphState.isEditing = false;

            renderGraph();
        }, 1);
        
        renderGraph();
    }

    let lastX = 0, lastY = 0;
    on(relativeContainer, "mousemove", (e) => {
        // only run mousemove if we've moved by a large enough distance;
        const x = Math.floor(e.pageX / 2);
        const y = Math.floor(e.pageY / 2);
        if (lastX === x && lastY === y) {
            return
        }

        lastX = x;
        lastY = y;

        onMouseMove(e);

        renderGraph();
    });
    on(relativeContainer, "mouseup", (e) => {
        onMouseUp(e);
        renderGraph();
    });
    on(relativeContainer, "mousedown", (e) => {
        onMouseDown(e);
        renderGraph();
    });

    document.addEventListener("keydown", (e) => {
        if (!isVisible(root)) {
            return;
        }

        let needsRender = true;

        if (e.key === "Enter" && !graphState.isEditing && graphState.currentSelectedNode !== -1) {
            graphState.isEditing = true;
        } else if (e.key === "Escape") {
            if (graphState.isEditing) {
                graphState.isEditing = false;
            } else if (graphState.currentSelectedNode !== -1) {
                graphState.currentSelectedNode = -1;
            } else {
                s.args.onClose();
            }
        } else {
            needsRender = false;
        }

        if (needsRender) {
            e.stopPropagation();
            e.preventDefault();
            renderGraph();
        }
    });

    // Testing code. TODO: remove
    setTimeout(() => {
        const srcNodeIdx = addNewNode();
        const dstNodeIdx = addNewNode();
        graphEdges.push({
            srcNodeIdx,
            srcX: 0, srcY: 0,
            dstNodeIdx,
            dstX: 0, dstY: 0
        });
        renderGraph();
    }, 1);

    return newComponent(root, renderGraph, s);
}

function GraphNode() {
    const s = newState<GraphNodeUIArgs>();

    const className = "pre-wrap w-100 h-100";
    const styles = "padding: 0; position: absolute;";
    const textArea = el<HTMLTextAreaElement>("TEXTAREA", { 
        class: className, 
        style: styles + "cursor: text;",
        spellcheck: "false",
    });

    const textDiv = div({
        class: className, 
        style: styles + "user-select: none; cursor: pointer;",
    });

    const [edgeDragStartRegions, updateDragRegionStyles] = makeDragRects((regionDiv) => {
        on(regionDiv, "mousemove", (e) => {
            const { graphState, idx, onMouseMove, renderGraph } = s.args;

            e.stopImmediatePropagation();

            onMouseMove(e);

            if (!graphState.isDragging) {
                graphState.currentEdgeDragSrcNodeIdx = idx;
            } else {
                graphState.currentEdgeDragDstNodeIdx = idx;
            }

            renderGraph();
        });
        on(regionDiv, "mouseup", (e) => {
            const { onMouseUp, renderGraph } = s.args;

            e.stopImmediatePropagation();

            onMouseUp(e);
            renderGraph();
        });
        on(regionDiv, "mousedown", (e) => {
            const { onMouseDown, renderGraph } = s.args;

            e.stopImmediatePropagation();

            onMouseDown(e);

            renderGraph();
        });
    });

    const rg = newRenderGroup();
    const root = div({
        style: "position: absolute; padding: 5px; border: 1px var(--fg-color) solid; ",
    }, [
        div({ style: "position: relative;" }, [
            textArea,
            textDiv,
            ...edgeDragStartRegions,
        ]),
    ]);


    let lastText: string | undefined;
    let lastIsEditing = false;

    function render() {
        const { node, isSelected, isEditing, graphState, relativeContainer, idx } = s.args;

        if (setVisibleGroup(
            !graphState.isDragging || idx !== graphState.currentEdgeDragSrcNodeIdx, 
            edgeDragStartRegions
        )) {
            updateDragRegionStyles(s.args);
        }

        rg.render();

        if (
            lastText !== node.text ||
            lastIsEditing !== isEditing
        ) {
            lastIsEditing = isEditing;
            lastText = node.text;

            if (setVisible(textArea, isEditing)) {
                textArea.el.focus();
                setInputValue(textArea, node.text);
            } 

            if (setVisible(textDiv, !isEditing)) {
                setText(textDiv, node.text);
            }

            updateTextAreaSize();
        }

        const xPos = graphXToRealX(graphState, relativeContainer.el, node.x);
        const yPos = graphYToRealY(graphState, relativeContainer.el, node.y);

        setStyle(root, "transform", `translate(${xPos}px, ${yPos}px)`);
        setStyle(root, "backgroundColor", isSelected ? "var(--bg-color-focus)" : "var(--bg-color)");
        setStyle(root, "zIndex", isSelected ? Z_INDICES.NODE_SELECTED : Z_INDICES.NODE_UNSELECTED);
        setStyle(textDiv, "backgroundColor", isSelected ? "var(--bg-color-focus)" : "var(--bg-color)");
        setStyle(textArea, "backgroundColor", isSelected ? "var(--bg-color-focus)" : "var(--bg-color)");
    }

    function updateTextAreaSize() {
        // we need to fit to the text size both the width and height!

        const { node, isEditing } = s.args;
        lastText = node.text;

        const textEl = isEditing ? textArea : textDiv;

        textEl.el.style.width = "0";
        // these are our '' styles.
        // it don't work though, so I've commented it out
        // textEl.el.style.whiteSpace = "";
        // textEl.el.style.overflowWrap = "anywhere";
        textEl.el.style.whiteSpace = "pre";
        // was getting some false wrapping happening when using exact width, so now I've aded this + 5 and it seems to be working nicer
        textEl.el.style.width = Math.max(30, Math.min(500, textEl.el.scrollWidth + 5)) + "px";
        textEl.el.style.whiteSpace = "pre-wrap";
        textEl.el.style.height = "0";
        textEl.el.style.height = textEl.el.scrollHeight + "px";

        textEl.el.parentElement!.style.width = textEl.el.style.width;
        textEl.el.parentElement!.style.height = textEl.el.style.height;

        textEl.el.parentElement!.parentElement!.style.width = textEl.el.style.width;
        textEl.el.parentElement!.parentElement!.style.height = textEl.el.style.height;
    }

    root.el.addEventListener("click", (e) => {
        const { graphState, renderGraph, idx } = s.args;

        if (s.args.graphState.isDragging) {
            return;
        }

        // TODO: fix. it clicks instantly after it selects.  lmao.
        e.stopPropagation();

        if (s.args.graphState.isDragging) {
            s.args.graphState.isDragging = false;
            return;
        }

        if (graphState.currentSelectedNode === idx && !graphState.isEditing) {
            graphState.isEditing = true;
            renderGraph();
        }
    });

    root.el.addEventListener("mousedown", () => {
        const { idx, graphState, renderGraph, } = s.args;

        // block clicking, so we don't instantly de-select this thing.
        graphState.isClickBlocked = true;
        if (graphState.currentSelectedNode !== idx) {
            graphState.currentSelectedNode = idx;
        }

        renderGraph();
    });

    on(textArea, "input", () => {
        const { node } = s.args;
        node.text = textArea.el.value;
        updateTextAreaSize();
    });

    return newComponent(root, render, s);
}

const cnGraphEdge = sg.makeClass("graphEdge", [
    ` > .path   { fill: none; stroke: var(--fg-color); stroke-width: 5; }`,
    ` > .hitbox { fill: none; stroke: none; stroke-width: 30; }`,
    ` > .hitbox:hover { stroke: rgba(255, 0, 0, 0.5); }`,
    `.block-mouse > * { pointer-events: none }`,
]);

function GraphEdge() {
    const s = newState<GraphEdgeUIArgs>();

    const pathEl = elSvg("path", { class: "path" });
    const hitboxEl = elSvg("path", { class: "hitbox" });
    const root = elSvg("g", { class: cnGraphEdge }, [
        pathEl,
        hitboxEl,
    ]);

    const c = newComponent(root, render, s);

    function render() {
        const { edge, srcNode, dstNode, graphState, relativeContainer } = s.args;

        setClass(root, "block-mouse", true || graphState.isDragging);

        let x0 = edgeSrcX(graphState, relativeContainer.el, edge, srcNode);
        let y0 = edgeSrcY(graphState, relativeContainer.el, edge, srcNode);
        let x1 = edgeDstX(graphState, relativeContainer.el, edge, dstNode);
        let y1 = edgeDstY(graphState, relativeContainer.el, edge, dstNode);

        /**
         * Very helpful: https://www.w3schools.com/graphics/svg_path.asp
         *
         *  M = moveto (move from one point to another point)
         *  L = lineto (create a line)
         *  H = horizontal lineto (create a horizontal line)
         *  V = vertical lineto (create a vertical line)
         *  C = curveto (create a curve)
         *  S = smooth curveto (create a smooth curve)
         *  Q = quadratic Bézier curve (create a quadratic Bézier curve)
         *  T = smooth quadratic Bézier curveto (create a smooth quadratic Bézier curve)
         *  A = elliptical Arc (create a elliptical arc)
         *  Z = closepath (close the path)
         *
         *  Note: All of the commands above can also be
         */

        setAttr(pathEl, "d", `M${x0} ${y0} L${x1} ${y1} L`);
        setAttr(hitboxEl, "d", `M${x0} ${y0} L${x1} ${y1} L`);
    }

    return c;
}


const cnEdgeCreateDragRect = sg.makeClass("graphNodeDragRect", [
    // https://stackoverflow.com/questions/704564/disable-drag-and-drop-on-html-elements
    // So many fkn opinions on this thread - user-select: none; was the only thing that worked.
    ` { position: absolute; z-index: ${Z_INDICES.EDGE_CREATE_HANDLES}; background-color: transparent; cursor: crosshair; border: 1px black solid; user-select: none; }`,
    `.src-edge-drag { background-color: rgba(255, 0, 0, 0.5); }`,
    `.dst-edge-drag { background-color: rgba(0, 0, 255, 0.5); }`,
]);

function makeDragRects(setupfn: (dragRect: Insertable<HTMLDivElement>) => void) {
    const dragRects = [
        div({ class: cnEdgeCreateDragRect }),
        div({ class: cnEdgeCreateDragRect }),
        div({ class: cnEdgeCreateDragRect }),
        div({ class: cnEdgeCreateDragRect }),
    ];

    const directions = [
        "top", "right", "bottom", "left"
    ] as const;
    const axes = [
        "height", "width", "height", "width"
    ] as const;

    function updateDragRectStyles(args: GraphNodeUIArgs) {
        const { graphState, idx } = args;

        const outsetWidth = 40;
        for(let i = 0; i < dragRects.length; i++) {
            const divEl = dragRects[i];

            setStyle(divEl, directions[i - 1] || "left", "-" + outsetWidth + "px");
            setStyle(divEl, directions[i] || "top", "-" + outsetWidth + "px");
            setStyle(divEl, directions[i + 1] || "top", "0");
            setStyle(divEl, axes[i], outsetWidth + "px");

            // setClass(divEl, "src-edge-drag", graphState.currentEdgeDragSrcNodeIdx === idx);
            // setClass(divEl, "dst-edge-drag", graphState.currentEdgeDragDstNodeIdx === idx);
        }
    }

    for (const dr of dragRects) {
        setupfn(dr);
    }

    return [dragRects, updateDragRectStyles] as const;
}


function edgeSrcX(graphState: GraphState, root: HTMLElement, edge: GraphEdge, srcNode: GraphNode | undefined) {
    let x: number = 0;
    if (srcNode) {
        x = srcNode.x + edge.srcX;
    } else {
        x = edge.srcX;
    }
    return graphXToRealX(graphState, root, x);
}

function edgeSrcY(graphState: GraphState, root: HTMLElement, edge: GraphEdge, srcNode: GraphNode | undefined) {
    let y: number = 0;
    if (srcNode) {
        y = srcNode.y + edge.srcY;
    } else {
        y = edge.srcY;
    }
    return graphYToRealY(graphState, root, y);
}

function edgeDstX(graphState: GraphState, root: HTMLElement, edge: GraphEdge, dstNode: GraphNode | undefined) {
    let x: number = 0;
    if (dstNode) {
        x = dstNode.x + edge.dstX;
    } else {
        x = edge.dstX;
    }
    return graphXToRealX(graphState, root, x);
}

function edgeDstY(graphState: GraphState, root: HTMLElement, edge: GraphEdge, dstNode: GraphNode | undefined) {
    let y: number = 0;
    if (dstNode) {
        y = dstNode.y + edge.dstY;
    } else {
        y = edge.dstY;
    }
    return graphYToRealY(graphState, root, y);
}

function graphXToRealX(graphState: GraphState, root: HTMLElement, x: number) {
    const rect = root.getBoundingClientRect();
    return Math.floor(
        graphState.viewX + (rect.width / 2) + x
    );
}

function realXToGraphX(graphState: GraphState, root: HTMLElement, x: number) {
    const rect = root.getBoundingClientRect();
    return Math.floor(
        x - graphState.viewX - (rect.width / 2)
    );
}

function graphYToRealY(graphState: GraphState, root: HTMLElement, y: number) {
    const rect = root.getBoundingClientRect();
    return Math.floor(
        graphState.viewY + rect.height / 2 + y
    );
}

function realYToGraphY(graphState: GraphState, root: HTMLElement, y: number) {
    const rect = root.getBoundingClientRect();
    return Math.floor(
        y - graphState.viewY - (rect.height / 2)
    );
}

function getMouseX(parent: HTMLDivElement, e: MouseEvent) {
    return e.pageX - parent.offsetLeft;
}

function getMouseY(parent: HTMLDivElement, e: MouseEvent) {
    return e.pageY - parent.offsetTop;
}
