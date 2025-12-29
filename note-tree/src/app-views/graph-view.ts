import { imListRowCellStyle } from "src/app-components/list-row";
import { imContextMenu, imContextMenuBegin, imContextMenuEnd, openContextMenuAtMouse } from "src/components/context-menu";
import {
    BLOCK,
    COL,
    DisplayType,
    imAbsoluteXY,
    imAlign,
    imBg,
    imButton,
    imFlex,
    imJustify,
    imLayout,
    imLayoutEnd,
    imPadding,
    imRelative,
    imScrollOverflow,
    imSize,
    imZIndex,
    NA,
    PX,
    ROW,
    STRETCH
} from "src/components/core/layout";
import { cn, cssVars } from "src/components/core/stylesheets";
import { imLine, LINE_HORIZONTAL } from "src/components/im-line";
import { imTextInputOneLine } from "src/components/text-input";
import { arrayAt, pushToNullableArray, resizeObjectPool } from "src/utils/array-utils";
import { assert } from "src/utils/assert";
import {
    getDeltaTimeSeconds,
    ImCache,
    imFor,
    imForEnd,
    imIf,
    imIfElse,
    imIfEnd,
    imKeyedBegin,
    imKeyedEnd,
    imMemo,
    imState,
    isFirstishRender
} from "src/utils/im-core";
import {
    EL_SVG,
    EL_SVG_POLYGON,
    elHasMouseOver,
    elHasMousePress,
    elSetAttr,
    elSetClass,
    elSetStyle,
    EV_CONTEXTMENU,
    EV_DBLCLICK,
    getGlobalEventSystem,
    imElSvg,
    imElSvgEnd,
    imOn,
    imPreventScrollEventPropagation,
    imStr
} from "src/utils/im-dom";


// One year ago, I had tried making this exact widget. 
// None of the coordinate transforms worked. Events kept firing unexpectedly. Hover hitboxes kept stepping over each other.
// Zooming to the mouse position? I understood the maths at the time, and had implemented it in several other places before then,
// but I just couldn't pull it off in my old framework. 
// Drag events? They kept treading on each other. Each new drag added substantial pain. 
// Panning the graph would start dragging nodes, creating new edges, etc. 
// After spending several hours attempting to fix it all, the code was unreadable, unmaintainable. 
// It was a pain. I simply put a deprecation notice in the file, and never touched it or used it ever again.
//
// The new framework has allowed me to make this widget to a much higher degree of polish, functinality, and maintainabilit
// in a couple of hours what took me a couple weeks in my previous framework. The rewrite was worth it after all.

// TODO: Rely less on getBoundingClientRect() for computing things like edge endpoint positions.


export type GraphMappingConcept = {
    conceptName: string;
    x: number;
    y: number;
};

export function newGraphMappingConcept(x: number, y: number, name: string): GraphMappingConcept {
    return {
        conceptName: name,
        x: x,
        y: y,
    };
}

// Not managed by the user. The system will infer them via the description!
export type GraphMappingRelationship = {
    relationshipName: string;
    srcId: number;
    dstId: number;
};

export function newGraphMappingRelationship(srcId: number, dstId: number): GraphMappingRelationship {
    return {
        relationshipName: "",
        srcId: srcId,
        dstId: dstId,
    };
}

export type MappingGraph = {
    _version: number;
    // Order of the items will never change, as their index is also their ID. 
    // Also means the UI doesn't need to use keys to render them though, unless it is doing it's own sorting.
    concepts: (GraphMappingConcept | null)[];
    relationships: (GraphMappingRelationship | null)[];
}

export type MappingGraphView = {
    pan: Position;
    zoom: number;
    _version: number;
}

export function newMappingGraph(): MappingGraph {
    return {
        _version: -1,
        concepts: [],
        relationships: [],
    };
}

export function newMappingGraphView(): MappingGraphView {
    return {
        pan: { x: 0, y: 0 },
        zoom: 1,
        _version: 0,
    };
}

type EdgeGroup = {
    relIds: number[];
    c1Pos: Position;
    c2Pos: Position;
};

export type GraphMappingsViewState = {
    conceptsUiState: MappingConceptUiState[];
    relUiState: MappingRelationshipsUiState[];

    indexes: {
        // Keyed on the flat id of a particular connection.
        // Consider the graph as a connection matrix #num_nodes x #num_nodes.
        // The id of any connection would then be (#num_nodes * srcId + dstId). 
        // To make it direction-agnostic, we can do (#num_nodes * min(srcId, dstId) + max(src, dstId)).
        // I have bent over backwards to use a number key here, because they are more performant than string keys.
        // NOTE: we can now only have sqrt(MAX_SAFE_INTEGER) number of edge groups and therefore now. 94,906,265. Yeah I reckon we're good
        edgeGroups: Map<number, EdgeGroup>;
    };

    newName: string;

    dragConcept: {
        draggingIdx: number;
        startX: number;
        startY: number;
        startMouseX: number;
        startMouseY: number;
    };

    dragNewEdge: {
        srcId: number;
        startMouseX: number;
        startMouseY: number;
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
    };

    dragExistingEdge: {
        srcId: number;
        startMouseX: number;
        startMouseY: number;
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
    };

    targetZoom: number;
    panState: {
        isPanning: boolean;
        startX: number;
        startY: number;
        startMouseX: number;
        startMouseY: number;
    };

    rightClicked: ItemReference; 
    currentlyEditing: ItemReference;
};

type ItemReference = {
    relId?: number;
    conceptId?: number;
};

type MappingConceptUiState = {
    width: number;
    height: number;
    top: number;
    left: number;
    bottom: number;
    right: number;

    version: 0,
};

type MappingRelationshipsUiState = {
    // Screen coords
};

function newMappingRelationshipsUiState(): MappingRelationshipsUiState {
    return {
    };
}

function newMappingConceptUiState(): MappingConceptUiState {
    return {
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,

        version: 0,
    };
}

export function newGraphMappingsViewState(): GraphMappingsViewState {
    return {
        conceptsUiState: [],
        relUiState: [],

        indexes: {
            edgeGroups: new Map(),
        },

        newName: "",

        dragConcept: {
            draggingIdx: -1,
            startX: 0,
            startY: 0,
            startMouseX: 0,
            startMouseY: 0,
        },

        targetZoom: 1,
        panState: {
            isPanning: false,
            startX: 0,
            startY: 0,
            startMouseX: 0,
            startMouseY: 0,
        },

        dragNewEdge: {
            srcId: -1,
            startX: -1,
            currentX: -1,
            currentY: -1,
            startY: -1,
            startMouseX: -1,
            startMouseY: -1,
        },

        dragExistingEdge: {
            srcId: -1,
            startX: -1,
            currentX: -1,
            currentY: -1,
            startY: -1,
            startMouseX: -1,
            startMouseY: -1,
        },

        rightClicked: {},
        currentlyEditing: {},
    };
}


function isDraggingAnything(s: GraphMappingsViewState): boolean {
    return s.dragConcept.draggingIdx !== -1 ||
        s.panState.isPanning ||
        s.dragNewEdge.srcId !== -1 ||
        s.dragExistingEdge.srcId !== -1;
}

function toGraphX(view: MappingGraphView, mouseX: number) {
    return toGraphLength(view, mouseX) - view.pan.x;
}

function toGraphY(view: MappingGraphView, mouseY: number) {
    return toGraphLength(view, mouseY) - view.pan.y;
}

function toGraphLength(view: MappingGraphView, len: number) {
    return len / view.zoom;
}

function toScreenX(view: MappingGraphView, x: number) {
    return (x + view.pan.x) * view.zoom;
}

function toScreenY(view: MappingGraphView, y: number) {
    return (y + view.pan.y) * view.zoom;
}


function lerpClamped(a: number, b: number, t: number) {
    t = clamp(t, 0, 1);

    if (Math.abs(a - b) < 0.0001) return b;

    return (1 - t) * a + t * b;
}

function clamp(t: number, a: number, b: number) {
    if (t < a) t = a;
    if (t > b) t = b;
    return t;
}

/**
 *    dy2  dy    (x0, y0) - start of line
 *    -    -   *
 *    ^    ^    \__
 *    v    |       \__
 *    -    |   --------*__------------------ y - horizontal line
 *         |              \__
 *         v                 *
 *         -                  (x1, y1) - end of line
 *
 *             |<----dx----->|
 *
 *         dx2 |<---->|  <-- This is the result. 
 *
 *  Similar triangles: 
 *     dx/dy = dx2/dy2
 *  => dy2 * (dx / dy) = dx2
 *
 */
function solveLineXHorizontalIntersection(
    x0: number, y0: number,
    x1: number, y1: number,
    y: number
): number | null {
    const dx = x1 - x0;
    const dy = y1 - y0;

    const dy2 = y - y0;

    if (Math.abs(dy) < 0.00001) return null
    const dx2 = dy2 * dx / dy;

    return x0 + dx2;
}

function solveLineXVerticalIntersection(
    x0: number, y0: number,
    x1: number, y1: number,
    x: number
): number | null {
    return solveLineXHorizontalIntersection(y0, x0, y1, x1, x);
}

function distSquared(x0: number, y0: number, x1: number, y1: number) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    return dx * dx + dy * dy;
}

function closerLineXRectangleIntersection(
    x0: number, y0: number,
    x1: number, y1: number,
    top: number, left: number,
    bottom: number, right: number,
    dst: Position, 
): boolean {
    let found = false;
    let lastDist = Infinity;

    const ah = solveLineXHorizontalIntersection(x0, y0, x1, y1, bottom);
    if (ah !== null) {
        if (left < ah && ah < right) {
            let x = ah;
            let y = bottom;

            const sqrDistance = distSquared(x0, y0, x, y);
            if (sqrDistance < lastDist) {
                lastDist = sqrDistance;
                found = true;
                dst.x = x;
                dst.y = y;
            }
        }
    }

    const bh = solveLineXHorizontalIntersection(x0, y0, x1, y1, top);
    if (bh !== null) {
        if (left < bh && bh < right) {
            let x = bh;
            let y = top;

            const sqrDistance = distSquared(x0, y0, x, y);
            if (sqrDistance < lastDist) {
                lastDist = sqrDistance;
                found = true;
                dst.x = x;
                dst.y = y;
            }
        }
    }

    const av = solveLineXVerticalIntersection(x0, y0, x1, y1, left);
    if (av !== null) {
        if (top < av && av < bottom) {
            let x = left;
            let y = av;

            const sqrDistance = distSquared(x0, y0, x, y);
            if (sqrDistance < lastDist) {
                lastDist = sqrDistance;
                found = true;
                dst.x = x;
                dst.y = y;
            }
        }
    }

    const bv = solveLineXVerticalIntersection(x0, y0, x1, y1, right);
    if (bv !== null) {
        if (top < bv && bv < bottom) {
            let x = right;
            let y = bv;

            const sqrDistance = distSquared(x0, y0, x, y);
            if (sqrDistance < lastDist) {
                lastDist = sqrDistance;
                found = true;
                dst.x = x;
                dst.y = y;
            }
        }
    }

    return found;
}

type Position = {
    x: number;
    y: number;
};

function recomputeIndexes(s: GraphMappingsViewState, graph: MappingGraph) {
    // edge groups
    {
        const edgeGroups = s.indexes.edgeGroups;

        for (const group of edgeGroups.values()) {
            group.relIds.length = 0;
        }

        for (let relId = 0; relId < graph.relationships.length; relId++) {
            const rel = graph.relationships[relId];
            if (!rel) continue;

            const min = Math.min(rel.srcId, rel.dstId);
            const max = Math.max(rel.srcId, rel.dstId);
            const key = graph.concepts.length * min + max;

            let edgeGroup = edgeGroups.get(key);
            if (!edgeGroup) {
                edgeGroup = {
                    relIds: [],
                    c1Pos: { x: 0, y: 0 },
                    c2Pos: { x: 0, y: 0 },
                };
                edgeGroups.set(key, edgeGroup);
            }

            edgeGroup.relIds.push(relId);
        }
    }
}

export function imGraphMappingsEditorView(
    c: ImCache,
    s: GraphMappingsViewState,
    graph: MappingGraph,
    v: MappingGraphView,
) {
    let editedGraph = false;
    let editedView = false;
    let mutation: (() => void) | undefined;

    if (imMemo(c, v)) s.targetZoom = v.zoom;
    if (imMemo(c, graph)) {
        recomputeIndexes(s, graph);
    }

    const { mouse } = getGlobalEventSystem();

    const dt = getDeltaTimeSeconds(c);

    const contextMenu = imContextMenu(c);

    // Initialize parallel Ui state
    {
        resizeObjectPool(s.relUiState, newMappingRelationshipsUiState, graph.relationships.length);
        resizeObjectPool(s.conceptsUiState, newMappingConceptUiState, graph.concepts.length);
    }

    const root = imLayout(c, COL); imFlex(c); imRelative(c); imScrollOverflow(c, true, true); {
        const rootRect = root.getBoundingClientRect();

        const isDraggingEdge = s.dragNewEdge.srcId !== -1;
        if (imMemo(c, v.zoom)) elSetStyle(c, "fontSize", v.zoom + "rem");
        if (imMemo(c, isDraggingEdge)) elSetStyle(c, "cursor", isDraggingEdge ? "crosshair" : "move");

        const scroll = imPreventScrollEventPropagation(c);
        const scrollAmount = scroll.scrollY / 100;

        // zooming in and out
        {
            if (scrollAmount) {
                const scrollSpeed = 0.2;
                const divisor = clamp(1.0 + scrollAmount * scrollSpeed, 0.2, 1.8)
                s.targetZoom /= divisor;
                if (s.targetZoom < 0.01) s.targetZoom = 0.01;
                if (s.targetZoom > 10) s.targetZoom = 10;
            }

            // animate zooming in and out. We also need to ensure that the 'center' of the zoom is on the mouse cursor
            if (Math.abs(v.zoom - s.targetZoom) > 0.00001) {
                const rect = root.getBoundingClientRect();
                const zoomCenterXScreen = mouse.X - rect.x;
                const zoomCenterYScreen = mouse.Y - rect.y;

                const zoomCenterX = toGraphX(v, zoomCenterXScreen);
                const zoomCenterY = toGraphY(v, zoomCenterYScreen);

                // TODO: technically wrog way to use lerp with deltatime but I keep forgetting the real one. Maybe the framework should just have it?
                v.zoom = lerpClamped(v.zoom, s.targetZoom, dt * 40);

                const zoomCenterXAfterZoom = toGraphX(v, zoomCenterXScreen);
                const zoomCenterYAfterZoom = toGraphY(v, zoomCenterYScreen);

                const dX = zoomCenterXAfterZoom - zoomCenterX;
                const dY = zoomCenterYAfterZoom - zoomCenterY;

                v.pan.x += dX;
                v.pan.y += dY;
                editedView = true;
            }
        }

        const ctxEv = imOn(c, EV_CONTEXTMENU);
        if (ctxEv) {
            s.rightClicked.conceptId = -1;
            s.rightClicked.relId = -1;
        }

        const dragStartConcept = arrayAt(graph.concepts, s.dragNewEdge.srcId);
        if (imIf(c) && dragStartConcept) {
            const x0 = toScreenX(v, s.dragNewEdge.startX);
            const y0 = toScreenY(v, s.dragNewEdge.startY);
            const x1 = toScreenX(v, s.dragNewEdge.currentX);
            const y1 = toScreenY(v, s.dragNewEdge.currentY);

            const dX = toGraphLength(v, mouse.X) - s.dragNewEdge.startMouseX;
            const dY = toGraphLength(v, mouse.Y) - s.dragNewEdge.startMouseY;
            s.dragNewEdge.currentX = s.dragNewEdge.startX + dX;
            s.dragNewEdge.currentY = s.dragNewEdge.startY + dY;

            const lineState = imLayoutLine(c, ROW, x0, y0, x1, y1); imAlign(c); imJustify(c); {
                if (isFirstishRender(c)) elSetClass(c, cn.userSelectNone);
                if (imIf(c) && lineState.isUpsideDown) {
                    imLayout(c, ROW); imSize(c, 20 * v.zoom, PX, 0, NA); imAlign(c); {
                        imArrowHead(c);
                    } imLayoutEnd(c);
                } imIfEnd(c);

                imLayout(c, ROW); imFlex(c); {
                    imLine(c, LINE_HORIZONTAL, 3);
                } imLayoutEnd(c);

                if (imIf(c) && !lineState.isUpsideDown) {
                    imLayout(c, ROW); imSize(c, 20 * v.zoom, PX, 0, NA); imAlign(c); {
                        if (isFirstishRender(c)) elSetStyle(c, "transform", "scale(-1, 1)")
                        imArrowHead(c);
                    } imLayoutEnd(c);
                } imIfEnd(c);
            } imLayoutLineEnd(c);
        } imIfEnd(c);

        imFor(c); for (let conceptId = 0; conceptId < graph.concepts.length; conceptId++) {
            const concept = graph.concepts[conceptId];
            if (!concept) continue;

            const conceptUiState = s.conceptsUiState[conceptId]; assert(!!conceptUiState);

            imKeyedBegin(c, conceptId); {
                const editing = conceptId === s.currentlyEditing.conceptId;
                let dragging = conceptId === s.dragConcept.draggingIdx;

                if (dragging) {
                    // Complete the drag _before_ we set the absolute style.
                    const dX = toGraphLength(v, mouse.X) - s.dragConcept.startMouseX;
                    const dY = toGraphLength(v, mouse.Y) - s.dragConcept.startMouseY;
                    concept.x = s.dragConcept.startX + dX;
                    concept.y = s.dragConcept.startY + dY;

                    editedGraph = true;
                    conceptUiState.version++;
                }

                imLayout(c, BLOCK); {
                    imZIndex(c, 1); // raise above edges
                    imAbsoluteXY(c, toScreenX(v, concept.x), PX, toScreenY(v, concept.y), PX);
                    imPadding(c, 20, PX, 20, PX, 20, PX, 20, PX);

                    if (isFirstishRender(c)) elSetStyle(c, "transform", "translate(-50%, -50%");
                    if (isFirstishRender(c)) elSetStyle(c, "cursor", "pointer");
                    if (isFirstishRender(c)) elSetStyle(c, "borderRadius", (4 * v.zoom) + "px");
                    if (isFirstishRender(c)) elSetClass(c, cn.pre);

                    let hoveredInner = false;
                    const innerRoot = imLayout(c, COL); {
                        hoveredInner = elHasMouseOver(c)

                        const innerRect = innerRoot.getBoundingClientRect();
                        const padding = 10 * v.zoom;
                        conceptUiState.top =    -rootRect.y + innerRect.top - padding;
                        conceptUiState.left =   -rootRect.x + innerRect.left - padding;
                        conceptUiState.bottom = -rootRect.y + innerRect.bottom + padding;
                        conceptUiState.right =  -rootRect.x + innerRect.right + padding;
                        conceptUiState.width  = conceptUiState.right - conceptUiState.left;
                        conceptUiState.height = conceptUiState.top - conceptUiState.bottom;

                        imPadding(c, 4 * v.zoom, PX, 10 * v.zoom, PX, 4 * v.zoom, PX, 10 * v.zoom, PX);
                        imBg(c, cssVars.bg);

                        if (imMemo(c, hoveredInner)) elSetStyle(c, "border", "2px solid " + (hoveredInner ? cssVars.fg : cssVars.mg));
                        if (imMemo(c, editing)) elSetStyle(c, "cursor", editing ? "" : "pointer");
                        if (imMemo(c, v.zoom)) elSetStyle(c, "borderRadius", (4 * v.zoom) + "px");
                        

                        if (!isDraggingAnything(s) && elHasMousePress(c) && mouse.leftMouseButton) {
                            s.dragConcept.draggingIdx = conceptId;
                            s.dragConcept.startMouseX = toGraphLength(v, mouse.X);
                            s.dragConcept.startMouseY = toGraphLength(v, mouse.Y);
                            s.dragConcept.startX = concept.x;
                            s.dragConcept.startY = concept.y;
                        }

                        if (imIf(c) && editing) {
                            if (imMemo(c, true)) s.newName = concept.conceptName || "Unnamed";

                            const ev = imTextInputOneLine(c, s.newName, "Name...", true, true);
                            if (ev) {
                                if (ev.newName !== undefined) {
                                    s.newName = ev.newName;
                                }

                                // I kept pressing escape and losing my stuff. 
                                // In this case, a more consistent UX is for escape to retain the contents
                                if (ev.submit || ev.cancel) {
                                    concept.conceptName = s.newName;
                                    s.currentlyEditing.conceptId = -1;

                                    conceptUiState.version++;
                                    editedGraph = true;
                                }
                            }
                        } else {
                            imIfElse(c);

                            if (ctxEv && elHasMouseOver(c)) {
                                s.rightClicked.conceptId = conceptId;
                            }

                            imLayout(c, BLOCK); {
                                if (isFirstishRender(c)) elSetClass(c, cn.userSelectNone);

                                imStr(c, concept.conceptName || "Unnamed");

                                const dblClickEv = imOn(c, EV_DBLCLICK);
                                if (dblClickEv) {
                                    s.currentlyEditing.conceptId = conceptId;
                                    s.currentlyEditing.relId = -1;
                                }
                            } imLayoutEnd(c);
                        } imIfEnd(c);
                    } imLayoutEnd(c);

                    let canAcceptInEdge = false;
                    let canDragOutEdge = false;
                    let edgeHitbox = false;
                    if (!hoveredInner && elHasMouseOver(c)) {
                        edgeHitbox = true;

                        if (!isDraggingAnything(s)) {
                            canDragOutEdge = true;

                            if (mouse.leftMouseButton) {
                                s.dragNewEdge.srcId = conceptId;

                                const rect = root.getBoundingClientRect();
                                s.dragNewEdge.startMouseX = toGraphLength(v, mouse.X);
                                s.dragNewEdge.startMouseY = toGraphLength(v, mouse.Y);
                                s.dragNewEdge.startX = toGraphX(v, mouse.X - rect.x);
                                s.dragNewEdge.startY = toGraphY(v, mouse.Y - rect.y);
                                s.dragNewEdge.currentX = s.dragNewEdge.startX;
                                s.dragNewEdge.currentY = s.dragNewEdge.startY;
                            }
                        } else if (s.dragNewEdge.srcId !== -1 && s.dragNewEdge.srcId !== conceptId) {
                            canAcceptInEdge = true;

                            if (!mouse.leftMouseButton) {
                                // Drag accepted!
                                const rel = newGraphMappingRelationship(s.dragNewEdge.srcId, conceptId);
                                mutation = () => {
                                    const idx = pushToNullableArray(graph.relationships, rel);
                                    recomputeIndexes(s, graph);
                                    s.currentlyEditing.relId = idx;
                                    s.dragNewEdge.srcId = -1;
                                    editedView = true;
                                }
                            }
                        }
                    }

                    imBg(c, canDragOutEdge ? "" : canAcceptInEdge ? "rgba(0, 255, 0, 0.2)" : "");
                    if (imMemo(c, canDragOutEdge)) elSetStyle(c, "cursor", canDragOutEdge ? "crosshair" : "");
                } imLayoutEnd(c);
            } imKeyedEnd(c);
        } imForEnd(c);

        // Edge positions are derived via node positions, so we render them after, so
        // that there isn't any 1-frame-off lag. 
        imFor(c); for (const edgeGroup of s.indexes.edgeGroups.values()) {
            if (edgeGroup.relIds.length === 0) continue;

            imKeyedBegin(c, edgeGroup); {
                const rel = graph.relationships[edgeGroup.relIds[0]]; assert(!!rel);
                // Unknown order!
                const c1Id = rel.srcId;
                const c1 = graph.concepts[c1Id];
                const c2 = graph.concepts[rel.dstId];
                if (!c1 || !c2) continue;

                const x0 = toScreenX(v, c1.x);
                const y0 = toScreenY(v, c1.y);
                const x1 = toScreenX(v, c2.x);
                const y1 = toScreenY(v, c2.y);

                // recompute src line position
                {
                    const c1UiState = s.conceptsUiState[rel.srcId]; assert(!!c1UiState);

                    const { top, left, bottom, right } = c1UiState;
                    closerLineXRectangleIntersection(
                        x1, y1, x0, y0,
                        top, left, bottom, right,
                        edgeGroup.c1Pos
                    );
                }

                // recompute dst line position
                {
                    const c2UiState = s.conceptsUiState[rel.dstId]; assert(!!c2UiState);

                    const { top, left, bottom, right } = c2UiState;
                    closerLineXRectangleIntersection(
                        x0, y0, x1, y1,
                        top, left, bottom, right,
                        edgeGroup.c2Pos,
                    );
                }

                const x0Line = edgeGroup.c1Pos.x;
                const y0Line = edgeGroup.c1Pos.y;
                const x1Line = edgeGroup.c2Pos.x;
                const y1Line = edgeGroup.c2Pos.y;
                const mx = lerpClamped(x0Line, x1Line, 0.5);
                const my = lerpClamped(y0Line, y1Line, 0.5);
                const isFlipped = x1 < x0;

                const lineState = imLayoutLine(c, COL, x0Line, y0Line, x1Line, y1Line); imAlign(c, STRETCH); {
                    imFor(c); for (let idxInGroup = 0; idxInGroup < edgeGroup.relIds.length; idxInGroup++) {
                        const relId = edgeGroup.relIds[idxInGroup];
                        const rel = graph.relationships[relId];
                        if (!rel) continue;

                        const src = arrayAt(graph.concepts, rel.srcId);
                        const dst = arrayAt(graph.concepts, rel.dstId);
                        if (!src || !dst) continue;

                        imKeyedBegin(c, relId); {
                            const srcUiState = s.conceptsUiState[rel.srcId]; assert(!!srcUiState);
                            const dstUiState = s.conceptsUiState[rel.dstId]; assert(!!dstUiState);
                            const relUiState = s.relUiState[relId]; assert(!!relUiState);

                            imLayout(c, ROW); {
                                const isSrc = c1Id === rel.srcId;

                                // arrow. only one should appear at a time
                                if (imIf(c) && lineState.isUpsideDown === isSrc) {
                                    imLayout(c, ROW); imSize(c, 20 * v.zoom, PX, 0, NA); imAlign(c); {
                                        imArrowHead(c);
                                    } imLayoutEnd(c);
                                } imIfEnd(c);

                                // handleedge
                                imLayout(c, ROW); imFlex(c); imAlign(c); {
                                    const col = elHasMouseOver(c) ? "red" : cssVars.fg;
                                    imLayout(c, ROW); imFlex(c); imSize(c, 0, NA, 3, PX); imBg(c, col); imLayoutEnd(c);
                                } imLayoutEnd(c);

                                imLayout(c, ROW); imSize(c, 1, PX, 0, NA); imAlign(c); {
                                    imLayout(c, BLOCK); imSize(c, 1, PX, 1, PX); imLayoutEnd(c);
                                } imLayoutEnd(c);

                                // handleedge
                                imLayout(c, ROW); imFlex(c); imAlign(c); {
                                    const col = elHasMouseOver(c) ? "red" : cssVars.fg;
                                    imLayout(c, ROW); imFlex(c); imSize(c, 0, NA, 3, PX); imBg(c, col); imLayoutEnd(c);
                                } imLayoutEnd(c);

                                // arrow
                                if (imIf(c) && lineState.isUpsideDown !== isSrc) {
                                    imLayout(c, ROW); imSize(c, 20 * v.zoom, PX, 0, NA); imAlign(c); {
                                        if (isFirstishRender(c)) elSetStyle(c, "transform", "scale(-1, 1)")
                                        imArrowHead(c);
                                    } imLayoutEnd(c);
                                } imIfEnd(c);
                            } imLayoutEnd(c);
                        } imKeyedEnd(c);
                    } imForEnd(c);
                } imLayoutLineEnd(c);

                const labelX = mx;
                const labelY = my;
                imLayout(c, COL); imAbsoluteXY(c, labelX, PX, labelY, PX); {
                    imFor(c); for (let idxInGroup = 0; idxInGroup < edgeGroup.relIds.length; idxInGroup++) {
                        const relId = edgeGroup.relIds[idxInGroup];
                        const rel = graph.relationships[relId];
                        if (!rel) continue;

                        imKeyedBegin(c, relId); {
                            imLayout(c, BLOCK); {
                                if (isFirstishRender(c)) elSetStyle(c, "transform", "translate(-50%, -50%");
                                editedGraph = imRelationshipLabel(c, s, rel, relId, ctxEv) || editedGraph;
                            } imLayoutEnd(c);
                        } imKeyedEnd(c);
                    } imForEnd(c);
                } imLayoutEnd(c);
            } imKeyedEnd(c);
        } imForEnd(c);


        if (!isDraggingAnything(s) && elHasMousePress(c) && mouse.leftMouseButton) {
            s.panState.startMouseX = toGraphLength(v, mouse.X);
            s.panState.startMouseY = toGraphLength(v, mouse.Y);
            s.panState.startX = v.pan.x;
            s.panState.startY = v.pan.y;
            s.panState.isPanning = true;
        }

        if (s.panState.isPanning) {
            const dX = toGraphLength(v, mouse.X) - s.panState.startMouseX;
            const dY = toGraphLength(v, mouse.Y) - s.panState.startMouseY;
            v.pan.x = s.panState.startX + dX;
            v.pan.y = s.panState.startY + dY;
            editedView = true;
        }

        if (ctxEv) {
            openContextMenuAtMouse(contextMenu);
            ctxEv.preventDefault();
        }
    } imLayoutEnd(c);


    if (imIf(c) && contextMenu.open) {
        imContextMenuBegin(c, contextMenu); {
            imContextMenuItem(c); {
                imStr(c, "Add concept");
                if (elHasMousePress(c)) {
                    const rect = root.getBoundingClientRect();
                    const x = contextMenu.position.x - rect.x;
                    const y = contextMenu.position.y - rect.y;
                    const newConcept = newGraphMappingConcept(
                        toGraphX(v, x),
                        toGraphY(v, y),
                        "Unnamed",
                    );

                    mutation = () => {
                        const idx = pushToNullableArray(graph.concepts, newConcept);
                        recomputeIndexes(s, graph);
                        s.currentlyEditing = { conceptId: idx };
                        contextMenu.open = false;
                    }
                }
            } imLayoutEnd(c);

            const conceptClickedOn = arrayAt(graph.concepts, s.rightClicked.conceptId ?? -1);
            if (imIf(c) && conceptClickedOn) {
                const conceptId = s.rightClicked.conceptId;
                assert(conceptId != null);

                imLine(c, LINE_HORIZONTAL);

                imContextMenuItem(c); {
                    imStr(c, "Rename concept");
                    if (elHasMousePress(c)) {
                        s.currentlyEditing = { conceptId };
                        contextMenu.open = false;
                    }
                } imLayoutEnd(c);

                imContextMenuItem(c); {
                    imStr(c, "Delete concept");
                    if (elHasMousePress(c)) {
                        deleteConcept(graph, conceptId);
                        recomputeIndexes(s, graph);
                        contextMenu.open = false;
                    }
                } imLayoutEnd(c);
            } imIfEnd(c);

            const relClickedOn = arrayAt(graph.relationships, s.rightClicked.relId ?? -1);
            if (imIf(c) && relClickedOn) {
                const relId = s.rightClicked.relId;
                assert(relId != null);

                imLine(c, LINE_HORIZONTAL);

                imContextMenuItem(c); {
                    imStr(c, "Rename relationship");
                    if (elHasMousePress(c)) {
                        s.currentlyEditing = { relId };
                        contextMenu.open = false;
                    }
                } imLayoutEnd(c);
                imContextMenuItem(c); {
                    imStr(c, "Delete relationship");
                    if (elHasMousePress(c)) {
                        deleteRelationship(graph, relId)
                        recomputeIndexes(s, graph);
                        contextMenu.open = false;
                    }
                } imLayoutEnd(c);
            } imIfEnd(c);
        } imContextMenuEnd(c, contextMenu);
    } imIfEnd(c);

    if (mutation) {
        mutation();
    }

    if (editedGraph) {
        graph._version++;
    }

    if (editedView) {
        v._version++;
    }

    // Some code above will check if elHasMouseOver() && dragInProgress && !mouseLeftButton
    // to handle a 'drop' event after a drag, so we're clearing them here at the bottom instead
    // of first thing at the top.
    if (!mouse.leftMouseButton) {
        s.dragConcept.draggingIdx = -1;
        s.panState.isPanning = false;
        s.dragNewEdge.srcId = -1;
    }
}

function imArrowHead(c: ImCache) {
    imElSvg(c, EL_SVG); imRelative(c); {
        if (isFirstishRender(c)) elSetAttr(c, "viewBox", "0 0 10 10");
        if (isFirstishRender(c)) elSetStyle(c, "width", "100%")
        if (isFirstishRender(c)) elSetStyle(c, "height", "100%")

        imElSvg(c, EL_SVG_POLYGON); {
            if (isFirstishRender(c)) elSetAttr(c, "points", "0,5 10,10 10,0 0,5");
            if (isFirstishRender(c)) elSetAttr(c, "style", `fill:${cssVars.fg};stroke-width:0;`);
        } imElSvgEnd(c, EL_SVG_POLYGON);
    } imElSvgEnd(c, EL_SVG);
}

function imRelationshipLabel(
    c: ImCache,
    s: GraphMappingsViewState,
    rel: GraphMappingRelationship,
    relId: number,
    ctxEv: MouseEvent | null,
) {
    let edited = false;

    const editing = s.currentlyEditing.relId === relId;

    imLayout(c, ROW); imBg(c, cssVars.bg); {
        const hovered = elHasMouseOver(c);

        if (isFirstishRender(c)) elSetStyle(c, "padding", "3px 10px");
        if (imMemo(c, hovered)) elSetStyle(c, "border", hovered ? `2px solid ${cssVars.fg}` : "");

        if (imIf(c) && editing) {
            if (imMemo(c, true)) s.newName = rel.relationshipName || "Unnamed";

            const ev = imTextInputOneLine(c, s.newName, "Name...", true, true);
            if (ev) {
                if (ev.newName !== undefined) {
                    s.newName = ev.newName;
                }
                if (ev.submit || ev.cancel) {
                    rel.relationshipName = s.newName;
                    s.currentlyEditing = {};
                    edited = true;
                }
            }
        } else {
            imIfElse(c);

            if (ctxEv && hovered) {
                s.rightClicked = { relId };
            }

            imLayout(c, ROW); {
                if (isFirstishRender(c)) elSetClass(c, cn.userSelectNone);

                imStr(c, rel.relationshipName || "Unnamed");

                const dblClickEv = imOn(c, EV_DBLCLICK);
                if (dblClickEv) {
                    s.currentlyEditing = { relId };
                }
            } imLayoutEnd(c);
        } imIfEnd(c);
    } imLayoutEnd(c);

    return edited;
}

function imLineLayoutState() {
    return {
        isUpsideDown: false,
        angle: 0,
    };
}

function imLayoutLine(
    c: ImCache,
    type: DisplayType,
    x0: number, y0: number,
    x1: number, y1: number,
    neverUpsideDown = true,
) {
    const s = imState(c, imLineLayoutState);

    s.isUpsideDown = x1 < x0;

    if (neverUpsideDown) {
        // try to make the line go left -> right so that the contents are never upside down
        if (s.isUpsideDown) {
            let temp = x1;
            x1 = x0;
            x0 = temp;

            temp = y1;
            y1 = y0;
            y0 = temp;
        }
    }

    imLayout(c, type);
    imAbsoluteXY(c, x0, PX, y0, PX);

    const dx = x1 - x0;
    const dy = y1 - y0;
    s.angle = Math.atan2(dy, dx);

    elSetStyle(c, "transform", `translate(0, -50%) rotate(${s.angle}rad)`)
    elSetStyle(c, "transformOrigin", "center left")
    const len = Math.sqrt(dx * dx + dy * dy);
    elSetStyle(c, "width", len + "px");

    // imLayoutEnd

    return s;
}

function imLayoutLineEnd(c: ImCache) {
    // imLayoutBegin
    imLayoutEnd(c);
}

function imContextMenuItem(c: ImCache) {
    imLayout(c, BLOCK); imListRowCellStyle(c); imButton(c); {
    } // imLayoutEnd
}

function deleteConcept(graph: MappingGraph, conceptId: number) {
    if (conceptId < 0 && conceptId >= graph.concepts.length) return;

    graph.concepts[conceptId] = null;
    for (let relId = 0; relId < graph.relationships.length; relId++) {
        const rel = graph.relationships[relId];
        if (!rel) continue;
        if (rel.srcId !== conceptId && rel.dstId !== conceptId) continue;
        graph.relationships[relId] = null;
    }
}

function deleteRelationship(graph: MappingGraph, relId: number) {
    if (relId < 0 && relId >= graph.relationships.length) return;
    graph.relationships[relId] = null;
}
