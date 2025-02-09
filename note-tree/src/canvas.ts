import { Button, ScrollContainer } from "src/components";
import { boundsCheck } from "src/utils/array-utils";
import { copyToClipboard, readFromClipboard } from "src/utils/clipboard";
import { Insertable, RenderGroup, cn, div, el, isVisible, newComponent, newListRenderer, setAttrs, setClass, setStyle, setText, setVisible } from "src/utils/dom-utils";
import { KeyboardState, handleKeyDownKeyboardState, handleKeyUpKeyboardState, newKeyboardState } from "./keyboard-input";
import { cnApp, cssVars } from "./styling";

const TAB_SIZE = 4;

type CanvasArgs = {
    state: CanvasState;
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
    // Callbacks, publically settable state
    onInput(): void;
    onWrite(): void;
    _canvasWasWrittenTo: boolean;
    layers: AsciiCanvasLayer[];

    // Input state
    keyboardState: KeyboardState;
    mouseInputState: MouseInputState;
    currentTool: ToolType;
    cursorRowCol: { i: number; j: number; };

    // Data state
    rows: RowArgs[];
    currentLayer: number;
    toolState: {
        startedAction: ToolType | undefined;
        startedMove: boolean;
        moveOffsetI: number;
        moveOffsetJ: number;
        selectionApplyType: "additive" | "subtractive" | "replace" | "toggle";
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


function newMouseInputState(): MouseInputState {
    return {
        x: -1, y: -1,
        lbDown: false,
        _lbWasDown: false,
        _prevX: 0, _prevY: 0,
    };
}

export function newCanvasState(): CanvasState {
    return {
        onInput() {},
        onWrite() {},
        _canvasWasWrittenTo: false,
        layers: [],
        keyboardState: newKeyboardState(),
        mouseInputState: newMouseInputState(),
        rows: [],
        currentTool: "rect-select",
        undoLog: [],
        cursorRowCol: { i: 0, j: 0 },
        undoLogPosition: -1,
        currentLayer: 0,
        toolState: {
            startedMove: false,
            startedAction: undefined,
            selectionApplyType: "replace",
            iPrev: 0,
            jPrev: 0,
            moveOffsetI: 0,
            moveOffsetJ: 0,
            jSelectStart: 0,
            iSelectStart: 0,
            keyboardSelectStart: false,
            keyboardMoveStart: false,
        },
    };
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
}

function newLayer(): AsciiCanvasLayer {
    return { data: [] };
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
    type DirectionMatrix = [boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean];
    function matchDirections(directions: DirectionMatrix, coords: [0 | 1 | 2, 0 | 1 | 2][]) {
        return coords.every(([i, j]) => directions[j + 3 * i]);
    }

    forEachCell(canvas, (c) => {
        if (!c.isSelected) {
            return;
        }

        const directions: DirectionMatrix = [
            isSelected(canvas, c.i - 1, c.j - 1), isSelected(canvas, c.i, c.j - 1), isSelected(canvas, c.i + 1, c.j - 1),
            isSelected(canvas, c.i - 1, c.j), true, isSelected(canvas, c.i + 1, c.j),
            isSelected(canvas, c.i - 1, c.j + 1), isSelected(canvas, c.i, c.j + 1), isSelected(canvas, c.i + 1, c.j + 1),
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

function isSelected(canvas: CanvasState, i: number, j: number): boolean {
    const cell = getCell(canvas, i, j);
    if (!cell) {
        return false;
    }

    return cell.isSelected;
}


function resizeLayer(layer: AsciiCanvasLayer, rows: number, cols: number) {
    const data = layer.data;

    while (data.length < rows) {
        data.push(Array(cols).fill(" "));
    }
    while (data.length > rows) {
        data.pop();
    }

    for (let i = 0; i < data.length; i++) {
        const rows = data[i];

        while (rows.length < cols) {
            rows.push(" ");
        }
        while (rows.length > cols) {
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


function getCharOnLayer(i: number, j: number, layer: AsciiCanvasLayer): string {
    if (
        boundsCheck(layer.data, i) &&
        boundsCheck(layer.data[i], j)
    ) {
        return layer.data[i][j] || " ";
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
    beingCalledInsideUndoFunction = false,
) {
    if (
        !boundsCheck(layer.data, i) ||
        !boundsCheck(layer.data[i], j)
    ) {
        return;
    }

    const layerIdx = getLayerIdx(canvas, layer);
    const prev = layer.data[i][j];
    if (char === prev) {
        return;
    }

    if (
        !beingCalledInsideUndoFunction &&
        // Writes to the 'temp' layer are inconsequental and shouldn't be undoable
        layerIdx !== -1
    ) {
        logUndoableChange(canvas, {
            row: i,
            col: j,
            char: { layerIdx, new: char, prev },
        });
    }

    if (layerIdx !== -1) {
        canvas._canvasWasWrittenTo = true;
    }

    layer.data[i][j] = char;
    return;
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

function lerp(a: number, b: number, t: number): number {
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
    for (const c of line) {
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
    for (let i = minY; i <= maxY; i++) {
        const row: string[] = [];
        for (let j = minX; j <= maxX; j++) {
            const cell = getCell(canvas, i, j);
            if (cell.isSelected) {
                const char = getCharOnCurrentLayer(canvas, i, j);
                row.push(char);
            } else {
                row.push(' ');
            }
        }

        lines.push(row.join("").trimEnd());
    }

    return lines.join("\n");
}

function getFirstNonWhitespace(canvas: CanvasState, row: number, blockedBySelection = true): number {
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


function getLastNonWhitespace(canvas: CanvasState, row: number, blockedBySelection = true): number {
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
    let lookUpwards = true;
    for (let i = 0; i <= WHITESPACE_GAP; i++) {
        if (getCharOnCurrentLayer(canvas, row, col - i) !== ' ') {
            lookUpwards = false;
            break;
        }
    }
    if (lookUpwards) {
        for (let i = rowStart; i >= 0; i--) {
            // if we can find a row above us with non-whitespace, we should use that. 
            // I think this is somewhat error-prone actually, and may need to be revised later.
            if (
                getCharOnCurrentLayer(canvas, i, col) !== ' '
                || getCharOnCurrentLayer(canvas, i - 1, col) !== ' '
                || getCharOnCurrentLayer(canvas, i + 1, col) !== ' '
            ) {
                row = i;
                break;
            }
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
    while (canvas.undoLog.length - 1 > canvas.undoLogPosition) {
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

        const cell: CanvasCellArgs | undefined = getCellOrUndefined(canvas, row, col);
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

                setCharOnLayer(canvas, row, col, char.prev, layer, false);
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

                setCharOnLayer(canvas, row, col, char.new, layer, false);
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
    return canvas.keyboardState.isAltPressed ? "move-selection" : canvas.currentTool;
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

type VisualCharInfo = {
    char: string;
    isSelected: boolean;
}

function getVisualChar(canvas: CanvasState, i: number, j: number, outInfo: VisualCharInfo) {
    const isMoving = canvas.toolState.startedMove;
    const thisCell = getCell(canvas, i, j);

    if (isMoving) {
        const iOffset = canvas.toolState.moveOffsetI;
        const jOffset = canvas.toolState.moveOffsetJ;

        const srcCell = getCellOrUndefined(canvas, i - iOffset, j - jOffset);
        if (srcCell?.isSelected) {
            outInfo.isSelected = true;
            outInfo.char = getCharOnCurrentLayer(canvas, srcCell.i, srcCell.j);
            return;
        }

        if (thisCell.isSelected) {
            outInfo.isSelected = false;
            outInfo.char = ' ';
            return;
        }
    }

    outInfo.isSelected = thisCell.isSelected;
    outInfo.char = getCharOnCurrentLayer(canvas, i, j);
}


function Canvas(rg: RenderGroup<CanvasArgs>) {
    let currentCursorEl: Insertable | null = null;
    let canvasState: CanvasState;
    let mouseInputState: MouseInputState;
    let shouldScroll = false;

    rg.preRenderFn(s => {
        canvasState = s.state;
        mouseInputState = canvasState.mouseInputState;

        if (s.state._canvasWasWrittenTo) {
            s.state.onWrite();
            s.state._canvasWasWrittenTo = false;
        }
    });

    const scrollContainer = newComponent(ScrollContainer);
    const root = setAttrs(scrollContainer, {
        style: "padding-top: 10px; padding-bottom: 10px; white-space: nowrap; width: fit-content; max-width: 100%;" +
            `border: 1px solid ${cssVars.fgColor};`
    }, true);

    const rowList = newListRenderer(root, () => newComponent((rg: RenderGroup<RowArgs>) => {
        const root = div({
            class: [cn.row, cn.justifyContentCenter],
            style: "width: fit-content;"
        });

        const charList = newListRenderer(root, () => newComponent((rg: RenderGroup<CanvasCellArgs>) => {
            // Memoizing for peformance. 
            let lastState = -1;
            let lastIsCursor = false;
            let lastChar = "";

            const visualCharInfo: VisualCharInfo = {
                isSelected: false,
                char: ' '
            };

            const root = el("SPAN", {
                class: [cn.pre, cn.inlineBlock, cn.borderBox],
                style: "font-size: 24px; width: 1ch; user-select: none; cursor: crosshair;"
            });

            rg.preRenderFn(function renderCanvasCell(s) {
                const { canvasState, j, i, isSelectedPreview: isSelectedTemp, } = s;

                getVisualChar(canvasState, i, j, visualCharInfo);
                const { char, isSelected } = visualCharInfo;

                if (lastChar !== visualCharInfo.char) {
                    lastChar = char;
                    setText(root, char);
                }

                const isCursor = i === canvasState.cursorRowCol.i
                    && j === canvasState.cursorRowCol.j;
                if (isCursor !== lastIsCursor) {
                    lastIsCursor = isCursor;

                    setStyle(root, `outline`, !isCursor ? `` : `2px solid ${cssVars.fgColor}`);
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
                        state === 1 ? `${cssVars.bgColorFocus}` :
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
            });

            function handleMouseMovement(e: MouseEvent) {
                e.stopImmediatePropagation();

                const s = rg.s;
                const mouseInputState = s.canvasState.mouseInputState;
                mouseInputState.x = s.j;
                mouseInputState.y = s.i;

                onMouseInputStateChange();
            }

            root.el.addEventListener("mousemove", handleMouseMovement);

            return root;
        }, undefined, true /* We want errors to be caught by the root canvas, not inside of this specific cell. */));

        rg.preRenderFn(function renderCanvasRow(s) {
            const { charList: rowList } = s;

            charList.render((getNext) => {
                for (let i = 0; i < rowList.length; i++) {
                    const c = getNext();
                    c.render(rowList[i]);
                }
            });
        });

        return root;
    }, undefined, true /* We want errors to be caught by the root canvas, not inside of this specific cell. */));

    root.el.addEventListener("mouseleave", () => {
        canvasState.mouseInputState.x = -1;
        canvasState.mouseInputState.y = -1;
        onMouseInputStateChange();
    });

    function clearSelectionPreview() {
        forEachCell(canvasState, (c) => c.isSelectedPreview = false);
    }

    function selectLine(x1: number, y1: number, x2: number, y2: number) {
        const dirX = x2 - x1;
        const dirY = y2 - y1;

        const mag = Math.sqrt(dirX * dirX + dirY * dirY);

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
        while (coords = queue.pop()) {
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
            if (!cancel) {
                // apply the move we started
                const tempLayer = newLayer();
                const selectionLayer = newLayer(); // HACK: should be booleans. but I don't care
                resizeLayer(tempLayer, getNumRows(canvasState), getNumCols(canvasState));
                resizeLayer(selectionLayer, getNumRows(canvasState), getNumCols(canvasState));

                const visualInfo: VisualCharInfo = {
                    char: ' ',
                    isSelected: false,
                };

                forEachCell(canvasState, c => {
                    getVisualChar(canvasState, c.i, c.j, visualInfo);
                    tempLayer.data[c.i][c.j] = visualInfo.char;
                    selectionLayer.data[c.i][c.j] = visualInfo.isSelected ? "y" : "n";
                });

                forEachCell(canvasState, c => {
                    setCharOnCurrentLayer(canvasState, c.i, c.j, tempLayer.data[c.i][c.j]);
                    selectCell(canvasState, c.i, c.j, selectionLayer.data[c.i][c.j] === "y");
                });
            }

            canvasState.toolState.startedMove = false;
            canvasState.toolState.moveOffsetI = 0;
            canvasState.toolState.moveOffsetJ = 0;
            return;
        }

        if (isSelectionTool(startedAction)) {
            if (!cancel) {
                const applyType = canvasState.toolState.selectionApplyType;

                if (applyType === "additive") {
                    forEachCell(canvasState, (c) => {
                        // additive selection
                        if (c.isSelectedPreview) {
                            selectCell(canvasState, c.i, c.j, true);
                        }
                    });
                } else if (applyType === "subtractive") {
                    forEachCell(canvasState, (c) => {
                        // subtractive selection
                        if (c.isSelectedPreview) {
                            selectCell(canvasState, c.i, c.j, false);
                        }
                    });
                } else if (applyType === "replace") {
                    forEachCell(canvasState, (c) => {
                        // replace selection
                        selectCell(canvasState, c.i, c.j, c.isSelectedPreview);
                    });
                } else if (applyType === "toggle") {
                    forEachCell(canvasState, (c) => {
                        // replace selection
                        if (c.isSelectedPreview) {
                            selectCell(canvasState, c.i, c.j, !c.isSelected);
                        }
                    });
                }
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
        isMouse: boolean,
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

        if (
            mouseInputState.lbDown
            || !isMouse
        ) {
            moveCursor(canvasState, iInput, jInput);
        }

        if (isMouse) {
            if (canvasState.keyboardState.isShiftPressed) {
                toolState.selectionApplyType = "subtractive";
            } else if (canvasState.keyboardState.isCtrlPressed) {
                toolState.selectionApplyType = "additive";
            } else {
                toolState.selectionApplyType = "replace";
            }
        } else {
            toolState.selectionApplyType = "toggle";
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
            if (started) {
                toolState.startedMove = true;
            }

            toolState.moveOffsetI = iInput - toolState.iSelectStart;
            toolState.moveOffsetJ = jInput - toolState.jSelectStart;
        }

        toolState.iPrev = iInput;
        toolState.jPrev = jInput;
    }

    function onMouseInputStateChange() {
        if (mouseInputState.x === -1 || mouseInputState.y === -1) {
            canvasState.onInput();
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
                mouseInputState.x,
                true,
            );
        }

        mouseInputState._prevX = mouseInputState.x;
        mouseInputState._prevY = mouseInputState.y;
        mouseInputState._lbWasDown = mouseInputState.lbDown;

        canvasState.onInput();
    }

    rg.preRenderFn(function renderCanvas(s) {
        if (canvasState.layers.length < 1) {
            canvasState.layers.push(newLayer());
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

        if (!scrollContainer._s) {
            scrollContainer._s = {
                scrollEl: null,
                axes: "hv",
            };
        }

        if (shouldScroll) {
            shouldScroll = false;
            scrollContainer.s.scrollEl = currentCursorEl;
            scrollContainer.render(scrollContainer.s);
        }
    });

    document.addEventListener("mousedown", () => {
        if (!isVisible(root)) {
            return;
        }

        const mouseInputState = canvasState.mouseInputState;
        mouseInputState.lbDown = true;
        onMouseInputStateChange();
    });

    document.addEventListener("mouseup", () => {
        if (!isVisible(root)) {
            return;
        }

        const mouseInputState = canvasState.mouseInputState;
        mouseInputState.lbDown = false;
        onMouseInputStateChange();
    });

    document.addEventListener("keyup", () => {
        if (!isVisible(root)) {
            return;
        }

        canvasState.onInput();
    });

    function handleKeyDown(e: KeyboardEvent) {
        handleKeyDownKeyboardState(canvasState.keyboardState, e);

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
                    handleSelect(canvasState, true, cursorCell.i, cursorCell.j, false);
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
                    handleSelect(canvasState, false, cursorCell.i, cursorCell.j, false);
                }
            }
        } else if (e.key === "Enter") {
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
        if (!isVisible(root)) {
            return;
        }

        handleKeyDown(e);

        canvasState.onInput();

        rg.renderWithCurrentState();
    });

    document.addEventListener("keyup", (e) => {
        if (!isVisible(root)) {
            return;
        }

        handleKeyUpKeyboardState(canvasState.keyboardState, e);

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
            rg.renderWithCurrentState();
        }
    });

    return root;
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
const MIN_NUM_COLS = 64;

export type AsciiCanvasArgs = {
    canvasState: CanvasState;
    outputLayers: AsciiCanvasLayer[];
    /** 
     * NOTE: these events will fire very very often. Don't do any even remotely non-performant things in here - debounce them instead 
     */
    onInput(): void;
    onWrite(): void;
}

export function AsciiCanvas(rg: RenderGroup<AsciiCanvasArgs>) {
    // NOTE: This component is tightly coupled to AsciiCanvas, and shouldn't be moved out
    function ToolbarButton(rg: RenderGroup<{
        canvasState: CanvasState;
        name: string;
        onClick(e: MouseEvent): void;
        tool?: ToolType;
        selected?: boolean;
        disabled?: boolean;
    }>) {
        const button = newComponent(Button);

        rg.preRenderFn(function renderAsciiCanvasToolbarButton(s) {
            const { tool, selected, disabled } = s;

            setText(button, s.name);
            button.render({
                label: s.name,
                style: ";text-align: center; align-items: center;",
                inline: true,
                onClick: (e) => {
                    const { onClick, tool } = s;

                    if (tool) {
                        changeTool(tool);
                    }

                    onClick(e);
                }
            });

            const isCurrentTool = getTool(s.canvasState) === tool;
            setClass(button, cnApp.inverted, !!selected || isCurrentTool);
            setClass(button, cnApp.unfocusedTextColor, !!disabled);
        });

        return button;
    }

    function changeTool(tool?: ToolType) {
        if (!tool) {
            return;
        }

        canvasState.currentTool = tool;
        rerenderLocal();
    }

    const buttons = {
        moreRows: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "+",
            onClick: () => {
                resizeLayers(canvasState, getNumRows(canvasState) + NUM_ROWS_INCR_AMOUNT, getNumCols(canvasState));
                rerenderLocal();
            },
        })),
        lessRows: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "-",
            onClick: () => {
                resizeLayers(canvasState, getNumRows(canvasState) - NUM_ROWS_INCR_AMOUNT, getNumCols(canvasState));
                rerenderLocal();
            },
        })),
        moreCols: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
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
        lessCols: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "-",
            onClick: () => {
                resizeLayers(canvasState, getNumRows(canvasState), getNumCols(canvasState) - NUM_COLUMNS_INCR_AMOUNT);
                rerenderLocal();
            },
        })),
        freeformSelect: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "Draw",
            onClick: rerenderLocal,
            tool: "freeform-select" satisfies ToolType,
        })),
        lineSelect: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "Line",
            onClick: rerenderLocal,
            tool: "line-select",
        })),
        rectOutlineSelect: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "Rect Outline",
            onClick: rerenderLocal,
            tool: "rect-outline-select",
        })),
        rectSelect: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "Rect",
            onClick: rerenderLocal,
            tool: "rect-select",
        })),
        bucketFillSelect: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "Fill",
            onClick: rerenderLocal,
            tool: "fill-select",
        })),
        bucketFillSelectOutline: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "Fill Outline",
            onClick: rerenderLocal,
            tool: "fill-select-outline",
        })),
        bucketFillSelectConnected: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "Fill Connected",
            onClick: rerenderLocal,
            tool: "fill-select-connected",
        })),
        invertSelection: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "Invert Selection",
            onClick: () => {
                forEachCell(canvasState, (c) => selectCell(canvasState, c.i, c.j, !c.isSelected));
                rerenderLocal();
            },
        })),
        copyToClipboard: rg.c(ToolbarButton, (button) => {
            button.render({
                canvasState,
                name: "Copy",
                onClick: copyCanvasToClipboard,
                selected: copied,
            })
        }),
        pasteFromClipboard: rg.c(ToolbarButton, (button) => {
            button.render({
                canvasState,
                name: "Paste",
                onClick: () => {
                    pasteClipboardToCanvas(cursorCell?.i || 0, cursorCell?.j || 0, false);
                    rerenderLocal();
                },
                selected: pastedNoTransparency,
                disabled: !canPaste,
            });
        }),
        pasteFromClipboardTransparent: rg.c(ToolbarButton, (button) => {
            button.render({
                canvasState,
                name: "Paste (transparent)",
                onClick: () => {
                    pasteClipboardToCanvas(cursorCell?.i || 0, cursorCell?.j || 0, false);
                    rerenderLocal();
                },
                selected: pastedWithTransparency,
                disabled: !canPaste,
            });
        }),
        linesFromSelection: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "Draw Lines",
            onClick: () => {
                generateLines(canvasState);
                rerenderLocal();
            }
        })),
        undoButton: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "Undo",
            selected: undoDone,
            disabled: !canUndo(canvasState),
            onClick: undo,
        })),
        redoButton: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "Redo",
            selected: redoDone,
            disabled: !canRedo(canvasState),
            onClick: redo,
        })),
    };

    const statusText = div({ style: "text-align: center" });
    const performanceWarning = div({ style: "text-align: center" }, [
        "!! Warning: A large number of rows/columns will currently be bad for performance !!"
    ]);

    let cursorCell: CanvasCellArgs | undefined;
    let canPaste = false;

    const mouseScrollList = [
        buttons.rectSelect,
        buttons.freeformSelect,
        buttons.rectOutlineSelect,
        buttons.lineSelect,
        buttons.bucketFillSelect,
        buttons.bucketFillSelectOutline,
        buttons.bucketFillSelectConnected,
    ];

    const toolbar = div({ style: "gap: 5px;" }, [
        div({ class: [cn.inlineBlock] }, [
            buttons.lessRows,
            div({ style: "display: inline-block; min-width: 3ch; text-align: center;", class: ["", ""] }, [
                rg.text(() => "rows: " + getNumRows(canvasState)),
            ]),
            buttons.moreRows,
            buttons.lessCols,
            div({ style: "display: inline-block; min-width: 3ch; text-align: center;" }, [
                rg.text(() => "cols: " + getNumCols(canvasState)),
            ]),
            buttons.moreCols,
        ]),
        spacer(),
        div({ class: [cn.inlineBlock] }, [
            rg.text(() => "Selection (Ctrl + [Q/E]): "),
            ...mouseScrollList,
        ]),
        spacer(),
        div({ class: [cn.inlineBlock] }, [
            buttons.invertSelection,
        ]),
        spacer(),
        div({ class: [cn.inlineBlock] }, [
            buttons.copyToClipboard,
            buttons.pasteFromClipboard,
            buttons.pasteFromClipboardTransparent,
        ]),
        spacer(),
        div({ class: [cn.inlineBlock] }, [
            buttons.linesFromSelection,
        ]),
        div({ class: [cn.inlineBlock] }, [
            buttons.undoButton,
            rg.text(() => (1 + canvasState.undoLogPosition) + " / " + canvasState.undoLog.length),
            buttons.redoButton,
        ]),
    ]);

    function spacer() {
        return div({ class: [cn.inlineBlock], style: "width: 30px" });
    }

    const canvasComponent = newComponent(Canvas);
    let canvasState: CanvasState;
    rg.preRenderFn(function renderAsciiCanvas(s) {
        canvasState = s.canvasState;
        canvasState.layers = s.outputLayers;
        canvasState.onInput = rerenderLocal;
        canvasState.onWrite = s.onWrite;

        const cursorCell = getCursorCell(s.canvasState);
        canPaste = !!cursorCell;

        canvasComponent.render({ state: s.canvasState });

        updateCanvasStausText(canvasState);
    });

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
        rg.renderWithCurrentState();
        const s = rg.s;
        s.onInput();
    }

    function prevTool() {
        let idx = mouseScrollList.findIndex((button) => {
            return button.s?.tool === canvasState.currentTool;
        });

        if (idx > 0) {
            idx--;
        } else {
            idx = mouseScrollList.length - 1;
        }

        const s = mouseScrollList[idx].s;
        changeTool(s.tool);
    }

    function nextTool() {
        let idx = mouseScrollList.findIndex((button) => {
            return button.s?.tool === canvasState.currentTool;
        });

        if (idx < mouseScrollList.length - 1) {
            idx++;
        } else {
            idx = 0;
        }

        const s = mouseScrollList[idx].s;
        changeTool(s.tool);
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
        if (!isVisible(root)) {
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

    const root = div({ class: [cn.relative, cn.h100, cn.row] }, [
        div({ class: [cn.col, cn.justifyContentCenter, cn.alignItemsCenter, cn.overflowAuto ]}, [
            div({ class: [cn.flex1] }),
            canvasComponent,
            statusText,
            performanceWarning,
            div({ class: [cn.flex1] }),
            toolbar,
        ]),
        div({ style: "width: 20px" }),
    ]);
    return root;
}

