import { isAltPressed } from "src/./keyboard-input";
import { ScrollContainer, makeButton } from "src/components";
import { boundsCheck } from "src/utils/array-utils";
import { copyToClipboard, readFromClipboard } from "src/utils/clipboard";
import { Insertable, addChildren, div, el, isVisible, newComponent, newListRenderer, newRenderGroup, newState, on, replaceChildren, setAttrs, setClass, setStyle, setText, setVisible } from "src/utils/dom-utils";
import { scoreFuzzyFind } from "./utils/fuzzyfind";
import { shouldFilterOutNote } from "./state";

const TAB_SIZE = 8;

type CanvasArgs = {
    onInput(): void;
    onWrite(): void;
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
    row: number;
    col: number;
    char?: {
        layerIdx: number;
        prev: string;
        new: string;
    },
    selection?: {
        prev: boolean;
        new: boolean;
    }
}
type UndoLogEntry = {
    timestampMs: number;
    data: UndoLogEntryData;
}

type CanvasState = {
    // Input state
    args: () => CanvasArgs;
    mouseInputState: MouseInputState;
    currentTool: ToolType;
    cursorRowCol: { i: number; j: number; };

    // Data state
    rows: RowArgs[];
    layers: AsciiCanvasLayer[];
    currentLayer: number;
    tempLayer: AsciiCanvasLayer; // used for moving things around
    toolState: {
        startedAction: ToolType | undefined;
        iSelectStart: number;
        jSelectStart: number;
        iPrev: number;
        jPrev: number;
        keyboardSelectStart: boolean;
        keyboardMoveStart: boolean;
    };

    // Undo state
    undoLog: UndoLogEntry[];
    // This will always point to the last change that was _applied_. Should default to -1 if nothing in the undo log
    undoLogPosition: number; 
}

type ToolType = "freeform-select" | 
    "line-select" |
    "rect-outline-select" |
    "rect-select" |
    "fill-select" |
    "fill-select-connected" |
    "fill-select-outline" |
    "move-selection";

type RowArgs = {
    charList: CanvasCellArgs[];
};

type CanvasCellArgs = {
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

function selectCell(canvas: CanvasState, i: number, j: number, value: boolean, calledInUndoFn = false) {
    const cell = getCellOrUndefined(canvas, i, j);
    if (!cell) {
        return;
    }

    if (cell.isSelected === value) {
        return;
    }

    if (!calledInUndoFn) {
        logUndoableChange(canvas, {
            row: i,
            col: j,
            selection: { prev: cell.isSelected, new: value },
        });
    }

    cell.isSelected = value;
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
    return getCellOrUndefined(canvas, iFinal, jFinal);
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
        !boundsCheck(layer.data, iFinal) ||
        !boundsCheck(layer.data[iFinal], jFinal)
    ) {
        return;
    } 

    const layerIdx = getLayerIdx(canvas, layer);
    const prev = layer.data[iFinal][jFinal];
    if (char === prev) {
        return;
    }

    if (
        !beingCalledInsideUndoFunction &&
        // Writes to the 'temp' layer are inconsequental and shouldn't be undoable
        layerIdx !== -1
    ) {
        logUndoableChange(canvas, {
            row: iFinal,
            col: jFinal,
            char: { layerIdx, new: char, prev  },
        });
    }

    if (layerIdx !== -1) {
        canvas.args().onWrite();
    }

    layer.data[iFinal][jFinal] = char;
    return;
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
    if (char.length > 1) {
        throw new Error("Invalid char");
    }
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

function getCellOrUndefined(canvas: CanvasState, i: number, j: number): CanvasCellArgs | undefined {
    return canvas.rows[i]?.charList[j];
}
function getCell(canvas: CanvasState, i: number, j: number): CanvasCellArgs {
    const cell = getCellOrUndefined(canvas, i, j);
    if (!cell) {
        throw new Error("Cell wasn't present!");
    }

    return cell;
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
        char.isSelectedTemp = false;
        char.isSelectedPreview = false;
        selectCell(canvas, char.i, char.i, false);
        setCharOnCurrentLayer(canvas, char.i, char.j, ' ');
    });

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
                selectCell(canvas, cell.i, cell.j, true);
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

function getFirstNonWhitespace(canvas:CanvasState, row: number, blockedBySelection = true): number {
    const cols = getNumCols(canvas);
    for (let i = 0; i < cols; i++) {
        if (blockedBySelection) {
            const cell = getCellOrUndefined(canvas, row, i + 1);
            if (cell?.isSelected) {
                break;
            }
        }

        const c = getCharOnCurrentLayer(canvas, row, i);
        if (c !== ' ') {
            return i;
        }
    }

    return cols - 1;
}


function getLastNonWhitespace(canvas:CanvasState, row: number, blockedBySelection = true): number {
    const cols = getNumCols(canvas);
    for (let i = cols; i >= 0; i--) {
        if (blockedBySelection) {
            const cell = getCellOrUndefined(canvas, row, i - 1);
            if (cell?.isSelected) {
                break;
            }
        }

        const c = getCharOnCurrentLayer(canvas, row, i);
        if (c !== ' ') {
            return i;
        }
    }

    return 0;
}

const WHITESPACE_GAP = 2;
function getCurrentLineStart(canvas: CanvasState, rowStart: number, col: number) {
    let row = rowStart;
    for (let i = rowStart; i >= 0; i--) {
        // if we can find a row above us with non-whitespace, we should use that. 
        // I think this is somewhat error-prone actually, and may need to be revised later.
        if (getCharOnCurrentLayer(canvas, i, col) !== ' ') {
            row = i;
            break;
        }
    }

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

        const { row, col, char, selection } = currentChange.data;

        const cell : CanvasCellArgs | undefined = getCellOrUndefined(canvas, row, col);
        if (!cell) {
            // We currently don't undo/redo resizing, so dont worry about handling cell being undefined
            continue;
        }

        if (backwards) {
            if (char) {
                const layer = canvas.layers[char.layerIdx];
                if (!layer) {
                    throw new Error("Addition/removal of layers wasn't correctly undone/redone!");
                }

                setCharOnLayer(canvas, row, col, char.prev, layer, false, true);
            }

            if (selection) {
                selectCell(canvas, row, col, selection.prev, true);
            }

            canvas.undoLogPosition--;
        } else {
            if (char) {
                const layer = canvas.layers[char.layerIdx];
                if (!layer) {
                    throw new Error("Addition/removal of layers wasn't correctly undone/redone!");
                }

                setCharOnLayer(canvas, row, col, char.new, layer, false, true);
            }

            if (selection) {
                selectCell(canvas, row, col, selection.new, true);
            }

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

function getCursorCell(canvas: CanvasState): CanvasCellArgs | undefined {
    return getCellOrUndefined(canvas, canvas.cursorRowCol.i, canvas.cursorRowCol.j);
}

function moveCursor(canvas: CanvasState, i: number, j: number) {
    canvas.cursorRowCol.i = i;
    canvas.cursorRowCol.j = j;

    // If we're moving by 1 at a time, we can expand the canvas.
    const rows = getNumRows(canvas);
    const cols = getNumCols(canvas);
    if (i === rows || j === cols) {
        resizeLayers(canvas, Math.max(rows, i + 1), Math.max(cols, j + 1));
    }
}

function newLine(canvasState: CanvasState) {
    const cursorCell = getCursorCell(canvasState);
    if (!cursorCell) return;

    const typingStartCol = getCurrentLineStart(canvasState, cursorCell.i, cursorCell.j);
    moveCursor(canvasState, canvasState.cursorRowCol.i + 1, typingStartCol);
}

function backspace(canvasState: CanvasState) {
    const cursorCell = getCursorCell(canvasState);
    if (!cursorCell) return;

    moveCursor(canvasState, cursorCell.i, cursorCell.j - 1);
    setCharOnCurrentLayer(canvasState, cursorCell.i, cursorCell.j - 1, ' ');
}

function typeChar(canvasState: CanvasState, key: string) {
    const cursorCell = getCursorCell(canvasState);
    if (!cursorCell) return;

    // Type this letter using the cursor cell
    setCharOnCurrentLayer(canvasState, cursorCell.i, cursorCell.j, key);

    if (cursorCell.j === getNumCols(canvasState) - 1) {
        newLine(canvasState);
    } else {
        moveCursor(canvasState, cursorCell.i, cursorCell.j + 1);
    }
}

function moveToNonWhitespaceOrSelected(
    start: number, 
    len: number,
    getChar: (i: number) => string,
    getSelected: (i: number) => boolean,
    isWhitespace = true, 
    backwards = true, 
    stopBefore = false,
): number {
    let pos = start;
    const dir = backwards ? -1 : 1;
    const limitLower = stopBefore ? -1 : 0;
    const limitHigher = stopBefore ? len : len - 1;
    const initialSelected = getSelected(start);

    pos += dir;

    while (
        pos + dir >= limitLower 
        && pos + dir <= limitHigher 
        && (getChar(pos) === ' ') !== isWhitespace 
        && (initialSelected === getSelected(pos))
    ) {
        pos += dir;
    }

    while (
        pos + dir >= limitLower 
        && pos + dir <= limitHigher 
        && (getChar(pos) === ' ') === isWhitespace 
        && (initialSelected === getSelected(pos))
    ) {
        pos += dir;
    }

    if (stopBefore) {
        pos -= dir;
    }

    return pos;
}

function isSelectionTool(tool: ToolType) {
    return tool === "freeform-select"
        || tool === "line-select"
        || tool === "rect-outline-select"
        || tool === "rect-select"
        || tool === "fill-select"
        || tool === "fill-select-connected"
        || tool === "fill-select-outline"
        || tool === "move-selection";
}


function getNumSelected(canvas: CanvasState) {
    let numSelected = 0;
    forEachCell(canvas, c => c.isSelected && numSelected++);
    return numSelected;
}


function Canvas() {
    const s = newState<CanvasArgs>();

    let currentCursorEl: Insertable | null = null;
    let shouldScroll = false;

    const scrollContainer = ScrollContainer();
    const root = setAttrs(scrollContainer, { 
        class: "flex-1",
        style: "padding-top: 10px; padding-bottom: 10px; white-space: nowrap; border: 1px solid var(--fg-color);"
    }, true);

    const rowList = newListRenderer(root, () => {
        const s = newState<RowArgs>();

        const root = div({ class: "row justify-content-center", style: "width: fit-content" });

        const charList = newListRenderer(root, () => {
            const s = newState<CanvasCellArgs>();
            // Memoizing for peformance. 
            let lastState = -1;
            let lastIsCursor = false;
            let lastChar = "";

            const root = el("SPAN", { 
                class: "pre inline-block border-box", 
                style: "font-size: 24px; width: 1ch;user-select: none; cursor: crosshair;" 
            });

            function renderCanvasCell() {
                const { canvasState, j, i, isSelectedPreview: isSelectedTemp, } = s.args;

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

                const isCursor = i === canvasState.cursorRowCol.i 
                    && j === canvasState.cursorRowCol.j;
                if (isCursor !== lastIsCursor) {
                    lastIsCursor = isCursor;

                    setStyle(root, "outline", !isCursor ? "" : "2px solid var(--fg-color)");
                    setStyle(root, "zIndex", !isCursor ? "0" : "1");
                }

                if (isCursor) {
                    currentCursorEl = root;
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
                        state === 1 ? "var(--bg-color-focus)" :
                            state === 2 ? "#0078D7" :
                            state === 3 ? "#888" :
                            ""
                    );
                    setStyle(
                        root, 
                        "color",  
                        state === 2 ? "#FFF" : ""
                    );
                }
            }

            // We want errors to be caught by the root canvas, not inside of this specific cell.
            component.skipErrorBoundary = true;

            function handleMouseMovement(e: MouseEvent) {
                e.stopImmediatePropagation();

                const mouseInputState = s.args.canvasState.mouseInputState;
                mouseInputState.x = s.args.j;
                mouseInputState.y = s.args.i;
                
                moveCursor(canvasState, mouseInputState.y, mouseInputState.x)
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

        const component = newComponent(root, renderCanvasRow, s);
        component.skipErrorBoundary = true;

        return component;
    });

    on(root, "mouseleave", () => {
        canvasState.mouseInputState.x = -1;
        canvasState.mouseInputState.y = -1;

        const numSelected = getNumSelected(canvasState);
        if (numSelected === 1) {
            forEachCell(canvasState, c => {
                if (!c.isSelected) {
                    return;
                }

                canvasState.cursorRowCol.i = c.i;
                canvasState.cursorRowCol.j = c.j;
            });
        }

        onMouseInputStateChange();
    });

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

        moveCursor(canvasState, y2, x2);
    }

    // NOTE: keepOutlineOnly not quite working as intended yet :(
    function propagateSelection(x: number, y: number, corners: boolean, keepOutlineOnly: boolean, whiteSpace = false) {
        clearSelectionPreview();
        forEachCell(canvasState, (c) => c.isVisited = false);

        // propagate out a selection using a breadth-first approach
        type Coord = [number, number, number, number];
        const queue: Coord[] = [[y, x, y, x]];
        let coords: Coord | undefined;
        let fillChar: string | undefined;
        while(coords = queue.pop()) {
            const [i, j, iPrev, jPrev] = coords;

            const cell = getCellOrUndefined(canvasState, i, j);
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
            } else if (!whiteSpace && cellChar !== fillChar) {
                continue;
            } else if (
                whiteSpace &&
                ((cellChar === ' ') !== (fillChar === ' '))
            ) {
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
        const startedAction = canvasState.toolState.startedAction;
        canvasState.toolState.startedAction = undefined;
        if (!startedAction) {
            return;
        }

        // some of these are also select actions, so they need to be checked first.
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
                forEachCell(canvasState, (c) => selectCell(canvasState, c.i, c.j, c.isSelectedTemp));
            }


            // clear the temp buffer
            const useOffsets = false;
            forEachCell(canvasState, (c) => setCharOnLayer(canvasState, c.i, c.j, ' ', canvasState.tempLayer, useOffsets));

            return;
        } 

        if (isSelectionTool(startedAction)) {
            if (!cancel) {
                // Apply our selection preview.
                
                // NOTE: Disabling this for now, as it conflicts with shift+moving to expand the current selection,
                // the latter of which is far more usefull. We can enable it later when we figure out how to bind it
                // if (false && isShiftPressed()) {
                    // forEachCell(canvasState, (c) => {
                    //     // subtractive selection
                    //     if (c.isSelectedPreview) {
                    //         c.isSelected = false;
                    //     }
                    // });
                // } else 
                // Should do the same for additive selections to remain consistent.
                // if (isCtrlPressed()) {
                //     // forEachCell(canvasState, (c) => {
                //     //     // additive selection
                //     //     c.isSelected = c.isSelected || c.isSelectedPreview;
                //     // });
                // } else
                // {
                //     forEachCell(canvasState, (c) => {
                //         // replace selection
                //         c.isSelected = c.isSelectedPreview;
                //     });
                // }

                // Might just use a toggle-based selection in order to get all the functionality of 100% additive, 
                // subtractive and replace functionality.
                // This wouldn't fly in an image editor because the pixels are way too small to toggle individually,
                // but it should work in this pseudo-text editor
                forEachCell(canvasState, (c) => {
                    // replace selection
                    if (c.isSelectedPreview) {
                        selectCell(canvasState, c.i, c.j, !c.isSelected);
                    }
                });
            }

            forEachCell(canvasState, (c) => c.isSelectedPreview = false);

            return;
        }
    }

    function handleSelect(
        canvasState: CanvasState,
        started: boolean,
        iInput: number,
        jInput: number,
    ) {
        const toolState = canvasState.toolState;
        const tool = getTool(canvasState);

        if (!isSelectionTool(tool)) {
            return;
        }

        if (started) {
            toolState.startedAction = tool;
            toolState.iSelectStart = iInput;
            toolState.jSelectStart = jInput;
            toolState.iPrev = iInput;
            toolState.jPrev = jInput;
        }

        if (tool === "freeform-select") {
            selectLine(toolState.jPrev, toolState.iPrev, jInput, iInput);
        } else if (tool === "line-select") {
            clearSelectionPreview();
            selectLine(toolState.jSelectStart, toolState.iSelectStart, jInput, iInput);
        } else if (tool === "rect-outline-select") {
            clearSelectionPreview();
            selectLine(toolState.jSelectStart, toolState.iSelectStart, jInput, toolState.iSelectStart);
            selectLine(toolState.jSelectStart, toolState.iSelectStart, toolState.jSelectStart, iInput);
            selectLine(jInput, toolState.iSelectStart, jInput, iInput);
            selectLine(toolState.jSelectStart, iInput, jInput, iInput);
        } else if (tool === "rect-select") {
            clearSelectionPreview();
            let minX = Math.min(toolState.jSelectStart, jInput);
            let maxX = Math.max(toolState.jSelectStart, jInput);
            let minY = Math.min(toolState.iSelectStart, iInput);
            let maxY = Math.max(toolState.iSelectStart, iInput);
            for (let i = minY; i <= maxY; i++) {
                for (let j = minX; j <= maxX; j++) {
                    getCell(canvasState, i, j).isSelectedPreview = true;
                }
            }
        } else if (started && (
            tool === "fill-select"
            || tool === "fill-select-outline"
            || tool === "fill-select-connected"
        )) {
            if (tool === "fill-select") {
                const corners = false;
                propagateSelection(jInput, iInput, corners, false);
            } else if (tool === "fill-select-outline") {
                // I want mouseInputState.to just select the fringe of the propagation, but it isn't working :(
                const corners = true;
                propagateSelection(jInput, iInput, corners, true);
            } else if (tool === "fill-select-connected") {
                const corners = true;
                propagateSelection(jInput, iInput, corners, false, true);
            }
        } else if (tool === "move-selection") {
            const tempLayer = canvasState.tempLayer;

            if (started) {
                tempLayer.iOffset = 0;
                tempLayer.jOffset = 0;
                moveSelectedCellDataToLayer(canvasState, getCurrentLayer(canvasState), tempLayer);
            }

            tempLayer.iOffset = iInput - toolState.iSelectStart;
            tempLayer.jOffset = jInput - toolState.jSelectStart;
        }

        toolState.iPrev = iInput;
        toolState.jPrev = jInput;
    }

    function onMouseInputStateChange() {
        if (mouseInputState.x === -1 || mouseInputState.y === -1) {
            s.args.onInput();
            return;
        }

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
            handleSelect(
                canvasState, 
                clicked,
                mouseInputState.y,
                mouseInputState.x
            );
        }

        mouseInputState._prevX = mouseInputState.x;
        mouseInputState._prevY = mouseInputState.y;
        mouseInputState._lbWasDown = mouseInputState.lbDown;

        s.args.onInput();
    }

    const mouseInputState: MouseInputState = {
        x: -1, y: -1,
        lbDown: false,
        _lbWasDown: false,
        _prevX: 0, _prevY: 0,
    };

    const canvasState: CanvasState = {
        args: () => s.args,
        mouseInputState,
        rows: [],
        currentTool: "rect-select",
        undoLog: [],
        cursorRowCol: { i: 0, j: 0 },
        undoLogPosition: -1,
        layers: [
            // main layer. right now it's the only layer
            newLayer(),
        ],
        currentLayer: 0, 
        toolState: {
            startedAction: undefined,
            iPrev: 0,
            jPrev: 0,
            jSelectStart: 0,
            iSelectStart: 0,
            keyboardSelectStart: false,
            keyboardMoveStart: false,
        },
        tempLayer: newLayer(),
    };

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

        const rows = getNumRows(canvasState);
        const cols = getNumCols(canvasState);
        resizeLayers(canvasState, rows, cols);

        currentCursorEl = null;

        rowList.render((getNext) => {
            for (let i = 0; i < canvasState.rows.length; i++) {
                getNext().render(canvasState.rows[i]);
            }
        });

        if (!scrollContainer.state.hasArgs()) {
            scrollContainer.state.args = { 
                scrollEl: null,
                axes: "hv",
            };
        }

        if (shouldScroll) {
            shouldScroll = false;
            scrollContainer.state.args.scrollEl = currentCursorEl;
            scrollContainer.render(scrollContainer.state.args);
        }
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
        let cursorCell = getCursorCell(canvasState);
        if (!cursorCell) {
            moveCursor(canvasState, 0, 0);
            cursorCell = getCursorCell(canvasState);
        }
        if (!cursorCell) {
            return;
        }

        if (e.key === "Escape") {
            const cancel = true;

            if (canvasState.toolState.startedAction) {
                applyCurrentAction(cancel);
                e.stopImmediatePropagation();
                return;
            } 

            const numSelected = getNumSelected(canvasState);
            if (numSelected > 0) {
                forEachCell(canvasState, c => selectCell(canvasState, c.i, c.j, false));
                e.stopImmediatePropagation();
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

        const numSelected = getNumSelected(canvasState);
        if (
            numSelected > 1 &&
            key.length === 1
        ) {
            // Just overwrite every cell with what was typed 
            
            e.stopImmediatePropagation();

            forEachCell(canvasState, (char) => {
                if (char.isSelected) {
                    setCharOnCurrentLayer(canvasState, char.i, char.j, key);
                }
            });

            return;
        }

        const ctrlPressed = e.ctrlKey || e.metaKey;

        function moveToToNonWhitespaceOrSelection(
            horizontal: boolean,
            backwards: boolean,
            stopBefore: boolean,
        ) {
            const cursorCell = getCursorCell(canvasState);
            if (!cursorCell) return;

            let pos = horizontal ? cursorCell.j : cursorCell.i;
            const len = horizontal ? getNumCols(canvasState) : getNumRows(canvasState);

            const iterFnChar = horizontal ? (
                (pos: number) => getCharOnCurrentLayer(canvasState, cursorCell.i, pos)
            ) : (
                (pos: number) => getCharOnCurrentLayer(canvasState, pos, cursorCell.j)
            );

            const iterFnSelect = horizontal ? (
                (pos: number) => !!getCellOrUndefined(canvasState, cursorCell.i, pos)?.isSelected
            ) : (
                (pos: number) => !!getCellOrUndefined(canvasState, pos, cursorCell.j)?.isSelected
            );

            pos = moveToNonWhitespaceOrSelected(
                pos, 
                len, 
                iterFnChar, 
                iterFnSelect, 
                false, 
                backwards, 
                stopBefore,
            );

            if (horizontal) {
                moveCursor(canvasState, cursorCell.i, pos);
            } else {
                moveCursor(canvasState, pos, cursorCell.j);
            }
        }

        if (
            e.key === "ArrowRight"
            || e.key === "ArrowLeft"
            || e.key === "ArrowUp" 
            || e.key === "ArrowDown"
            || e.key === "Home"
            || e.key === "End"
        ) {
            shouldScroll = true;

            let isSelectingOrMoving = false;
            if (e.shiftKey || e.altKey) {
                isSelectingOrMoving = true;

                let handled = true;
                const alreadyDoingSomething = canvasState.toolState.keyboardSelectStart 
                    || canvasState.toolState.keyboardMoveStart;
                if (e.shiftKey && !canvasState.toolState.keyboardSelectStart) {
                    canvasState.toolState.keyboardSelectStart = true;
                } else if (e.altKey && !canvasState.toolState.keyboardMoveStart) {
                    canvasState.toolState.keyboardMoveStart = true;
                } else {
                    handled = false;
                }

                if (!alreadyDoingSomething && handled) {
                    handleSelect(canvasState, true, cursorCell.i, cursorCell.j);
                }
            }

            if (e.key === "ArrowUp") {
                if (ctrlPressed) {
                    moveToToNonWhitespaceOrSelection(false, true, true);
                } else {
                    moveCursor(canvasState, cursorCell.i - 1, cursorCell.j);
                }
            } else if (e.key === "ArrowDown") {
                if (ctrlPressed) {
                    moveToToNonWhitespaceOrSelection(false, false, true);
                } else {
                    moveCursor(canvasState, cursorCell.i + 1, cursorCell.j);
                }
            } else if (e.key === "ArrowLeft") {
                if (ctrlPressed) {
                    moveToToNonWhitespaceOrSelection(true, true, true);
                } else {
                    moveCursor(canvasState, cursorCell.i, cursorCell.j - 1);
                }
            } else if (e.key === "ArrowRight") {
                if (ctrlPressed) {
                    moveToToNonWhitespaceOrSelection(true, false, true);
                } else {
                    moveCursor(canvasState, cursorCell.i, cursorCell.j + 1);
                }
            } else if (e.key === "Home") {
                const firstWhitespaceIdx = getFirstNonWhitespace(canvasState, cursorCell.i);
                if (cursorCell.j <= firstWhitespaceIdx) {
                    moveCursor(canvasState, cursorCell.i, 0);
                } else {
                    moveCursor(canvasState, cursorCell.i, firstWhitespaceIdx);
                }
            } else if (e.key === "End") {
                const lastWhitespaceIdx = getLastNonWhitespace(canvasState, cursorCell.i);
                const cols = getNumCols(canvasState);
                if (cursorCell.j >= lastWhitespaceIdx) {
                    moveCursor(canvasState, cursorCell.i, cols - 1);
                } else {
                    moveCursor(canvasState, cursorCell.i, lastWhitespaceIdx);
                }
            }

            if (isSelectingOrMoving) {
                const cursorCell = getCursorCell(canvasState);
                if (cursorCell) {
                    handleSelect(canvasState, false, cursorCell.i, cursorCell.j);
                }
            }
        }  else if (e.key === "Enter") {
            newLine(canvasState);
        } else if (e.key === "Tab") {
            const start = getCurrentLineStart(canvasState, cursorCell.i, cursorCell.j);
            const offset = cursorCell.j - start;
            if (cursorCell) {
                moveCursor(
                    canvasState, 
                    cursorCell.i, 
                    start 
                        + Math.floor(offset / TAB_SIZE) * TAB_SIZE
                        + TAB_SIZE
                );
            }
        } else if (e.key === "Backspace") {
            if (ctrlPressed) {
                moveToToNonWhitespaceOrSelection(true, true, true);
                let cursorCell;
                while (
                    (cursorCell = getCursorCell(canvasState)) &&
                    getCharOnCurrentLayer(canvasState, cursorCell.i, cursorCell.j - 1) !== ' ' &&
                    cursorCell.j >= 0
                ) {
                    backspace(canvasState);
                }
            } else {
                backspace(canvasState);
            }
        } else {
            if (key.length !== 1) {
                return;
            }

            forEachCell(canvasState, c => selectCell(canvasState, c.i, c.j, false));

            typeChar(canvasState, key);
        }

        e.preventDefault();
    }

    document.addEventListener("keydown", (e) => {
        if (!isVisible(component)) {
            return;
        }

        handleKeyDown(e);

        s.args.onInput();

        renderCanvas();
    });

    document.addEventListener("keyup", (e) => {
        let shouldApply = true;
        if (e.key === "Shift" && canvasState.toolState.keyboardSelectStart) {
            canvasState.toolState.keyboardSelectStart = false;
        } else if (e.key === "Alt" && canvasState.toolState.keyboardMoveStart) {
            canvasState.toolState.keyboardMoveStart = false;
        } else {
            shouldApply = false;
        }

        if (shouldApply) {
            applyCurrentAction();
            renderCanvas();
        }
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
     * NOTE: these events will fire very very often. Don't do any even remotely non-performant things in here - debounce them instead 
     */
    onInput(): void;
    onWrite(): void;
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
        bucketFillSelectConnected: ToolbarButton(),
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
        rg(buttons.bucketFillSelectConnected, (c) => c.render({
            name: "Fill Connected",
            onClick: rerenderLocal,
            tool: "fill-select-connected",
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
                    forEachCell(canvasState, (c) => selectCell(canvasState, c.i, c.j, !c.isSelected));
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
            rg.text(() => (1 + canvasState.undoLogPosition) + " / " + canvasState.undoLog.length),
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
            `row ${canvas.cursorRowCol.i}, col ${canvas.cursorRowCol.j}`
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

        setText(statusText, stringBuilder.join(" | "));
        setVisible(performanceWarning, getNumRows(canvas) * getNumCols(canvas) > MIN_NUM_COLS * 128);
    }

    const canvasArgs : CanvasArgs = {
        onInput: rerenderLocal,
        onWrite: () => {},
        outputLayers: [],
    };

    let copied = false;
    let pastedNoTransparency = false;
    let pastedWithTransparency = false;
    let undoDone = false;
    let redoDone = false;
    function unhighlightKeyPressButtons() {
        // Some of these actions only complete on key-up, so we ned to delay resetting these,
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
        canvasArgs.outputLayers = s.args.outputLayers;
        canvasArgs.onWrite = s.args.onWrite;

        const cursorCell = getCursorCell(canvasState);
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
                const pasteCell = getCursorCell(canvasState);
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

