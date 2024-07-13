import { isAltPressed, isCtrlPressed, isShiftPressed } from "src/./keyboard-input";
import { makeButton } from "src/components";
import { boundsCheck } from "src/utils/array-utils";
import { copyToClipboard, readFromClipboard } from "src/utils/clipboard";
import { div, el, isVisible, newComponent, newListRenderer, newRenderGroup, newState, on, replaceChildren, setAttrs, setClass, setStyle, setText, setVisible } from "src/utils/dom-utils";

const TAB_SIZE = 4;

type CanvasArgs = {
    onInput(): void;
    outputLayers: AsciiCanvasLayer[] | undefined;
};

type MouseInputState = {
    lbDown: boolean;
    x: number;
    y: number;

    _lbWasDown: boolean;
    _prevX: number;
    _prevY: number;
}

type UndoLogEntryData = {
    layerIdx: number;
    row: number;
    col: number;
    prevValue: string;
    newVal: string;
}
type UndoLogEntry = {
    timestampMs: number;
    data: UndoLogEntryData;
}

type CanvasState = {
    mouseInputState: MouseInputState;
    rows: RowArgs[];
    currentTool: ToolType;
    layers: AsciiCanvasLayer[];
    currentLayer: number;
    tempLayer: AsciiCanvasLayer;
    undoLog: UndoLogEntry[];
    // This will always point to the last change that was _applied_. Should default to -1 if nothing in the undo log
    undoLogPosition: number; 
}

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

export type AsciiCanvasLayer = {
    data: string[][];
    iOffset: number;
    jOffset: number;
}

function newLayer(): AsciiCanvasLayer {
    return {
        data: [],
        iOffset: 0,
        jOffset: 0,
    }
}

function generateLines(canvas: CanvasState) {
    type DirectionMatrix = [boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean];
    function matchDirections(directions: DirectionMatrix, coords: [0 | 1 | 2, 0 | 1 | 2][]) {
        return coords.every(([i, j]) => directions[j + 3 * i]);
    }

    forEachCell(canvas, (c) => {
        if (!c.isSelected) {
            return;
        }

        const directions: DirectionMatrix = [
                isSelected(canvas, c.i - 1, c.j - 1),   isSelected(canvas, c.i, c.j - 1),   isSelected(canvas, c.i + 1, c.j - 1),
                isSelected(canvas, c.i - 1, c.j),                                   true,   isSelected(canvas, c.i + 1, c.j),
                isSelected(canvas, c.i - 1, c.j + 1),   isSelected(canvas, c.i, c.j + 1),   isSelected(canvas, c.i + 1, c.j + 1),
        ];

        let char = '';

        if (matchDirections(directions, [
            [0, 0],
            [0, 1],
            [0, 2],
            [1, 0],
            [1, 2],
            [2, 0],
            [2, 1],
            [2, 2],
        ])) {
            char = '#';
        } else if (matchDirections(directions, [
            [0, 0],
            [0, 2],
            [2, 0],
            [2, 2],
        ])) {
            char = 'x';
        } else if (matchDirections(directions, [
            [0, 1],
            [1, 0],
            [1, 2],
            [2, 1],
        ])) {
            char = '+';
        } else if (
            matchDirections(directions, [
                [0, 2],
            ]) ||
            matchDirections(directions, [
                [2, 0],
            ])
        ) {
            char = '/';
        } else if (
            matchDirections(directions, [
                [0, 0],
            ]) ||
            matchDirections(directions, [
                [2, 2],
            ])
        ) {
            char = '\\';
        } else if (
            matchDirections(directions, [
                [0, 1],
            ]) ||
            matchDirections(directions, [
                [2, 1],
            ]) 
        ) {
            char = '-';
        } else if (
            matchDirections(directions, [
                [1, 0],
            ]) ||
            matchDirections(directions, [
                [1, 2],
            ]) 
        ) {
            char = '|';
        } 

        setCharOnCurrentLayer(canvas, c.i, c.j, char);

    });
}

function isSelected(canvas: CanvasState, i: number, j: number) : boolean {
    const cell = getCellForLayer(canvas, i, j, getCurrentLayer(canvas));
    if (!cell) {
        return false;
    }

    return cell.isSelected;
}


function resizeLayer(layer: AsciiCanvasLayer, rows: number, cols: number) {
    const data = layer.data;

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

function resizeLayers(canvas: CanvasState, rows: number, cols: number) {
    rows = Math.max(rows, 1);
    cols = Math.max(cols, 3);

    for (let layerIdx = 0; layerIdx < canvas.layers.length; layerIdx++) {
        resizeLayer(canvas.layers[layerIdx], rows, cols);
    }

    resizeLayer(canvas.tempLayer, rows, cols);

    // Maintain row/col pool
    // NOTE: The rowList and charList are already doing a similar pooling mechanism.
    // Should this data just be created within there itself? For now I have decided "no" but I might change my mind on this one...
    while (canvas.rows.length < rows) {
        canvas.rows.push({ charList: [] });
    }
    while (canvas.rows.length > rows) {
        canvas.rows.pop();
    }

    for (let i = 0; i < canvas.rows.length; i++) {
        const chars = canvas.rows[i].charList;

        while (chars.length < cols) {
            chars.push({
                br: false, bl: false, bb: false, bt: false,

                j: chars.length,
                i: i,

                isSelected: false,
                isSelectedTemp: false,
                isSelectedPreview: false,
                isVisited: false,

                canvasState: canvas,
            });
        }
        while (chars.length > cols) {
            chars.pop();
        }
    }
}

// This gets the cell for the corresponding coordinate on a layer, taking the layer offset into account
function getCellForLayer(canvas: CanvasState, i: number, j: number, layer: AsciiCanvasLayer): CanvasCellArgs | undefined {
    const iFinal =  i - layer.iOffset;
    const jFinal =  j - layer.jOffset;
    return getCell(canvas, iFinal, jFinal);
}

function getCharOnLayer(i: number, j: number, layer: AsciiCanvasLayer): string {
    const iFinal =  i - layer.iOffset;
    const jFinal =  j - layer.jOffset;
    if (
        boundsCheck(layer.data, iFinal) && 
        boundsCheck(layer.data[iFinal], jFinal)
    ) {
        return layer.data[iFinal][jFinal] || " ";
    }

    return ' ';
}

function getLayerIdx(canvas: CanvasState, layer: AsciiCanvasLayer): number {
    return canvas.layers.indexOf(layer);
}

function setCharOnLayer(
    canvas: CanvasState, 
    i: number, j: number, 
    char: string, 
    layer: AsciiCanvasLayer, 
    useOffsets = true, 
    beingCalledInsideUndoFunction = false,
) {
    const iFinal =  !useOffsets ? i : i - layer.iOffset;
    const jFinal =  !useOffsets ? j : j - layer.jOffset;
    if (
        boundsCheck(layer.data, iFinal) && 
        boundsCheck(layer.data[iFinal], jFinal)
    ) {
        const layerIdx = getLayerIdx(canvas, layer);
        if (
            !beingCalledInsideUndoFunction &&
            // Writes to the 'temp' layer are inconsequental and shouldn't be undoable
            layerIdx !== -1
        ) {
            logUndoableChange(canvas, {
                layerIdx: layerIdx,
                row: iFinal,
                col: jFinal,
                prevValue: layer.data[iFinal][jFinal],
                newVal: char,
            });
        }

        layer.data[iFinal][jFinal] = char;
        return;
    } 
}


// this currently deletes everything from the dst layer
function moveSelectedCellDataToLayer(canvas: CanvasState, layerSrc: AsciiCanvasLayer, layerDst: AsciiCanvasLayer) {
    forEachCell(canvas, (c) => {
        // Use the correct offset
        const cellSrc = getCellForLayer(canvas, c.i, c.j, layerSrc);
        if (!cellSrc?.isSelected) {
            return;
        }

        const char = getCharOnLayer(c.i, c.j, layerSrc);
        setCharOnLayer(canvas, c.i, c.j, ' ', layerSrc);
        setCharOnLayer(canvas, c.i, c.j, char, layerDst);
    });
}

function getCharOnCurrentLayer(canvas: CanvasState, i: number, j: number): string {
    return getCharOnLayer(i, j, getCurrentLayer(canvas));
}

function setCharOnCurrentLayer(canvas: CanvasState, i: number, j: number, char: string) {
    setCharOnLayer(canvas, i, j, char, getCurrentLayer(canvas));
}

function getCurrentLayer(canvas: CanvasState): AsciiCanvasLayer {
    return canvas.layers[canvas.currentLayer];
}

// Returns the char, and the layer we pulled it from...
function getChar(canvas: CanvasState, i: number, j: number): [string, AsciiCanvasLayer | undefined] {
    const char = getCharOnLayer(i, j, canvas.tempLayer);
    if (char.trim()) {
        return [char, canvas.tempLayer];
    }

    for (let layerIdx = canvas.layers.length - 1; layerIdx >= 0; layerIdx--) {
        const layer = canvas.layers[layerIdx]
        const char = getCharOnLayer(i, j, layer);
        if (char.trim()) {
            return [char, layer];
        }
    }

    return [' ', undefined];
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
    if (canvas.layers[0].data.length === 0) {
        return 0;
    }

    return canvas.layers[0].data[0].length;
}

function getNumRows(canvas: CanvasState) {
    return canvas.layers[0].data.length;
}

function lerp(a: number, b: number, t: number) : number {
    return a + (b - a) * t;
}

export function resetCanvas(canvas: CanvasState, resetSize = true, initialText: string | undefined = undefined) {
    resetUndoLog(canvas);

    if (resetSize) {
        resizeLayers(canvas, NUM_ROWS_INCR_AMOUNT, MIN_NUM_COLS)
    }

    forEachCell(canvas, (char) => {
        char.isSelected = false;
        char.isSelectedTemp = false;
        char.isSelectedPreview = false;
        setCharOnCurrentLayer(canvas, char.i, char.j, ' ');
    });

    const first = getCell(canvas, 0, 0);
    if (first) {
        first.isSelected = true;
    }

    if (initialText) {
        pasteTextToCanvas(canvas, initialText, {
            whitespaceIsTransparent: false,
            selectPasted: false,
            resizeLayersToPasted: true,
        });

        resetUndoLog(canvas);
    }
}

function lineLength(line: string) {
    let len = 0;
    for(const c of line) {
        if (c === "\t") {
            len += TAB_SIZE;
        } else {
            len += 1;
        }
    }
    return len;
}

export function pasteTextToCanvas(canvas: CanvasState, text: string, {
    row = 0,
    col = 0,
    whitespaceIsTransparent = false,
    selectPasted = true,
    resizeLayersToPasted = false,
}: {
    row?: number;
    col?: number;
    whitespaceIsTransparent?: boolean;
    selectPasted?: boolean;
    resizeLayersToPasted?: boolean;
    autoExpand?: boolean;
} = {}) {
    text.replace(/\r/g, "");
    const lines = text.split("\n");

    if (resizeLayersToPasted) {
        row = 0;
        col = 0;
        let wantedRows = lines.length;
        let wantedCols = Math.max(...lines.map(lineLength), MIN_NUM_COLS);
        resizeLayers(canvas, wantedRows, wantedCols);
    }

    for (let i = 0; i < lines.length; i++) {
        const pasteRow = row + i;
        if (pasteRow >= getNumRows(canvas)) {
            resizeLayers(canvas, pasteRow + 1, getNumCols(canvas));
        }

        const line = lines[i];
        for (let j = 0; j < line.length; j++) {
            const pasteCol = col + j;
            if (pasteCol >= getNumCols(canvas)) {
                resizeLayers(canvas, getNumRows(canvas), pasteCol + 1);
            }

            const c = line[j];

            if (whitespaceIsTransparent && c === ' ') {
                continue;
            }

            setCharOnCurrentLayer(canvas, pasteRow, pasteCol, c);

            if (selectPasted) {
                const cell = getCell(canvas, pasteRow, pasteCol);
                cell.isSelected = true;
            }
        }
    }
}

export function getLayersString(layers: AsciiCanvasLayer[]): string {
    if (layers.length === 0) {
        // (Hint: you should have checked this was empty beforehand)
        throw Error("Can't serialize empty layers. ");
    }

    const rows = layers[0].data.length;
    const cols = layers[0].data[0].length;
    const lines: string[] = [];
    for (let i = 0; i < rows; i++) {
        const rowStringBuilder: string[] = [];
        for (let j = 0; j < cols; j++) {
            let c = ' ';
            for (let lIdx = layers.length - 1; lIdx >= 0; lIdx--) {
                const l = layers[lIdx];
                const lc = l.data[i][j];
                if (lc !== ' ') {
                    c = lc;
                    break;
                }
            }

            rowStringBuilder.push(c);
        }
        lines.push(rowStringBuilder.join("").trimEnd());
    }

    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.trim() !== "") {
            break;
        }

        lines.pop();
    }

    return lines.join("\n");
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

    const lines: string[] = [];
    for(let i = minY; i <= maxY; i++) {
        const row: string[] = [];
        for(let j = minX; j <= maxX; j++) {
            const cell = getCell(canvas, i, j);
            if (cell.isSelected) {
                const [char] = getChar(canvas, i, j);
                row.push(char);
            } else {
                row.push(' ');
            }
        }

        lines.push(row.join("").trimEnd());
    }

    return lines.join("\n");
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

const WHITESPACE_GAP = 2;
function getCurrentLineStart(canvas: CanvasState, row: number, col: number) {
    // the first whitespace large enough will be the start of the row
    let lastNonWhitespaceCol = -1;
    let whitespaceChain = 0;
    for (let i = col; i >= 0; i--) {
        const char = getCharOnCurrentLayer(canvas, row, i);
        if (char === ' ') {
            whitespaceChain++;
        } else {
            whitespaceChain = 0;
            lastNonWhitespaceCol = i;
        }

        if (lastNonWhitespaceCol !== -1 && whitespaceChain === WHITESPACE_GAP) {
            return lastNonWhitespaceCol;
        }
    }

    return 0;
}

function logUndoableChange(canvas: CanvasState, entryData: UndoLogEntryData) {
    while(canvas.undoLog.length - 1 > canvas.undoLogPosition) {
        canvas.undoLog.pop();
    }

    canvas.undoLog.push({
        timestampMs: Date.now(),
        data: entryData
    });

    canvas.undoLogPosition += 1;
}

function getCurrentChange(canvas: CanvasState): UndoLogEntry | undefined {
    return canvas.undoLog[canvas.undoLogPosition];
}
function getNextChange(canvas: CanvasState): UndoLogEntry | undefined {
    return canvas.undoLog[canvas.undoLogPosition + 1];
}
function canUndo(canvas: CanvasState): boolean {
    return !!getCurrentChange(canvas);
}

function resetUndoLog(canvas: CanvasState) {
    canvas.undoLog.splice(0, canvas.undoLog.length);
    canvas.undoLogPosition = -1;
}

function moveThroughUndoLog(canvas: CanvasState, {
    timeWithinMs = 100,
    backwards = true,
} = {}) {
    let currentChange = backwards ? getCurrentChange(canvas) : getNextChange(canvas);
    if (!currentChange) {
        return;
    }

    const t0 = currentChange.timestampMs;

    let safetyCounter = 0;

    while (
        !!currentChange &&
        Math.abs(currentChange.timestampMs - t0) < timeWithinMs
    ) {
        safetyCounter++;
        if (safetyCounter > 100000) {
            throw new Error("BRUH what u doin");
        }

        // The current undo position is always on the last change that was applied. 
        // Undoing a change needs to undo the change at the current cursor, and redoing a change needs to 
        // apply the next change and increment the postion up to that
        
        if (!currentChange) {
            break;
        }

        const { layerIdx, row, col, prevValue, newVal } = currentChange.data;

        const layer = canvas.layers[layerIdx];
        if (!layer) {
            throw new Error("Addition/removal of layers wasn't correctly undone/redone!");
        }

        if (backwards) {
            setCharOnLayer(canvas, row, col, prevValue, layer, false, true);
            canvas.undoLogPosition--;
        } else {
            setCharOnLayer(canvas, row, col, newVal, layer, false, true);
            canvas.undoLogPosition++;
        }

        currentChange = backwards ? getCurrentChange(canvas) : getNextChange(canvas);
    }
}

const UNDO_REDO_THERSHOLD_MS = 10;
function undoWithinTime(canvas: CanvasState) {
    moveThroughUndoLog(canvas, {
        timeWithinMs: UNDO_REDO_THERSHOLD_MS,
        backwards: true,
    });
}

function canRedo(canvas: CanvasState): boolean {
    return !!getNextChange(canvas);
}
function redoWithinTime(canvas: CanvasState) {
    moveThroughUndoLog(canvas, {
        timeWithinMs: UNDO_REDO_THERSHOLD_MS,
        backwards: false,
    });
}

function getTool(canvas: CanvasState): ToolType {
    return isAltPressed() ?  "move-selection" : canvas.currentTool;
}

function Canvas() {
    const root = div({ style: "overflow: auto; padding-top: 10px; padding-bottom: 10px; white-space: nowrap;"});

    const rowList = newListRenderer(root, () => {
        const s = newState<RowArgs>();

        const root = div({ class: "row justify-content-center", style: "width: fit-content" });

        const charList = newListRenderer(root, () => {
            const s = newState<CanvasCellArgs>();
            // Memoizing for peformance. 
            let lastState = -1;
            let blLast = false; 
            let brLast = false;
            let btLast = false;
            let bbLast = false;
            let lastChar = "";

            const root = el("SPAN", { class: "pre inline-block", style: "font-size: 24px; width: 1ch;user-select: none; cursor: crosshair;" });

            function renderCanvasCell() {
                const { canvasState, j, i, bl, br, bt, bb, isSelectedPreview: isSelectedTemp, } = s.args;

                let [char, layer] = getChar(canvasState, i, j);
                if (!layer) {
                    layer = getCurrentLayer(canvasState);
                }
                const cell = getCellForLayer(canvasState, i, j, layer);
                const isSelected = cell ? cell.isSelected : false;

                if (lastChar !== char) {
                    lastChar = char;
                    setText(root, char);
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
            }

            // We want errors to be caught by the root canvas, not inside of this specific cell.
            component.skipErrorBoundary = true;

            function handleMouseMovement() {
                const mouseInputState = s.args.canvasState.mouseInputState;
                mouseInputState.x = s.args.j;
                mouseInputState.y = s.args.i;
                onMouseInputStateChange();
            }

            on(root, "mousemove", handleMouseMovement);

            return newComponent(root, renderCanvasCell, s);
        });

        function renderCanvasRow() {
            const { charList: rowList } = s.args;

            charList.render((getNext) => {
                for (let i = 0; i < rowList.length; i++) {
                    const c = getNext();
                    c.render(rowList[i]);
                }
            });
        }

        on(root, "mouseleave", () => {
            canvasState.mouseInputState.x = -1;
            canvasState.mouseInputState.y = -1;
            onMouseInputStateChange();
        });

        const component = newComponent(root, renderCanvasRow, s);
        component.skipErrorBoundary = true;

        return component;
    });

    const toolState: {
        selectionStartX: number;
        selectionStartY: number;
        startedAction: ToolType | undefined;
    } = {
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
            canvasState.rows[y].charList[x].isSelectedPreview = true;
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

            const tempLayer = canvasState.tempLayer;
            if (cancel) {
                tempLayer.iOffset = 0;
                tempLayer.jOffset = 0;
            }

            moveSelectedCellDataToLayer(canvasState, canvasState.tempLayer, getCurrentLayer(canvasState));

            // move the selection after.
            {
                forEachCell(canvasState, (c) => c.isSelectedTemp = false);
                forEachCell(canvasState, (c) => {
                    const cell = getCellForLayer(canvasState, c.i, c.j, canvasState.tempLayer);
                    if (!cell) {
                        return;
                    }

                    c.isSelectedTemp = cell.isSelected;
                });
                forEachCell(canvasState, (c) => c.isSelected = c.isSelectedTemp);
            }


            // clear the temp buffer
            const useOffsets = false;
            forEachCell(canvasState, (c) => setCharOnLayer(canvasState, c.i, c.j, ' ', canvasState.tempLayer, useOffsets));

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
                
                if (isShiftPressed()) {
                    forEachCell(canvasState, (c) => {
                        // subtractive selection
                        if (c.isSelectedPreview) {
                            c.isSelected = false;
                        }
                    });
                } else if (isCtrlPressed()) {
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

        const tool = getTool(canvasState);
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
                const tempLayer = canvasState.tempLayer;

                if (clicked) {
                    tempLayer.iOffset = 0;
                    tempLayer.jOffset = 0;
                    moveSelectedCellDataToLayer(canvasState, getCurrentLayer(canvasState), tempLayer);
                }


                tempLayer.iOffset = mouseInputState.y - toolState.selectionStartY;
                tempLayer.jOffset = mouseInputState.x - toolState.selectionStartX;
            }
        }

        mouseInputState._prevX = mouseInputState.x;
        mouseInputState._prevY = mouseInputState.y;
        mouseInputState._lbWasDown = mouseInputState.lbDown;

        s.args.onInput();
    }

    const mouseInputState: MouseInputState = {
        x: 0, y: 0,
        lbDown: false,
        _lbWasDown: false,
        _prevX: 0, _prevY: 0,
    };

    const canvasState: CanvasState = {
        mouseInputState,
        rows: [],
        currentTool: "rect-select",

        undoLog: [],
        undoLogPosition: -1,

        layers: [
            // main layer. right now it's the only layer
            newLayer(),
        ],
        currentLayer: 0,

        // used for moving things around
        tempLayer: newLayer(),
    };

    const s = newState<CanvasArgs>();

    function renderCanvas() {
        const { outputLayers } = s.args;

        if (outputLayers) {
            // Allows writing to an array that lives outside of this component
            canvasState.layers = outputLayers;
            if (outputLayers.length < 1) {
                outputLayers.push(newLayer());
            }
        }

        if (getNumRows(canvasState) === 0) {
            resetCanvas(canvasState);
        }

        const height = getNumRows(canvasState);
        const width = getNumCols(canvasState);
        resizeLayers(canvasState, height, width);

        // Update border styling
        for (let i = 0; i < width; i++) {
            for (let j = 0; j < height; j++) {
                getCell(canvasState, i, j)
                canvasState.rows[j].charList[i].bt = j === 0;
                canvasState.rows[j].charList[i].bb = j === height - 1;
                canvasState.rows[j].charList[i].bl = i === 0;
                canvasState.rows[j].charList[i].br = i === width - 1;
            }
        }

        rowList.render((getNext) => {
            for (let i = 0; i < canvasState.rows.length; i++) {
                getNext().render(canvasState.rows[i]);
            }
        });
    }

    const component = newComponent(root, renderCanvas, s);

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

    document.addEventListener("keyup", () => {
        if (!isVisible(component)) {
            return;
        }

        s.args.onInput();
    });

    function handleKeyDown(e: KeyboardEvent) {
        function moveCursor(cursor: CanvasCellArgs, i: number, j: number): CanvasCellArgs {
            const nextCursor = getCell(canvasState, i, j);
            if (!nextCursor) {
                return cursor;
            }

            cursor.isSelected = false;
            nextCursor.isSelected = true;
            return nextCursor;
        }


        if (e.key === "Escape") {
            const cancel = true;

            if (toolState.startedAction) {
                e.stopImmediatePropagation();
                applyCurrentAction(cancel);
                return;
            }
        }

        if (isAsciiCanvasKeybind(e)) {
            // The parent AsciiCanvas component wants to handle this event
            return;
        }

        let key = e.key;
        if (key === "Backspace" || key === "Delete") {
            key = ' ';
        }

        let len = 0;
        // iterating 1 code point at a time
        for (const _c of key) {
            len++;
            if (len > 1) {
                break;
            }
        }
 
        let cursorCell = getTextInputCursorCell(canvasState);
        if (cursorCell) {
            // Start typing, with the singular selected cursorCell being the cursor

            const typingStartCol = getCurrentLineStart(canvasState, cursorCell.i, cursorCell.j);

            function newLine(cursorCell: CanvasCellArgs) {
                moveCursor(cursorCell, cursorCell.i + 1, typingStartCol);
            }

            function backspace(cursorCell: CanvasCellArgs) {
                const nextCursor = moveCursor(cursorCell, cursorCell.i, cursorCell.j - 1);
                setCharOnCurrentLayer(canvasState, nextCursor.i, nextCursor.j, ' ');
                return nextCursor;
            }

            function moveHorizontallyToNonWhitespace(cursorCell: CanvasCellArgs, isWhitespace = true, backwards = true, stopBefore = false) {
                let j = cursorCell.j
                const dir = backwards ? -1 : 1;
                const limitLower = stopBefore ? -1 : 0;
                const limitHigher = stopBefore ? getNumCols(canvasState) : getNumCols(canvasState) - 1;
                while (
                    j + dir >= limitLower && 
                    j + dir <= limitHigher &&
                    (getCharOnCurrentLayer(canvasState, cursorCell.i, j) === ' ') === isWhitespace
                ) {
                    j += dir;
                }

                if (stopBefore) {
                    j -= dir;
                }

                return moveCursor(cursorCell, cursorCell.i, j);
            }

            const ctrlPressed = e.ctrlKey || e.metaKey;

            if (e.key === "ArrowUp" && cursorCell.i > 0) {
                moveCursor(cursorCell, cursorCell.i - 1, cursorCell.j);
            } else if (e.key === "ArrowDown") {
                moveCursor(cursorCell, cursorCell.i + 1, cursorCell.j);
            } else if (e.key === "ArrowLeft") {
                if (ctrlPressed) {
                    const onWhitespace = getCharOnCurrentLayer(canvasState, cursorCell.i, cursorCell.j) === ' ';
                    cursorCell = moveHorizontallyToNonWhitespace(cursorCell, onWhitespace, true, false);
                } else {
                    cursorCell = moveCursor(cursorCell, cursorCell.i, cursorCell.j - 1);
                }
            } else if (e.key === "ArrowRight") {
                if (ctrlPressed) {
                    const onWhitespace = getCharOnCurrentLayer(canvasState, cursorCell.i, cursorCell.j) === ' ';
                    cursorCell = moveHorizontallyToNonWhitespace(cursorCell, onWhitespace, false, false);
                } else {
                    cursorCell = moveCursor(cursorCell, cursorCell.i, cursorCell.j + 1);
                }
            } else if (e.key === "Home") {
                cursorCell = moveCursor(cursorCell, cursorCell.i, 0);
            } else if (e.key === "End") {
                cursorCell = moveCursor(cursorCell, cursorCell.i, getNumCols(canvasState) - 1);
            } else if (e.key === "Enter") {
                newLine(cursorCell);
            } else if (e.key === "Tab") {
                moveCursor(cursorCell, cursorCell.i, TAB_SIZE + Math.floor(cursorCell.j / TAB_SIZE) * TAB_SIZE);
            } else if (e.key === "Backspace") {
                if (ctrlPressed) {
                    cursorCell = moveHorizontallyToNonWhitespace(cursorCell, true, true, true);
                    while (
                        getCharOnCurrentLayer(canvasState, cursorCell.i, cursorCell.j - 1) !== ' '
                    ) {
                        const nextCursor = backspace(cursorCell);
                        if (nextCursor === cursorCell) {
                            break;
                        }
                        cursorCell = nextCursor;
                    }
                } else {
                    backspace(cursorCell);
                }
            } else {
                if (key.length !== 1) {
                    return;
                }

                // Type this letter using the cursor cell
                setCharOnCurrentLayer(canvasState, cursorCell.i, cursorCell.j, key);

                if (cursorCell.j === getNumCols(canvasState) - 1) {
                    newLine(cursorCell);
                } else {
                    moveCursor(cursorCell, cursorCell.i, cursorCell.j + 1);
                }
            }
        } else if (key.length === 1) {
            // Just overwrite every cell with what was typed
            e.stopImmediatePropagation();

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

        s.args.onInput();
    });


    return [component, canvasState] as const;
}

// TODO: figure out hwo to delete this fn. lol.
function isAsciiCanvasKeybind(e: KeyboardEvent) {
    const ctrlPressed = e.ctrlKey || e.metaKey;
    return (
       (ctrlPressed && (e.key === "E" || e.key === "e")) 
        || (ctrlPressed && (e.key === "Q" || e.key === "q")) 
        || (ctrlPressed && (e.key === "C" || e.key === "c")) 
        || (ctrlPressed && (e.key === "V" || e.key === "v")) 
        || (ctrlPressed && (e.key === "Z" || e.key === "z")) 
        || (ctrlPressed && (e.key === "Y" || e.key === "y"))
    );
}

// I want the canvas to be like a diagram board, where I append a slab of vertical rows to the page 
// Whenever I need a new page. 1 page with is approximately the width of the screen, and same for page height and 1 scren height.
const NUM_ROWS_INCR_AMOUNT = 32;
// However, I don't expect the width I need to change very much at all. 
const NUM_COLUMNS_INCR_AMOUNT = 8;
const MIN_NUM_COLS = 130;

export type AsciiCanvasArgs = {
    outputLayers: AsciiCanvasLayer[];
    /** 
     * NOTE: this event will fire very very often. Don't do any even remotely non-performant things in here - debounce them instead 
     */
    onInput(): void;
}

export function AsciiCanvas() {
    // NOTE: This component is tightly coupled to AsciiCanvas, and shouldn't be moved out
    function ToolbarButton() {
        const s = newState<{
            name: string;
            onClick(e: MouseEvent): void;
            tool?: ToolType;
            selected?: boolean;
            disabled?: boolean;
        }>();

        const textEl = div();
        const button = setAttrs(makeButton(""), { class: "inline-block", style: ";text-align: center; align-items: center;" }, true);
        replaceChildren(button, [
            textEl, 
        ]);

        function renderAsciiCanvasToolbarButton() {
            const { tool, selected, disabled } = s.args;

            setText(button, s.args.name);

            const isCurrentTool = getTool(canvasState) === tool;
            setClass(button, "inverted", !!selected || isCurrentTool);
            setClass(button, "unfocused-text-color", !!disabled);
        }

        on(button, "click", (e) => { 
            const { onClick, tool } = s.args;

            if (tool) {
                changeTool(tool);
            }

            onClick(e);
        });

        return newComponent(button, renderAsciiCanvasToolbarButton, s);
    }

    const s = newState<AsciiCanvasArgs>();

    function changeTool(tool?: ToolType) {
        if (!tool) {
            return;
        }

        canvasState.currentTool = tool;
        rerenderLocal();
    }

    const [canvasComponent, canvasState] = Canvas();
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
        invertSelection: ToolbarButton(),
        copyToClipboard: ToolbarButton(),
        pasteFromClipboard: ToolbarButton(),
        pasteFromClipboardTransparent: ToolbarButton(),
        linesFromSelection: ToolbarButton(),
        undoButton: ToolbarButton(),
        redoButton: ToolbarButton(),
    };

    const statusText = div({ style: "text-align: center" });
    const performanceWarning = div({ style: "text-align: center" }, [
        "!! Warning: A large number of rows/columns will currently be bad for performance !!"
    ]);

    let cursorCell: CanvasCellArgs | undefined;
    let canPaste = false;

    const rg = newRenderGroup();

    const mouseScrollList = [
        rg(buttons.rectSelect, (c) => c.render({
                name: "Rect",
                onClick: rerenderLocal,
                tool: "rect-select",
        })),
        rg(buttons.freeformSelect, (c) => c.render({
            name: "Draw",
            onClick: rerenderLocal,
            tool: "freeform-select" satisfies ToolType,
        })),
        rg(buttons.lineSelect, (c) => c.render({
            name: "Line",
            onClick: rerenderLocal,
            tool: "line-select",
        })),
        rg(buttons.rectOutlineSelect, (c) => c.render({
            name: "Rect Outline",
            onClick: rerenderLocal,
            tool: "rect-outline-select",
        })),
        rg(buttons.bucketFillSelect, (c) => c.render({
            name: "Fill",
            onClick: rerenderLocal,
            tool: "fill-select",
        })),
        rg(buttons.bucketFillSelectOutline, (c) => c.render({
            name: "Fill Outline",
            onClick: rerenderLocal,
            tool: "fill-select-outline",
        })),
    ];

    const toolbar = div({ class: "", style: "justify-content: center; gap: 5px;" }, [
        div({ class: "inline-block"}, [
            rg(buttons.lessRows, (c) => c.render({
                name: "-",
                onClick: () => {
                    resizeLayers(canvasState, getNumRows(canvasState) - NUM_ROWS_INCR_AMOUNT, getNumCols(canvasState));
                    rerenderLocal();
                },
            })),
            div({ style: "display: inline-block; min-width: 3ch; text-align: center;" }, [
                rg.text(() => "rows: " + getNumRows(canvasState)),
            ]),
            rg(buttons.moreRows, (c) => c.render({
                name: "+",
                onClick: () => {
                    resizeLayers(canvasState, getNumRows(canvasState) + NUM_ROWS_INCR_AMOUNT, getNumCols(canvasState));
                    rerenderLocal();
                },
            })),
            rg(buttons.lessCols, (c) => c.render({
                name: "-",
                onClick: () => {
                    resizeLayers(canvasState, getNumRows(canvasState), getNumCols(canvasState) - NUM_COLUMNS_INCR_AMOUNT);
                    rerenderLocal();
                },
            })),
            div({ style: "display: inline-block; min-width: 3ch; text-align: center;" }, [
                rg.text(() => "cols: " + getNumCols(canvasState)),
            ]),
            rg(buttons.moreCols, (c) => c.render({
                name: "+",
                onClick: () => {
                    const wantedCols = Math.max(
                        getNumCols(canvasState) + NUM_COLUMNS_INCR_AMOUNT,
                        MIN_NUM_COLS,
                    );
                    resizeLayers(canvasState, getNumRows(canvasState), wantedCols);
                    rerenderLocal();
                },
            })),
        ]),
        spacer(),
        div({ class: "inline-block"}, [
            rg.text(() => "Selection (Ctrl + [Q/E]): "),
            ...mouseScrollList,
        ]),
        spacer(),
        div({ class: "inline-block"}, [
            rg(buttons.invertSelection, (c) => c.render({
                name: "Invert Selection",
                onClick: () => {
                    forEachCell(canvasState, (c) => c.isSelected = !c.isSelected);
                    rerenderLocal();
                },
            })),
        ]),
        spacer(),
        div({ class: "inline-block"}, [
            rg(buttons.copyToClipboard, (button) => {
                button.render({
                    name: "Copy",
                    onClick: copyCanvasToClipboard,
                    selected: copied,
                })
            }),
            rg(buttons.pasteFromClipboard, (button) => {
                button.render({
                    name: "Paste",
                    onClick: () => {
                        pasteClipboardToCanvas(cursorCell?.i || 0, cursorCell?.j || 0, false);
                        rerenderLocal();
                    },
                    selected: pastedNoTransparency,
                    disabled: !canPaste,
                });
            }),
            rg(buttons.pasteFromClipboardTransparent, (button) => {
                button.render({
                    name: "Paste (transparent)",
                    onClick: () => {
                        pasteClipboardToCanvas(cursorCell?.i || 0, cursorCell?.j || 0, false);
                        rerenderLocal();
                    },
                    selected: pastedWithTransparency,
                    disabled: !canPaste,
                });
            }),
        ]),
        spacer(),
        div({ class: "inline-block"}, [
            rg(buttons.linesFromSelection, (c) => c.render({
                name: "Draw Lines",
                onClick: () => {
                    generateLines(canvasState);
                    rerenderLocal();
                }
            })),
        ]),
        div({ class: "inline-block"}, [
            rg(buttons.undoButton, (c) => c.render({
                name: "Undo",
                selected: undoDone,
                disabled: !canUndo(canvasState),
                onClick: undo,
            })),
            rg.text(() => canvasState.undoLogPosition + " / " + canvasState.undoLog.length),
            rg(buttons.redoButton, (c) => c.render({
                name: "Redo",
                selected: redoDone,
                disabled: !canRedo(canvasState),
                onClick: redo,
            })),
        ]),
    ]);

    function spacer() {
        return div({ class: "inline-block", style: "width: 30px" });
    }

    const root = div({ class: "relative h-100 row" }, [
        div({ class: "flex-1 col justify-content-center", style: "overflow: auto;" }, [
            div({ class: "flex-1" }),
            canvasComponent,
            statusText,
            performanceWarning,
            div({ class: "flex-1" }),
            toolbar,
        ]),
        div({ style: "width: 20px" }),
    ]);

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
                    isCtrlPressed() ? "adding " : 
                    isShiftPressed() ? "subtracting " :
                    "replacing "
                ) + 
                selPreviewCount 
            );
        }

        setText(statusText, stringBuilder.join(" | "));
        setVisible(performanceWarning, getNumRows(canvas) * getNumCols(canvas) > MIN_NUM_COLS * 128);
    }

    const canvasArgs : CanvasArgs = {
        onInput: rerenderLocal,
        outputLayers: [],
    };

    let copied = false;
    let pastedNoTransparency = false;
    let pastedWithTransparency = false;
    let undoDone = false;
    let redoDone = false;
    function unhighlightKeyPressButtons() {
        // Some of these actions only complete on key-up, so we ned to delay resetting these.
        setTimeout(() => {
            copied = false;
            pastedNoTransparency = false;
            pastedWithTransparency = false;
            redoDone = false;
            undoDone = false;

            rerenderLocal();
        }, 100);
    }

    function copyCanvasToClipboard() {
        const text = getCanvasSelectionAsString(canvasState);
        copyToClipboard(text);
        copied = true;
        unhighlightKeyPressButtons();
    }

    async function pasteClipboardToCanvas(row: number, col: number, whitespaceIsTransparent: boolean) {
        const text = await readFromClipboard();

        if (!text || typeof text !== "string") {
            console.warn("failed to read from clipboard - ", text);
            return;
        }

        pasteTextToCanvas(canvasState, text, {
            row, col,
            whitespaceIsTransparent,
            selectPasted: true,
            resizeLayersToPasted: false,
        });

        if (whitespaceIsTransparent) {
            pastedWithTransparency = true;
            unhighlightKeyPressButtons();
        } else {
            pastedNoTransparency = true;
            unhighlightKeyPressButtons();
        }

        rerenderLocal();
    }

    function rerenderLocal() {
        component.render(s.args);
        s.args.onInput();
    }

    function renderAsciiCanvas() {
        // This single line of code allows us to write to an array that lives outside of this component
        canvasArgs.outputLayers = s.args.outputLayers;

        cursorCell = getTextInputCursorCell(canvasState);
        canPaste = !!cursorCell;

        rg.render();

        canvasComponent.render(canvasArgs);
        
        updateCanvasStausText(canvasState);
    }

    function prevTool() {
        let idx = mouseScrollList.findIndex((button) => {
            return button.state.args.tool === canvasState.currentTool;
        });

        if (idx > 0) {
            idx--;
        } else {
            idx = mouseScrollList.length - 1;
        }

        changeTool(mouseScrollList[idx].state.args.tool);
    }

    function nextTool() {
        let idx = mouseScrollList.findIndex((button) => {
            return button.state.args.tool === canvasState.currentTool;
        });

        if (idx < mouseScrollList.length - 1) {
            idx++;
        } else {
            idx = 0;
        }

        changeTool(mouseScrollList[idx].state.args.tool);
    }

    function undo() {
        if (!canUndo(canvasState)) {
            return;
        }

        undoWithinTime(canvasState);
        undoDone = true;
        unhighlightKeyPressButtons();

        rerenderLocal();
    }

    function redo() {
        if (!canRedo(canvasState)) {
            return;
        }

        redoWithinTime(canvasState);
        redoDone = true;
        unhighlightKeyPressButtons();

        rerenderLocal();
    }

    document.addEventListener("keydown", (e) => {
        if (!isVisible(component)) {
            return;
        }

        if (!isAsciiCanvasKeybind(e)) {
            return;
        }

        e.preventDefault();

        console.log(e.key);

        let render = false;
        if (e.ctrlKey || e.metaKey) {
            if (e.key === "e" || e.key === "E") {
                nextTool();
                render = true;
            } else if (e.key === "q" || e.key === "Q") {
                prevTool();
                render = true;
            } else if (e.key === "c" || e.key === "C") {
                copyCanvasToClipboard();
                render = true;
            } else if (e.key === "v" || e.key === "V") {
                const pasteCell = getTextInputCursorCell(canvasState);
                if (pasteCell) {
                    const whitespaceIsTransparent = e.shiftKey;
                    pasteClipboardToCanvas(pasteCell.i, pasteCell.j, whitespaceIsTransparent);
                    render = true;
                }
            } else if (e.key === "z" || e.key === "Z") {
                if (e.shiftKey) {
                    redo();
                } else {
                    undo();
                }
            } else if (e.key === "y" || e.key === "Y" && !e.shiftKey) {
                redo();
            }
        }

        if (render) {
            rerenderLocal();
        }
    });

    const component = newComponent(root, renderAsciiCanvas, s);
    return [component, canvasState] as const;
}

