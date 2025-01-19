import { newTextArea } from "./components/text-area";
import { addChildren, cn, div, el, Insertable, isVisible, newComponent, newCssBuilder, newListRenderer, RenderGroup, setAttrs, setClass, setInputValue, setInputValueAndResize, setStyle, setText, setVisible } from "./utils/dom-utils";
import { newDragManager } from "./utils/drag-handlers";
import { newUuid } from "./utils/uuid";
import { cnApp, cssVars } from "./styling";

type GraphArgs = {
    graphData?: GraphData;
    onClose(): void;

    // Should be called whenever any data at all changes
    onInput(): void;
};

const EDGE_THICNKESSES = {
    THIN: 2,
    NORMAL: 5,
    THICK: 8,
};

const Z_INDICES = {
    CONTEXT_MENU: "20",
    NODE_SELECTED: "10",
    NODE_UNSELECTED: "9",
    EDGE: "8",
    EDGE_CREATE_HANDLES: "7",
};

type GraphNodeUIArgs = {
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

type GraphEdgeUIArgs = {
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

type GraphState = {
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

function getObj<T>(record: Record<string, T>, key: string | undefined): T | undefined {
    if (!key) {
        return undefined;
    }
    return record[key];
}

function getMap<T>(record: Map<string, T>, key: string | undefined): T | undefined {
    if (!key) {
        return undefined;
    }
    return record.get(key);
}


function forEachConnectedEdge(nodeId: string | undefined, edges: Record<string, GraphEdge>, fn: (edge: GraphEdge, i: string) => void) {
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


// WARNING:
// I had made this for a bit of fun, but this component is mostly a mistake and any further maintanence will be a giant waste of time.
// I should convert to SVG for convenience, and easier exporting/reusing our diagrams in other places.

export function InteractiveGraph(rg: RenderGroup<GraphArgs>) {
    const graphRoot = div({
        class: [cn.absoluteFill],
        style: `border: 2px solid cncssVars.fgColor}; overflow: hidden; cursor: move;`,
    });

    const relativeContainer = div({ class: [cn.col, cn.relative, cn.flex1] });
    const contextMenu = newComponent(RadialContextMenu);

    let graphData = newGraphData();

    const nodeComponentMap = new Map<string, Insertable<HTMLDivElement>>();
    const edgeComponentMap = new Map<string, Insertable<HTMLDivElement>>();

    const nodeListRenderer = newListRenderer(div({ class: [cn.absoluteFill, cn.pointerEventsNone] }), () => newComponent(GraphNodeUI));
    rg.preRenderFn((graphS) => nodeListRenderer.render((getNext) => {
        for (const id of nodeComponentMap.keys()) {
            if (!(id in graphData.nodes)) {
                nodeComponentMap.delete(id);
            }
        }

        for (const id in graphData.nodes) {
            const node = graphData.nodes[id];
            const c = getNext();
            if (!c._s) {
                c._s = {
                    node,
                    graphArgs: graphS,

                    isEditing: false,
                    isSelected: false,
                    graphState,

                    onMouseDown,
                    onMouseUp,
                    onMouseMove,
                    onContextMenu,

                    relativeContainer,
                    renderGraph: rg.renderWithCurrentState,
                };
            }

            c.s.node = node;
            c.s.graphState = graphState;
            c.s.isSelected = graphState.currentSelectedNodeId === id;
            c.s.isEditing = graphState.isEditing && c.s.isSelected;

            c.renderWithCurrentState();
            nodeComponentMap.set(id, c);
        }
    }));

    // NOTE: important that this renders _after_ the node list renderer - the edges depend on nodes being created and existing to render properly.
    const edgeListRenderer = newListRenderer(div({ class: [cn.absoluteFill, cn.pointerEventsNone] }), () => newComponent(GraphEdgeUI));
    rg.preRenderFn((graphS) => edgeListRenderer.render((getNext) => {
        for (const id of edgeComponentMap.keys()) {
            if (!(id in graphData.edges)) {
                edgeComponentMap.delete(id);
            }
        }

        for (const id in graphData.edges) {
            const edge = graphData.edges[id];
            const c = getNext();

            if (!c._s) {
                c._s = {
                    graphArgs: graphS,

                    srcNode: undefined,
                    srcNodeEl: undefined,
                    dstNode: undefined,
                    dstNodeEl: undefined,
                    graphState: graphState,
                    edge,

                    onMouseUp,
                    onMouseDown,
                    onMouseMove,
                    onContextMenu,

                    relativeContainer,
                    renderGraph: rg.renderWithCurrentState.bind(rg),
                };
            }

            c.s.edge = edge;
            c.s.srcNode = getObj(graphData.nodes, edge.srcNodeId);
            c.s.srcNodeEl = getMap(nodeComponentMap, edge.srcNodeId)?.el;
            c.s.dstNode = getObj(graphData.nodes, edge.dstNodeId);
            c.s.dstNodeEl = getMap(nodeComponentMap, edge.dstNodeId)?.el;
            c.s.graphState = graphState;
            c.s.relativeContainer = relativeContainer;

            c.render(c.s);
            edgeComponentMap.set(id, c);
        }
    }));

    const root = div({
        class: [cn.flex1, cn.w100, cn.h100, cn.col]
    }, [
        addChildren(relativeContainer, [
            addChildren(graphRoot, [
                nodeListRenderer,
                edgeListRenderer,
            ]),
            // svgRoot,
            contextMenu,
        ]),
    ]);

    function contextMenuItem(defaultText: string, onClick: () => void): ContextMenuItem {
        return {
            text: defaultText,
            visible: true,
            toggled: false,
            onClick,
        };
    }

    function getCurrentEdge(): GraphEdge | undefined {
        return graphState.currentEdgeDragEdgeId ? graphData.edges[graphState.currentEdgeDragEdgeId] : undefined;
    }

    const contextMenuItemsDict = {
        clearAll: contextMenuItem("Clear all", () => {
            const s = rg.s;
            s.onInput();

            for (const k in graphData.nodes) {
                delete graphData.nodes[k];
            }
            for (const k in graphData.edges) {
                delete graphData.edges[k];
            }

            rg.renderWithCurrentState();
        }),
        newNode: contextMenuItem("New node", () => {
            const x = realXToGraphX(graphState, relativeContainer.el, graphState.contextMenuX);
            const y = realYToGraphY(graphState, relativeContainer.el, graphState.contextMenuY)
            addNewNode(x, y);
        }),
        recenter: contextMenuItem("Recenter", () => {
            recenter();
            rg.renderWithCurrentState();
        }),
        clearZoom: contextMenuItem("Clear Zoom", () => {
            graphState.viewZoom = 1;
            rg.renderWithCurrentState();
        }),
        canAddNewLabel: (edge: GraphEdge | undefined): edge is GraphEdge => !!edge && ["", " "].includes(edge.text),
        newLabel: contextMenuItem("New Label", () => {
            const edge = getCurrentEdge();
            if (!contextMenuItemsDict.canAddNewLabel(edge)) {
                return;
            }


            edge.text = "New Label"
            const s = rg.s;
            s.onInput();
            rg.renderWithCurrentState();
        }),
        flipEdge: contextMenuItem("Flip Edge", () => {
            const edge = getCurrentEdge();
            if (!edge) {
                return;
            }

            [edge.srcNodeId, edge.dstNodeId] = [edge.dstNodeId, edge.srcNodeId];
            [edge.srcX, edge.dstX] = [edge.dstX, edge.srcX];
            [edge.srcY, edge.dstY] = [edge.dstY, edge.srcY];
            [edge.srcXPivot, edge.dstXPivot] = [edge.dstXPivot, edge.srcXPivot];
            [edge.srcYPivot, edge.dstYPivot] = [edge.dstYPivot, edge.srcYPivot];

            const s = rg.s;
            s.onInput();

            rg.renderWithCurrentState();
        }),
        edgeThicknessThin: contextMenuItem("Weight -> Thin", () => {
            const edge: GraphEdge | undefined = graphState.currentEdgeDragEdgeId ? graphData.edges[graphState.currentEdgeDragEdgeId] : undefined;
            if (edge) {
                edge.thickness = EDGE_THICNKESSES.THIN;
                rg.renderWithCurrentState();
            }
        }),
        edgeThicknessNormal: contextMenuItem("Weight -> Normal", () => {
            const edge: GraphEdge | undefined = graphState.currentEdgeDragEdgeId ? graphData.edges[graphState.currentEdgeDragEdgeId] : undefined;
            if (edge) {
                edge.thickness = EDGE_THICNKESSES.NORMAL;
                rg.renderWithCurrentState();
            }
        }),
        edgeThicknessThick: contextMenuItem("Weight -> Thick", () => {
            const edge: GraphEdge | undefined = graphState.currentEdgeDragEdgeId ? graphData.edges[graphState.currentEdgeDragEdgeId] : undefined;
            if (edge) {
                edge.thickness = EDGE_THICNKESSES.THICK;
                rg.renderWithCurrentState();
            }
        }),
        deleteNode: contextMenuItem("Delete node", () => {
            const currentSelectedNodeId = graphState.currentSelectedNodeId;
            if (!currentSelectedNodeId) {
                return;
            }

            const node = graphData.nodes[currentSelectedNodeId];
            if (!node) {
                return;
            }

            forEachConnectedEdge(currentSelectedNodeId, graphData.edges, (_edge, id) => {
                delete graphData.edges[id];
            });

            delete graphData.nodes[currentSelectedNodeId];

            rg.renderWithCurrentState();
        }),
        recalcItemVisibility() {
            const nodeSelected = !!graphState.currentSelectedNodeId;
            const selectedEdge = getCurrentEdge();
            const dragEdge = !!graphState.currentEdgeDragStartNodeIdx;
            const hasItems = nodeComponentMap.size > 0;
            const noneSelected = !nodeSelected && !selectedEdge && !dragEdge;

            contextMenuItemsDict.edgeThicknessThin.visible = !!selectedEdge;
            contextMenuItemsDict.edgeThicknessNormal.visible = !!selectedEdge;
            contextMenuItemsDict.edgeThicknessThick.visible = !!selectedEdge;

            contextMenuItemsDict.recenter.visible = hasItems && noneSelected;
            contextMenuItemsDict.clearZoom.visible = hasItems && noneSelected;
            contextMenuItemsDict.newNode.visible = noneSelected;
            contextMenuItemsDict.flipEdge.visible = !!selectedEdge;
            contextMenuItemsDict.newLabel.visible = contextMenuItemsDict.canAddNewLabel(selectedEdge)

            if (contextMenuItemsDict.deleteNode.visible = nodeSelected) {
                let hasConnectedEdges = false;
                forEachConnectedEdge(graphState.currentSelectedNodeId, graphData.edges, () => hasConnectedEdges = true);

                if (hasConnectedEdges) {
                    contextMenuItemsDict.deleteNode.text = "Delete node (and edges)";
                } else {
                    contextMenuItemsDict.deleteNode.text = "Delete node";
                }
            }
        }
    };

    const graphState: GraphState = {
        viewX: 0,
        viewY: 0,
        lastMouseY: 0,
        lastMouseX: 0,
        viewZoom: 1,
        isDragging: false,
        isClickBlocked: false,
        isMouseDown: false,
        isEditing: false,
        isSnapepdToGrid: false,

        contextMenuItems: [
            contextMenuItemsDict.clearAll,
            contextMenuItemsDict.newNode,
            contextMenuItemsDict.recenter,
            contextMenuItemsDict.clearZoom,
            contextMenuItemsDict.flipEdge,
            contextMenuItemsDict.edgeThicknessThin,
            contextMenuItemsDict.edgeThicknessNormal,
            contextMenuItemsDict.edgeThicknessThick,
            contextMenuItemsDict.newLabel,
            contextMenuItemsDict.deleteNode,
        ],
        isContextMenuOpen: false,
        contextMenuX: 0,
        contextMenuY: 0,

        currentEdgeDragStartIsSrc: false,
    };

    let viewDxStart = 0, viewDyStart = 0;
    let nodeDxStart = 0, nodeDyStart = 0;
    let mouseStartX = 0, mouseStartY = 0;

    function moveGraphView(x: number, y: number) {
        graphState.viewX = x;
        graphState.viewY = y;
    }

    function recenter() {
        // move all the elements themselves by their mean.
        {
            let meanX = 0, meanY = 0;
            for (const id in graphData.nodes) {
                const node = graphData.nodes[id];
                meanX += node.x / nodeComponentMap.size;
                meanY += node.y / nodeComponentMap.size;
            }

            for (const id in graphData.nodes) {
                const node = graphData.nodes[id];
                node.x -= meanX;
                node.y -= meanY;
            }

            const s = rg.s;
            s.onInput();
        }

        // move and zoom the graph to fit all the shite
        {
            let minX = 999999; let maxX = -999999;
            let minY = 999999; let maxY = -999999;
            for (const id in graphData.nodes) {
                const node = graphData.nodes[id];
                minX = Math.min(minX, node.x);
                minY = Math.min(minY, node.y);
                maxX = Math.max(maxX, node.x);
                maxY = Math.max(maxY, node.y);
            }

            const size = Math.max(
                relativeContainer.el.clientWidth,
                relativeContainer.el.clientHeight
            );

            graphState.viewZoom = Math.min(
                size / (maxX - minX),
                size / (maxY - minY),
            );

            // moveGraphView(minX, minY);
            // moveGraphView(maxX, maxY);
            moveGraphView(
                lerp(minX, maxY, 0.5),
                lerp(minY, maxY, 0.5),
            );
        }

        rg.renderWithCurrentState();
    }

    function addNewNode(x = 0, y = 0) {
        const id = newUuid(id => id in graphData.nodes);
        graphData.nodes[id] = {
            id,
            text: "Node " + nodeComponentMap.size,
            x, y,
        };

        const s = rg.s;
        s.onInput();

        return id;
    }

    let domRect = root.el.getBoundingClientRect();

    rg.preRenderFn(function renderGraph(s) {
        if (s.graphData) {
            graphData = s.graphData;
        }

        let hasNodes = false;
        for (const _k in graphData.nodes) {
            hasNodes = true;
            break;
        }

        if (!hasNodes) {
            addNewNode();
        }

        domRect = root.el.getBoundingClientRect();

        for (const id in graphData.edges) {
            const edge = graphData.edges[id];
            if (
                (!edge.srcNodeId || !edge.dstNodeId) &&
                graphState.currentEdgeDragEdgeId !== id
            ) {
                delete graphData.edges[id];
            }
        }

        if (setVisible(contextMenu, graphState.isContextMenuOpen)) {
            contextMenuItemsDict.recalcItemVisibility();
            contextMenu.render({
                x: graphState.contextMenuX,
                y: graphState.contextMenuY,
                items: graphState.contextMenuItems,
                centerText: "   +   ",
                onClose: closeContextMenu,
            });
        }
    });

    function startEdgeDrag(_e: MouseEvent) {
        // Specifically for edges, we want the endpoint to be exactly on the mouse cursor.
        // For most things, we want the point where we started dragging something to be the point that we are 'grabbing', and for 
        // the current position of that thing to be offset by the offset which was present at the start.
        const startX = getRelativeX(relativeContainer.el, dragManager.dragState.startX);
        const startY = getRelativeY(relativeContainer.el, dragManager.dragState.startY);

        const startNode = getObj(graphData.nodes, graphState.currentEdgeDragStartNodeIdx);
        const startNodeEl = getMap(nodeComponentMap, graphState.currentEdgeDragStartNodeIdx);
        if (!startNode || !startNodeEl) {
            return;
        }

        if (!graphState.currentEdgeDragEdgeId) {
            graphState.currentEdgeDragStartIsSrc = true;
            const id = newUuid(id => id in graphData.edges);
            const edge: GraphEdge = {
                id,
                text: "",
                srcNodeId: undefined, srcX: 0, srcY: 0, srcXPivot: 0, srcYPivot: 0,
                dstNodeId: undefined, dstX: 0, dstY: 0, dstXPivot: 0, dstYPivot: 0,
                thickness: EDGE_THICNKESSES.NORMAL,
            };
            graphData.edges[id] = edge;
            graphState.currentEdgeDragEdgeId = id;

            // NOTE: When we introduce zooming, sliced coordinates need to be scaled to graph coordinates in a specific way.
            const [slicedX, pivotX] = realXToSlicedNormEl(graphState, relativeContainer.el, startNodeEl.el, startX)
            const [slicedY, pivotY] = realYToSlicedNormEl(graphState, relativeContainer.el, startNodeEl.el, startY)

            if (graphState.currentEdgeDragStartIsSrc) {
                edge.srcNodeId = graphState.currentEdgeDragStartNodeIdx;
                edge.srcX = slicedX;
                edge.srcY = slicedY;
                edge.srcXPivot = pivotX;
                edge.srcYPivot = pivotY;
            } else {
                edge.dstNodeId = graphState.currentEdgeDragStartNodeIdx;
                edge.dstX = slicedX;
                edge.dstY = slicedY;
                edge.dstXPivot = pivotX;
                edge.dstYPivot = pivotY;
            }

            const s = rg.s;
            s.onInput();
        }

        const currentEdge = getObj(graphData.edges, graphState.currentEdgeDragEdgeId);
        if (!currentEdge) {
            throw new Error("Edge shouldn't be undefined");
        }

        const startXGraph = realXToGraphX(graphState, relativeContainer.el, startX);
        const startYGraph = realYToGraphY(graphState, relativeContainer.el, startY);
        if (graphState.currentEdgeDragStartIsSrc) {
            currentEdge.dstNodeId = undefined;
            currentEdge.dstX = startXGraph;
            currentEdge.dstY = startYGraph;
        } else {
            currentEdge.srcNodeId = undefined;
            currentEdge.srcX = startXGraph;
            currentEdge.srcY = startYGraph;
        }

        const s = rg.s;
        s.onInput();

        graphState.currentSelectedNodeId = undefined;
    }

    function finishEdgeDrag(e: MouseEvent) {
        const currentEdgeDragEndNodeIdx = graphState.currentEdgeDragEndNodeIdx;
        const currentEdgeDragEdgeIdx = graphState.currentEdgeDragEdgeId;

        const endNode = getObj(graphData.nodes, currentEdgeDragEndNodeIdx);
        const endNodeEl = getMap(nodeComponentMap, currentEdgeDragEndNodeIdx);
        const currentEdge = getObj(graphData.edges, currentEdgeDragEdgeIdx);

        graphState.currentEdgeDragEndNodeIdx = undefined;
        graphState.currentEdgeDragEdgeId = undefined;
        graphState.currentEdgeDragStartNodeIdx = undefined;

        if (!currentEdge || !endNode || !endNodeEl) {
            return;
        }

        const endX = getRelativeX(relativeContainer.el, e.pageX);
        const endY = getRelativeY(relativeContainer.el, e.pageY);

        const [slicedX, pivotX] = realXToSlicedNormEl(graphState, relativeContainer.el, endNodeEl.el, endX);
        const [slicedY, pivotY] = realYToSlicedNormEl(graphState, relativeContainer.el, endNodeEl.el, endY);

        if (graphState.currentEdgeDragStartIsSrc) {
            currentEdge.dstNodeId = currentEdgeDragEndNodeIdx;
            currentEdge.dstX = slicedX;
            currentEdge.dstY = slicedY;
            currentEdge.dstXPivot = pivotX;
            currentEdge.dstYPivot = pivotY;
        } else {
            currentEdge.srcNodeId = currentEdgeDragEndNodeIdx;
            currentEdge.srcX = slicedX;
            currentEdge.srcY = slicedY;
            currentEdge.srcXPivot = pivotX;
            currentEdge.srcYPivot = pivotY;
        }

        const s = rg.s;
        s.onInput();

        rg.renderWithCurrentState();
    }

    const dragManager = newDragManager({
        onDragStart(e) {
            graphState.isDragging = true;
            if (graphState.currentEdgeDragStartNodeIdx) {
                startEdgeDrag(e);
            } else if (graphState.currentSelectedNodeId) {
                const currentNode = graphData.nodes[graphState.currentSelectedNodeId];
                nodeDxStart = currentNode.x;
                nodeDyStart = currentNode.y;
            } else {
                viewDxStart = graphState.viewX;
                viewDyStart = graphState.viewY;
            }

            mouseStartX = realXToGraphX(graphState, relativeContainer.el, graphState.lastMouseX);
            mouseStartY = realYToGraphY(graphState, relativeContainer.el, graphState.lastMouseY);
        },
        onDrag(dx: number, dy: number, _e: MouseEvent) {
            const s = rg.s;

            if (graphState.isEditing) {
                return;
            }

            const mouseX = realXToGraphX(graphState, relativeContainer.el, graphState.lastMouseX);
            const mouseY = realYToGraphY(graphState, relativeContainer.el, graphState.lastMouseY);
            const dxGraph = mouseX - mouseStartX;
            const dyGraph = mouseY - mouseStartY;

            if (graphState.currentSelectedNodeId) {
                const currentNode = graphData.nodes[graphState.currentSelectedNodeId];
                currentNode.x = nodeDxStart + dxGraph;
                currentNode.y = nodeDyStart + dyGraph;

                s.onInput();

                return;
            }

            if (graphState.currentEdgeDragEdgeId) {
                const currentEdge = graphData.edges[graphState.currentEdgeDragEdgeId];

                if (graphState.currentEdgeDragStartIsSrc) {
                    currentEdge.dstX = mouseX;
                    currentEdge.dstY = mouseY;
                } else {
                    currentEdge.srcX = mouseX;
                    currentEdge.srcY = mouseY;
                }

                s.onInput();

                return;
            }

            moveGraphView(viewDxStart + dx, viewDyStart + dy);
            return;
        },
        onDragEnd(e) {
            graphState.isDragging = false;

            finishEdgeDrag(e);
        },
    });

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

            graphState.currentSelectedNodeId = undefined;
            graphState.isEditing = false;

        }, 1);
    }

    function onContextMenu(e: MouseEvent) {
        e.preventDefault();

        // NOTE: other code might want to call this function, then add it's own stuff to the context menu and disable other stuff, possibly
        graphState.isContextMenuOpen = true;
        graphState.contextMenuX = getRelativeX(relativeContainer.el, e.pageX);
        graphState.contextMenuY = getRelativeY(relativeContainer.el, e.pageY);
    }
    function closeContextMenu() {
        graphState.isContextMenuOpen = false;
        dragManager.cancelDrag();
        rg.renderWithCurrentState();
    }

    let lastX = 0, lastY = 0;
    function onMouseMove(e: MouseEvent) {
        // only run mousemove if we've moved by a large enough distance, since this event gets sent a LOT
        const x = Math.floor(e.pageX);
        const y = Math.floor(e.pageY);
        if (lastX === x && lastY === y) {
            return;
        }

        lastX = x;
        lastY = y;

        graphState.lastMouseX = getRelativeX(relativeContainer.el, e.pageX);
        graphState.lastMouseY = getRelativeY(relativeContainer.el, e.pageY);

        graphState.isMouseDown = e.buttons !== 0;

        dragManager.onMouseMove(e);

        if (!graphState.isDragging) {
            // reset a bunch of things that were set in drag operations
            graphState.isClickBlocked = false;
            graphState.currentEdgeDragStartNodeIdx = undefined;
            graphState.currentEdgeDragEdgeId = undefined;
        } else {
            graphState.currentEdgeDragEndNodeIdx = undefined;
        }

        graphState.isContextMenuOpen = false;
    }
    relativeContainer.el.addEventListener("mousemove", (e) => {
        onMouseMove(e);

        rg.renderWithCurrentState();
    });
    relativeContainer.el.addEventListener("mouseup", (e) => {
        onMouseUp(e);
        rg.renderWithCurrentState();
    });
    relativeContainer.el.addEventListener("mousedown", (e) => {
        onMouseDown(e);
        rg.renderWithCurrentState();
    });
    relativeContainer.el.addEventListener("contextmenu", (e) => {
        onContextMenu(e);
        rg.renderWithCurrentState();
    });

    relativeContainer.el.addEventListener("wheel", (e) => {
        e.preventDefault();

        // NOTE: Thisworks with the mouse wheel (delta ranges between -1 and 1, but infrequent) 
        // and the trackpad (ranges between -0.01 and 0.01 but occurs far more frequently)

        const oldX0 = realXToGraphX(graphState, relativeContainer.el, graphState.lastMouseX);
        const oldY0 = realYToGraphY(graphState, relativeContainer.el, graphState.lastMouseY);

        const delta = clamp(e.deltaY / 100, -0.1, 0.1);
        const newZoom = clamp(graphState.viewZoom - delta, 0.1, 10);
        graphState.viewZoom = newZoom;

        const newX0 = realXToGraphX(graphState, relativeContainer.el, graphState.lastMouseX);
        const newY0 = realYToGraphY(graphState, relativeContainer.el, graphState.lastMouseY);

        // TODO: fix. zooming in and out doesn feel quite right
        // const xDelta = graphXToRealX(graphState, relativeContainer.el, newX0 - oldX0);
        // const yDelta = graphXToRealX(graphState, relativeContainer.el, newY0 - oldY0);
        const xDelta = newX0 - oldX0;
        const yDelta = newY0 - oldY0;

        moveGraphView(
            graphState.viewX - xDelta,
            graphState.viewY - yDelta,
        );

        rg.renderWithCurrentState();
    });

    document.addEventListener("keydown", (e) => {
        if (!isVisible(root)) {
            return;
        }

        let needsRender = true;

        if (e.key === "Enter" && !graphState.isEditing && !!graphState.currentSelectedNodeId) {
            graphState.isEditing = true;
        } else if (e.key === "Escape") {
            if (graphState.isEditing) {
                graphState.isEditing = false;
            } else if (graphState.currentSelectedNodeId) {
                graphState.currentSelectedNodeId = undefined;
            } else {
                const s = rg.s;
                s.onClose();
            }
        } else {
            needsRender = false;
        }

        if (needsRender) {
            e.stopPropagation();
            e.preventDefault();
            rg.renderWithCurrentState();
        }
    });

    return root;
}

function GraphNodeUI(rg: RenderGroup<GraphNodeUIArgs>) {
    const className = "pre w-100 h-100";
    const styles = "padding: 0; position: absolute;";
    const textArea = setAttrs(newTextArea(), {
        class: [className],
        style: styles + "cursor: text;",
        spellcheck: "false",
    });

    const textDiv = div({
        class: [className],
        style: styles + "user-select: none; cursor: pointer;",
    });

    const [edgeDragStartRegions, updateDragRegionStyles] = makeDragRects((regionDiv) => {
        regionDiv.el.addEventListener("mousemove", (e) => {
            const s = rg.s;
            const { graphState, node } = s;

            e.stopImmediatePropagation();

            s.onMouseMove(e);

            if (!graphState.isDragging) {
                graphState.currentEdgeDragStartNodeIdx = node.id;
                graphState.currentEdgeDragEdgeId = undefined;
            } else {
                if (
                    graphState.currentEdgeDragStartNodeIdx &&
                    graphState.currentEdgeDragStartNodeIdx !== node.id
                ) {
                    graphState.currentEdgeDragEndNodeIdx = node.id;
                }
            }

            s.renderGraph();
        });
        regionDiv.el.addEventListener("mouseup", (e) => {
            const s = rg.s;
            e.stopImmediatePropagation();

            s.onMouseUp(e);
            s.renderGraph();
        });
        regionDiv.el.addEventListener("mousedown", (e) => {
            const s = rg.s;
            e.stopImmediatePropagation();
            s.onMouseDown(e);
            s.renderGraph();
        });
        regionDiv.el.addEventListener("contextmenu", (e) => {
            const s = rg.s;
            e.stopImmediatePropagation();
            s.onContextMenu(e);
            s.renderGraph();
        })
    });

    const root = div({
        style: `position: absolute; padding: 5px; border: 1px ${cssVars.fgColor} solid;`,
        class: [cn.pointerEventsAll],
    }, [
        div({ style: "position: relative;" }, [
            textArea,
            textDiv,
            ...edgeDragStartRegions,
        ]),
    ]);


    rg.preRenderFn(function renderGraphNodeUI(s) {
        const { node, isSelected, isEditing, graphState, relativeContainer, graphArgs } = s;

        const dragStartRegionsVisble = !graphState.isDragging || node.id !== graphState.currentEdgeDragStartNodeIdx;
        for (const region of edgeDragStartRegions) {
            setVisible(region, dragStartRegionsVisble)
        }
        if (dragStartRegionsVisble) {
            updateDragRegionStyles(s);
        }

        if (!node.text) {
            node.text = " ";
            graphArgs.onInput();
        }

        if (setVisible(textArea, isEditing)) {
            textArea.el.focus();
            setInputValue(textArea, node.text);
        }

        if (setVisible(textDiv, !isEditing)) {
            setText(textDiv, node.text);
        }

        // update text area size
        {
            // we need to fit to the text size both the width and height!

            const { isEditing } = s;

            const textEl = isEditing ? textArea : textDiv;

            textEl.el.style.width = "0";
            // these are our '' styles.
            // it don't work though, so I've commented it out
            // textEl.el.style.whiteSpace = "";
            // textEl.el.style.overflowWrap = "anywhere";
            textEl.el.style.whiteSpace = "pre";
            // was getting some false wrapping happening when using exact width, so now I've aded this + 5 and it seems to be working nicer
            textEl.el.style.width = textEl.el.scrollWidth + "px";
            textEl.el.style.whiteSpace = "pre-wrap";
            textEl.el.style.height = "0";
            textEl.el.style.height = textEl.el.scrollHeight + "px";

            textEl.el.parentElement!.style.width = textEl.el.style.width;
            textEl.el.parentElement!.style.height = textEl.el.style.height;

            textEl.el.parentElement!.parentElement!.style.width = textEl.el.style.width;
            textEl.el.parentElement!.parentElement!.style.height = textEl.el.style.height;
        }

        const xPos = graphXToRealX(graphState, relativeContainer.el, node.x);
        const yPos = graphYToRealY(graphState, relativeContainer.el, node.y);

        setStyle(root, "transformOrigin", `top left`);
        setStyle(root, "transform", `translate(${xPos}px, ${yPos}px) scale(${graphState.viewZoom})`);
        setStyle(root, `backgroundColor`, isSelected ? `${cssVars.bgColorFocus}` : `${cssVars.bgColor}`);
        setStyle(root, "zIndex", isSelected ? Z_INDICES.NODE_SELECTED : Z_INDICES.NODE_UNSELECTED);
        setStyle(textDiv, `backgroundColor`, isSelected ? `${cssVars.bgColorFocus}` : `${cssVars.bgColor}`);
        setStyle(textArea, `backgroundColor`, isSelected ? `${cssVars.bgColorFocus}` : `${cssVars.bgColor}`);
    });


    root.el.addEventListener("click", (e) => {
        const s = rg.s;
        const { graphState, node } = s;

        if (s.graphState.isDragging) {
            return;
        }

        // TODO: fix. it clicks instantly after it selects.  lmao.
        e.stopPropagation();

        if (s.graphState.isDragging) {
            s.graphState.isDragging = false;
            return;
        }

        if (graphState.currentSelectedNodeId === node.id && !graphState.isEditing) {
            graphState.isEditing = true;
            s.renderGraph();
        }
    });

    root.el.addEventListener("mousedown", () => {
        const s = rg.s;
        const { node, graphState, } = s;

        // block clicking, so we don't instantly de-select this thing.
        graphState.isClickBlocked = true;
        if (graphState.currentSelectedNodeId !== node.id) {
            graphState.currentSelectedNodeId = node.id;
        }

        s.renderGraph();
    });

    textArea.el.addEventListener("input", () => {
        const s = rg.s;
        const { node, graphArgs } = s;
        node.text = textArea.el.value;
        graphArgs.onInput();
        s.renderGraph();
    });

    return root;
}

const cssb = newCssBuilder();
const cnGraphEdgeRoot = cssb.cn(`graph-edge-root`, [
    ` { position: absolute; top: 0; left: 0; width: 1px; height: 1px; }`,
    ` .line { width: 1px; height: 1px; background-color: ${cssVars.fgColor}; } `,
    `.redrag .line { background-color: red; }`
]);

function GraphEdgeUI(rg: RenderGroup<GraphEdgeUIArgs>) {
    const arrowHitbox = div({
        class: ["line"],
        style: "background-color: transparent;"
        // style: "background-color: rgba(0, 0, 255, 0.5);" 
    });
    const arrowLine = div({ class: ["line"] });
    const arrowHead1 = div({ class: ["line"] });
    const arrowHead2 = div({ class: ["line"] });
    const arrowSegments = [
        arrowHitbox,
        arrowLine,
        arrowHead1,
        arrowHead2
    ];

    function getX0() {
        const s = rg.s;
        const { graphState, relativeContainer, edge, srcNode, srcNodeEl } = s;
        return edgeSrcX(graphState, relativeContainer.el, edge, srcNode, srcNodeEl);
    }
    function getY0() {
        const s = rg.s;
        const { graphState, relativeContainer, edge, srcNode, srcNodeEl } = s;
        return edgeSrcY(graphState, relativeContainer.el, edge, srcNode, srcNodeEl);
    }
    function getX1() {
        const s = rg.s;
        const { graphState, relativeContainer, edge, dstNode, dstNodeEl } = s;
        return edgeDstX(graphState, relativeContainer.el, edge, dstNode, dstNodeEl);
    }
    function getY1() {
        const s = rg.s;
        const { graphState, relativeContainer, edge, dstNode, dstNodeEl } = s;
        return edgeDstY(graphState, relativeContainer.el, edge, dstNode, dstNodeEl);
    }

    for (const seg of arrowSegments) {
        seg.el.addEventListener("mousemove", (e) => {
            const s = rg.s;
            const { graphState, edge, onMouseMove, relativeContainer, srcNode, dstNode } = s;

            e.stopImmediatePropagation();
            onMouseMove(e);

            if (
                srcNode &&
                dstNode &&
                !graphState.isDragging
            ) {
                const mouseX = getRelativeX(relativeContainer.el, e.pageX);
                const mouseY = getRelativeY(relativeContainer.el, e.pageY);

                let x0 = getX0(); let y0 = getY0();
                let x1 = getX1(); let y1 = getY1();

                const lengthToSrc = magnitude(mouseX - x0, mouseY - y0);
                const lengthToDst = magnitude(mouseX - x1, mouseY - y1);

                const startAtSrc = lengthToDst < lengthToSrc;
                graphState.currentEdgeDragStartNodeIdx = startAtSrc ? srcNode.id : dstNode.id;
                graphState.currentEdgeDragEdgeId = edge.id;
                graphState.currentEdgeDragStartIsSrc = startAtSrc;
            }

            s.renderGraph();
        });
        seg.el.addEventListener("mouseup", (e) => {
            const s = rg.s;
            s.onMouseUp(e);
            s.renderGraph();
        });
        seg.el.addEventListener("mousedown", (e) => {
            const s = rg.s;
            e.stopImmediatePropagation();
            s.onMouseDown(e);
            s.renderGraph();
        });
        seg.el.addEventListener("contextmenu", (e) => {
            const s = rg.s;
            e.stopImmediatePropagation();
            s.onContextMenu(e);
            s.renderGraph();
        });
    }

    const labelInput = el<HTMLInputElement>("INPUT", { class: [cn.w100] });
    const label = div({ style: "position: absolute; white-space: nowrap;" }, [
        labelInput
    ]);

    const root = div({
        class: [cnGraphEdgeRoot, cn.pointerEventsAll],
        style: "user-select: none;",
    }, [
        ...arrowSegments,
        label,
    ]);

    setInputValueAndResize(labelInput, "Edge");

    rg.preRenderFn(function renderGraphEdgeUI(s) {
        const { graphState, edge, graphArgs } = s;

        if (!edge.text) {
            edge.text = " ";
            graphArgs.onInput();
        }

        setClass(root, cn.pointerEventsNone, true || graphState.isDragging);
        setClass(root, "redrag", graphState.currentEdgeDragEdgeId === edge.id);

        setInputValue(labelInput, edge.text);

        // draw the edge line
        {
            let x0 = getX0(); let y0 = getY0();
            let x1 = getX1(); let y1 = getY1();

            const dx = x1 - x0;
            const dy = y1 - y0;
            const length = magnitude(x1 - x0, y1 - y0);
            const angle = Math.atan2(dy, dx);
            const shouldNotFlip = (-Math.PI / 2 <= angle && angle <= Math.PI / 2);

            setStyle(root, "width", "1px");
            setStyle(root, "height", "1px");
            const edgeThickness = edge.thickness * graphState.viewZoom;
            const hitboxHeight = 50;
            setStyle(root, `transform`, `translate(${x0}px, ${y0}px) rotate(${angle}rad)`);

            if (shouldNotFlip) {
                setStyle(label, `transform`, `translate(${length / 2 - label.el.clientWidth / 2}px, ${-edgeThickness - 22}px)`);
            } else {
                setStyle(label, `transform`, `translate(${length / 2 - label.el.clientWidth / 2}px, 8px) scale(-1, -1)`);
            }

            const deg2Rad = Math.PI / 180;
            const arrowAngle = 140 * deg2Rad;
            const arrowHeadSegmentVOfffset = Math.sin(arrowAngle) * edgeThickness * 0.5;

            setStyle(arrowLine, `transform`, `translate(${length / 2 - edgeThickness / 2}px, 1px) scale(${length - edgeThickness}, ${edgeThickness})`);
            setStyle(arrowHitbox, `transform`, `translate(${length / 2 - 5}px, 1px) scale(${length - edgeThickness}, ${hitboxHeight})`);

            const arrowHeadLength = 30 * graphState.viewZoom;
            setStyle(
                arrowHead1,
                `transform`,
                `translate(${length - edgeThickness / 2}px, ${arrowHeadSegmentVOfffset}px) rotate(-${arrowAngle}rad) scale(${arrowHeadLength}, ${edgeThickness}) translate(50%)`
            );
            setStyle(arrowHead2, `transform`, `translate(${length - edgeThickness / 2}px, ${-arrowHeadSegmentVOfffset}px) rotate(${arrowAngle}rad) scale(${arrowHeadLength}, ${edgeThickness}) translate(50%)`);

            setInputValueAndResize(labelInput, labelInput.el.value);
            labelInput.el.style.width = "0";
            labelInput.el.style.whiteSpace = "pre";
            labelInput.el.style.width = labelInput.el.scrollWidth + 5 + "px";
            setStyle(labelInput, "width", labelInput.el.style.width);
        }
    });

    labelInput.el.addEventListener("input", () => {
        const s = rg.s;
        const { edge, graphArgs } = s;

        edge.text = labelInput.el.value;

        graphArgs.onInput();

        rg.renderWithCurrentState();
    });

    return root;
}


const cnEdgeCreateDragRect = cssb.cn("graphNodeDragRect", [
    // https://stackoverflow.com/questions/704564/disable-drag-and-drop-on-html-elements
    // So many fkn opinions on this thread - user-select: none; was the only thing that worked.
    ` { position: absolute; z-index: ${Z_INDICES.EDGE_CREATE_HANDLES}; background-color: transparent; cursor: crosshair; user-select: none; }`,
    // + "border: 1px black solid; "
    `.src-edge-drag { background-color: rgba(255, 0, 0, 0.5); }`,
    `.dst-edge-drag { background-color: rgba(0, 0, 255, 0.5); }`,
]);

function makeDragRects(setupfn: (dragRect: Insertable<HTMLDivElement>) => void) {
    const dragRects = [
        div({ class: [cnEdgeCreateDragRect] }),
        div({ class: [cnEdgeCreateDragRect] }),
        div({ class: [cnEdgeCreateDragRect] }),
        div({ class: [cnEdgeCreateDragRect] }),
    ];

    const directions = [
        "top", "right", "bottom", "left"
    ] as const;
    const axes = [
        "height", "width", "height", "width"
    ] as const;

    function updateDragRectStyles(args: GraphNodeUIArgs) {
        const { graphState, node } = args;

        const outsetWidth = 20;
        for (let i = 0; i < dragRects.length; i++) {
            const divEl = dragRects[i];

            setStyle(divEl, directions[i - 1] || "left", "-" + outsetWidth + "px");
            setStyle(divEl, directions[i] || "top", "-" + outsetWidth + "px");
            setStyle(divEl, directions[i + 1] || "top", "0");
            setStyle(divEl, axes[i], outsetWidth + "px");

            setClass(divEl, "src-edge-drag", graphState.currentEdgeDragStartNodeIdx === node.id && !graphState.currentEdgeDragEdgeId);
            setClass(divEl, "dst-edge-drag", graphState.currentEdgeDragEndNodeIdx === node.id);
        }
    }

    for (const dr of dragRects) {
        setupfn(dr);
    }

    return [dragRects, updateDragRectStyles] as const;
}


type ContextMenuItem = {
    text: string;
    visible: boolean;
    toggled: boolean;
    onClick(): void;
};

const cnContextMenu = cssb.cn(`context-menu`, [
    ` .item:hover { background-color: ${cssVars.bgColorFocus}; cursor: pointer; }`
])

function RadialContextMenu(rg: RenderGroup<{
    x: number;
    y: number;
    centerText: string;
    items: ContextMenuItem[];
    onClose(): void;
}>) {
    function RadialContextMenuItem(rg: RenderGroup<{
        x: number;
        y: number;
        item: ContextMenuItem;
        onClose(): void;
    }>) {
        const root = div({
            class: [cn.absolute, cn.noWrap, cssVars.bgColor, "item "],
            style: `z-index: ${Z_INDICES.CONTEXT_MENU}; padding: 10px; border-radius: 5px; border: 2px solid ${cssVars.fgColor};`,
        }, [
            rg.text((s) => s.item.text)
        ]);

        rg.preRenderFn(function renderRadialContextMenuItem(s) {
            const { x, y, item } = s;

            setStyle(root, "left", x + "px");
            setStyle(root, "top", y + "px");
            setClass(root, "inverted", item.toggled);
        });

        root.el.addEventListener("mousedown", (e) => {
            if (e.button !== 0) {
                return
            }

            const s = rg.s;
            s.item.onClick();
            closeSelf(e);
        });

        return root;
    }

    const contextMenuItemList = newListRenderer(div({ class: [cn.relative] }), () => newComponent(RadialContextMenuItem));
    const centerTextEl = div({ class: [cn.pre] });
    const centerTextContainerPadding = 10;
    const centerTextContainer = div({
        class: [cssVars.bgColor, cn.noWrap, cn.col, cn.alignItemsCenter, cn.justifyContentCenter],
        style: `padding: ${centerTextContainerPadding}px; border-radius: 500px; opacity: 0.75`
    }, [
        centerTextEl
    ]);

    const root = div({
        style: `position: absolute; background-color: transparent; z-index: ${Z_INDICES.CONTEXT_MENU}`,
        class: [cnContextMenu, cn.col, cn.alignItemsCenter, cn.justifyContentCenter],
    }, [
        div({ class: [cn.relative] }, [
            div({ class: [cn.absoluteFill, cn.col, cn.alignItemsCenter, cn.justifyContentCenter] }, [
                // 0x0 div in th center
                contextMenuItemList,
            ]),
            centerTextContainer,
        ]),
    ]);

    rg.preRenderFn(function renderRadialContextMenu(s) {
        const { x, y, items, centerText } = s;

        setText(centerTextEl, centerText);
        const centerTextWidth = centerTextEl.el.clientWidth;
        setStyle(centerTextContainer, "height", (centerTextContainer.el.clientWidth - centerTextContainerPadding * 2) + "px");

        let rootWidth = 0;
        let rootHeight = 0;
        contextMenuItemList.render((getNext) => {
            // first render
            for (const item of items) {
                if (!item.visible) {
                    continue;
                }

                getNext().render({
                    item,
                    // set later
                    x: 0, y: 0,
                    onClose: s.onClose,
                });
            }


            // now measure their sizes, and place them in a circle accordingly

            const baseRadius = 100;
            let i = 0;
            let delta = 2 * Math.PI / 120;
            const lastRect = { x: -99999, y: -99999, w: -99999, h: -99999 };
            const boundingRect = { t: 0, l: 0, b: 0, r: 0 };
            let radiusMultiplierX = 1;
            let radiusMultiplierY = 1;
            // NOTE: some items may be hidden, so contextMenuItemList.components.length !== items.length
            for (let angle = 0; i < contextMenuItemList.components.length; angle += delta) {
                if (angle > 2 * Math.PI) {
                    radiusMultiplierX += 1.3;
                    radiusMultiplierY += 0.5;
                    angle = 0;
                }

                const cirlceAngle = angle + Math.PI / 2;
                const centerX = Math.cos(cirlceAngle) * radiusMultiplierX * (baseRadius * 0.5 + centerTextWidth);
                const centerY = Math.sin(cirlceAngle) * baseRadius * radiusMultiplierY;

                const c = contextMenuItemList.components[i];
                const s = c.s;
                const w = c.el.clientWidth;
                const h = c.el.clientHeight;

                const x = centerX - w / 2;
                const y = centerY - h / 2;

                if (rectIntersect(x, y, w, h, lastRect.x, lastRect.y, lastRect.w, lastRect.h)) {
                    continue;
                }

                s.x = x;
                s.y = y;

                const spacing = 10;
                lastRect.x = x - spacing;
                lastRect.y = y - spacing;
                lastRect.w = w + spacing * 2;
                lastRect.h = h + spacing * 2;

                const r = lastRect.x + lastRect.w;
                const b = lastRect.y + lastRect.h;

                boundingRect.l = Math.min(boundingRect.l, lastRect.x);
                boundingRect.r = Math.max(boundingRect.r, r);
                boundingRect.t = Math.min(boundingRect.t, lastRect.y);
                boundingRect.b = Math.max(boundingRect.b, b);

                i++;
            }

            rootWidth = Math.max(Math.abs(boundingRect.r), Math.abs(boundingRect.l)) * 2;
            rootHeight = Math.max(Math.abs(boundingRect.b), Math.abs(boundingRect.t)) * 2;

            for (let i = 0; i < contextMenuItemList.components.length; i++) {
                const c = contextMenuItemList.components[i];
                c.renderWithCurrentState();
            }
        });

        setStyle(root, "left", (x - rootWidth / 2) + "px");
        setStyle(root, "top", (y - rootHeight / 2) + "px");
        setStyle(root, "width", rootWidth + "px");
        setStyle(root, "height", rootHeight + "px");

    });

    function closeSelf(e: MouseEvent) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const s = rg.s;
        s.onClose();
    }

    root.el.addEventListener("contextmenu", closeSelf);
    root.el.addEventListener("mousedown", (e) => {
        if (e.button === 0) {
            closeSelf(e);
        }
    });
    root.el.addEventListener("mousemove", (e) => {
        e.stopImmediatePropagation();
    });

    return root;
}

function rectIntersect(
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

function rangeIntersect(
    a0: number, a1: number,
    b0: number, b1: number,
): boolean {
    return (
        (a0 <= b0 && b0 <= a1) ||
        (a0 <= b1 && b1 <= a1) ||
        (b0 <= a0 && a1 <= b1)
    );
};

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function inverseLerp(a: number, b: number, t: number): number {
    return (t - a) / (b - a);
}

function clamp(val: number, a: number, b: number): number {
    return Math.max(a, Math.min(b, val));
}

const CLAMP_PADDING = 20;

function realXToSlicedNormEl(graphState: GraphState, relativeEl: HTMLElement, el: HTMLElement, real: number): [number, number] {
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

function slicedNormXToRealEl(graphState: GraphState, relativeEl: HTMLElement, el: HTMLElement, x: number, pivotX: number): number {
    const rect = el.getBoundingClientRect();
    const low = getRelativeX(relativeEl, rect.left);
    // const hi = getRelativeX(relativeEl, rect.left + rect.width);

    return low + clamp(x * graphState.viewZoom, -CLAMP_PADDING, rect.width + CLAMP_PADDING) + rect.width * pivotX;

    // return slicedNormToReal(low, hi, slicedNorm);
}

function realYToSlicedNormEl(graphState: GraphState, relativeEl: HTMLElement, el: HTMLElement, real: number): [number, number] {
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



function slicedNormYToRealEl(graphState: GraphState, relativeEl: HTMLElement, el: HTMLElement, y: number, pivotY: number): number {
    const rect = el.getBoundingClientRect();
    const low = getRelativeY(relativeEl, rect.top);
    // const hi = getRelativeY(relativeEl, rect.top + rect.height);

    // return low + y + pivotY * rect.height;
    return low + clamp(y * graphState.viewZoom, -CLAMP_PADDING, rect.height + CLAMP_PADDING) + rect.height * pivotY;
    // return slicedNormToReal(low, hi, slicedNorm);
}

function realToSlicedNorm(low: number, hi: number, real: number) {
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


function slicedNormToReal(low: number, hi: number, norm: number) {
    if (norm < -0.5) {
        return norm + low + 0.5;
    }

    if (norm > 0.5) {
        return hi + norm - 0.5;
    }

    return lerp(low, hi, inverseLerp(-0.5, 0.5, norm));
}

function edgeSrcX(graphState: GraphState, relativeEl: HTMLElement, edge: GraphEdge, srcNode: GraphNode | undefined, nodeEl: HTMLElement | undefined) {
    if (!srcNode || !nodeEl) {
        return graphXToRealX(graphState, relativeEl, edge.srcX);
    }

    return slicedNormXToRealEl(graphState, relativeEl, nodeEl, edge.srcX, edge.srcXPivot);
}

function edgeSrcY(graphState: GraphState, relativeEl: HTMLElement, edge: GraphEdge, srcNode: GraphNode | undefined, nodeEl: HTMLElement | undefined) {
    if (!srcNode || !nodeEl) {
        return graphYToRealY(graphState, relativeEl, edge.srcY);
    }

    return slicedNormYToRealEl(graphState, relativeEl, nodeEl, edge.srcY, edge.srcYPivot);
}

function edgeDstX(graphState: GraphState, relativeEl: HTMLElement, edge: GraphEdge, dstNode: GraphNode | undefined, nodeEl: HTMLElement | undefined) {
    if (!dstNode || !nodeEl) {
        return graphXToRealX(graphState, relativeEl, edge.dstX);
    }

    return slicedNormXToRealEl(graphState, relativeEl, nodeEl, edge.dstX, edge.dstXPivot);
}

function edgeDstY(graphState: GraphState, relativeEl: HTMLElement, edge: GraphEdge, dstNode: GraphNode | undefined, nodeEl: HTMLElement | undefined) {
    if (!dstNode || !nodeEl) {
        return graphYToRealY(graphState, relativeEl, edge.dstY);
    }

    return slicedNormYToRealEl(graphState, relativeEl, nodeEl, edge.dstY, edge.dstYPivot);
}

function graphXToRealX(graphState: GraphState, root: HTMLElement, x: number) {
    return Math.floor(graphState.viewX + (x * graphState.viewZoom));
}

function realXToGraphX(graphState: GraphState, root: HTMLElement, x: number) {
    return Math.floor(x - graphState.viewX) / graphState.viewZoom;
}

function graphYToRealY(graphState: GraphState, root: HTMLElement, y: number) {
    return Math.floor(graphState.viewY + (y * graphState.viewZoom));
}

function realYToGraphY(graphState: GraphState, root: HTMLElement, y: number) {
    return Math.floor(y - graphState.viewY) / graphState.viewZoom;
}

function getRelativeX(parent: HTMLElement, pageX: number) {
    return pageX - parent.offsetLeft;
}

function getRelativeY(parent: HTMLElement, pageY: number) {
    return pageY - parent.offsetTop;
}


function magnitude(x: number, y: number) {
    return Math.sqrt(x * x + y * y);
}
