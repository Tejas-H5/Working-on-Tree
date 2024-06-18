import { makeButton } from "./components";
import { div, el, newComponent, newRenderGroup, on, setInputValue, setStyle } from "./utils/dom-utils";

export type GraphNode = {
    text: string;
    x: number;
    y: number;
};
export type GraphEdge = {};

// TODO: inject this
const graphNodes: GraphNode[] = [];

export function InteractiveGraph() {
    type Args = {
    };

    const rg = newRenderGroup();
    const graphRoot = div({ class: "flex-1 relative", style: "border: 2px solid var(--fg-color);", });
    const root = div({
        style: "width: 100%; height: 100%;",
        class: "col",
    }, [
        rg.list(graphRoot, GraphNode, (getNext) => {
            for (let i = 0; i < graphNodes.length; i++) {
                getNext().render({
                    node: graphNodes[i],
                });
            }
        }),
        div({}, [
            on(makeButton("New node"), "click", addNewNode),
        ])
    ]);

    const c = newComponent<Args>(root, render);

    function addNewNode() {
        const { width, height } = graphRoot.el.getBoundingClientRect();
        graphNodes.push({ 
            text: "New node " + graphNodes.length, 
            x: 100,
            y: 100,
        });
        render();
    }

    function render() {
        rg.render();
    }

    addNewNode();

    return c;
}

type GraphNodeArgs = {
    node: GraphNode;
}

function GraphNode() {
    const textArea = el<HTMLTextAreaElement>("TEXTAREA", { 
        class: "pre-wrap w-100 h-100", 
        spellcheck: "false",
        style: "border: 1px var(--fg-color) solid; padding: 5px;" 
    });

    const rg = newRenderGroup();
    const root = div({
        style: "position: absolute; min-width: 50px; max-width: 500px;"
    }, [
        textArea
    ]);

    const c = newComponent<GraphNodeArgs>(root, render);

    let lastText: string | undefined;

    function render() {
        const { node } = c.args;

        rg.render();

        if (lastText !== node.text) {
            console.log("Updated da text!!!!!");
            lastText = node.text;

            setInputValue(textArea, node.text);
            setTimeout(() => {
                updateTextAreaSize();
            }, 1);
        }

        setStyle(root, "transform", `translate(${node.x}px, ${node.y}px)`);
    }

    function updateTextAreaSize() {
        // we need to fit to the text size both the width and height!

        const { node } = c.args;
        lastText = node.text;

        textArea.el.style.width = "0";
        // these are our 'handle-long-words' styles.
        // it don't work though, so I've commented it out
        // textArea.el.style.whiteSpace = "";
        // textArea.el.style.overflowWrap = "anywhere";
        textArea.el.style.whiteSpace = "pre";
        // was getting some false wrapping happening when using exact width, so now I've aded this + 5 and it seems to be working nicer
        textArea.el.style.width = Math.max(30, Math.min(500, textArea.el.scrollWidth + 5)) + "px";
        textArea.el.style.whiteSpace = "pre-wrap";
        textArea.el.style.height = "0";
        textArea.el.style.height = textArea.el.scrollHeight + "px";
    }

    on(textArea, "input", () => {
        const { node } = c.args;
        node.text = textArea.el.value;
        updateTextAreaSize();
    });

    return c;
}



