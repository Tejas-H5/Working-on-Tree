import { makeButton } from "./components";
import { div, el, elSvg, isVisible, newComponent, newRenderGroup, newState, newStyleGenerator, on, setAttr, setInputValue, setStyle, setText, setVisible } from "./utils/dom-utils";
import { addDragHandlers } from "./utils/drag-handlers";

const sg = newStyleGenerator();

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
    isEditing: boolean;
    blockClick: boolean;
    currentSelectedNode: number;
    currentSelectedEdge: number;
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
    const s = newState<{
        onClose(): void;
    }>();

    const rg = newRenderGroup();

    const graphRoot = div({ 
        class: "absolute-fill",
        style: "border: 2px solid var(--fg-color); overflow: hidden; cursor: move;", 
    });

    const svgRoot = elSvg("svg", { 
        class: "absolute-fill",
        style: "position: absolute; left: 50%; top: 50%; padding: 5px; border: 1px var(--fg-color) solid; ",
        xmlns: "http://www.w3.org/2000/svg",
    }, [
    ]);

    const root = div({
        class: "flex-1 w-100 h-100 col",
    }, [
        div({ class: "col relative flex-1" }, [
            rg.list(svgRoot, GraphEdge, (getNext) => {
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
                        };
                    }

                    c.state.args.edge = graphEdges[i];
                    c.state.args.srcNode = graphNodes[edge.srcNodeIdx];
                    c.state.args.dstNode = graphNodes[edge.dstNodeIdx];
                    c.state.args.graphState = graphState;

                    c.render(c.state.args);
                }
            }),
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

                            onSelect,
                            onClick,
                            renderGraph,
                            startNewEdgeDrag,
                            finishNewEdgeDrag,
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
        div({class: "row"}, [
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
        isEditing: false,
        blockClick: false,
        currentSelectedNode: -1,
        currentSelectedEdge: -1,
    };

    let viewDxStart = 0, viewDyStart = 0;

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

    function startNewEdgeDrag(
        srcNodeIdx: number,
        srcX: number,
        srcY: number,
    ) {
        const node = graphNodes[srcNodeIdx];
        if (!node) {
            return;
        }

        const newEdgeIdx = graphEdges.length;
        graphEdges.push({
            srcNodeIdx,
            srcX, srcY,

            dstNodeIdx: -1,
            dstX: 0,
            dstY: 0,
        });
    }

    function finishNewEdgeDrag(
        dstNodeIdx: number,
        dstX: number,
        dstY: number,
    ) {
    }

    function renderGraph() {
        rg.render();
    }

    function onDragStart() {
        graphState.blockClick = true;
        if (graphState.currentSelectedNode === -1) {
            viewDxStart = graphState.viewX;
            viewDyStart = graphState.viewY;
        } else {
            const currentNode = graphNodes[graphState.currentSelectedNode];
            viewDxStart = currentNode.x;
            viewDyStart = currentNode.y;
        }
    }
    function onDrag(dx: number, dy: number) {
        if (graphState.isEditing) {
            return;
        }

        if (graphState.currentSelectedNode === -1) {
            graphState.viewX = viewDxStart + dx;
            graphState.viewY = viewDyStart + dy;
            return;
        } 


        const currentNode = graphNodes[graphState.currentSelectedNode];
        currentNode.x = viewDxStart + dx;
        currentNode.y = viewDyStart + dy;
    }

    function onDragEnd() {
        graphState.blockClick = false;
    }


    function onSelect(graphNodeIdx: number) {
        if (graphState.currentSelectedNode !== graphNodeIdx) {
            graphState.currentSelectedNode = graphNodeIdx;
            if (graphState.isDragging) {
                onDragStart();
            }
        }         
        renderGraph();
    }

    function onClick(graphNodeIdx: number) {
        if (graphState.currentSelectedNode === graphNodeIdx && !graphState.isEditing) {
            graphState.isEditing = true;
            renderGraph();
        }
    }

    on(graphRoot, "mousedown", () => {
        setTimeout(() => {
            if (graphState.blockClick) {
                return;
            }

            graphState.currentSelectedNode = -1;
            graphState.isEditing = false;
            renderGraph();
        }, 1);
    });

    addDragHandlers(graphRoot, { 
        onDragStart, 
        onDragEnd, 
        onDrag(dx, dy) {
            onDrag(dx, dy);
            renderGraph();
        }
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

const cnGraphNodeDragRect = sg.makeClass("graphNodeDragRect", [
    ` { position: absolute; }`,
    `:hover { background-color: rgba(255, 0, 0, 0.5); cursor: crosshair; }`,
]);

function GraphNode() {
    const s = newState<{
        node: GraphNode;

        idx: number;
        graphState: GraphState;
        isEditing: boolean;
        isSelected: boolean;

        onSelect(idx: number): void;
        onClick(idx: number): void;
        startNewEdgeDrag(srcNodeIndex: number, srcX: number, srcY: number): void;
        finishNewEdgeDrag(dstNodeIndex: number, dstX: number, dstY: number): void;

        renderGraph(): void;
    }>();

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

    const dragRects = [
        div({ class: cnGraphNodeDragRect }),
        div({ class: cnGraphNodeDragRect }),
        div({ class: cnGraphNodeDragRect }),
        div({ class: cnGraphNodeDragRect }),
    ];

    const directions = [
        "top", "right", "bottom", "left"
    ] as const;
    const axes = [
        "height", "width", "height", "width"
    ] as const;

    function setDragRectDimensions() {
        const outsetWidth = 40;
        for(let i = 0; i < dragRects.length; i++) {
            const divEl = dragRects[i];
            setStyle(divEl, directions[i - 1] || "left", "-" + outsetWidth + "px");
            setStyle(divEl, directions[i] || "top", "-" + outsetWidth + "px");
            setStyle(divEl, directions[i + 1] || "top", "0");
            setStyle(divEl, axes[i], outsetWidth + "px");
        }
    }

    const rg = newRenderGroup();
    const root = div({
        style: "position: absolute; left: 50%; top: 50%; padding: 5px; border: 1px var(--fg-color) solid; "
    }, [
        div({ style: "position: relative;" }, [
            textArea,
            textDiv,
            ...dragRects,
        ]),
    ]);


    let lastText: string | undefined;
    let lastIsEditing = false;

    function render() {
        const { node, isSelected, isEditing, graphState: graphSate } = s.args;

        setDragRectDimensions();

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

        const xPos = (node.x + graphSate.viewX).toFixed();
        const yPos = (node.y + graphSate.viewY).toFixed();

        setStyle(root, "transform", `translate(${xPos}px, ${yPos}px)`);
        setStyle(root, "backgroundColor", isSelected ? "var(--bg-color-focus)" : "");
        setStyle(root, "zIndex", isSelected ? "1" : "0");
        setStyle(textDiv, "backgroundColor", isSelected ? "var(--bg-color-focus)" : "");
        setStyle(textArea, "backgroundColor", isSelected ? "var(--bg-color-focus)" : "");
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
        if (s.args.graphState.isDragging) {
            return;
        }

        // TODO: fix. it clicks instantly after it selects.  lmao.
        e.stopPropagation();

        if (s.args.graphState.blockClick) {
            s.args.graphState.blockClick = false;
            return;
        }

        s.args.onClick(s.args.idx);
    });

    root.el.addEventListener("mousedown", (e) => {
        const { idx, onSelect } = s.args;

        s.args.graphState.blockClick = true;
        onSelect(idx);
    });

    on(textArea, "input", () => {
        const { node } = s.args;
        node.text = textArea.el.value;
        updateTextAreaSize();
    });

    return newComponent(root, render, s);
}

function GraphEdge() {
    const s = newState<{
        edge: GraphEdge;
        srcNode: GraphNode;
        dstNode: GraphNode;
        graphState: GraphState;
    }>();

    const pathEl = elSvg("path", { style: "left: 50%; top: 50%" });
    const c = newComponent(pathEl, render, s);

    function render() {
        const { edge, srcNode, dstNode, graphState } = s.args;

        let x0 = srcNode.x + edge.srcX;
        let y0 = srcNode.y + edge.srcY;
        let x1 = dstNode.x + edge.dstX;
        let y1 = dstNode.y + edge.dstY;

        x0 = Math.floor(x0 + graphState.viewX);
        y0 = Math.floor(y0 + graphState.viewY);
        x1 = Math.floor(x1 + graphState.viewX);
        y1 = Math.floor(y1 + graphState.viewY);

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
        setStyle(pathEl, "fill", "none");
        setStyle(pathEl, "stroke", "var(--fg-color)");
        setStyle(pathEl, "strokeWidth", "2");
    }

    return c;
}
