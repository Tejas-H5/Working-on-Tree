import { Button, ScrollContainer } from "src/legacy-components";
import { boundsCheck } from "src/utils/array-utils";
import { copyToClipboard, readFromClipboard } from "src/utils/clipboard";
import { Insertable, RenderGroup, cn, div, el, isVisible, newComponent, newListRenderer, setAttrs, setClass, setStyle, setText, setVisible, span } from "src/utils/dom-utils";
import { cnApp, cssVars } from "../legacy-styling";
import { assert } from "../utils/assert";
import { 
NUM_ROWS_INCR_AMOUNT,
NUM_COLUMNS_INCR_AMOUNT,
MIN_NUM_COLS,
WHITESPACE_GAP,
UNDO_REDO_THERSHOLD_MS,
CanvasArgs,
MouseInputState,
UndoLogEntryData,
UndoLogEntry,
CanvasState,
newMouseInputStat,
newCanvasStat,
ToolType,
RowArgs,
CanvasCellArgs,
AsciiCanvasLayer,
newLayer,
selectCell,
generateLines,
isSelected,
resizeLayer,
resizeLayers,
getCharOnLayer,
getLayerIdx,
setCharOnLayer,
getCharOnCurrentLayer,
setCharOnCurrentLayer,
getCurrentLayer,
forEachCell,
getCellOrUndefined,
getCell,
getNumCols,
getNumRows,
lerp,
resetCanvas,
lineLength,
pasteTextToCanvas,
getLayersString,
getCanvasSelectionAsString,
getFirstNonWhitespace,
getLastNonWhitespace,
getCurrentLineStart,
logUndoableChange,
canUndo,
resetUndoLog,
moveThroughUndoLog,
} from "./canvas-state";



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
        class: [cn.overflowAuto, cn.mw100, cn.mh100, cn.wFitContent, cn.hFitContent],
        style: `white-space: nowrap; border: 1px solid ${cssVars.fgColor};`
    }, true);

    const rowList = newListRenderer(root, () => newComponent((rg: RenderGroup<RowArgs>) => {
        const root = div({
            class: [cn.row, cn.justifyContentCenter, cn.wFitContent],
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
                rg.root.errorContext.avoidErrorHandler = true;

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
        }, undefined));

        rg.preRenderFn(function renderCanvasRow(s) {
            rg.root.errorContext.avoidErrorHandler = true;

            const { charList: rowList } = s;

            charList.render((getNext) => {
                for (let i = 0; i < rowList.length; i++) {
                    const c = getNext();
                    c.render(rowList[i]);
                }
            });
        });

        return root;
    }, undefined));

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
        canvasState.toolState.iArrow = y2;
        canvasState.toolState.jArrow = x2;
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
            scrollContainer.render({
                scrollEl: null,
                axes: "hv",
            });
        }

        if (shouldScroll) {
            shouldScroll = false;
            scrollContainer.s.scrollEl = currentCursorEl;
            scrollContainer.renderWithCurrentState();
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
            doSecondPart = true,
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
                doSecondPart,
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
                    + Math.floor(offset / canvasState.tabSize) * canvasState.tabSize + canvasState.tabSize
                );
            }
        } else if (e.key === "Backspace") {
            if (ctrlPressed) {
                moveToToNonWhitespaceOrSelection(true, true, true, false);
                const cursorCell = getCursorCell(canvasState);
                if (cursorCell) {
                    let num = 0;
                    for (let i = cursorCell.j; i >= 0; i--) {
                        if (getCharOnCurrentLayer(canvasState, cursorCell.i, i - 1) === ' ') break;
                        num++;
                    }

                    backspaceNum(canvasState, num, true);
                }
            } else {
                backspaceNum(canvasState, 1, true);
            }
        } else if (e.key === "Delete") {
            if (ctrlPressed) {
                moveToToNonWhitespaceOrSelection(true, false, true, false);
                const cursorCell = getCursorCell(canvasState);
                if (cursorCell) {
                    let num = 0;
                    const numCols = getNumCols(canvasState);
                    for (let i = cursorCell.j; i <= numCols; i++) {
                        num++;
                        if (getCharOnCurrentLayer(canvasState, cursorCell.i, i + 1) === ' ') break;
                    }

                    moveCursor(canvasState, cursorCell.i, cursorCell.j + num);
                    backspaceNum(canvasState, num, true);
                }
            } else {
                moveCursor(canvasState, cursorCell.i, cursorCell.j + 1);
                backspaceNum(canvasState, 1, true);
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
            name: "Draw Line",
            disabled: getNumSelected(canvasState) === 0,
            onClick: () => {
                generateLines(canvasState, false);
                rerenderLocal();
            }
        })),
        arrowLinesFromSelection: rg.c(ToolbarButton, (c) => c.render({
            canvasState,
            name: "Draw Arrow-Line",
            disabled: getNumSelected(canvasState) === 0,
            onClick: () => {
                generateLines(canvasState, true);
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

    const leftToolbar = div({
        class: [cn.col, cn.alignItemsStretch, cn.justifyContentCenter, cnApp.gap5, cn.overflowYAuto, cn.h100]
    }, [
        ...mouseScrollList,
        spacerV(),
        buttons.invertSelection,
        spacerV(),
        div({ class: [cn.row, cn.alignItemsCenter] }, [
            buttons.lessRows,
            div({ class: [cn.flex1], style: "display: inline-block; min-width: 3ch; text-align: center;",  }, [
                rg.text(() => "rows: " + getNumRows(canvasState)),
            ]),
            buttons.moreRows,
        ]),
        div({ class: [cn.row, cn.alignItemsCenter] }, [
            buttons.lessCols,
            div({ class: [cn.flex1], style: "display: inline-block; min-width: 3ch; text-align: center;" }, [
                rg.text(() => "cols: " + getNumCols(canvasState)),
            ]),
            buttons.moreCols,
        ]),
        spacerV(),
        buttons.copyToClipboard,
        buttons.pasteFromClipboard,
        buttons.pasteFromClipboardTransparent,
        spacerV(),
        buttons.linesFromSelection,
        buttons.arrowLinesFromSelection,
        spacerV(),
        buttons.undoButton,
        span({ class: [cn.textAlignCenter] }, [
            rg.text(() => (1 + canvasState.undoLogPosition) + " / " + canvasState.undoLog.length),
        ]),
        buttons.redoButton,
    ]);

    const rightToolbar = div({
        class: [cn.col, cn.alignItemsStretch, cn.justifyContentCenter, cnApp.gap5]
    }, [
    ]);

    function spacerV() {
        return div({ class: [cn.inlineBlock], style: "height: 20px" });
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

    // I hate CSS
    const root = div({ class: [cn.row, cn.h100, cn.relative] }, [
        div({ class: [cn.col, cn.flex1, cn.h100, cn.relative] }, [
            div({ class: [cn.flex1, cn.h100, cn.relative] }),
            div({ class: [cn.row, cn.justifyContentCenter, cn.alignItemsCenter, cn.h100, cn.relative] }, [
                leftToolbar,
                div({ class: [cn.col, cn.flex1, cn.h100] }, [
                    div({ class: [cn.row, cn.flex1, cn.mw100, cn.mh100, cn.alignItemsCenter, cn.justifyContentCenter] }, [
                        canvasComponent,
                    ]),
                    statusText,
                    performanceWarning,
                ]),
                rightToolbar
            ]),

            div({ class: [cn.flex1] }),
        ])
    ]);
    return root;
}

