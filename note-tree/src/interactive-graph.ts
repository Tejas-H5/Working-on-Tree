import { makeButton } from "./components";
import { TextArea } from "./components/text-area";
import { filterInPlace } from "./utils/array-utils";
import { addDays } from "./utils/datetime";
import { Insertable, addChildren, div, el, isVisible, newComponent, newListRenderer, newRenderGroup, newState, newStyleGenerator, on, setAttr, setAttrs, setClass, setInputValue, setInputValueAndResize, setStyle, setText, setVisible, setVisibleGroup } from "./utils/dom-utils";
import { newDragManager } from "./utils/drag-handlers";

const sg = newStyleGenerator();

type GraphArgs = {
    onClose(): void;
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

    idx: number;
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
    idx: number;

    edge: GraphEdge;
    srcNode: GraphNode | undefined;
    dstNode: GraphNode | undefined;
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

    contextMenuItems: ContextMenuItem[];
    isContextMenuOpen: boolean;
    contextMenuX: number;
    contextMenuY: number;

    currentSelectedNode: number;
    currentEdgeDragStartNodeIdx: number;
    currentEdgeDragEndNodeIdx: number;
    currentEdgeDragStartIsSrc: boolean;
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

function getDragStartNodeIdx(graphState: GraphState, edge: GraphEdge) {
    return graphState.currentEdgeDragStartIsSrc ? edge.srcNodeIdx : edge.dstNodeIdx
}

function getDragEndNodeIdx(graphState: GraphState, edge: GraphEdge) {
    return graphState.currentEdgeDragStartIsSrc ? edge.dstNodeIdx : edge.srcNodeIdx
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

    const root = div({
        class: "flex-1 w-100 h-100 col",
    }, [
        addChildren(relativeContainer, [
            addChildren(graphRoot, [
                rg.list(div({ class: "absolute-fill pointer-events-none" }), GraphEdgeUI, (getNext) => {
                    for (let i = 0; i < graphEdges.length; i++) {
                        const edge = graphEdges[i];
                        const c = getNext();

                        if (!c.state.hasArgs()) {
                            c.state.args = {
                                srcNode: graphNodes[edge.srcNodeIdx],
                                dstNode: graphNodes[edge.dstNodeIdx],
                                graphState: graphState,
                                edge,
                                idx: 0,

                                onMouseUp,
                                onMouseDown,
                                onMouseMove,
                                onContextMenu,

                                relativeContainer,
                                renderGraph,
                            };
                        }

                        c.state.args.edge = graphEdges[i];
                        c.state.args.srcNode = graphNodes[edge.srcNodeIdx];
                        c.state.args.dstNode = graphNodes[edge.dstNodeIdx];
                        c.state.args.graphState = graphState;
                        c.state.args.relativeContainer = relativeContainer;
                        c.state.args.idx = i;

                        c.render(c.state.args);
                    }
                }),
                // NOTE: not quite right to use graphRoot as the root of the list...
                rg.list(div({ class: "absolute-fill pointer-events-none" }), GraphNodeUI, (getNext) => {
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
                                onContextMenu,

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
            ]),
            // svgRoot,
            contextMenu,
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

    function contextMenuItem(item: ContextMenuItem) {
        return item;
    }

    const contextMenuItems = {
        newNode: contextMenuItem({
            text: "New Node",
            onClick() {
                const x = realXToGraphX(graphState, relativeContainer.el, graphState.contextMenuX);
                const y = realYToGraphY(graphState, relativeContainer.el, graphState.contextMenuY)
                addNewNode(x, y);
            }
        })
    };

    const graphState: GraphState = {
        viewX: 0,
        viewY: 0,
        isDragging: false,
        isClickBlocked: false, 
        isMouseDown: false,
        isEditing: false,

        contextMenuItems: [
            contextMenuItems.newNode,
        ],
        isContextMenuOpen: false,
        contextMenuX: 0,
        contextMenuY: 0,

        currentSelectedNode: -1,
        currentEdgeDragStartNodeIdx: -1,
        currentEdgeDragEndNodeIdx: -1,
        currentEdgeDragStartIsSrc: false,
        currentEdgeDragEdgeIdx: -1,
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

    function addNewNode(x = 0, y = 0) {
        const idx = graphNodes.length;
        graphNodes.push({ 
            text: "New node " + graphNodes.length, 
            x, y,
        });
        return idx;
    }

    let domRect = root.el.getBoundingClientRect();

    function renderGraph() {
        domRect = root.el.getBoundingClientRect();

        filterInPlace(graphEdges, (edge) => {
            return (
                (edge.dstNodeIdx !== -1 && edge.srcNodeIdx !== -1) ||
                graphState.currentEdgeDragStartNodeIdx === getDragStartNodeIdx(graphState, edge)
            );
        });

        rg.render();

        if (setVisible(contextMenu, graphState.isContextMenuOpen)) {
            contextMenu.render({
                x: graphState.contextMenuX,
                y: graphState.contextMenuY,
                items: graphState.contextMenuItems,
                centerText: "+New",
                onClose: closeContextMenu,
            });
        }
    }

    function startEdgeDrag(e: MouseEvent) {
        // Specifically for edges, we want the endpoint to be exactly on the mouse cursor.
        // For most things, we want the point where we started dragging something to be the point that we are 'grabbing', and for 
        // the current position of that thing to be offset by the offset which was present at the start.
        const startX = realXToGraphX(graphState, relativeContainer.el, getMouseX(relativeContainer.el, dragManager.dragState.startX));
        const startY = realYToGraphY(graphState, relativeContainer.el, getMouseY(relativeContainer.el, dragManager.dragState.startY));

        const startNode = graphNodes[graphState.currentEdgeDragStartNodeIdx];
        if (!startNode) {
            return;
        }

        if (graphState.currentEdgeDragEdgeIdx === -1) {
            graphState.currentEdgeDragStartIsSrc = true;
            graphState.currentEdgeDragEdgeIdx = graphEdges.length;
            graphEdges.push({
                srcNodeIdx: -1,
                srcX: startX, srcY: startY,
                dstNodeIdx: -1,
                dstX: startX, dstY: startY,
            });
        }

        const currentEdge = graphEdges[graphState.currentEdgeDragEdgeIdx];
        if (graphState.currentEdgeDragStartIsSrc) {
            if (currentEdge.srcNodeIdx === -1) {
                currentEdge.srcNodeIdx = graphState.currentEdgeDragStartNodeIdx;
                currentEdge.srcX = startX - startNode.x;
                currentEdge.srcY = startY - startNode.y;
            }

            currentEdge.dstNodeIdx = -1;
            currentEdge.dstX = startX;
            currentEdge.dstY = startY;
        } else {
            if (currentEdge.dstNodeIdx === -1) {
                currentEdge.dstNodeIdx = graphState.currentEdgeDragStartNodeIdx;
                currentEdge.dstX = startX - startNode.x;
                currentEdge.dstY = startY - startNode.y;
            }

            currentEdge.srcNodeIdx = -1;
            currentEdge.srcX = startX;
            currentEdge.srcY = startY;
        }

        graphState.currentSelectedNode = -1;
    }

    function finishEdgeDrag(e: MouseEvent) {
        const currentEdgeDragEndNodeIdx = graphState.currentEdgeDragEndNodeIdx;
        const currentEdgeDragEdgeIdx = graphState.currentEdgeDragEdgeIdx;

        const endNode = graphNodes[currentEdgeDragEndNodeIdx];
        const currentEdge = graphEdges[currentEdgeDragEdgeIdx];

        graphState.currentEdgeDragEndNodeIdx = -1;
        graphState.currentEdgeDragEdgeIdx = -1;
        graphState.currentEdgeDragStartNodeIdx = -1;

        if (!currentEdge || !endNode) {
            return;
        }

        const endX = realXToGraphX(graphState, relativeContainer.el, getMouseX(relativeContainer.el, e.pageX));
        const endY = realYToGraphY(graphState, relativeContainer.el, getMouseY(relativeContainer.el, e.pageY));

        const endNodeToX = endX - endNode.x;
        const endNodeToY = endY - endNode.y;

        if (graphState.currentEdgeDragStartIsSrc) {
            currentEdge.dstNodeIdx = currentEdgeDragEndNodeIdx;
            currentEdge.dstX = endNodeToX;
            currentEdge.dstY = endNodeToY;
        } else {
            currentEdge.srcNodeIdx = currentEdgeDragEndNodeIdx;
            currentEdge.srcX = endNodeToX;
            currentEdge.srcY = endNodeToY;
        }

        renderGraph();
    }

    const dragManager = newDragManager({
        onDragStart(e) {
            graphState.isDragging = true;
            if (graphState.currentEdgeDragStartNodeIdx !== -1) {
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
        onDrag(dx: number, dy: number, e: MouseEvent) {
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

                const mouseX = realXToGraphX(graphState, relativeContainer.el, getMouseX(relativeContainer.el, e.pageX));
                const mouseY = realYToGraphY(graphState, relativeContainer.el, getMouseY(relativeContainer.el, e.pageY));

                if (graphState.currentEdgeDragStartIsSrc) {
                    currentEdge.dstX = mouseX;
                    currentEdge.dstY = mouseY;
                } else {
                    currentEdge.srcX = mouseX;
                    currentEdge.srcY = mouseY;
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
            graphState.currentEdgeDragStartNodeIdx = -1;
            graphState.currentEdgeDragEdgeIdx = -1;
        } else {
            graphState.currentEdgeDragEndNodeIdx = -1;
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

            graphState.currentSelectedNode = -1;
            graphState.isEditing = false;

        }, 1);
    }

    function onContextMenu(e: MouseEvent) {
        e.preventDefault();

        // NOTE: other code might want to call this function, then add it's own stuff to the context menu and disable other stuff, possibly
        graphState.isContextMenuOpen = true;
        graphState.contextMenuX = getMouseX(relativeContainer.el, e.pageX);
        graphState.contextMenuY = getMouseY(relativeContainer.el, e.pageY);
    }
    function closeContextMenu() {
        graphState.isContextMenuOpen = false;
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
        function setupTest(
            name: string,
            x0: number, y0: number,
            x1: number, y1: number,
        ) {
            const srcNodeIdx = addNewNode(x0, y0);
            graphNodes[srcNodeIdx].text = name + " src";
            graphNodes[srcNodeIdx].x = x0;
            graphNodes[srcNodeIdx].y = y0;

            const dstNodeIdx = addNewNode();
            graphNodes[dstNodeIdx].text = name + " dst";
            graphNodes[dstNodeIdx].x = x1;
            graphNodes[dstNodeIdx].y = y1;

            graphEdges.push({
                srcNodeIdx,
                srcX: 0, srcY: 0,
                dstNodeIdx,
                dstX: 0, dstY: 0
            });
        }

        // setupTest("A", -200, 0, 200, 0);
        // setupTest("B", 0, -200, 0, 200);
        // setupTest("C", 300, 300, -300, -300);
        // setupTest("D", -300, 300, 300, -300);

        const name = "hub n spoke";
        const srcNodeIdx = addNewNode();
        graphNodes[srcNodeIdx].text = name + " src";
        graphNodes[srcNodeIdx].x = 0;
        graphNodes[srcNodeIdx].y = 0;
        for (let i = 0 ; i < 20; i++) {
            const dstNodeIdx = addNewNode();
            graphNodes[dstNodeIdx].text = name + " dst " + i;
            graphNodes[dstNodeIdx].x = 1000 * (0.5 - Math.random());
            graphNodes[dstNodeIdx].y = 1000 * (0.5 - Math.random());

            graphEdges.push({
                srcNodeIdx,
                srcX: 0, srcY: 0,
                dstNodeIdx,
                dstX: 0, dstY: 0
            });
        }
        

        recenter();

        renderGraph();
    }, 1);

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
            const { graphState, idx, onMouseMove, renderGraph } = s.args;

            e.stopImmediatePropagation();

            onMouseMove(e);

            if (!graphState.isDragging) {
                graphState.currentEdgeDragStartNodeIdx = idx;
                graphState.currentEdgeDragEdgeIdx = -1;
            } else {
                if (
                    graphState.currentEdgeDragStartNodeIdx !== -1 &&
                    graphState.currentEdgeDragStartNodeIdx !== idx
                ) {
                    graphState.currentEdgeDragEndNodeIdx = idx;
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

    function render() {
        const { node, isSelected, isEditing, graphState, relativeContainer, idx } = s.args;

        if (setVisibleGroup(
            !graphState.isDragging || idx !== graphState.currentEdgeDragStartNodeIdx, 
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
        render();
    });

    return newComponent(root, render, s);
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

    for (const seg of arrowSegments) {
        on(seg, "mousemove", (e) => {
            const { graphState, idx, onMouseMove, renderGraph, relativeContainer, edge, srcNode, dstNode } = s.args;

            e.stopImmediatePropagation();
            onMouseMove(e);

            if (
                srcNode &&
                dstNode &&
                !graphState.isDragging
            ) {
                const mouseX = realXToGraphX(graphState, relativeContainer.el, getMouseX(relativeContainer.el, e.pageX));
                const mouseY = realYToGraphY(graphState, relativeContainer.el, getMouseY(relativeContainer.el, e.pageY));

                let x0 = edgeSrcX(edge, srcNode);
                let y0 = edgeSrcY(edge, srcNode);
                let x1 = edgeDstX(edge, dstNode);
                let y1 = edgeDstY(edge, dstNode);

                const lengthToSrc = magnitude(mouseX - x0, mouseY - y0);
                const lengthToDst = magnitude(mouseX - x1, mouseY - y1);

                const startAtSrc = lengthToDst < lengthToSrc;
                graphState.currentEdgeDragStartNodeIdx = startAtSrc ? (
                    graphNodes.indexOf(srcNode)
                ) : (
                    graphNodes.indexOf(dstNode)
                );
                graphState.currentEdgeDragEdgeIdx = idx;
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

    setInputValueAndResize(labelInput, "Hiii");

    function render() {
        const { edge, srcNode, dstNode, graphState, relativeContainer, idx } = s.args;

        setClass(root, "block-mouse", true || graphState.isDragging);
        setClass(root, "redrag", graphState.currentEdgeDragEdgeIdx === idx);

        let x0 = graphXToRealX(graphState, relativeContainer.el, edgeSrcX(edge, srcNode));
        let y0 = graphYToRealY(graphState, relativeContainer.el, edgeSrcY(edge, srcNode));
        let x1 = graphXToRealX(graphState, relativeContainer.el, edgeDstX(edge, dstNode));
        let y1 = graphYToRealY(graphState, relativeContainer.el, edgeDstY(edge, dstNode));

        const dx = x1 - x0;
        const dy = y1 - y0;
        const length = magnitude(x1 - x0, y1 - y0);
        const angle = Math.atan2(dy, dx);
        const shouldNotFlip = (-Math.PI / 2 <= angle && angle <= Math.PI / 2);

        setStyle(root, "width", "1px");
        setStyle(root, "height", "1px");
        const edgeHeight = 10;
        const hitboxHeight = 50;
        setStyle(root, `transform`, `translate(${x0}px, ${y0}px) rotate(${angle}rad)`);

        if (shouldNotFlip) {
            setStyle(label, `transform`, `translate(${length / 2 -  label.el.clientWidth / 2}px, ${-edgeHeight - 22}px)`);
        } else {
            setStyle(label, `transform`, `translate(${length / 2 -  label.el.clientWidth / 2}px, 8px) scale(-1, -1)`);
        }


        const deg2Rad = Math.PI / 180;
        const arrowAngle = 140 * deg2Rad;
        const arrowHeadSegmentVOfffset = Math.sin(arrowAngle) * edgeHeight * 0.5;

        setStyle(arrowLine, `transform`, `translate(${length / 2 - 10}px, 1px) scale(${length - edgeHeight}, ${edgeHeight})`);
        setStyle(arrowHitbox, `transform`, `translate(${length / 2 - 5}px, 1px) scale(${length - edgeHeight}, ${hitboxHeight})`);

        setStyle(arrowHead1, `transform`, `translate(${length - edgeHeight / 2}px, ${arrowHeadSegmentVOfffset}px) rotate(-${arrowAngle}rad) scale(30, ${edgeHeight}) translate(50%)`);
        setStyle(arrowHead2, `transform`, `translate(${length - edgeHeight / 2}px, ${-arrowHeadSegmentVOfffset}px) rotate(${arrowAngle}rad) scale(30, ${edgeHeight}) translate(50%)`);

        setInputValueAndResize(labelInput, labelInput.el.value);
        labelInput.el.style.width = "0";
        labelInput.el.style.whiteSpace = "pre";
        labelInput.el.style.width = Math.max(30, Math.min(500, labelInput.el.scrollWidth + 5)) + "px";
        setStyle(labelInput, "width", labelInput.el.style.width);
    }

    on(labelInput, "input", () => {
        render();
    });

    return newComponent(root, render, s);
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
        const { graphState, idx } = args;

        const outsetWidth = 20;
        for(let i = 0; i < dragRects.length; i++) {
            const divEl = dragRects[i];

            setStyle(divEl, directions[i - 1] || "left", "-" + outsetWidth + "px");
            setStyle(divEl, directions[i] || "top", "-" + outsetWidth + "px");
            setStyle(divEl, directions[i + 1] || "top", "0");
            setStyle(divEl, axes[i], outsetWidth + "px");

            setClass(divEl, "src-edge-drag", graphState.currentEdgeDragStartNodeIdx === idx && graphState.currentEdgeDragEdgeIdx === -1);
            setClass(divEl, "dst-edge-drag", graphState.currentEdgeDragEndNodeIdx === idx);
        }
    }

    for (const dr of dragRects) {
        setupfn(dr);
    }

    return [dragRects, updateDragRectStyles] as const;
}


type ContextMenuItem = {
    text: string;
    hidden?: boolean;
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

        function render() {
            const { x, y } = s.args;

            rg.render();

            setStyle(root, "left", x + "px");
            setStyle(root, "top", y + "px");
        }

        on(root, "mousedown", (e) => {
            if (e.button !== 0) {
                return
            }

            e.stopImmediatePropagation();
            s.args.item.onClick();
            s.args.onClose();
        });

        return newComponent(root, render, s);
    }

    const contextMenuItemList = newListRenderer(div({ class: "relative" }), RadialContextMenuItem);
    const centerTextEl = div();
    const centerTextContainerPadding = 10;
    const centerTextContainer = div({ 
        class: "bg-color nowrap col align-items-center justify-content-center", 
        style: `padding: ${centerTextContainerPadding}px; border-radius: 500px;` 
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

    function render() {
        const { x, y, items, centerText } = s.args;

        setText(centerTextEl, centerText);
        const centerTextWidth = centerTextEl.el.clientWidth;
        setStyle(centerTextContainer, "height", (centerTextContainer.el.clientWidth - centerTextContainerPadding * 2) + "px");
        
        let rootWidth = 0;
        let rootHeight = 0;
        contextMenuItemList.render((getNext) => {
            // first render
            for(const item of items) {
                if (item.hidden) {
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

            let maxWidth = 0;
            for (const c of contextMenuItemList.components) {
                maxWidth = Math.max(maxWidth, c.el.clientWidth);
            }

            ;
            let i = 0; 
            let delta = Math.PI / 120;
            const lastRect = { x: -99999, y: -99999, w: -99999, h: -99999 };
            const boundingRect = { t: 0, l: 0, b: 0, r: 0 };
            const verticalRect = { x: -centerTextWidth / 2, y: -5000, w: centerTextWidth, h: 10000  };
            let radiusMultiplierX = 1;
            let radiusMultiplierY = 1;
            for (let angle = 0; i < items.length; angle += delta) {
                if (angle > 2 * Math.PI) {
                    radiusMultiplierX += 1.3;
                    radiusMultiplierY += 0.5;
                    angle = 0;
                }

                const cirlceAngle = angle + Math.PI / 2;
                const centerX = Math.cos(cirlceAngle) * radiusMultiplierX * (maxWidth * 0.5 + centerTextWidth);
                const centerY = Math.sin(cirlceAngle) * maxWidth * radiusMultiplierY;

                const c = contextMenuItemList.components[i];
                const w = c.el.clientWidth;
                const h = c.el.clientHeight;

                const x = centerX - w / 2;
                const y = centerY - h / 2;

                if (
                    rectIntersect(x, y, w, h, lastRect.x, lastRect.y, lastRect.w, lastRect.h) ||
                    rectIntersect(x, y, w, h, verticalRect.x, verticalRect.y, verticalRect.w, verticalRect.h)
                ) {
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

            rootWidth = boundingRect.r - boundingRect.l;
            rootHeight = boundingRect.b - boundingRect.t;

            for (let i = 0; i < items.length; i++) {
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

    return newComponent(root, render, s);
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

function edgeSrcX(edge: GraphEdge, srcNode: GraphNode | undefined) {
    let x: number = 0;
    if (srcNode) {
        x = srcNode.x + edge.srcX;
    } else {
        x = edge.srcX;
    }
    return x;
}

function edgeSrcY(edge: GraphEdge, srcNode: GraphNode | undefined) {
    let y: number = 0;
    if (srcNode) {
        y = srcNode.y + edge.srcY;
    } else {
        y = edge.srcY;
    }
    return y;
}

function edgeDstX(edge: GraphEdge, dstNode: GraphNode | undefined) {
    let x: number = 0;
    if (dstNode) {
        x = dstNode.x + edge.dstX;
    } else {
        x = edge.dstX;
    }
    return x;
}

function edgeDstY(edge: GraphEdge, dstNode: GraphNode | undefined) {
    let y: number = 0;
    if (dstNode) {
        y = dstNode.y + edge.dstY;
    } else {
        y = edge.dstY;
    }
    return y;
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

function getMouseX(parent: HTMLDivElement, pageX: number) {
    return pageX - parent.offsetLeft;
}

function getMouseY(parent: HTMLDivElement, pageY: number) {
    return pageY - parent.offsetTop;
}


function magnitude(x: number, y: number) {
    return Math.sqrt(x * x + y * y);
}
