import { TextArea } from "./components/text-area";
import { Insertable, addChildren, div, el, isVisible, newComponent, newListRenderer, newRenderGroup, newState, newStyleGenerator, on, setAttrs, setClass, setInputValue, setInputValueAndResize, setStyle, setText, setVisible, setVisibleGroup } from "./utils/dom-utils";
import { newDragManager } from "./utils/drag-handlers";
import { newUuid } from "./utils/uuid";

const sg = newStyleGenerator();

type GraphArgs = {
    graphData?: GraphData;
    onClose(): void;
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
    // If srcNodeIdx is not -1, then srcXSliced etc. are sliced-normal offsets relative to the source node.
    // else, they are just normal x-y offsets. same with Y.
    srcNodeId: string | undefined;
    dstNodeId: string | undefined;
    srcXSliced: number; srcYSliced: number;
    dstXSliced: number; dstYSliced: number;

    thickness: number;
};

type GraphState = {
    viewX: number;
    viewY: number;
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

export function InteractiveGraph() {
    const s = newState<GraphArgs>();

    const rg = newRenderGroup();
    const graphRoot = div({
        class: "absolute-fill",
        style: "border: 2px solid var(--fg-color); overflow: hidden; cursor: move;",
    });

    const relativeContainer = div({ class: "col relative flex-1" });
    const contextMenu = RadialContextMenu();

    let graphData = newGraphData();

    const nodeComponentMap = new Map<string, Insertable<HTMLDivElement>>();
    const edgeComponentMap = new Map<string, Insertable<HTMLDivElement>>();
    const nodeListRenderer = rg.list(div({ class: "absolute-fill pointer-events-none" }), GraphNodeUI, (getNext) => {
        for (const id of nodeComponentMap.keys()) {
            if (!(id in graphData.nodes)) {
                nodeComponentMap.delete(id);
            }
        }

        for (const id in graphData.nodes) {
            const node = graphData.nodes[id];
            const c = getNext();
            if (!c.state.hasArgs()) {
                c.render({
                    node,

                    isEditing: false,
                    isSelected: false,
                    graphState,

                    onMouseDown,
                    onMouseUp,
                    onMouseMove,
                    onContextMenu,

                    relativeContainer,
                    renderGraph,
                })
            }

            c.state.args.node = node;
            c.state.args.graphState = graphState;
            c.state.args.isSelected = graphState.currentSelectedNodeId === id;
            c.state.args.isEditing = graphState.isEditing && c.state.args.isSelected;

            c.render(c.state.args);
            nodeComponentMap.set(id, c);
        }
    })

    // NOTE: important that this renders _after_ the node list renderer - the edges depend on nodes being created and existing to render properly.
    const edgeListRenderer = rg.list(div({ class: "absolute-fill pointer-events-none" }), GraphEdgeUI, (getNext) => {
        for (const id of edgeComponentMap.keys()) {
            if (!(id in graphData.edges)) {
                edgeComponentMap.delete(id);
            }
        }

        for (const id in graphData.edges) {
            const edge = graphData.edges[id];
            const c = getNext();

            if (!c.state.hasArgs()) {
                c.state.args = {
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
                    renderGraph,
                };
            }

            c.state.args.edge = edge;
            c.state.args.srcNode = getObj(graphData.nodes, edge.srcNodeId);
            c.state.args.srcNodeEl = getMap(nodeComponentMap, edge.srcNodeId)?.el;
            c.state.args.dstNode = getObj(graphData.nodes, edge.dstNodeId);
            c.state.args.dstNodeEl = getMap(nodeComponentMap, edge.dstNodeId)?.el;
            c.state.args.graphState = graphState;
            c.state.args.relativeContainer = relativeContainer;

            c.render(c.state.args);
            edgeComponentMap.set(id, c);
        }
    });

    const root = div({
        class: "flex-1 w-100 h-100 col",
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

    const contextMenuItemsDict = {
        newNode: contextMenuItem("New node", () => {
            const x = realXToGraphX(graphState, relativeContainer.el, graphState.contextMenuX);
            const y = realYToGraphY(graphState, relativeContainer.el, graphState.contextMenuY)
            addNewNode(x, y);
        }),
        recenter: contextMenuItem("Recenter", () => {
            recenter();
            renderGraph();
        }),
        flipEdge: contextMenuItem("Flip Edge", () => {
            const edge: GraphEdge | undefined = graphState.currentEdgeDragEdgeId ? graphData.edges[graphState.currentEdgeDragEdgeId] : undefined;
            if (!edge) {
                return;
            }

            [edge.srcNodeId, edge.dstNodeId] = [edge.dstNodeId, edge.srcNodeId];
            [edge.srcXSliced, edge.dstXSliced] = [edge.dstXSliced, edge.srcXSliced];
            [edge.srcYSliced, edge.dstYSliced] = [edge.dstYSliced, edge.srcYSliced];

            renderGraph();
        }),
        edgeThicknessThin: contextMenuItem("Weight -> Thin", () => {
            const edge: GraphEdge | undefined = graphState.currentEdgeDragEdgeId ? graphData.edges[graphState.currentEdgeDragEdgeId] : undefined;
            if (edge) {
                edge.thickness = EDGE_THICNKESSES.THIN;
                renderGraph();
            }
        }),
        edgeThicknessNormal: contextMenuItem("Weight -> Normal", () => {
            const edge: GraphEdge | undefined = graphState.currentEdgeDragEdgeId ? graphData.edges[graphState.currentEdgeDragEdgeId] : undefined;
            if (edge) {
                edge.thickness = EDGE_THICNKESSES.NORMAL;
                renderGraph();
            }
        }),
        edgeThicknessThick: contextMenuItem("Weight -> Thick", () => {
            const edge: GraphEdge | undefined = graphState.currentEdgeDragEdgeId ? graphData.edges[graphState.currentEdgeDragEdgeId] : undefined;
            if (edge) {
                edge.thickness = EDGE_THICNKESSES.THICK;
                renderGraph();
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

            renderGraph();
        }),
        recalcItemVisibility() {
            const nodeSelected = !!graphState.currentSelectedNodeId;
            const edgeSelected = !!graphState.currentEdgeDragEdgeId;
            const dragEdge = !!graphState.currentEdgeDragStartNodeIdx;
            const hasItems = nodeComponentMap.size > 0;
            const noneSelected = !nodeSelected && !edgeSelected && !dragEdge;

            contextMenuItemsDict.edgeThicknessThin.visible = edgeSelected;
            contextMenuItemsDict.edgeThicknessNormal.visible = edgeSelected;
            contextMenuItemsDict.edgeThicknessThick.visible = edgeSelected;

            contextMenuItemsDict.recenter.visible = hasItems && noneSelected;
            contextMenuItemsDict.newNode.visible = noneSelected;
            contextMenuItemsDict.flipEdge.visible = edgeSelected;

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
        isDragging: false,
        isClickBlocked: false,
        isMouseDown: false,
        isEditing: false,
        isSnapepdToGrid: false,

        contextMenuItems: [
            contextMenuItemsDict.newNode,
            contextMenuItemsDict.recenter,
            contextMenuItemsDict.flipEdge,
            contextMenuItemsDict.edgeThicknessThin,
            contextMenuItemsDict.edgeThicknessNormal,
            contextMenuItemsDict.edgeThicknessThick,
            contextMenuItemsDict.deleteNode,
        ],
        isContextMenuOpen: false,
        contextMenuX: 0,
        contextMenuY: 0,

        currentEdgeDragStartIsSrc: false,
    };

    let viewDxStart = 0, viewDyStart = 0;
    let nodeDxStart = 0, nodeDyStart = 0;

    function moveGraph(x: number, y: number) {
        graphState.viewY = x;
        graphState.viewX = y;
    }

    function recenter() {
        // move all the elements themselves by their mean.
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

        moveGraph(0, 0);
    }

    function addNewNode(x = 0, y = 0) {
        const id = newUuid(id => id in graphData.nodes);
        graphData.nodes[id] = {
            id,
            text: "Node " + nodeComponentMap.size,
            x, y,
        };
        return id;
    }

    let domRect = root.el.getBoundingClientRect();

    function renderGraph() {
        if (s.args.graphData) {
            graphData = s.args.graphData;
        }

        let hasNodes = false;
        for (const k in graphData.nodes) {
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

        rg.render();
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
    }

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
                srcNodeId: undefined, srcXSliced: 0, srcYSliced: 0,
                dstNodeId: undefined, dstXSliced: 0, dstYSliced: 0,
                thickness: EDGE_THICNKESSES.NORMAL,
            };
            graphData.edges[id] = edge;
            graphState.currentEdgeDragEdgeId = id;

            // NOTE: When we introduce zooming, sliced coordinates need to be scaled to graph coordinates in a specific way.
            const slicedX = realXToSlicedNormEl(relativeContainer.el, startNodeEl.el, startX)
            const slicedY = realYToSlicedNormEl(relativeContainer.el, startNodeEl.el, startY)
            if (graphState.currentEdgeDragStartIsSrc) {
                edge.srcNodeId = graphState.currentEdgeDragStartNodeIdx;
                edge.srcXSliced = slicedX;
                edge.srcYSliced = slicedY;
            } else {
                edge.dstNodeId = graphState.currentEdgeDragStartNodeIdx;
                edge.dstXSliced = slicedX;
                edge.dstYSliced = slicedY;
            }
        }

        const currentEdge = getObj(graphData.edges, graphState.currentEdgeDragEdgeId);
        if (!currentEdge) {
            throw new Error("Edge shouldn't be undefined");
        }

        const startXGraph = realXToGraphX(graphState, relativeContainer.el, startX);
        const startYGraph = realYToGraphY(graphState, relativeContainer.el, startY);
        if (graphState.currentEdgeDragStartIsSrc) {
            currentEdge.dstNodeId = undefined;
            currentEdge.dstXSliced = startXGraph;
            currentEdge.dstYSliced = startYGraph;
        } else {
            currentEdge.srcNodeId = undefined;
            currentEdge.srcXSliced = startXGraph;
            currentEdge.srcYSliced = startYGraph;
        }

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

        const slicedX = realXToSlicedNormEl(relativeContainer.el, endNodeEl.el, endX);
        const slicedY = realYToSlicedNormEl(relativeContainer.el, endNodeEl.el, endY);

        if (graphState.currentEdgeDragStartIsSrc) {
            currentEdge.dstNodeId = currentEdgeDragEndNodeIdx;
            currentEdge.dstXSliced = slicedX;
            currentEdge.dstYSliced = slicedY;
        } else {
            currentEdge.srcNodeId = currentEdgeDragEndNodeIdx;
            currentEdge.srcXSliced = slicedX;
            currentEdge.srcYSliced = slicedY;
        }

        renderGraph();
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
        },
        onDrag(dx: number, dy: number, e: MouseEvent) {
            if (graphState.isEditing) {
                return;
            }

            if (graphState.currentSelectedNodeId) {
                const currentNode = graphData.nodes[graphState.currentSelectedNodeId];
                currentNode.x = nodeDxStart + dx;
                currentNode.y = nodeDyStart + dy;

                return;
            }

            if (graphState.currentEdgeDragEdgeId) {
                const currentEdge = graphData.edges[graphState.currentEdgeDragEdgeId];

                const mouseX = realXToGraphX(graphState, relativeContainer.el, getRelativeX(relativeContainer.el, e.pageX));
                const mouseY = realYToGraphY(graphState, relativeContainer.el, getRelativeY(relativeContainer.el, e.pageY));

                if (graphState.currentEdgeDragStartIsSrc) {
                    currentEdge.dstXSliced = mouseX;
                    currentEdge.dstYSliced = mouseY;
                } else {
                    currentEdge.srcXSliced = mouseX;
                    currentEdge.srcYSliced = mouseY;
                }

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

    function onMouseMove(e: MouseEvent) {
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
        renderGraph();
    }

    let lastX = 0, lastY = 0;
    on(relativeContainer, "mousemove", (e) => {
        // only run mousemove if we've moved by a large enough distance, since this event gets sent a LOT
        const x = Math.floor(e.pageX);
        const y = Math.floor(e.pageY);
        if (lastX === x && lastY === y) {
            return;
        }

        // currently too lazy to put this in the right places.
        // But really this should only be called whenever our state changes, and not more or less.
        s.args.onInput();

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
    on(relativeContainer, "contextmenu", (e) => {
        onContextMenu(e);
        renderGraph();
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

    return newComponent(root, renderGraph, s);
}

function GraphNodeUI() {
    const s = newState<GraphNodeUIArgs>();

    const className = "pre w-100 h-100";
    const styles = "padding: 0; position: absolute;";
    const textArea = setAttrs(TextArea(), {
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
            const { graphState, node, onMouseMove, renderGraph } = s.args;

            e.stopImmediatePropagation();

            onMouseMove(e);

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
        on(regionDiv, "contextmenu", (e) => {
            const { onContextMenu, renderGraph } = s.args;
            e.stopImmediatePropagation();
            onContextMenu(e);
            renderGraph();
        })
    });

    const rg = newRenderGroup();
    const root = div({
        style: "position: absolute; padding: 5px; border: 1px var(--fg-color) solid; ",
        class: "pointer-events-all",
    }, [
        div({ style: "position: relative;" }, [
            textArea,
            textDiv,
            ...edgeDragStartRegions,
        ]),
    ]);


    let lastText: string | undefined;
    let lastIsEditing = false;

    function renderGraphNodeUI() {
        const { node, isSelected, isEditing, graphState, relativeContainer } = s.args;

        if (setVisibleGroup(
            !graphState.isDragging || node.id !== graphState.currentEdgeDragStartNodeIdx,
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

        const w = root.el.clientWidth;
        const h = root.el.clientHeight;

        setStyle(root, "transform", `translate(${xPos - w / 2}px, ${yPos - h / 2}px)`);
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
        const { graphState, renderGraph, node } = s.args;

        if (s.args.graphState.isDragging) {
            return;
        }

        // TODO: fix. it clicks instantly after it selects.  lmao.
        e.stopPropagation();

        if (s.args.graphState.isDragging) {
            s.args.graphState.isDragging = false;
            return;
        }

        if (graphState.currentSelectedNodeId === node.id && !graphState.isEditing) {
            graphState.isEditing = true;
            renderGraph();
        }
    });

    root.el.addEventListener("mousedown", () => {
        const { node, graphState, renderGraph, } = s.args;

        // block clicking, so we don't instantly de-select this thing.
        graphState.isClickBlocked = true;
        if (graphState.currentSelectedNodeId !== node.id) {
            graphState.currentSelectedNodeId = node.id;
        }

        renderGraph();
    });

    on(textArea, "input", () => {
        const { node, renderGraph } = s.args;
        node.text = textArea.el.value;
        renderGraph();
    });

    return newComponent(root, renderGraphNodeUI, s);
}

const cnGraphEdgeRoot = sg.makeClass(`graph-edge-root`, [
    ` { position: absolute; top: 0; left: 0; width: 1px; height: 1px; }`,
    ` .line { width: 1px; height: 1px; background-color: var(--fg-color); } `,
    `.redrag .line { background-color: red; }`
]);

function GraphEdgeUI() {
    const s = newState<GraphEdgeUIArgs>();

    const arrowHitbox = div({
        class: "line",
        style: "background-color: transparent;"
        // style: "background-color: rgba(0, 0, 255, 0.5);" 
    });
    const arrowLine = div({ class: "line" });
    const arrowHead1 = div({ class: "line" });
    const arrowHead2 = div({ class: "line" });
    const arrowSegments = [
        arrowHitbox,
        arrowLine,
        arrowHead1,
        arrowHead2
    ];

    function getX0() {
        const { graphState, relativeContainer, edge, srcNode, srcNodeEl } = s.args;
        return edgeSrcX(graphState, relativeContainer.el, edge, srcNode, srcNodeEl);
    }
    function getY0() {
        const { graphState, relativeContainer, edge, srcNode, srcNodeEl } = s.args;
        return edgeSrcY(graphState, relativeContainer.el, edge, srcNode, srcNodeEl);
    }
    function getX1() {
        const { graphState, relativeContainer, edge, dstNode, dstNodeEl } = s.args;
        return edgeDstX(graphState, relativeContainer.el, edge, dstNode, dstNodeEl);
    }
    function getY1() {
        const { graphState, relativeContainer, edge, dstNode, dstNodeEl } = s.args;
        return edgeDstY(graphState, relativeContainer.el, edge, dstNode, dstNodeEl);
    }

    for (const seg of arrowSegments) {
        on(seg, "mousemove", (e) => {
            const { graphState, edge, onMouseMove, renderGraph, relativeContainer, srcNode, dstNode } = s.args;

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

            renderGraph();
        });
        on(seg, "mouseup", (e) => {
            const { onMouseUp, renderGraph } = s.args;

            e.stopImmediatePropagation();
            onMouseUp(e);
            renderGraph();
        });
        on(seg, "mousedown", (e) => {
            const { onMouseDown, renderGraph } = s.args;

            e.stopImmediatePropagation();
            onMouseDown(e);
            renderGraph();
        });
        on(seg, "contextmenu", (e) => {
            const { onContextMenu, renderGraph } = s.args;
            e.stopImmediatePropagation();
            onContextMenu(e);
            renderGraph();
        });
    }

    const rg = newRenderGroup();
    const labelInput = el<HTMLInputElement>("INPUT", { class: "w-100" });
    const label = div({ style: "position: absolute; white-space: nowrap;" }, [
        labelInput
    ]);

    const root = div({
        class: cnGraphEdgeRoot + " pointer-events-all",
        style: "user-select: none;",
    }, [
        ...arrowSegments,
        label,
    ]);

    setInputValueAndResize(labelInput, "Edge");

    function renderGraphEdgeUI() {
        const { graphState, edge } = s.args;

        rg.render();

        setClass(root, "block-mouse", true || graphState.isDragging);
        setClass(root, "redrag", graphState.currentEdgeDragEdgeId === edge.id);

        let x0 = getX0(); let y0 = getY0();
        let x1 = getX1(); let y1 = getY1();

        const dx = x1 - x0;
        const dy = y1 - y0;
        const length = magnitude(x1 - x0, y1 - y0);
        const angle = Math.atan2(dy, dx);
        const shouldNotFlip = (-Math.PI / 2 <= angle && angle <= Math.PI / 2);

        setStyle(root, "width", "1px");
        setStyle(root, "height", "1px");
        const edgeThickness = edge.thickness;
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

        setStyle(arrowHead1, `transform`, `translate(${length - edgeThickness / 2}px, ${arrowHeadSegmentVOfffset}px) rotate(-${arrowAngle}rad) scale(30, ${edgeThickness}) translate(50%)`);
        setStyle(arrowHead2, `transform`, `translate(${length - edgeThickness / 2}px, ${-arrowHeadSegmentVOfffset}px) rotate(${arrowAngle}rad) scale(30, ${edgeThickness}) translate(50%)`);

        setInputValueAndResize(labelInput, labelInput.el.value);
        labelInput.el.style.width = "0";
        labelInput.el.style.whiteSpace = "pre";
        labelInput.el.style.width = Math.max(30, Math.min(500, labelInput.el.scrollWidth + 5)) + "px";
        setStyle(labelInput, "width", labelInput.el.style.width);
    }

    on(labelInput, "input", () => {
        renderGraphEdgeUI();
    });

    return newComponent(root, renderGraphEdgeUI, s);
}


const cnEdgeCreateDragRect = sg.makeClass("graphNodeDragRect", [
    // https://stackoverflow.com/questions/704564/disable-drag-and-drop-on-html-elements
    // So many fkn opinions on this thread - user-select: none; was the only thing that worked.
    ` { position: absolute; z-index: ${Z_INDICES.EDGE_CREATE_HANDLES}; background-color: transparent; cursor: crosshair; user-select: none; }`,
    // + "border: 1px black solid; "
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

const cnContextMenu = sg.makeClass(`context-menu`, [
    ` .item:hover { background-color: var(--bg-color-focus); cursor: pointer; }`
])

function RadialContextMenu() {
    const s = newState<{
        x: number;
        y: number;
        centerText: string;
        items: ContextMenuItem[];
        onClose(): void;
    }>();

    function RadialContextMenuItem() {
        const s = newState<{
            x: number;
            y: number;
            item: ContextMenuItem;
            onClose(): void;
        }>();

        const rg = newRenderGroup();
        const root = div({
            class: "absolute nowrap item bg-color",
            style: `z-index: ${Z_INDICES.CONTEXT_MENU}; padding: 10px; border-radius: 5px; border: 2px solid var(--fg-color);`,
        }, [
            rg.text(() => s.args.item.text)
        ]);

        function renderRadialContextMenuItem() {
            const { x, y, item } = s.args;

            rg.render();

            setStyle(root, "left", x + "px");
            setStyle(root, "top", y + "px");
            setClass(root, "inverted", item.toggled);
        }

        on(root, "mousedown", (e) => {
            if (e.button !== 0) {
                return
            }

            s.args.item.onClick();
            closeSelf(e);
        });

        return newComponent(root, renderRadialContextMenuItem, s);
    }

    const contextMenuItemList = newListRenderer(div({ class: "relative" }), RadialContextMenuItem);
    const centerTextEl = div({ class: "pre" });
    const centerTextContainerPadding = 10;
    const centerTextContainer = div({
        class: "bg-color nowrap col align-items-center justify-content-center",
        style: `padding: ${centerTextContainerPadding}px; border-radius: 500px; opacity: 0.75`
    }, [
        centerTextEl
    ]);

    const root = div({
        style: `position: absolute; background-color: transparent; z-index: ${Z_INDICES.CONTEXT_MENU}`,
        class: cnContextMenu + " col align-items-center justify-content-center",
    }, [
        div({ class: "relative" }, [
            div({ class: "absolute-fill col align-items-center justify-content-center" }, [
                // 0x0 div in th center
                contextMenuItemList,
            ]),
            centerTextContainer,
        ]),
    ]);

    function renderRadialContextMenu() {
        const { x, y, items, centerText } = s.args;

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
                    onClose: s.args.onClose,
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
                const w = c.el.clientWidth;
                const h = c.el.clientHeight;

                const x = centerX - w / 2;
                const y = centerY - h / 2;

                if (rectIntersect(x, y, w, h, lastRect.x, lastRect.y, lastRect.w, lastRect.h)) {
                    continue;
                }

                c.state.args.x = x;
                c.state.args.y = y;

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
                c.render(c.state.args);
            }
        });

        setStyle(root, "left", (x - rootWidth / 2) + "px");
        setStyle(root, "top", (y - rootHeight / 2) + "px");
        setStyle(root, "width", rootWidth + "px");
        setStyle(root, "height", rootHeight + "px");

    }

    function closeSelf(e: MouseEvent) {
        e.preventDefault();
        e.stopImmediatePropagation();
        s.args.onClose();
    }

    on(root, "contextmenu", closeSelf);
    on(root, "mousedown", (e) => {
        if (e.button === 0) {
            closeSelf(e);
        }
    });
    on(root, "mousemove", (e) => {
        e.stopImmediatePropagation();
    });

    return newComponent(root, renderRadialContextMenu, s);
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

function realXToSlicedNormEl(relativeEl: HTMLElement, el: HTMLElement, real: number): number {
    const rect = el.getBoundingClientRect();
    const low = getRelativeX(relativeEl, rect.left);
    const hi = getRelativeX(relativeEl, rect.left + rect.width);
    return realToSlicedNorm(low, hi, real);
}

function slicedNormXToRealEl(relativeEl: HTMLElement, el: HTMLElement, slicedNorm: number): number {
    const rect = el.getBoundingClientRect();
    const low = getRelativeX(relativeEl, rect.left);
    const hi = getRelativeX(relativeEl, rect.left + rect.width);
    return slicedNormToReal(low, hi, slicedNorm);
}

function realYToSlicedNormEl(relativeEl: HTMLElement, el: HTMLElement, real: number): number {
    const rect = el.getBoundingClientRect();
    const low = getRelativeY(relativeEl, rect.top);
    const hi = getRelativeY(relativeEl, rect.top + rect.height);
    return realToSlicedNorm(low, hi, real);
}

function slicedNormYToRealEl(relativeEl: HTMLElement, el: HTMLElement, slicedNorm: number): number {
    const rect = el.getBoundingClientRect();
    const low = getRelativeY(relativeEl, rect.top);
    const hi = getRelativeY(relativeEl, rect.top + rect.height);
    return slicedNormToReal(low, hi, slicedNorm);
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
        return graphXToRealX(graphState, relativeEl, edge.srcXSliced);
    }

    return slicedNormXToRealEl(relativeEl, nodeEl, edge.srcXSliced);
}

function edgeSrcY(graphState: GraphState, relativeEl: HTMLElement, edge: GraphEdge, srcNode: GraphNode | undefined, nodeEl: HTMLElement | undefined) {
    if (!srcNode || !nodeEl) {
        return graphYToRealY(graphState, relativeEl, edge.srcYSliced);
    }

    return slicedNormYToRealEl(relativeEl, nodeEl, edge.srcYSliced);
}

function edgeDstX(graphState: GraphState, relativeEl: HTMLElement, edge: GraphEdge, dstNode: GraphNode | undefined, nodeEl: HTMLElement | undefined) {
    if (!dstNode || !nodeEl) {
        return graphXToRealX(graphState, relativeEl, edge.dstXSliced);
    }

    return slicedNormXToRealEl(relativeEl, nodeEl, edge.dstXSliced);
}

function edgeDstY(graphState: GraphState, relativeEl: HTMLElement, edge: GraphEdge, dstNode: GraphNode | undefined, nodeEl: HTMLElement | undefined) {
    if (!dstNode || !nodeEl) {
        return graphYToRealY(graphState, relativeEl, edge.dstYSliced);
    }

    return slicedNormYToRealEl(relativeEl, nodeEl, edge.dstYSliced);
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

function getRelativeX(parent: HTMLElement, pageX: number) {
    return pageX - parent.offsetLeft;
}

function getRelativeY(parent: HTMLElement, pageY: number) {
    return pageY - parent.offsetTop;
}


function magnitude(x: number, y: number) {
    return Math.sqrt(x * x + y * y);
}
