import { boundsCheck } from "./array-utils";
import { copyToClipboard, readFromClipboard } from "./clipboard";
import { Renderable, div, el, isVisible, makeComponent, makeComponentList, replaceChildren, setClass, setStyle, setTextContent, setVisible } from "./dom-utils";
import { makeButton } from "./generic-components";

type CanvasArgs = {
    width: number;
    height: number;
    onChange(): void;
};

type MouseInputState = {
    lbDown: boolean;
    x: number;
    y: number;

    _lbWasDown: boolean;
    _prevX: number;
    _prevY: number;
}

type KeyboardInputState = {
    isShiftPressed: boolean;
    isCtrlPressed: boolean;
    key: string;
}

type CanvasState = {
    mouseInputState: MouseInputState;
    keyboardInputState: KeyboardInputState;
    rows: RowArgs[];
    currentTool: ToolType;

    layers: Layer[];
    currentLayer: number;
};

type ToolType = "freeform-select" | 
    "line-select" |
    "rect-outline-select" |
    "rect-select" |
    "fill-select" |
    "fill-select-outline" |
    "move-selection";

type RowArgs = {
    charList: CanvasCellArgs[];
};

type CanvasCellArgs = {
    // CSS borders - bl = border left, etc. It was a pain to type...
    bl: boolean;
    br: boolean;
    bt: boolean;
    bb: boolean;

    j: number;
    i: number;

    canvasState: CanvasState;
    isSelected: boolean;
    isSelectedPreview: boolean;
    // like isSelectedPreview, but not shown on the ui. so we can use it like a scratch buffer almost
    isSelectedTemp: boolean;

    // Used for recursive propagations where we want to avoid re-visiting a coordinate
    isVisited: boolean;
};

type Layer = {
    data: string[][];
    iOffset: number;
    jOffset: number;
}

function newLayer(): Layer {
    return {
        data: [],
        iOffset: 0,
        jOffset: 0,
    }
}

function resizeLayers(canvas: CanvasState, rows: number, cols: number) {
    for (let layerIdx = 0; layerIdx < canvas.layers.length; layerIdx++) {
        const data = canvas.layers[layerIdx].data;

        while(data.length < rows) {
            data.push(Array(cols).fill(" "));
        }
        while(data.length > rows) {
            data.pop();
        }

        for (let i = 0; i < data.length; i++) {
            const rows = data[i];

            while(rows.length < cols) {
                rows.push(" ");
            }
            while(rows.length > cols) {
                rows.pop();
            }
        }
    }
}

// This gets the cell for the corresponding coordinate on a layer, taking the layer offset into account
function getCellForLayer(canvas: CanvasState, i: number, j: number, layer: number): CanvasCellArgs | undefined {
    const iFinal =  i - canvas.layers[layer].iOffset;
    const jFinal =  j - canvas.layers[layer].jOffset;
    return getCell(canvas, iFinal, jFinal);
}

function getCharOnLayer(canvas: CanvasState, i: number, j: number, layer: number): string {
    const iFinal =  i - canvas.layers[layer].iOffset;
    const jFinal =  j - canvas.layers[layer].jOffset;
    if (
        boundsCheck(canvas.layers[layer].data, iFinal) && 
        boundsCheck(canvas.layers[layer].data[iFinal], jFinal)
    ) {
        return canvas.layers[layer].data[iFinal][jFinal] || " ";
    }

    return ' ';
}

function setCharOnLayer(canvas: CanvasState, i: number, j: number, char: string, layer: number, useOffsets = true) {
    const iFinal =  !useOffsets ? i : i - canvas.layers[layer].iOffset;
    const jFinal =  !useOffsets ? j : j - canvas.layers[layer].jOffset;
    if (
        boundsCheck(canvas.layers[layer].data, iFinal) && 
        boundsCheck(canvas.layers[layer].data[iFinal], jFinal)
    ) {
        canvas.layers[layer].data[iFinal][jFinal] = char;
        return;
    } 
}


// this currently deletes everything from the dst layer
function moveSelectedCellDataToLayer(canvas: CanvasState, layerSrc: number, layerDst: number) {
    forEachCell(canvas, (c) => {
        // Use the correct offset
        const cellSrc = getCellForLayer(canvas, c.i, c.j, layerSrc);
        if (!cellSrc?.isSelected) {
            return;
        }

        const char = getCharOnLayer(canvas, c.i, c.j, layerSrc);
        setCharOnLayer(canvas, c.i, c.j, ' ', layerSrc);
        setCharOnLayer(canvas, c.i, c.j, char, layerDst);
    });
}

function getCharOnCurrentLayer(canvas: CanvasState, i: number, j: number): string {
    return getCharOnLayer(canvas, i, j, canvas.currentLayer);
}

function setCharOnCurrentLayer(canvas: CanvasState, i: number, j: number, char: string) {
    setCharOnLayer(canvas, i, j, char, canvas.currentLayer);
}

function getTempLayer(canvas: CanvasState): Layer {
    return canvas.layers[getTempLayerIdx(canvas)];
}

function getCurrentLayer(canvas: CanvasState): Layer {
    return canvas.layers[canvas.currentLayer];
}

function getTempLayerIdx(canvas: CanvasState): number {
    return canvas.layers.length - 1;
}

// Returns the char, and the layer we pulled it from...
function getChar(canvas: CanvasState, i: number, j: number): [string, number] {
    for (let layerIdx = canvas.layers.length - 1; layerIdx >= 0; layerIdx--) {
        const char = getCharOnLayer(canvas, i, j, layerIdx);
        if (char.trim()) {
            return [char, layerIdx];
        }
    }

    return [' ', 0];
}

function forEachCell(canvas: CanvasState, fn: (char: CanvasCellArgs) => void) {
    for (let i = 0; i < canvas.rows.length; i++) {
        for (let j = 0; j < canvas.rows[i].charList.length; j++) {
            fn(getCell(canvas, i, j));
        }
    }
}

function getCell(canvas: CanvasState, i: number, j: number): CanvasCellArgs {
    return canvas.rows[i]?.charList[j];
}

function getNumCols(canvas: CanvasState) {
    return canvas.rows[0].charList.length;
}

function getNumRows(canvas: CanvasState) {
    return canvas.rows.length;
}

function lerp(a: number, b: number, t: number) : number {
    return a + (b - a) * t;
}

function getCanvasSelectionAsString(canvas: CanvasState) {
    let minX = getNumCols(canvas);
    let maxX = 0;
    let minY = getNumRows(canvas);
    let maxY = 0;

    forEachCell(canvas, (c) => {
        if (c.isSelected) {
            minX = Math.min(c.j, minX);
            maxX = Math.max(c.j, maxX);
            minY = Math.min(c.i, minY);
            maxY = Math.max(c.i, maxY);
        }
    });

    if (minX > maxX || minY > maxY) {
        minX = 0; 
        maxX = getNumCols(canvas);
        minY = 0; 
        maxY = getNumRows(canvas);
    }

    let stringBuilder = [];
    for(let i = minY; i <= maxY; i++) {
        for(let j = minX; j < maxX; j++) {
            const cell = getCell(canvas, i, j);
            if (cell.isSelected) {
                const [char] = getChar(canvas, i, j);
                stringBuilder.push(char);
            } else {
                stringBuilder.push(' ');
            }
        }

        // Remove trailing whitespace. its annoying
        while (stringBuilder[stringBuilder.length - 1] === ' ') {
            stringBuilder.pop();
        }

        stringBuilder.push('\n');
    }

    return stringBuilder.join("");
}

// Returns the selected cell, if only 1 cell is selected
function getTextInputCursorCell(canvas: CanvasState) {
    let cell: CanvasCellArgs | undefined;
    let found = false;
    for (let i = 0; i < getNumRows(canvas); i++) {
        for (let j = 0; j < getNumCols(canvas); j++) {
            const cellIJ = getCell(canvas, i, j);

            if (found && cellIJ.isSelected) {
                // multiple selected cells. we shouldn't be typing
                return undefined;
            }

            if (!found && cellIJ.isSelected) {
                found = true;
                cell = cellIJ;
            }
        }
    }

    return cell;
}

function Canvas() {
    const root = div({ style: "overflow: auto; padding-top: 10px; padding-bottom: 10px; white-space: nowrap;"});

    const rowList = makeComponentList(root, () => {
        const root = div({ style: "text-align: center" });
        const charList = makeComponentList(root, () => {
            const root = el("SPAN", { class: "pre", style: "font-size: 24px; width: 1ch; height: 1ch;user-select: none; cursor: crosshair;" });

            // Memoizing for peformance. 
            let lastState = -1;
            let blLast = false; 
            let brLast = false;
            let btLast = false;
            let bbLast = false;
            let lastChar = "";

            const component = makeComponent<CanvasCellArgs>(root, () => {
                const { canvasState, j, i, bl, br, bt, bb, isSelectedPreview: isSelectedTemp, } = component.args;


                const [char, layerIdx] = getChar(canvasState, i, j);
                const cell = getCellForLayer(canvasState, i, j, layerIdx);
                let isSelected = cell?.isSelected || component.args.isSelected;

                if (lastChar !== char) {
                    lastChar = char;
                    setTextContent(root, char);
                }

                if (blLast !== bl) {
                    blLast = bl;
                    setStyle(root, "borderLeft", !bl ? "": "1px solid var(--fg-color)");
                }
                if (brLast !== br) {
                    brLast = br;
                    setStyle(root, "borderRight", !br ? "": "1px solid var(--fg-color)");
                }
                if (btLast !== bt) {
                    btLast = bt;
                    setStyle(root, "borderTop", !bt ? "": "1px solid var(--fg-color)");
                }
                if (bbLast !== bb) {
                    bbLast = bb;
                    setStyle(root, "borderBottom", !bb ? "": "1px solid var(--fg-color)");
                }

                let state = 0;
                if (isSelectedTemp) {
                    state = 1;
                } else if (isSelected) {
                    state = 2;
                } else if (
                    j === canvasState.mouseInputState.x && 
                    i === canvasState.mouseInputState.y
                ) {
                    state = 3;
                }

                if (state !== lastState) {
                    lastState = state;
                    setStyle(
                        root, 
                        "backgroundColor",  
                        state === 1 ? "#0FF" :
                            state === 2 ? "#888" :
                            state === 3 ? "var(--bg-color-focus)" :
                            ""
                    );
                }
            });

            function handleMouseMovement() {
                const mouseInputState = component.args.canvasState.mouseInputState;
                mouseInputState.x = component.args.j;
                mouseInputState.y = component.args.i;

                onMouseInputStateChange();
            }

            root.el.addEventListener("mousemove", handleMouseMovement);

            return component;
        });

        const component = makeComponent<RowArgs>(root, () => {
            const { charList: rowList } = component.args;

            charList.render(() => {
                for (let i = 0; i < rowList.length; i++) {
                    const c = charList.getNext();
                    c.render(rowList[i], true);
                }
            }, true);
        });

        component.el.addEventListener("mouseleave", () => {
            canvasState.mouseInputState.x = -1;
            canvasState.mouseInputState.y = -1;
            onMouseInputStateChange();
        });

        return component;
    });

    const rows: RowArgs[] = [];

    const toolState: {
        typingStartX: number;
        selectionStartX: number;
        selectionStartY: number;
        startedAction: ToolType | undefined;
    } = {
        typingStartX: 0,
        selectionStartX: 0,
        selectionStartY: 0,
        startedAction: undefined,
    };

    function clearSelectionPreview() {
        forEachCell(canvasState, (c) => c.isSelectedPreview = false);
    }

    function selectLine(x1: number, y1: number, x2: number, y2: number) {
        const dirX = x2 - x1;
        const dirY = y2 - y1;

        const mag = Math.sqrt(dirX*dirX + dirY*dirY);

        for (let i = 0; i < mag + 2; i++) {
            const x = Math.round(lerp(x1, x2, i / (mag + 1)));
            const y = Math.round(lerp(y1, y2, i / (mag + 1)));
            rows[y].charList[x].isSelectedPreview = true;
        }
    }

    // NOTE: keepOutlineOnly not quite working as intended yet :(
    function propagateSelection(x: number, y: number, corners: boolean, keepOutlineOnly: boolean) {
        clearSelectionPreview();
        forEachCell(canvasState, (c) => c.isVisited = false);

        // propagate out a selection using a breadth-first approach
        type Coord = [number, number, number, number];
        const queue: Coord[] = [[y, x, y, x]];
        let coords: Coord | undefined;
        let fillChar: string | undefined;
        while(coords = queue.pop()) {
            const [i, j, iPrev, jPrev] = coords;

            const cell = getCell(canvasState, i, j);
            if (!cell || cell.isVisited) {
                if (keepOutlineOnly) {
                    getCell(canvasState, iPrev, jPrev).isSelectedPreview = true;
                }
                continue;
            }
            cell.isVisited = true;

            const cellChar = getCharOnCurrentLayer(canvasState, i, j);;
            if (!fillChar) {
                fillChar = cellChar;
            } else if (cellChar !== fillChar) {
                continue;
            }

            if (!keepOutlineOnly) {
                cell.isSelectedPreview = true;
            }

            queue.push([i - 1, j, i, j])
            queue.push([i + 1, j, i, j])
            queue.push([i, j + 1, i, j])
            queue.push([i, j - 1, i, j])

            if (corners) {
                queue.push([i - 1, j - 1, i, j])
                queue.push([i + 1, j + 1, i, j])
                queue.push([i - 1, j + 1, i, j])
                queue.push([i + 1, j - 1, i, j])
            }
        }
    }

    function applyCurrentAction(cancel: boolean = false) {
        const startedAction = toolState.startedAction;
        toolState.startedAction = undefined;
        if (!startedAction) {
            return;
        }

        if (startedAction === "move-selection") {
            // apply the move we started

            const tempLayer = getTempLayer(canvasState);
            if (cancel) {
                tempLayer.iOffset = 0;
                tempLayer.jOffset = 0;
            }

            moveSelectedCellDataToLayer(canvasState, getTempLayerIdx(canvasState), canvasState.currentLayer);

            // move the selection after.
            {
                forEachCell(canvasState, (c) => c.isSelectedTemp = false);
                forEachCell(canvasState, (c) => {
                    const cell = getCellForLayer(canvasState, c.i, c.j, getTempLayerIdx(canvasState));
                    if (!cell) {
                        return;
                    }

                    c.isSelectedTemp = cell.isSelected;
                });
                forEachCell(canvasState, (c) => c.isSelected = c.isSelectedTemp);
            }


            // clear the temp buffer
            const useOffsets = false;
            forEachCell(canvasState, (c) => setCharOnLayer(canvasState, c.i, c.j, ' ', getTempLayerIdx(canvasState), useOffsets));

            return;
        } 

        if (
            startedAction === "freeform-select" ||
            startedAction === "line-select" ||
            startedAction === "rect-outline-select" ||
            startedAction === "rect-select" ||
            startedAction === "fill-select" ||
            startedAction === "fill-select-outline"
        ) {
            if (!cancel) {
                // Apply our selection preview.
                
                if (canvasState.keyboardInputState.isShiftPressed) {
                    forEachCell(canvasState, (c) => {
                        // subtractive selection
                        if (c.isSelectedPreview) {
                            c.isSelected = false;
                        }
                    });
                } else if (canvasState.keyboardInputState.isCtrlPressed) {
                    forEachCell(canvasState, (c) => {
                        // additive selection
                        c.isSelected = c.isSelected || c.isSelectedPreview;
                    });
                } else {
                    forEachCell(canvasState, (c) => {
                        // replace selection
                        c.isSelected = c.isSelectedPreview;
                    });
                }
            }

            forEachCell(canvasState, (c) => c.isSelectedPreview = false);

            return;
        }
    }


    function onMouseInputStateChange() {
        if (mouseInputState.x === -1 || mouseInputState.y === -1) {
            return;
        }

        const tool = canvasState.currentTool;
        let released = mouseInputState._lbWasDown && !mouseInputState.lbDown;
        let clicked = !mouseInputState._lbWasDown && mouseInputState.lbDown;

        if (released) {
            const cancel = false;
            applyCurrentAction(cancel);
        } else if (clicked) { 
            clicked = true;
            mouseInputState._prevX = mouseInputState.x;
            mouseInputState._prevY = mouseInputState.y;
        };


        if (mouseInputState.lbDown) {
            if (clicked) {
                toolState.selectionStartX = mouseInputState.x;
                toolState.selectionStartY = mouseInputState.y;
                toolState.startedAction = tool;
            }

            if (tool === "freeform-select") {
                selectLine(mouseInputState._prevX, mouseInputState._prevY, mouseInputState.x, mouseInputState.y);
            } else if (tool === "line-select") {
                clearSelectionPreview();
                selectLine(toolState.selectionStartX, toolState.selectionStartY, mouseInputState.x, mouseInputState.y);
            } else if (tool === "rect-outline-select") {
                clearSelectionPreview();
                selectLine(toolState.selectionStartX, toolState.selectionStartY, mouseInputState.x, toolState.selectionStartY);
                selectLine(toolState.selectionStartX, toolState.selectionStartY, toolState.selectionStartX, mouseInputState.y);
                selectLine(mouseInputState.x, toolState.selectionStartY, mouseInputState.x, mouseInputState.y);
                selectLine(toolState.selectionStartX, mouseInputState.y, mouseInputState.x, mouseInputState.y);
            } else if (tool === "rect-select") {
                clearSelectionPreview();
                let minX = Math.min(toolState.selectionStartX, mouseInputState.x);
                let maxX = Math.max(toolState.selectionStartX, mouseInputState.x);
                let minY = Math.min(toolState.selectionStartY, mouseInputState.y);
                let maxY = Math.max(toolState.selectionStartY, mouseInputState.y);
                for (let i = minY; i <= maxY; i++) {
                    for (let j = minX; j <= maxX; j++) {
                        getCell(canvasState, i, j).isSelectedPreview = true;
                    }
                }
            } else if (tool === "fill-select") {
                if (clicked) {
                    const keepOutlineOnly = false;
                    const corners = false;
                    propagateSelection(mouseInputState.x, mouseInputState.y, corners, keepOutlineOnly);
                }
            } else if (tool === "fill-select-outline") {
                if (clicked) {
                    // I want mouseInputState.to just select the fringe of the propagation, but it isn't working :(
                    const keepOutlineOnly = true;
                    const corners = true;
                    propagateSelection(mouseInputState.x, mouseInputState.y, corners, keepOutlineOnly);
                }
            } else if (tool === "move-selection") {
                const tempLayer = getTempLayer(canvasState);
                if (clicked) {
                    tempLayer.iOffset = 0;
                    tempLayer.jOffset = 0;
                    moveSelectedCellDataToLayer(canvasState, canvasState.currentLayer, getTempLayerIdx(canvasState));
                }


                tempLayer.iOffset = mouseInputState.y - toolState.selectionStartY;
                tempLayer.jOffset = mouseInputState.x - toolState.selectionStartX;
            }

            if (clicked && getTextInputCursorCell(canvasState)) {
                toolState.typingStartX = toolState.selectionStartX;
            }
        }

        mouseInputState._prevX = mouseInputState.x;
        mouseInputState._prevY = mouseInputState.y;
        mouseInputState._lbWasDown = mouseInputState.lbDown;

        component.args.onChange();
    }

    const mouseInputState: MouseInputState = {
        x: 0, y: 0,
        lbDown: false,
        _lbWasDown: false,
        _prevX: 0, _prevY: 0,
    };

    const keyboardInputState: KeyboardInputState = {
        isCtrlPressed: false,
        isShiftPressed: false,
        key: "",
    }

    const canvasState: CanvasState = {
        mouseInputState,
        keyboardInputState,
        rows,
        currentTool: "freeform-select",

        layers: [
            // main layer. right now it's the only layer
            newLayer(),
            // temp layer. used for moving things around, etc
            newLayer(),
        ],
        currentLayer: 0,
    };

    const component = makeComponent<CanvasArgs>(root, () => {
        const { height, width } = component.args;

        resizeLayers(canvasState, height, width);

        // Maintain row/col pool
        // NOTE: The rowList and charList are already doing a similar pooling mechanism.
        // Should this data just be created within there itself? For now I have decided "no" but I might change my mind on this one...
        while(rows.length < height) {
            rows.push({ charList: [] });
        }
        while(rows.length > height) {
            rows.pop();
        }

        for (let i = 0; i < rows.length; i++) {
            const chars = rows[i].charList;

            while(chars.length < width) {
                chars.push({ 
                    br: false, bl: false, bb: false, bt: false,

                    j: chars.length,
                    i: i,

                    isSelected: false,
                    isSelectedTemp: false,
                    isSelectedPreview: false,
                    isVisited: false,

                    canvasState,
                });
            }
            while(chars.length > width) {
                chars.pop();
            }
        }

        for (let i = 0; i < width; i++) {
            for (let j = 0; j < height; j++) {
                getCell(canvasState, i, j)
                rows[j].charList[i].bt = j === 0;
                rows[j].charList[i].bb = j === height - 1;
                rows[j].charList[i].bl = i === 0;
                rows[j].charList[i].br = i === width - 1;
            }
        }

        rowList.render(() => {
            for (let i = 0; i < rows.length; i++) {
                rowList.getNext().render(rows[i], true);
            }
        }, true);
    });

    document.addEventListener("mousedown", () => {
        if (!isVisible(component)) {
            return;
        }

        const mouseInputState = canvasState.mouseInputState;
        mouseInputState.lbDown = true;
        onMouseInputStateChange();
    });

    document.addEventListener("mouseup", () => {
        if (!isVisible(component)) {
            return;
        }

        const mouseInputState = canvasState.mouseInputState;
        mouseInputState.lbDown = false;
        onMouseInputStateChange();
    });

    document.addEventListener("keyup", (e) => {
        if (!isVisible(component)) {
            return;
        }

        keyboardInputState.key = "";

        if (e.key === "Shift") {
            keyboardInputState.isShiftPressed = false;
        } else if (e.key === "Control") {
            keyboardInputState.isCtrlPressed = false;
        }

        component.args.onChange();
    });

    function handleKeyDown(e: KeyboardEvent) {
        // used to be x,y hence the strange order
        // retuns the next cell
        function moveCursor(cursor: CanvasCellArgs, j: number, i: number, resetX = false): CanvasCellArgs {
            const nextCursor = getCell(canvasState, i, j);
            if (!nextCursor) {
                return cursor;
            }

            cursor.isSelected = false;
            nextCursor.isSelected = true;

            if (resetX || j < toolState.typingStartX) {
                toolState.typingStartX = j;
            }

            return nextCursor;
        }

        if (e.key === "Shift") {
            keyboardInputState.isShiftPressed = true;
            return;
        } else if (e.key === "Control") {
            keyboardInputState.isCtrlPressed = true;
            return;
        }

        if (e.key === "Escape") {
            const cancel = true;

            if (toolState.startedAction) {
                e.stopImmediatePropagation();
                applyCurrentAction(cancel);
                return;
            }
        }

        keyboardInputState.key = e.key;

        if (isAsciiCanvasKeybind(e)) {
            // The parent AsciiCanvas component wants to handle this event
            return;
        }

        const key = e.key;
        let len = 0;
        // iterating 1 code point at a time
        for (const _c of key) {
            len++;
            if (len > 1) {
                break;
            }
        }
 
        const cursorCell = getTextInputCursorCell(canvasState);
        if (cursorCell) {
            // Start typing, with the singular selected cursorCell being the cursor

            function newLine(cursorCell: CanvasCellArgs) {
                moveCursor(cursorCell, toolState.typingStartX, cursorCell.i + 1);
            }

            function atLineStart(cursorCell: CanvasCellArgs) {
                return cursorCell.j <= toolState.typingStartX;
            }

            function backspace(cursorCell: CanvasCellArgs): boolean {
                // NOTE: Might introduce a 'layer' system that really backspaces text rather than overwriting the cell wtih ' '
                
                if (atLineStart(cursorCell)) {
                    return false;
                }

                const nextCursor = moveCursor(cursorCell, cursorCell.j - 1, cursorCell.i);
                if (nextCursor === cursorCell) {
                    return false;
                }

                const char = getCharOnCurrentLayer(canvasState, nextCursor.i, nextCursor.j);
                if (char === ' ') {
                    return false;
                }

                setCharOnCurrentLayer(canvasState, nextCursor.i, nextCursor.j, ' ');
                return true;
            }

            if (e.key === "ArrowUp" && cursorCell.i > 0) {
                moveCursor(cursorCell, cursorCell.j, cursorCell.i - 1);
            } else if (e.key === "ArrowDown") {
                moveCursor(cursorCell, cursorCell.j, cursorCell.i + 1);
            } else if (e.key === "ArrowLeft") {
                moveCursor(cursorCell, cursorCell.j - 1, cursorCell.i);
            } else if (e.key === "ArrowRight") {
                moveCursor(cursorCell, cursorCell.j + 1, cursorCell.i);
            } else if (e.key === "Enter") {
                newLine(cursorCell);
            } else if (e.key === "Backspace") {
                if (e.ctrlKey || e.metaKey) {
                    while(backspace(cursorCell)) {}
                } else {
                    backspace(cursorCell);
                }
            } else {
                if (len !== 1) {
                    return;
                }

                setCharOnCurrentLayer(canvasState, cursorCell.i, cursorCell.j, key);

                if (cursorCell.j === getNumCols(canvasState) - 1) {
                    newLine(cursorCell);
                } else {
                    moveCursor(cursorCell, cursorCell.j + 1, cursorCell.i);
                }
            }
        } else {
            // Just overwrite every cell with what was typed

            if (len !== 1) {
                return;
            }

            forEachCell(canvasState, (char) => {
                if (char.isSelected) {
                    setCharOnCurrentLayer(canvasState, char.i, char.j, key);
                }
            });
        }

        e.preventDefault();
    }

    document.addEventListener("keydown", (e) => {
        if (!isVisible(component)) {
            return;
        }

        handleKeyDown(e);

        component.args.onChange();
    });


    return {
        ...component,
        canvasState,
    };
}

function isAsciiCanvasKeybind(e: KeyboardEvent) {
    const ctrlPressed = e.ctrlKey || e.metaKey;
    return (
        (ctrlPressed && (e.key === "E" || e.key === "e")) ||
        (ctrlPressed && (e.key === "Q" || e.key === "q")) ||
        (ctrlPressed && (e.key === "C" || e.key === "c")) ||
        (ctrlPressed && (e.key === "V" || e.key === "v")) 
    );
}

export function AsciiCanvas(): Renderable {
    type ToolbarButtonArgs = {
        name: string;
        onClick(e: MouseEvent): void;
        tool?: ToolType;
        selected?: boolean;
    };

    function changeTool(tool?: ToolType) {
        if (!tool) {
            return;
        }

        canvas.canvasState.currentTool = tool;
        rerenderLocal();
    }

    // NOTE: This component is tightly coupled to AsciiCanvas, and shouldn't be moved out
    function ToolbarButton(): Renderable<ToolbarButtonArgs> {
        const textEl = div();
        const button = makeButton("");
        replaceChildren(button, [
            textEl, 
        ]);

        const c = makeComponent<ToolbarButtonArgs>(button, () => {
            setTextContent(button, c.args.name);

            if (c.args.tool || c.args.selected !== undefined) {
                setClass(button, "inverted", c.args.selected || canvas.canvasState.currentTool === c.args.tool);
            }
        });

        button.el.addEventListener("click", (e) => { 
            const { onClick, tool } = c.args;

            if (tool) {
                changeTool(tool);
            }

            onClick(e);
        });

        return c;
    }

    const canvas = Canvas();
    const buttons = {
        moreRows: ToolbarButton(),
        lessRows: ToolbarButton(),
        moreCols: ToolbarButton(),
        lessCols: ToolbarButton(),
        freeformSelect: ToolbarButton(),
        lineSelect: ToolbarButton(),
        rectOutlineSelect: ToolbarButton(),
        rectSelect: ToolbarButton(),
        bucketFillSelect: ToolbarButton(),
        bucketFillSelectOutline: ToolbarButton(),
        moveSelection: ToolbarButton(),
        clearSelection: ToolbarButton(),
        invertSelection: ToolbarButton(),
        copyToClipboard: ToolbarButton(),
        pasteFromClipboard: ToolbarButton(),
    };

    const mouseScrollList = [
        buttons.freeformSelect,
        buttons.lineSelect,
        buttons.rectOutlineSelect,
        buttons.rectSelect,
        buttons.bucketFillSelect,
        buttons.bucketFillSelectOutline,
        buttons.moveSelection,
    ];

    const statusText = div({ style: "text-align: center" });
    let sidebar;
    const root = div({ class: "relative h-100 row" }, [
        div({ class: "flex-1 col justify-content-center", style: "overflow: auto;" }, [
            canvas,
            statusText,
        ]),
        div({ style: "width: 20px" }),
        sidebar = div({ class: "col", style: "justify-content: center; gap: 5px;" }, [
            buttons.moreRows,
            buttons.lessRows,
            buttons.moreCols,
            buttons.lessCols,
            div({ style: "height: 20px" }),
            ...mouseScrollList,
            div({ style: "height: 20px" }),
            buttons.clearSelection,
            buttons.invertSelection,
            div({ style: "height: 20px" }),
            buttons.copyToClipboard,
            buttons.pasteFromClipboard,
        ]),
    ]);

    function rerenderLocal() {
        component.render(component.args);
    }

    function updateCanvasStausText(canvas: CanvasState) {
        const stringBuilder = [
            `${canvas.mouseInputState.x}, ${canvas.mouseInputState.y}`
        ];

        let selCount = 0;
        let selPreviewCount = 0;
        forEachCell(canvas, (char) => {
            if (char.isSelected) {
                selCount++;
            }
            if (char.isSelectedPreview) {
                selPreviewCount++;
            }
        });

        if (selCount > 0) {
            stringBuilder.push(selCount + " selected");
        }
        
        if (selPreviewCount > 0) {
            stringBuilder.push(
                (
                    canvas.keyboardInputState.isCtrlPressed ? "adding " : 
                    canvas.keyboardInputState.isShiftPressed ? "subtracting " : 
                    "replacing "
                ) + 
                selPreviewCount 
            );
        }

        setTextContent(statusText, stringBuilder.join(" | "));
    }

    // INFO: Some discussion about the initial canvas size
    // I want the canvas to be like a diagram board, where I append a slab of vertical rows to the page 
    // Whenever I need a new page. 1 page with is approximately the width of the screen, and same for page height and 1 scren height.
    // However, I don't expect the width I need to change very much at all. 

    const NUM_ROWS_INCR_AMOUNT = 30;
    const NUM_COLUMNS_INCR_AMOUNT = 5;
    const canvasArgs : CanvasArgs = {
        width: 100,
        height: NUM_ROWS_INCR_AMOUNT,
        onChange: rerenderLocal,
    };

    function copyCanvasToClipboard() {
        const text = getCanvasSelectionAsString(canvas.canvasState);
        copyToClipboard(text);
    }

    async function pasteClipboardToCanvas(row: number, col: number, whitespaceIsTransparent: boolean) {
        const text = await readFromClipboard();
        if (!text || typeof text !== "string") {
            console.log("failed to read from clipboard - ", text);
            return;
        }

        text.replace(/\r/g, "");
        const lines = text.split("\n");

        const numRows = getNumRows(canvas.canvasState);
        const numCols = getNumCols(canvas.canvasState);
        outer: for (let i = 0; i < lines.length; i++) {
            for (let j = 0; j < lines[i].length; j++) {
                let canvasRow = row + i;
                let canvasCol = col + j;

                if (canvasRow >= numRows) {
                    break outer;
                }

                if (canvasCol >= numCols) {
                    break;
                }

                if (whitespaceIsTransparent && lines[i][j].trim() === "") {
                    continue;
                }

                setCharOnCurrentLayer(canvas.canvasState, canvasRow, canvasCol, lines[i][j]);
            }
        }
    }

    const component = makeComponent(root, () => {
        canvas.render(canvasArgs);

        buttons.moreRows.render({
            name: "More rows",
            onClick: () => {
                canvasArgs.height += NUM_ROWS_INCR_AMOUNT;
                rerenderLocal();
            },
        });

        buttons.lessRows.render({
            name: "Less rows",
            onClick: () => {
                canvasArgs.height -= NUM_ROWS_INCR_AMOUNT;
                rerenderLocal();
            },
        });

        buttons.moreCols.render({
            name: "More columns",
            onClick: () => {
                canvasArgs.width += NUM_COLUMNS_INCR_AMOUNT;
                rerenderLocal();
            },
        });

        buttons.lessCols.render({
            name: "Less columns",
            onClick: () => {
                canvasArgs.width -= NUM_COLUMNS_INCR_AMOUNT;
                rerenderLocal();
            },
        });


        buttons.freeformSelect.render({
            name: "Free Select",
            onClick: rerenderLocal,
            tool: "freeform-select",
        });

        buttons.lineSelect.render({
            name: "Line Select",
            onClick: rerenderLocal,
            tool: "line-select",
        });

        buttons.rectSelect.render({
            name: "Rect Select",
            onClick: rerenderLocal,
            tool: "rect-select",
        });
        
        buttons.rectOutlineSelect.render({
            name: "Rect Outline Select",
            onClick: rerenderLocal,
            tool: "rect-outline-select",
        });

        buttons.bucketFillSelect.render({
            name: "Fill Select",
            onClick: rerenderLocal,
            tool: "fill-select",
        });
        
        buttons.bucketFillSelectOutline.render({
            name: "Fill Select Outline",
            onClick: rerenderLocal,
            tool: "fill-select-outline",
        });

        buttons.moveSelection.render({
            name: "Move Selection",
            onClick: rerenderLocal,
            tool: "move-selection",
        });

        buttons.clearSelection.render({
            name: "Clear Selection",
            onClick: () => {
                forEachCell(canvas.canvasState, (c) => c.isSelected = false);
                rerenderLocal();
            },
        });

        buttons.invertSelection.render({
            name: "Invert Selection",
            onClick: () => {
                forEachCell(canvas.canvasState, (c) => c.isSelected = !c.isSelected);
                rerenderLocal();
            },
        });

        buttons.copyToClipboard.render({
            name: "Copy",
            onClick: copyCanvasToClipboard,
            selected: canvas.canvasState.keyboardInputState.isCtrlPressed && (
                canvas.canvasState.keyboardInputState.key === "c" || 
                canvas.canvasState.keyboardInputState.key === "C"
            )
        });

        const canPaste = !!getTextInputCursorCell(canvas.canvasState);
        if (setVisible(buttons.pasteFromClipboard, canPaste)) {
            buttons.pasteFromClipboard.render({
                name: "Paste",
                onClick: copyCanvasToClipboard,
                selected: canvas.canvasState.keyboardInputState.isCtrlPressed && (
                    canvas.canvasState.keyboardInputState.key === "v" || 
                    canvas.canvasState.keyboardInputState.key === "V"
                )
            });
        }

        updateCanvasStausText(canvas.canvasState);
    });

    function prevTool() {
        let idx = mouseScrollList.findIndex((button) => {
            return button.args.tool === canvas.canvasState.currentTool;
        });

        if (idx > 0) {
            idx--;
        } else {
            idx = mouseScrollList.length - 1;
        }

        changeTool(mouseScrollList[idx].args.tool);
    }

    function nextTool() {
        let idx = mouseScrollList.findIndex((button) => {
            return button.args.tool === canvas.canvasState.currentTool;
        });

        if (idx < mouseScrollList.length - 1) {
            idx++;
        } else {
            idx = 0;
        }

        changeTool(mouseScrollList[idx].args.tool);
    }

    document.addEventListener("keydown", (e) => {
        if (!isVisible(component)) {
            return;
        }

        if (!isAsciiCanvasKeybind(e)) {
            return;
        }

        e.preventDefault();

        if (e.ctrlKey || e.metaKey) {
            if (e.key === "e" || e.key === "E") {
                nextTool();
            } else if (e.key === "q" || e.key === "Q") {
                prevTool();
            } else if (e.key === "c" || e.key === "C") {
                copyCanvasToClipboard();
            } else if (e.key === "v" || e.key === "V") {
                const pasteCell = getTextInputCursorCell(canvas.canvasState);
                if (pasteCell) {
                    const whitespaceIsTransparent = canvas.canvasState.keyboardInputState.isShiftPressed;
                    pasteClipboardToCanvas(pasteCell.i, pasteCell.j, whitespaceIsTransparent);
                }
            }
        }
    });

    return component;
}

