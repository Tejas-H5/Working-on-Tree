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
};

type ToolType = "freeform-select" | 
    "line-select" |
    "rect-outline-select" |
    "rect-select" |
    "fill-select" |
    "fill-select-outline" |
    "move-selection";

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

type RowArgs = {
    charList: CanvasCellArgs[];
};

type CanvasCellArgs = {
    // just a 1-length string
    char: string;

    // CSS borders - bl = border left, etc. It was a pain to type...
    bl: boolean;
    br: boolean;
    bt: boolean;
    bb: boolean;

    // WHY TF did I use x, y here. Should have been row/col or i/j so that all my code could have been consistent
    // but for some reason I didn't do that. And I wrote all of this on the same day too...
    x: number;
    y: number;

    canvasState: CanvasState;
    isSelected: boolean;
    isSelectedPreview: boolean;

    // Used for recursive propagations where we want to avoid re-visiting a coordinate
    isVisited: boolean;
};

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
            minX = Math.min(c.x, minX);
            maxX = Math.max(c.x, maxX);
            minY = Math.min(c.y, minY);
            maxY = Math.max(c.y, maxY);
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
                stringBuilder.push(cell.char);
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
                const { canvasState, x, y, char, bl, br, bt, bb, isSelected, isSelectedPreview: isSelectedTemp, } = component.args;

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
                    x === canvasState.mouseInputState.x && 
                    y === canvasState.mouseInputState.y
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
                mouseInputState.x = component.args.x;
                mouseInputState.y = component.args.y;

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
                    c.render(rowList[i]);
                }
            });
        });

        component.el.addEventListener("mouseleave", () => {
            canvasState.mouseInputState.x = -1;
            canvasState.mouseInputState.y = -1;
            onMouseInputStateChange();
        });

        return component;
    });

    const rows: RowArgs[] = [];

    const toolState = {
        typingStartX: 0,
        selectionStartX: 0,
        selectionStartY: 0,
    };

    function clearSelectionPreview() {
        forEachCell(canvasState, (c) => c.isSelectedPreview = false);
    }

    function clearSelection() {
        forEachCell(canvasState, (c) => c.isSelected = false);
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

            if (!fillChar) {
                fillChar = cell.char;
            } else if (cell.char !== fillChar) {
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

    function onMouseInputStateChange() {
        if (mouseInputState.x === -1 || mouseInputState.y === -1) {
            return;
        }

        let released = mouseInputState._lbWasDown && !mouseInputState.lbDown;
        let clicked = !mouseInputState._lbWasDown && mouseInputState.lbDown;

        if (released) {
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

            forEachCell(canvasState, (c) => c.isSelectedPreview = false);
        } else if (clicked) { 
            clicked = true;
            mouseInputState._prevX = mouseInputState.x;
            mouseInputState._prevY = mouseInputState.y;
        };

        const tool = canvasState.currentTool;

        if (mouseInputState.lbDown) {
            if (clicked) {
                if (
                    // Some tools need the selection to function
                    tool !== "move-selection"
                ) {
                    toolState.selectionStartX = mouseInputState.x;
                    toolState.selectionStartY = mouseInputState.y;
                }
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
        currentTool: "freeform-select"
    };

    const component = makeComponent<CanvasArgs>(root, () => {
        const { height, width } = component.args;

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
                    char: " ", 
                    br: false, bl: false, bb: false, bt: false,

                    x: chars.length,
                    y: i,

                    isSelected: false,
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
                rowList.getNext().render(rows[i]);
            }
        });
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
        if (e.key === "Shift") {
            keyboardInputState.isShiftPressed = true;
            return;
        } else if (e.key === "Control") {
            keyboardInputState.isCtrlPressed = true;
            return;
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

        function moveCursor(x: number, y: number, resetX = false) {
            const cursorCell = getTextInputCursorCell(canvasState);
            if (!cursorCell) {
                return;
            }

            if (x < 0 || x >= getNumCols(canvasState)) {
                return;
            }

            if (y < 0 || y >= getNumRows(canvasState)) {
                return;
            }

            clearSelection();
            getCell(canvasState, y, x).isSelected = true;
            if (resetX || x < toolState.typingStartX) {
                toolState.typingStartX = x;
            }
        }
        
        const cursorCell = getTextInputCursorCell(canvasState);
        if (cursorCell) {
            function newLine(cursorCell: CanvasCellArgs) {
                moveCursor(toolState.typingStartX, cursorCell.y + 1);
            }

            function atLineStart(cursorCell: CanvasCellArgs) {
                return cursorCell.x <= toolState.typingStartX;
            }

            function backspace(cursorCell: CanvasCellArgs) {
                // NOTE: Might introduce a 'layer' system that really backspaces text rather than overwriting the cell wtih ' '
                if (atLineStart(cursorCell)) {
                    return
                }

                moveCursor(cursorCell.x - 1, cursorCell.y);
                const cursorCellNext = getTextInputCursorCell(canvasState);
                if (cursorCellNext) {
                    cursorCellNext.char = ' ';
                }
            }

            if (e.key === "ArrowUp" && cursorCell.y > 0) {
                moveCursor(cursorCell.x, cursorCell.y - 1);
            } else if (e.key === "ArrowDown") {
                moveCursor(cursorCell.x, cursorCell.y + 1);
            } else if (e.key === "ArrowLeft") {
                moveCursor(cursorCell.x - 1, cursorCell.y);
            } else if (e.key === "ArrowRight") {
                moveCursor(cursorCell.x + 1, cursorCell.y);
            } else if (e.key === "Enter") {
                newLine(cursorCell);
            } else if (e.key === "Backspace") {
                if (e.ctrlKey || e.metaKey) {
                    while(!atLineStart(cursorCell) && cursorCell.char !== ' ') {
                        backspace(cursorCell);
                    }
                } else {
                    backspace(cursorCell);
                }
            } else {
                if (len !== 1) {
                    return;
                }

                cursorCell.char = key;

                if (cursorCell.x === getNumCols(canvasState) - 1) {
                    newLine(cursorCell);
                } else {
                    moveCursor(cursorCell.x + 1, cursorCell.y);
                }
            }
        } else {
            if (len !== 1) {
                return;
            }

            forEachCell(canvasState, (char) => {
                if (char.isSelected) {
                    char.char = key;
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

                getCell(canvas.canvasState, canvasRow, canvasCol).char = lines[i][j];
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
                    pasteClipboardToCanvas(pasteCell.y, pasteCell.x, whitespaceIsTransparent);
                }
            }
        }
    });

    return component;
}

