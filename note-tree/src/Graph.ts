import { makeButton } from "./components";
import { Insertable, div, el, isVisible, newComponent, newRenderGroup, on, setInputValue, setStyle, setText, setVisible } from "./utils/dom-utils";

// NOTE: this is the data that will actually be serialized.
// UI vars should go into GraphNodeArgs
export type GraphNode = {
    text: string;
    x: number;
    y: number;
};

type GraphNodeArgs = {
    node: GraphNode;

    graphState: GraphState;
    idx: number;
    isEditing: boolean;
    isSelected: boolean;
    onSelect(idx: number): void;
    onClick(idx: number): void;
    renderGraph(): void;
}

type GraphState = {
    viewX: number;
    viewY: number;
    isDragging: boolean;
    blockClick: boolean;
}

export type GraphEdge = {};

// TODO: inject this
const graphNodes: GraphNode[] = [];

export function InteractiveGraph() {
    type Args = {
        onClose(): void;
    };

    const rg = newRenderGroup();
    const graphRoot = div({ 
        class: "flex-1 relative", 
        style: "border: 2px solid var(--fg-color); overflow: hidden; cursor: move;", 
    });
    const root = div({
        style: "width: 100%; height: 100%;",
        class: "col",
    }, [
        rg.list(graphRoot, GraphNode, (getNext) => {
            for (let i = 0; i < graphNodes.length; i++) {
                const c = getNext();
                if (!c.argsOrNull) {
                    c.render({
                        node: graphNodes[i],
                        idx: 0,
                        isEditing: false,
                        isSelected: false,
                        onSelect,
                        onClick,
                        graphState: graphState,
                        renderGraph: render,
                    })
                }

                c.args.node = graphNodes[i];
                c.args.isSelected = currentSelectedNode === i;
                c.args.isEditing = c.args.isSelected && isEditing;
                c.args.idx = i;
                c.args.graphState = graphState;

                c.render(c.args);
            }
        }),
        div({class: "row"}, [
            on(makeButton("Recenter"), "click", recenter),
            div({ class: "flex-1" }),
            on(makeButton("New node"), "click", addNewNode),
        ]),
    ]);

    let currentSelectedNode = -1;
    let isEditing = false;

    const graphState: GraphState = {
        viewX: 0,
        viewY: 0,
        isDragging: false,
        blockClick: false,
    };
    let viewDxStart = 0, viewDyStart = 0;

    const c = newComponent<Args>(root, render);

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

        render();
    }

    function addNewNode() {
        const { width, height } = graphRoot.el.getBoundingClientRect();
        graphNodes.push({ 
            text: "New node " + graphNodes.length, 
            x: 0,
            y: 0,
        });
        render();
    }

    function render() {
        rg.render();
    }

    on(graphRoot, "click", () => {
        currentSelectedNode = -1;
        isEditing = false;
        render();
    });

    function onDragStart() {
        graphState.blockClick = true;
        if (currentSelectedNode === -1) {
            viewDxStart = graphState.viewX;
            viewDyStart = graphState.viewY;
        } else {
            const currentNode = graphNodes[currentSelectedNode];
            viewDxStart = currentNode.x;
            viewDyStart = currentNode.y;
        }
    }

    addDragHandlers(graphRoot, {
        onDragStart,
        onDrag(dx, dy) {
            if (isEditing) {
                return;
            }

            if (currentSelectedNode === -1) {
                graphState.viewX = viewDxStart + dx;
                graphState.viewY = viewDyStart + dy;
            } else {
                const currentNode = graphNodes[currentSelectedNode];
                currentNode.x = viewDxStart + dx;
                currentNode.y = viewDyStart + dy;
            }
            render();
        },
        onDragEnd() {
        },
    });

    function onSelect(graphNodeIdx: number) {
        if (currentSelectedNode !== graphNodeIdx) {
            currentSelectedNode = graphNodeIdx;
            if (graphState.isDragging) {
                onDragStart();
            }
        }         
        render();
    }

    function onClick(graphNodeIdx: number) {
        if (currentSelectedNode === graphNodeIdx && !isEditing) {
            isEditing = true;
            render();
        }
    }

    document.addEventListener("keydown", (e) => {
        if (!isVisible(root)) {
            return;
        }

        let needsRender = true;

        if (e.key === "Enter" && !isEditing && currentSelectedNode !== -1) {
            isEditing = true;
        } else if (e.key === "Escape") {
            if (isEditing) {
                isEditing = false;
            } else if (currentSelectedNode !== -1) {
                currentSelectedNode = -1;
            } else {
                c.args.onClose();
            }
        } else {
            needsRender = false;
        }

        if (needsRender) {
            e.stopPropagation();
            e.preventDefault();
            render();
        }
    });

    setTimeout(() => {
        addNewNode();
    }, 1);

    return c;
}

function GraphNode() {
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

    const rg = newRenderGroup();
    const root = div({
        style: "position: absolute; padding: 5px; border: 1px var(--fg-color) solid; left: 50%; top: 50%;"
    }, [
        div({ style: "position: relative;" }, [
            textArea,
            textDiv,
        ]),
    ]);

    const c = newComponent<GraphNodeArgs>(root, render);

    let lastText: string | undefined;
    let lastIsEditing = false;

    function render() {
        const { node, isSelected, isEditing, graphState: graphSate } = c.args;

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
        setStyle(textDiv, "backgroundColor", isSelected ? "var(--bg-color-focus)" : "");
        setStyle(textArea, "backgroundColor", isSelected ? "var(--bg-color-focus)" : "");
    }

    function updateTextAreaSize() {
        // we need to fit to the text size both the width and height!

        const { node, isEditing } = c.args;
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

    on(root, "click", (e) => {
        // TODO: fix. it clicks instantly after it selects.  lmao.
        e.stopPropagation();

        if (c.args.graphState.blockClick) {
            c.args.graphState.blockClick = false;
            return;
        }

        c.args.onClick(c.args.idx);
    });

    on(root, "mousedown", (e) => {
        const { idx, onSelect, isSelected } = c.args;

        if (!isSelected) {
            c.args.graphState.blockClick = true;
            onSelect(idx);
        }
    });

    on(textArea, "input", () => {
        const { node } = c.args;
        node.text = textArea.el.value;
        updateTextAreaSize();
    });

    return c;
}

// The classic: https://www.w3schools.com/howto/howto_js_draggable.asp
// This is a little different.
function addDragHandlers(root: Insertable, {
    onDragStart,
    onDrag,
    onDragEnd,
}: {
    onDragStart(): void;
    onDragEnd(): void;
    onDrag(dx: number, dy: number): void;
}) {
    // NOTE: We don't actually care about the real position of the mouse, we only work in deltas.
    // (Because I couldn't actually find a way to get the pageX but relative the component)

    const dragState = {
        startX: 0,
        startY: 0,
        dragThreshold: 5,
        isDragging: false,
    };

    on(root, "mousedown", (e) => {
        e.stopImmediatePropagation();

        dragState.startX = e.pageX;
        dragState.startY = e.pageY;
    });

    on(root, "mousemove", (e) => {
        e.stopImmediatePropagation();

        const dx = e.pageX - dragState.startX;
        const dy = e.pageY - dragState.startY;


        if (Math.sqrt(dx*dx + dy*dy) > dragState.dragThreshold) {
            if (!dragState.isDragging) {
                dragState.isDragging = true;
                onDragStart();
            }
        }

        if (dragState.isDragging && e.buttons !== 0) {
            onDrag(dx, dy);
        }

        if (dragState.isDragging && e.buttons === 0) {
            dragState.isDragging = false;
            onDragEnd();
        }

    });

    on(root, "mouseup", (e) => {
        e.stopImmediatePropagation();

        if (e.buttons === 0) {
            dragState.isDragging = false;
            onDragEnd();
        }
    });

    return dragState;
}

