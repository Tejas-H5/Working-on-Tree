import { boundsCheck } from "src/utils/array-utils";
import { KeyboardState, newKeyboardState } from "../legacy-keyboard-input";
import { assert } from "src/utils/assert";

// I want the canvas to be like a diagram board, where I append a slab of vertical rows to the page 
// Whenever I need a new page. 1 page with is approximately the width of the screen, and same for page height and 1 scren height.
export const NUM_ROWS_INCR_AMOUNT = 32;
// However, I don't expect the width I need to change very much at all. 
export const NUM_COLUMNS_INCR_AMOUNT = 8;
export const MIN_NUM_COLS = 64;
export const WHITESPACE_GAP = 2;
export const UNDO_REDO_THERSHOLD_MS = 10;

export type CanvasArgs = {
    state: CanvasState;
};

export type MouseInputState = {
    lbDown: boolean;
    x: number;
    y: number;

    _lbWasDown: boolean;
    _prevX: number;
    _prevY: number;
}

export type UndoLogEntryData = {
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
export type UndoLogEntry = {
    timestampMs: number;
    data: UndoLogEntryData;
}

export type CanvasState = {
    // Callbacks, publically settable state
    onInput(): void;
    onWrite(): void;
    _canvasWasWrittenTo: boolean;
    layers: AsciiCanvasLayer[];

    // Setings
    tabSize: number;

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
        iArrow: number;
        jArrow: number;
    };

    // Undo state
    undoLog: UndoLogEntry[];
    // This will always point to the last change that was _applied_. Should default to -1 if nothing in the undo log
    undoLogPosition: number;
}


export function newMouseInputState(): MouseInputState {
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
        tabSize: 4,
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
            iArrow: -1,
            jArrow: -1,
        },
    };
}

export type ToolType = "freeform-select" |
    "line-select" |
    "rect-outline-select" |
    "rect-select" |
    "fill-select" |
    "fill-select-connected" |
    "fill-select-outline" |
    "move-selection";

export type RowArgs = {
    charList: CanvasCellArgs[];
};

export type CanvasCellArgs = {
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

export function newLayer(): AsciiCanvasLayer {
    return { data: [] };
}

export function selectCell(canvas: CanvasState, i: number, j: number, value: boolean, calledInUndoFn = false) {
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

export function generateLines(canvas: CanvasState, arrow: boolean) {
    const sel = (i: number, j: number) => {
        const cell = getCellOrUndefined(canvas, i, j);
        if (!cell) {
            return false
        }

        return cell.isSelected && !cell.isVisited;
    }

    const getChar = (i: number, j: number, passNumber: number): string => {
        const u = sel(i + 1, j);
        const ur = sel(i + 1, j + 1);
        const ul = sel(i + 1, j - 1);
        const l = sel(i, j - 1);
        const dl = sel(i - 1, j - 1);
        const d = sel(i - 1, j);
        const dr = sel(i - 1, j + 1);
        const r = sel(i, j + 1);

        let c = 0;
        if (u) c++;
        if (d) c++;
        if (l) c++;
        if (r) c++;
        if (dl) c++;
        if (dr) c++;
        if (ur) c++;
        if (ul) c++;

        // Took 3 hours of trial and error figuring this shit out. Totally worth it!
        //
        //                                \               |          ,|                                          |
        //  |                              )              )       ,-'                                            (
        //  |                              |             /       (                                                \
        //  |                 |-\          A       /              \                  |                             \
        //  |                 |--|      |---------'                '-,           ,--' \                |-\          )
        //  |                (              V                         \         /      -,           ,-' \-|         |
        //  (                (               )                         \       /      /  \         (       )
        //   \    ,-|         '------|       |               \          )        |---'    ',        \     /           ,,
        //    '--'                                            '--------'                    )        '---'          |-  -|
        //                                                                                  |                         ''
        //                                                                                  )
        //                                                                           |-----'
        //
        //         ,|                                                              \
        //       ,'                                                                 ',
        //     ,'                                                                     ',
        //    /                                                                         \
        //   /     |                                                                     \
        //  /      |                                                                      \
        // (       |                                                           ,,          \
        // |       |           \     /   ,-,                ,-,              ,-  |          \
        // |       (            )  ,'   (   \            ,-'   )            (  '' \          \
        // |        \           | /   \ |    \          (      |            |      \          )
        // (         \          ||     ||     \         |      |\           (       )         |
        //  \         \         \|     \|      ',       (      |-|           \      )         |
        //   \         ',        |      |        \       '----'   '----|      '----'          )
        //    \          '-|                                        \|                       /
        //     ',                                                                           /
        //       ',                                                                        /
        //
        // Some parts could be better, but don't care.
        //
        if (passNumber === 0) {
            if (
                // is this a corner? let's round it off. can't round off both types of corers in one pass though, since we would 
                // start making cuts in the line segment.
                ((u && r) || (r && d)) && (c === 2 || c === 3)
            ) {
                return " ";
            }
        } else if (passNumber === 1) {
            if (
                // is this a corner? and opposite to the one we rounded off earlier?
                ((d && l) || (l && u)) && (c === 2 || c === 3)
            ) {
                return " ";
            }
        } else if (passNumber === 2) {
            if (((ul || dr) && (c === 1)) || (ul && dr && c === 2)) {
                return "/";
            }
            if (((ur || dl) && (c === 1)) || (ur && dl && c === 2)) {
                return "\\";
            }

            if (((ul && r) || (ur && l)) && c === 2) {
                return ",";
            }
            if (((dl && r) || (dr && l)) && c === 2) {
                return  "'";
            }
            if (((dl && ul) || (dl && u) || (ul && d)) && c === 2) {
                return  ")";
            }
            if (((dr && ur) || (dr && u) || (ur && d)) && c === 2) {
                return  "(";
            }
            if (
                (dr && r && ur && c === 3) ||
                (l && dr && r && ur && c === 4) 
            ) {
                return  "E";
            }
            if (
                (dl && l && ul && c === 3) ||
                (r && dl && l && ul && c === 4) 
            ) {
                return  "Ǝ";
            }
            if (d && l && u && r) {
                if (c === 4) {
                    return "+";
                } else {
                    return "#";
                }
            }
            if (
                (r && dr && d && !l && ! ul && !u) ||
                (!r && !dr && !d && l && ul && u) 
            ) {
                return "\\";
            }
            if (d && dl && dr && !r && !l) {
                return "V"
            }
            if (u && ul && ur && !r && !l) {
                return "A"
            }
            if (
                (!ul && !l) ||
                (!dl && !l) ||
                (!ur && !r) ||
                (!dr && !r) 
            ) {
                return "|";
            }
            if (
                (!d && !dl) ||
                (!d && !dr) ||
                (!u && !ul) ||
                (!u && !ur)
            ) {
                return  "-";
            }
        }

        return "";
    }


    forEachCell(canvas, (c) => c.isVisited = false);
    for (let passNumber = 0; passNumber < 3; passNumber++) {
        forEachCell(canvas, (c) => {
            if (!c.isSelected) {
                return;
            }

            if (c.isVisited) {
                return;
            }

            const char = getChar(c.i, c.j, passNumber);

            if (char) {
                if (char === " ") {
                    c.isVisited = true;
                }  else {
                    setCharOnCurrentLayer(canvas, c.i, c.j, char);
                }
            }
        });
    }

    if (arrow) {
        let arrow = "";
        if (isSelected(
            canvas, canvas.toolState.iArrow - 1, canvas.toolState.jArrow)
        ) {
            arrow = "▼";
        } else if (isSelected(
            canvas, canvas.toolState.iArrow + 1, canvas.toolState.jArrow)
        ) {
            arrow = "▲";
        } else if (isSelected(
            canvas, canvas.toolState.iArrow, canvas.toolState.jArrow + 1)
        ) {
            arrow = "◄";
        } else if (isSelected(
            canvas, canvas.toolState.iArrow, canvas.toolState.jArrow - 1)
        ) {
            arrow = "►";
        }

        if (arrow) {
            setCharOnCurrentLayer(canvas, canvas.toolState.iArrow, canvas.toolState.jArrow, arrow);
        }
    }
}

export function isSelected(canvas: CanvasState, i: number, j: number): boolean {
    const cell = getCellOrUndefined(canvas, i, j);
    if (!cell) {
        return false;
    }

    return cell.isSelected;
}


export function resizeLayer(layer: AsciiCanvasLayer, rows: number, cols: number) {
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

export function resizeLayers(canvas: CanvasState, rows: number, cols: number) {
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


export function getCharOnLayer(i: number, j: number, layer: AsciiCanvasLayer): string {
    if (
        boundsCheck(layer.data, i) &&
        boundsCheck(layer.data[i], j)
    ) {
        return layer.data[i][j] || " ";
    }

    return ' ';
}

export function getLayerIdx(canvas: CanvasState, layer: AsciiCanvasLayer): number {
    return canvas.layers.indexOf(layer);
}

export function setCharOnLayer(
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

export function getCharOnCurrentLayer(canvas: CanvasState, i: number, j: number): string {
    return getCharOnLayer(i, j, getCurrentLayer(canvas));
}

export function setCharOnCurrentLayer(canvas: CanvasState, i: number, j: number, char: string) {
    if (char.length > 1) {
        throw new Error("Invalid char");
    }
    setCharOnLayer(canvas, i, j, char, getCurrentLayer(canvas));
}

export function getCurrentLayer(canvas: CanvasState): AsciiCanvasLayer {
    return canvas.layers[canvas.currentLayer];
}

export function forEachCell(canvas: CanvasState, fn: (char: CanvasCellArgs) => void) {
    for (let i = 0; i < canvas.rows.length; i++) {
        for (let j = 0; j < canvas.rows[i].charList.length; j++) {
            fn(getCell(canvas, i, j));
        }
    }
}

export function getCellOrUndefined(canvas: CanvasState, i: number, j: number): CanvasCellArgs | undefined {
    return canvas.rows[i]?.charList[j];
}
export function getCell(canvas: CanvasState, i: number, j: number): CanvasCellArgs {
    const cell = getCellOrUndefined(canvas, i, j);
    if (!cell) {
        throw new Error("Cell wasn't present!");
    }

    return cell;
}

export function getNumCols(canvas: CanvasState) {
    if (canvas.layers[0].data.length === 0) {
        return 0;
    }

    return canvas.layers[0].data[0].length;
}

export function getNumRows(canvas: CanvasState) {
    return canvas.layers[0].data.length;
}

export function lerp(a: number, b: number, t: number): number {
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
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

export function lineLength(line: string, canvas: CanvasState) {
    // unicode moment
    let len = 0;
    for (const c of line) {
        if (c === "\t") {
            len += canvas.tabSize;
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
    text.replace(/\t/g, " ".repeat(canvas.tabSize));
    const lines = text.split("\n");

    if (resizeLayersToPasted) {
        row = 0;
        col = 0;
        let wantedRows = lines.length;
        let wantedCols = Math.max(...lines.map(l => lineLength(l, canvas)), MIN_NUM_COLS);
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

export function getCanvasSelectionAsString(canvas: CanvasState) {
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

export function getFirstNonWhitespace(canvas: CanvasState, row: number, blockedBySelection = true): number {
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


export function getLastNonWhitespace(canvas: CanvasState, row: number, blockedBySelection = true): number {
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

export function getCurrentLineStart(canvas: CanvasState, rowStart: number, col: number) {
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

export function logUndoableChange(canvas: CanvasState, entryData: UndoLogEntryData) {
    if (canvas.undoLog.length !== canvas.undoLogPosition + 1) {
        canvas.undoLog.length = canvas.undoLogPosition + 1;
    }

    canvas.undoLog.push({
        timestampMs: Date.now(),
        data: entryData
    });

    canvas.undoLogPosition += 1;
}

export function canUndo(canvas: CanvasState): boolean {
    return canvas.undoLogPosition >= 0;
}

export function resetUndoLog(canvas: CanvasState) {
    canvas.undoLog.length = 0;
    canvas.undoLogPosition = -1;
}

export function moveThroughUndoLog(canvas: CanvasState, {
    timeWithinMs = 100,
    backwards = true,
} = {}) {
    if (canvas.undoLog.length === 0) {
        return;
    }

    assert(canvas.undoLogPosition >= -1 && canvas.undoLogPosition < canvas.undoLog.length);

    if (backwards) {
        if (canUndo(canvas)) {
            const t0 = canvas.undoLog[canvas.undoLogPosition].timestampMs;
            while (canUndo(canvas)) {
                const currentChange = canvas.undoLog[canvas.undoLogPosition];
                if (Math.abs(currentChange.timestampMs - t0) > timeWithinMs) {
                    break;
                }

                canvas.undoLogPosition--;

                const { row, col, char, selection } = currentChange.data;

                if (char) {
                    const layer = canvas.layers[char.layerIdx];
                    if (!layer) {
                        throw new Error("Addition/removal of layers wasn't correctly undone/redone!");
                    }

                    setCharOnLayer(canvas, row, col, char.prev, layer, true);
                }

                if (selection) {
                    selectCell(canvas, row, col, selection.prev, true);
                }
            }
        }
    } else {
        if (canRedo(canvas)) {
            const t0 = canvas.undoLog[canvas.undoLogPosition + 1].timestampMs;

            while (canRedo(canvas)) {
                const currentChange = canvas.undoLog[canvas.undoLogPosition + 1];

                if (Math.abs(currentChange.timestampMs - t0) > timeWithinMs) {
                    break;
                }

                canvas.undoLogPosition++;

                const { row, col, char, selection } = currentChange.data;

                if (char) {
                    const layer = canvas.layers[char.layerIdx];
                    if (!layer) {
                        throw new Error("Addition/removal of layers wasn't correctly undone/redone!");
                    }

                    setCharOnLayer(canvas, row, col, char.new, layer, true);
                }

                if (selection) {
                    selectCell(canvas, row, col, selection.new, true);
                }
            }
        }
    }
}

export function undoWithinTime(canvas: CanvasState) {
    moveThroughUndoLog(canvas, {
        timeWithinMs: UNDO_REDO_THERSHOLD_MS,
        backwards: true,
    });
}

export function canRedo(canvas: CanvasState): boolean {
    return canvas.undoLogPosition < canvas.undoLog.length - 1;
}

export function redoWithinTime(canvas: CanvasState) {
    moveThroughUndoLog(canvas, {
        timeWithinMs: UNDO_REDO_THERSHOLD_MS,
        backwards: false,
    });
}

export function getTool(canvas: CanvasState): ToolType {
    return canvas.keyboardState.isAltPressed ? "move-selection" : canvas.currentTool;
}

export function getCursorCell(canvas: CanvasState): CanvasCellArgs | undefined {
    return getCellOrUndefined(canvas, canvas.cursorRowCol.i, canvas.cursorRowCol.j);
}

export function moveCursor(canvas: CanvasState, i: number, j: number) {
    canvas.cursorRowCol.i = i;
    canvas.cursorRowCol.j = j;

    // If we're moving by 1 at a time, we can expand the canvas.
    const rows = getNumRows(canvas);
    const cols = getNumCols(canvas);
    if (i === rows || j === cols) {
        resizeLayers(canvas, Math.max(rows, i + 1), Math.max(cols, j + 1));
    }
}

export function newLine(canvasState: CanvasState) {
    const cursorCell = getCursorCell(canvasState);
    if (!cursorCell) return;

    const typingStartCol = getCurrentLineStart(canvasState, cursorCell.i, cursorCell.j);
    moveCursor(canvasState, canvasState.cursorRowCol.i + 1, typingStartCol);
}

export function backspaceNum(canvas: CanvasState, count: number, shouldMoveCursor: boolean) {
    const cursorCell = getCursorCell(canvas);
    if (!cursorCell) return;

    if (cursorCell.j - count < 0) count = cursorCell.j;
    if (count === 0) return;

    const end = findVirtualEnd(canvas, cursorCell.i, cursorCell.j);
    for (let i = cursorCell.j - count; i < end; i++) {
        const char = getCharOnCurrentLayer(canvas, cursorCell.i, i + count);
        setCharOnCurrentLayer(canvas, cursorCell.i, i + count, ' ');
        setCharOnCurrentLayer(canvas, cursorCell.i, i, char);
    }

    if (shouldMoveCursor) {
        moveCursor(canvas, cursorCell.i, cursorCell.j - count);
    }
}

// Useful when we want to shift a tightly-packed group of characters, without touching anything past a whitespace.
//  lasjds lsajdkls ksll                          lasdkjkaldsf
//  ^^^^^^^^^^^^^^^^^^^^  <- we only want to move these around. Hence, virtual end
export function findVirtualEnd(canvasState: CanvasState, row: number, colAt: number) {
    const WHITESPACE_DISTANCE = 4;

    const numCols = getNumCols(canvasState);

    let run = 0;
    let end = numCols - 1;
    for (let col = colAt; col < numCols; col++) {
        const char = getCharOnCurrentLayer(canvasState, row, col);
        if (char === ' ') {
            run++;
        } else {
            run = 0
        }
        if (run > WHITESPACE_DISTANCE) {
            end = col - WHITESPACE_DISTANCE;
            break;
        }
    }

    return end;
}

export function typeChar(canvasState: CanvasState, key: string) {
    const cursorCell = getCursorCell(canvasState);
    if (!cursorCell) return;

    const numCols = getNumCols(canvasState);

    const end = findVirtualEnd(canvasState, cursorCell.i, cursorCell.j);

    // shift this stuff one to the right
    
    for (let col = end; col >= cursorCell.j; col--) {
        const row = cursorCell.i;
        const char = getCharOnCurrentLayer(canvasState, row, col);

        if (col === numCols - 1) {
            resizeLayers(canvasState, getNumRows(canvasState), numCols + 1);
        }
        setCharOnCurrentLayer(canvasState, row, col + 1, char);
    }

    // Type this letter using the cursor cell
    setCharOnCurrentLayer(canvasState, cursorCell.i, cursorCell.j, key);
    moveCursor(canvasState, cursorCell.i, cursorCell.j + 1);
}

export function moveToNonWhitespaceOrSelected(
    start: number,
    len: number,
    getChar: (i: number) => string,
    getSelected: (i: number) => boolean,
    isWhitespace = true,
    backwards = true,
    stopBefore = false,
    doSecondPart = true,    //lmao, we really just be piling shit ontop of shit
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

    if (doSecondPart) {
        while (
            pos + dir >= limitLower
            && pos + dir <= limitHigher
            && (getChar(pos) === ' ') === isWhitespace
            && (initialSelected === getSelected(pos))
        ) {
            pos += dir;
        }
    }

    if (stopBefore) {
        pos -= dir;
    }

    return pos;
}

export function isSelectionTool(tool: ToolType) {
    return tool === "freeform-select"
        || tool === "line-select"
        || tool === "rect-outline-select"
        || tool === "rect-select"
        || tool === "fill-select"
        || tool === "fill-select-connected"
        || tool === "fill-select-outline"
        || tool === "move-selection";
}


export function getNumSelected(canvas: CanvasState) {
    let numSelected = 0;
    forEachCell(canvas, c => c.isSelected && numSelected++);
    return numSelected;
}

export type VisualCharInfo = {
    char: string;
    isSelected: boolean;
}

export function getVisualChar(canvas: CanvasState, i: number, j: number, outInfo: VisualCharInfo) {
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

