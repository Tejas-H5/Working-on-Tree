import { imListRowCellStyle } from "src/app-components/list-row";
import { imContextMenu, imContextMenuBegin, imContextMenuEnd, imContextMenuItemEnd, openContextMenuAtMouse } from "src/components/context-menu";
import {
    BLOCK,
    COL,
    DisplayType,
    imAbsolute,
    imAbsoluteXY,
    imAlign,
    imBg,
    imButton,
    imFg,
    imFlex,
    imJustify,
    imLayoutBegin,
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
import { arrayAt, filterInPlace, pushToNullableArray, resizeObjectPool } from "src/utils/array-utils";
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
    imElSvgBegin,
    imElSvgEnd,
    imOn,
    imPreventScrollEventPropagation,
    imStr
} from "src/utils/im-dom";
import { getNormalizedKey, isKeyHeld } from "src/utils/key-state";

const SHIFT = getNormalizedKey("Shift");

// One year ago, I had tried making this exact widget. 
// None of the coordinate transforms worked. Events kept firing unexpectedly. Hover hitboxes kept stepping over each other.
// Zooming to the mouse position? I understood the maths at the time, and had implemented it in several other places before then,
// but I just couldn't pull it off over there.
// Drag events? They kept treading on each other. Each new drag added substantial pain. 
// Panning the graph would start dragging nodes, creating new edges, etc. 
// After spending several hours attempting to fix it all, the code was unreadable, unmaintainable. 
// It was a pain. I simply put a deprecation notice in the file, and never touched it or used it ever again.
//
// The new framework has allowed me to make this widget to a much higher degree of polish, functinality, and maintainability
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

export function newGraphMappingRelationship(srcId: number, dstId: number, name: string): GraphMappingRelationship {
    return {
        relationshipName: name,
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

    // Non-stable indices.
    subsets: ConceptSubset[];
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
        subsets: [],
    };
}

export function newMappingGraphView(): MappingGraphView {
    return {
        pan: { x: 0, y: 0 },
        zoom: 1,
        _version: 0,
    };
}

type RelationshipGroup = {
    relIds: number[];
    c1Pos: Position;
    c2Pos: Position;
};

// A concept group is just an array of concepts. 
export type ConceptSubset = {
    conceptIds: number[];
};

export function newConceptSubset(): ConceptSubset {
    return {
        conceptIds: [],
    };
}

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
        edgeGroups: Map<number, RelationshipGroup>;
    };
    selection: {
        selected: ConceptSubset;
    },

    newName: string;

    dragConcept: {
        isDragging: boolean;
        startX: number;
        startY: number;
    };

    dragEdge: {
        srcId: number;
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
        srcToDst: boolean;
        relId: number;
    };

    targetZoom: number;
    panState: {
        isPanning: boolean;
        actuallyMoved: boolean;
        startX: number;
        startY: number;
        startMouseX: number;
        startMouseY: number;
    };

    boxSelect: {
        isBoxSelecting: boolean;
        startX: number;
        startY: number
        endX: number;
        endY: number
    },

    hoveredRelIdNext: number;
    hoveredRelId: number;

    rightClicked: ItemReference; 
    currentlyEditing: ItemReference;

    edited: boolean;
};

// NOTE: treat this as a value type. You should never be assigning to these individually.
type ItemReference = {
    relId?: number;
    conceptId?: number;
    subset?: ConceptSubset;
};

type MappingConceptUiState = {
    width: number;
    height: number;
    top: number;
    left: number;
    bottom: number;
    right: number;

    selected: boolean;

    dragging: {
        isDragging: boolean;
        startX: number;
        startY: number;
    };

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

        selected: false,

        dragging: {
            isDragging: false,
            startX: 0,
            startY: 0,
        },

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
        selection: {
            selected: newConceptSubset(),
        },

        newName: "",

        dragConcept: {
            isDragging: false,
            startX: 0,
            startY: 0,
        },

        targetZoom: 1,
        panState: {
            isPanning: false,
            actuallyMoved: false,
            startX: 0,
            startY: 0,
            startMouseX: 0,
            startMouseY: 0,
        },

        boxSelect: {
            isBoxSelecting: false,
            startX: 0,
            startY: 0,
            endX: 0,
            endY: 0,
        },

        dragEdge: {
            srcId: -1,
            startX: -1,
            currentX: -1,
            currentY: -1,
            startY: -1,
            srcToDst: false,
            relId: -1,
        },

        hoveredRelIdNext: 0,
        hoveredRelId: 0,

        rightClicked: {},
        currentlyEditing: {},

        edited: false,
    };
}


function isDraggingAnything(s: GraphMappingsViewState): boolean {
    return s.dragConcept.isDragging ||
        s.panState.isPanning ||
        s.dragEdge.srcId !== -1 ||
        s.boxSelect.isBoxSelecting;
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

function toScreenLength(view: MappingGraphView, len: number) {
    return len * view.zoom;
}

function toContainerX(view: MappingGraphView, x: number) {
    return (x + view.pan.x) * view.zoom;
}

function toContainerY(view: MappingGraphView, y: number) {
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

function ensureParallelUiSate(s: GraphMappingsViewState, graph: MappingGraph) {
    resizeObjectPool(s.relUiState, newMappingRelationshipsUiState, graph.relationships.length);
    resizeObjectPool(s.conceptsUiState, newMappingConceptUiState, graph.concepts.length);
}

export function imGraphMappingsEditorView(
    c: ImCache,
    s: GraphMappingsViewState,
    graph: MappingGraph,
    view: MappingGraphView,
) {
    let editedView = false;
    let mutation: (() => void) | undefined;

    if (imMemo(c, view)) s.targetZoom = view.zoom;
    if (imMemo(c, graph)) {
        recomputeIndexes(s, graph);
    }

    const { mouse, keyboard } = getGlobalEventSystem();

    const dt = getDeltaTimeSeconds(c);

    const contextMenu = imContextMenu(c);

    ensureParallelUiSate(s, graph);

    const root = imLayoutBegin(c, COL); imFlex(c); imRelative(c); imScrollOverflow(c, true, true);
    const rootRect = root.getBoundingClientRect(); {
        if (isFirstishRender(c)) elSetClass(c, cn.userSelectNone);

        const isDraggingEdge = s.dragEdge.srcId !== -1;
        if (imMemo(c, view.zoom)) elSetStyle(c, "fontSize", view.zoom + "rem");
        if (imMemo(c, isDraggingEdge)) elSetStyle(c, "cursor", isDraggingEdge ? "crosshair" : "move");

        if (s.dragConcept.isDragging) {
            // The drag should actually be applied to the selection.

            const rect = root.getBoundingClientRect();
            const mouseX = toGraphX(view, mouse.X - rect.x);
            const mouseY = toGraphY(view, mouse.Y - rect.y);
            const dX = mouseX - s.dragConcept.startX;
            const dY = mouseY - s.dragConcept.startY;

            for (let i = 0; i < graph.concepts.length; i++) {
                const concept = graph.concepts[i];
                if (!concept) continue;

                const ui = s.conceptsUiState[i];
                if (!ui.dragging.isDragging) continue;

                const newX = ui.dragging.startX + dX
                const newY = ui.dragging.startY + dY

                if (concept.x !== newX || concept.y !== newY) {
                    concept.x = newX;
                    concept.y = newY;
                    s.edited = true;
                    ui.version++;
                }
            }
        }

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
            if (Math.abs(view.zoom - s.targetZoom) > 0.00001) {
                const rect = root.getBoundingClientRect();
                const zoomCenterXScreen = mouse.X - rect.x;
                const zoomCenterYScreen = mouse.Y - rect.y;

                const zoomCenterX = toGraphX(view, zoomCenterXScreen);
                const zoomCenterY = toGraphY(view, zoomCenterYScreen);

                // TODO: technically wrog way to use lerp with deltatime but I keep forgetting the real one. Maybe the framework should just have it?
                view.zoom = lerpClamped(view.zoom, s.targetZoom, dt * 40);

                const zoomCenterXAfterZoom = toGraphX(view, zoomCenterXScreen);
                const zoomCenterYAfterZoom = toGraphY(view, zoomCenterYScreen);

                const dX = zoomCenterXAfterZoom - zoomCenterX;
                const dY = zoomCenterYAfterZoom - zoomCenterY;

                view.pan.x += dX;
                view.pan.y += dY;
                editedView = true;
            }
        }

        const ctxEv = imOn(c, EV_CONTEXTMENU);
        if (ctxEv) {
            // don't worry - we check if (ctxEv) and then assign here later
            s.rightClicked = {};
        }

        // Edge drag
        const dragStartConcept = arrayAt(graph.concepts, s.dragEdge.srcId);
        if (imIf(c) && dragStartConcept) {
            const x0 = toContainerX(view, s.dragEdge.startX);
            const y0 = toContainerY(view, s.dragEdge.startY);
            const x1 = toContainerX(view, s.dragEdge.currentX);
            const y1 = toContainerY(view, s.dragEdge.currentY);

            const mx = lerpClamped(x0, x1, 0.5);
            const my = lerpClamped(y0, y1, 0.5);

            s.dragEdge.currentX = toGraphX(view, mouse.X - rootRect.x);
            s.dragEdge.currentY = toGraphY(view, mouse.Y - rootRect.y);

            const lineState = imLayoutLine(c, ROW, x0, y0, x1, y1); imAlign(c); imJustify(c); {
                if (isFirstishRender(c)) elSetClass(c, cn.userSelectNone);
                if (imIf(c) && lineState.isUpsideDown === s.dragEdge.srcToDst) {
                    imLayoutBegin(c, ROW); imSize(c, 20 * view.zoom, PX, 0, NA); imAlign(c); {
                        imArrowHeadSvg(c);
                    } imLayoutEnd(c);
                } imIfEnd(c);

                imLayoutBegin(c, ROW); imFlex(c); {
                    imLine(c, LINE_HORIZONTAL, 3);
                } imLayoutEnd(c);

                if (imIf(c) && lineState.isUpsideDown  !== s.dragEdge.srcToDst) {
                    imLayoutBegin(c, ROW); imSize(c, 20 * view.zoom, PX, 0, NA); imAlign(c); {
                        if (isFirstishRender(c)) elSetStyle(c, "transform", "scale(-1, 1)")
                        imArrowHeadSvg(c);
                    } imLayoutEnd(c);
                } imIfEnd(c);
            } imLayoutLineEnd(c);

            const rel = arrayAt(graph.relationships, s.dragEdge.relId);
            if (imIf(c) && rel) {
                const labelX = mx;
                const labelY = my;
                imLayoutBegin(c, COL); imAbsoluteXY(c, labelX, PX, labelY, PX); imZIndex(c, 10); {
                    if (isFirstishRender(c)) elSetStyle(c, "transform", "translate(-50%, -50%");
                    imRelationshipLabel(c, s, rel, s.dragEdge.relId, ctxEv);
                } imLayoutEnd(c);
            } imIfEnd(c);
        } imIfEnd(c);

        // Concepts
        imFor(c); for (let conceptId = 0; conceptId < graph.concepts.length; conceptId++) {
            const concept = graph.concepts[conceptId];
            if (!concept) continue;

            const conceptUiState = s.conceptsUiState[conceptId]; assert(!!conceptUiState);

            imKeyedBegin(c, conceptId); {
                const editing = conceptId === s.currentlyEditing.conceptId;
                imLayoutBegin(c, BLOCK); {
                    imZIndex(c, 1); // raise above edges
                    imAbsoluteXY(c, toContainerX(view, concept.x), PX, toContainerY(view, concept.y), PX);
                    imPadding(c, 20, PX, 20, PX, 20, PX, 20, PX);

                    if (isFirstishRender(c)) elSetStyle(c, "transform", "translate(-50%, -50%");
                    if (isFirstishRender(c)) elSetStyle(c, "cursor", "pointer");
                    if (isFirstishRender(c)) elSetStyle(c, "borderRadius", (4 * view.zoom) + "px");
                    if (isFirstishRender(c)) elSetClass(c, cn.pre);

                    let hoveredInner = false;
                    const innerRoot = imLayoutBegin(c, COL); {
                        hoveredInner = elHasMouseOver(c)

                        const innerRect = innerRoot.getBoundingClientRect();
                        const padding = 10 * view.zoom;
                        conceptUiState.top =    -rootRect.y + innerRect.top - padding;
                        conceptUiState.left =   -rootRect.x + innerRect.left - padding;
                        conceptUiState.bottom = -rootRect.y + innerRect.bottom + padding;
                        conceptUiState.right =  -rootRect.x + innerRect.right + padding;
                        conceptUiState.width  = conceptUiState.right - conceptUiState.left;
                        conceptUiState.height = conceptUiState.top - conceptUiState.bottom;

                        imPadding(c, 4 * view.zoom, PX, 10 * view.zoom, PX, 4 * view.zoom, PX, 10 * view.zoom, PX);
                        imBg(c, cssVars.bg);

                        if (
                            imMemo(c, hoveredInner) |
                            imMemo(c, conceptUiState.selected)
                        ) {
                            const col = hoveredInner ? cssVars.fg : 
                                        conceptUiState.selected ? "#1E61FF" :
                                        cssVars.mg;

                            elSetStyle(c, "border", "2px solid " + col);
                        }
                        if (imMemo(c, editing)) elSetStyle(c, "cursor", editing ? "" : "pointer");
                        if (imMemo(c, view.zoom)) elSetStyle(c, "borderRadius", (4 * view.zoom) + "px");

                        if (!isDraggingAnything(s) && elHasMousePress(c) && mouse.leftMouseButton) {
                            startDraggingConcepts(s, graph, view, root);
                            conceptUiState.dragging.isDragging = true;
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
                                    s.currentlyEditing = {};

                                    conceptUiState.version++;
                                    s.edited = true;
                                }
                            }
                        } else {
                            imIfElse(c);

                            if (ctxEv && elHasMouseOver(c)) {
                                s.rightClicked = { conceptId };
                            }

                            imLayoutBegin(c, BLOCK); {
                                if (isFirstishRender(c)) elSetClass(c, cn.userSelectNone);

                                imStr(c, concept.conceptName || "Unnamed");

                                const dblClickEv = imOn(c, EV_DBLCLICK);
                                if (dblClickEv) {
                                    s.currentlyEditing.conceptId = conceptId;
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
                                s.dragEdge.srcId = conceptId;

                                const rect = root.getBoundingClientRect();
                                const mouseX = toGraphX(view, mouse.X - rect.x);
                                const mouseY = toGraphY(view, mouse.Y - rect.y);
                                s.dragEdge.startX = mouseX;
                                s.dragEdge.startY = mouseY;
                                s.dragEdge.currentX = s.dragEdge.startX;
                                s.dragEdge.currentY = s.dragEdge.startY;
                                s.dragEdge.srcToDst = true;
                                s.dragEdge.relId = -1;
                            }
                        } else if (s.dragEdge.srcId !== -1 && s.dragEdge.srcId !== conceptId) {
                            canAcceptInEdge = true;

                            if (!mouse.leftMouseButton) {
                                // Drag accepted!
                                mutation = () => {
                                    if (s.dragEdge.relId === -1) {
                                        const rel = newGraphMappingRelationship(s.dragEdge.srcId, conceptId, "Unnamed");
                                        const idx = pushToNullableArray(graph.relationships, rel);
                                        s.currentlyEditing = { relId: idx };
                                    } else {
                                        const rel = graph.relationships[s.dragEdge.relId];
                                        if (rel) {
                                            if (s.dragEdge.srcToDst) {
                                                rel.dstId = conceptId;
                                            } else {
                                                rel.srcId = conceptId;
                                            }
                                        }
                                    }

                                    recomputeIndexes(s, graph);
                                    s.dragEdge.srcId = -1;
                                    s.dragEdge.relId = -1;
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

                const x0 = toContainerX(view, c1.x);
                const y0 = toContainerY(view, c1.y);
                const x1 = toContainerX(view, c2.x);
                const y1 = toContainerY(view, c2.y);

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

                const labelX = mx;
                const labelY = my;
                imLayoutBegin(c, COL); imAbsoluteXY(c, labelX, PX, labelY, PX); imZIndex(c, 10); {
                    if (isFirstishRender(c)) elSetStyle(c, "transform", "translate(-50%, -50%");

                    imFor(c); for (let idxInGroup = 0; idxInGroup < edgeGroup.relIds.length; idxInGroup++) {
                        const relId = edgeGroup.relIds[idxInGroup];
                        const rel = graph.relationships[relId];
                        if (!rel) continue;
                        if (s.dragEdge.relId === relId) continue;

                        imKeyedBegin(c, relId); {
                            s.edited = imRelationshipLabel(c, s, rel, relId, ctxEv) || s.edited;
                        } imKeyedEnd(c);
                    } imForEnd(c);
                } imLayoutEnd(c);

                const lineState = imLayoutLine(c, COL, x0Line, y0Line, x1Line, y1Line); imAlign(c, STRETCH); {
                    imFor(c); for (let idxInGroup = 0; idxInGroup < edgeGroup.relIds.length; idxInGroup++) {
                        const relId = edgeGroup.relIds[idxInGroup];
                        const rel = graph.relationships[relId];
                        if (!rel) continue;
                        if (s.dragEdge.relId === relId) continue;

                        const src = arrayAt(graph.concepts, rel.srcId);
                        const dst = arrayAt(graph.concepts, rel.dstId);
                        if (!src || !dst) continue;

                        const isSrc = c1Id === rel.srcId;

                        imKeyedBegin(c, relId); {
                            const srcUiState = s.conceptsUiState[rel.srcId]; assert(!!srcUiState);
                            const dstUiState = s.conceptsUiState[rel.dstId]; assert(!!dstUiState);
                            const relUiState = s.relUiState[relId]; assert(!!relUiState);

                            imLayoutBegin(c, ROW); {
                                let col = s.hoveredRelId === relId ? "red" : cssVars.fg;
                                imFg(c, col);

                                if (elHasMouseOver(c)) {
                                    s.hoveredRelIdNext = relId;

                                    if (!isDraggingAnything(s) && mouse.leftMouseButton) {
                                        const rect = root.getBoundingClientRect();
                                        const mouseX = toGraphX(view, mouse.X - rect.x);
                                        const mouseY = toGraphY(view, mouse.Y - rect.y);

                                        const toSrc = distSquared(src.x, src.y, mouseX, mouseY);
                                        const toDst = distSquared(dst.x, dst.y, mouseX, mouseY);

                                        if (toSrc < toDst) {
                                            s.dragEdge.srcToDst = false;
                                            s.dragEdge.srcId = rel.dstId;
                                            s.dragEdge.startX = dst.x;
                                            s.dragEdge.startY = dst.y;
                                        } else {
                                            s.dragEdge.srcToDst = true;
                                            s.dragEdge.srcId = rel.srcId;
                                            s.dragEdge.startX = src.x;
                                            s.dragEdge.startY = src.y;
                                        }

                                        s.dragEdge.currentX = s.dragEdge.startX;
                                        s.dragEdge.currentY = s.dragEdge.startY;
                                        s.dragEdge.relId = relId;
                                    }
                                }

                                // arrow. only one should appear at a time
                                if (imIf(c) && lineState.isUpsideDown === isSrc) {
                                    imLayoutBegin(c, ROW); imSize(c, 20 * view.zoom, PX, 0, NA); imAlign(c); {
                                        imArrowHeadSvg(c);
                                    } imLayoutEnd(c);
                                } imIfEnd(c);

                                imLayoutBegin(c, ROW); imFlex(c); imAlign(c); {

                                    if (elHasMouseOver(c) && ctxEv) {
                                        s.rightClicked = { relId };
                                    }

                                    imLayoutBegin(c, ROW); imFlex(c); imSize(c, 0, NA, 3, PX); imBg(c, col); imLayoutEnd(c);
                                } imLayoutEnd(c);

                                // arrow
                                if (imIf(c) && lineState.isUpsideDown !== isSrc) {
                                    imLayoutBegin(c, ROW); imSize(c, 20 * view.zoom, PX, 0, NA); imAlign(c); {
                                        if (isFirstishRender(c)) elSetStyle(c, "transform", "scale(-1, 1)")
                                        imArrowHeadSvg(c);
                                    } imLayoutEnd(c);
                                } imIfEnd(c);

                            } imLayoutEnd(c);
                        } imKeyedEnd(c);

                    } imForEnd(c);
                } imLayoutLineEnd(c);

            } imKeyedEnd(c);
        } imForEnd(c);

        imFor(c); for (const subset of graph.subsets) {
            if (!subset) continue;

            imSubset(c, s, graph, view, subset, root, ctxEv);
        } imForEnd(c);

        imSubset(c, s, graph, view, s.selection.selected, root, ctxEv);

        if (!isDraggingAnything(s) && elHasMousePress(c) && mouse.leftMouseButton) {
            const keys = getGlobalEventSystem().keyboard.keys;

            if (isKeyHeld(keys, SHIFT)) {
                s.boxSelect.isBoxSelecting = true;

                const rect = root.getBoundingClientRect();
                const mouseX = toGraphX(view, mouse.X - rect.x);
                const mouseY = toGraphY(view, mouse.Y - rect.y);
                s.boxSelect.startX = mouseX;
                s.boxSelect.startY = mouseY;
                s.boxSelect.endX = s.boxSelect.startX;
                s.boxSelect.endY = s.boxSelect.startY;
            } else {
                s.panState.startMouseX = toGraphLength(view, mouse.X);
                s.panState.startMouseY = toGraphLength(view, mouse.Y);
                s.panState.startX = view.pan.x;
                s.panState.startY = view.pan.y;
                s.panState.isPanning = true;
                s.panState.actuallyMoved = false;
            }
        }

        if (s.panState.isPanning) {
            const dX = toGraphLength(view, mouse.X) - s.panState.startMouseX;
            const dY = toGraphLength(view, mouse.Y) - s.panState.startMouseY;

            const TOLERANCE_PX = 5;
            if (!s.panState.actuallyMoved) {
                s.panState.actuallyMoved = Math.abs(dX) + Math.abs(dY) > TOLERANCE_PX;
            }

            view.pan.x = s.panState.startX + dX;
            view.pan.y = s.panState.startY + dY;

            editedView = true;
        }

        if (imIf(c) && s.boxSelect.isBoxSelecting) {
            imLayoutBegin(c, BLOCK); imZIndex(c, 10000); imBg(c, cssVars.fg025a); {
                if (isFirstishRender(c)) elSetStyle(c, "border", "3px dashed " + cssVars.fg);

                let x0 = toContainerX(view, s.boxSelect.startX);
                let y0 = toContainerY(view, s.boxSelect.startY);

                const rect = root.getBoundingClientRect();
                const mouseX = mouse.X - rect.x;
                const mouseY = mouse.Y - rect.y;

                let x1 = mouseX;
                let y1 = mouseY;

                const minX = Math.min(x0, x1);
                const minY = Math.min(y0, y1);
                const maxX = Math.max(x0, x1);
                const maxY = Math.max(y0, y1);

                imAbsoluteXY(c, minX, PX, minY, PX);
                imSize(c, maxX - minX, PX, maxY - minY, PX);


                if (!mouse.leftMouseButton) {
                    s.boxSelect.isBoxSelecting = false;

                    const rect = root.getBoundingClientRect();
                    const mouseX = toGraphX(view, mouse.X - rect.x);
                    const mouseY = toGraphY(view, mouse.Y - rect.y);

                    const minX = Math.min(mouseX, s.boxSelect.startX);
                    const minY = Math.min(mouseY, s.boxSelect.startY);
                    const maxX = Math.max(mouseX, s.boxSelect.startX);
                    const maxY = Math.max(mouseY, s.boxSelect.startY);

                    const keys = getGlobalEventSystem().keyboard.keys;
                    const additive = isKeyHeld(keys, SHIFT)

                    for (let i = 0; i < graph.concepts.length; i++) {
                        const concept = graph.concepts[i];
                        if (!concept) continue;

                        const conceptUi = s.conceptsUiState[i];

                        let selected = false;
                        if (minX < concept.x && concept.x < maxX) {
                            if (minY < concept.y && concept.y < maxY) {
                                selected = true;
                            }
                        }

                        if (additive) {
                            conceptUi.selected ||= selected;
                        } else {
                            conceptUi.selected = selected;
                        }
                    }

                    onSelectionUpdated(s);
                }
            } imLayoutEnd(c);
        } imIfEnd(c);

        if (ctxEv) {
            openContextMenuAtMouse(contextMenu);
            ctxEv.preventDefault();
        }

        imLayoutBegin(c, ROW); imAbsolute(c, 0, NA, 10, PX, 10, PX, 0, NA); {
            if (isFirstishRender(c)) elSetStyle(c, "fontSize", "1rem");
            if (isFirstishRender(c)) elSetClass(c, cn.userSelectNone);
            imStr(c, view.pan.x); imStr(c, ", "); imStr(c, view.pan.y);
            imStr(c, " @ "); imStr(c, view.zoom); imStr(c, "x");
        } imLayoutEnd(c);
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
                        toGraphX(view, x),
                        toGraphY(view, y),
                        "Unnamed",
                    );

                    mutation = () => {
                        const idx = pushToNullableArray(graph.concepts, newConcept);
                        recomputeIndexes(s, graph);
                        s.currentlyEditing = { conceptId: idx };
                        contextMenu.open = false;
                    }
                }
            } imContextMenuItemEnd(c);

            imContextMenuItem(c); {
                imStr(c, "Recenter");
                if (elHasMousePress(c)) {
                    let minX: number | undefined;
                    let maxX: number | undefined;
                    let minY: number | undefined;
                    let maxY: number | undefined;
                    for (const concept of graph.concepts) {
                        if (!concept) continue;
                        if (minX === undefined || concept.x < minX) minX = concept.x;
                        if (minY === undefined || concept.y < minY) minY = concept.y;
                        if (maxX === undefined || concept.x > maxX) maxX = concept.x;
                        if (maxY === undefined || concept.y > maxY) maxY = concept.y;
                    }

                    if (minX === undefined) minX = 0;
                    if (maxX === undefined) maxX = minX;
                    if (minY === undefined) minY = 0;
                    if (maxY === undefined) maxY = minY;

                    const wantedX = (minX + maxX) / 2;
                    const wantedY = (minY + maxY) / 2;

                    view.zoom = 1;
                    s.targetZoom = 1;

                    const centerX = toGraphX(view, rootRect.width / 2);
                    const centerY = toGraphY(view, rootRect.height / 2);

                    const dX = wantedX - centerX;
                    const dY = wantedY - centerY;

                    view.pan.x -= dX;
                    view.pan.y -= dY;
                    editedView = true;

                    contextMenu.open = false;
                }
            } imContextMenuItemEnd(c);

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
                } imContextMenuItemEnd(c);

                imContextMenuItem(c); {
                    imStr(c, "Delete concept");
                    if (elHasMousePress(c)) {
                        deleteConcept(s, graph, conceptId);
                        recomputeIndexes(s, graph);
                        contextMenu.open = false;
                    }
                } imContextMenuItemEnd(c);
            } imIfEnd(c);

            const relClickedOn = arrayAt(graph.relationships, s.rightClicked.relId ?? -1);
            if (imIf(c) && relClickedOn) {
                const relId = s.rightClicked.relId;
                assert(relId != null);

                imLine(c, LINE_HORIZONTAL);

                imContextMenuItem(c); {
                    imStr(c, "Rename relationship");
                    if (elHasMousePress(c)) {
                        if (!relClickedOn.relationshipName) {
                            relClickedOn.relationshipName = "Unnamed";
                        }
                        s.currentlyEditing = { relId };
                        contextMenu.open = false;
                    }
                } imContextMenuItemEnd(c);
                imContextMenuItem(c); {
                    imStr(c, "Delete relationship");
                    if (elHasMousePress(c)) {
                        deleteRelationship(graph, relId)
                        recomputeIndexes(s, graph);
                        contextMenu.open = false;
                    }
                } imContextMenuItemEnd(c);
            } imIfEnd(c);

            const subsetClickedOn = s.rightClicked.subset;
            if (imIf(c) && subsetClickedOn) {
                imLine(c, LINE_HORIZONTAL);

                imContextMenuItem(c); {
                    imStr(c, "Delete concepts");
                    if (elHasMousePress(c)) {
                        for (const conceptIdx of subsetClickedOn.conceptIds) {
                            deleteConcept(s, graph, conceptIdx, false);
                        }
                        cleanupInvalidRelationshipsAndSubsets(s, graph);

                        recomputeIndexes(s, graph);
                        s.edited = true;
                        contextMenu.open = false;
                    }
                } imContextMenuItemEnd(c);

                imLine(c, LINE_HORIZONTAL);

                if (imIf(c) && subsetClickedOn === s.selection.selected) {
                    imContextMenuItem(c); {
                        imStr(c, "Add group");
                        if (elHasMousePress(c)) {
                            graph.subsets.push(s.selection.selected);
                            s.selection.selected = newConceptSubset();

                            for (const ui of s.conceptsUiState) {
                                ui.selected = false;
                            }
                            onSelectionUpdated(s);
                            sortSubsets(graph);

                            s.edited = true;
                            contextMenu.open = false;
                        }
                    } imContextMenuItemEnd(c);

                    imContextMenuItem(c); {
                        imStr(c, "Duplicate");
                        if (elHasMousePress(c)) {
                            const selectedSet = s.selection.selected;
                            s.selection.selected = newConceptSubset();
                            const newSelection = s.selection.selected;

                            const remap = new Map<number, number>();

                            for (const conceptIdx of selectedSet.conceptIds) {
                                const concept = graph.concepts[conceptIdx];
                                if (!concept) continue;

                                const duplicate = newGraphMappingConcept(
                                    concept.x + 100,
                                    concept.y + 100,
                                    concept.conceptName,
                                );

                                const idx = pushToNullableArray(graph.concepts, duplicate);
                                newSelection.conceptIds.push(idx);
                                remap.set(conceptIdx, idx);
                            }

                            let len = graph.relationships.length;
                            for (let i = 0; i < len; i++) {
                                const rel = graph.relationships[i];
                                if (!rel) continue;
                                const srcUi = arrayAt(s.conceptsUiState, rel.srcId);
                                const dstUi = arrayAt(s.conceptsUiState, rel.dstId);
                                if (!srcUi || !srcUi.selected) continue;
                                if (!dstUi || !dstUi.selected) continue;

                                const srcRemapped = remap.get(rel.srcId);
                                const dstRemapped = remap.get(rel.dstId);
                                if (srcRemapped === undefined || dstRemapped === undefined) continue;

                                const duplicate = newGraphMappingRelationship(srcRemapped, dstRemapped, rel.relationshipName);
                                pushToNullableArray(graph.relationships, duplicate);
                            }

                            len = graph.subsets.length;
                            for (let i = 0; i < len; i++) {
                                const subset = graph.subsets[i];

                                const canDuplicate = subset
                                    .conceptIds
                                    .every(conceptIdx => remap.has(conceptIdx));

                                if (!canDuplicate) continue;
                                
                                const duplicate = newConceptSubset();
                                for (const conceptIdx of subset.conceptIds) {
                                    const remapped = remap.get(conceptIdx); assert(!!remapped);
                                    duplicate.conceptIds.push(remapped);
                                }
                                graph.subsets.push(duplicate);
                            }

                            ensureParallelUiSate(s, graph);
                            sortSubsets(graph);

                            for (const ui of s.conceptsUiState) {
                                ui.selected = false;
                            }
                            for (const conceptIdx of newSelection.conceptIds) {
                                const ui = s.conceptsUiState[conceptIdx];
                                ui.selected = true;
                            }
                            onSelectionUpdated(s);

                            recomputeIndexes(s, graph);
                            s.edited = true;
                            contextMenu.open = false;
                        }
                    } imContextMenuItemEnd(c);
                } else {
                    imIfElse(c); 

                    imContextMenuItem(c); {
                        imStr(c, "Remove group");
                        if (elHasMousePress(c)) {
                            filterInPlace(graph.subsets, s => s !== subsetClickedOn);
                            s.edited = true;
                            contextMenu.open = false;
                        }
                    } imContextMenuItemEnd(c);

                } imIfEnd(c);
            } imIfEnd(c);
        } imContextMenuEnd(c, contextMenu);
    } imIfEnd(c);

    if (mutation) {
        mutation();
    }

    if (s.edited) {
        s.edited = false;
        graph._version++;
    }

    if (editedView) {
        view._version++;
    }

    // Some code above will check if elHasMouseOver() && dragInProgress && !mouseLeftButton
    // to handle a 'drop' event after a drag, so we're clearing them here at the bottom instead
    // of first thing at the top.
    if (!mouse.leftMouseButton) {
        s.dragConcept.isDragging = false;

        if (s.panState.isPanning) {
            s.panState.isPanning = false;
            if (!s.panState.actuallyMoved) {
                // Deselect all the things
                for (const cUi of s.conceptsUiState) {
                    cUi.selected = false;
                }
                onSelectionUpdated(s);
            }
        }

        s.boxSelect.isBoxSelecting = false;
        s.dragEdge.srcId = -1;
        s.dragEdge.relId = -1;
    }

    s.hoveredRelId = s.hoveredRelIdNext;
    s.hoveredRelIdNext = -1;
}

// This is a simple way to ensure that 
// fully overlapping subsets can always be hovered in the order of
// smallest -> largest, so that they can be removed before larger ones.
function sortSubsets(graph: MappingGraph) {
    graph.subsets.sort((a, b) => b.conceptIds.length - a.conceptIds.length);
}

// Set isDragging = true on the concepts you want dragged after calling this.
function startDraggingConcepts(s: GraphMappingsViewState, graph: MappingGraph, view: MappingGraphView, root: HTMLElement) {
    const mouse = getGlobalEventSystem().mouse;

    s.dragConcept.isDragging = true;

    const rect = root.getBoundingClientRect();
    const mouseX = toGraphX(view, mouse.X - rect.x);
    const mouseY = toGraphY(view, mouse.Y - rect.y);
    s.dragConcept.startX = mouseX;
    s.dragConcept.startY = mouseY;

    for (let i = 0; i < s.conceptsUiState.length; i++) {
        const concept = graph.concepts[i];
        if (!concept) continue;

        const ui = s.conceptsUiState[i];
        ui.dragging.startX = concept.x;
        ui.dragging.startY = concept.y;
        ui.dragging.isDragging = false;
    }
}

function imArrowHeadSvg(c: ImCache) {
    imElSvgBegin(c, EL_SVG); imRelative(c); {
        if (isFirstishRender(c)) elSetAttr(c, "viewBox", "0 0 10 10");
        if (isFirstishRender(c)) elSetStyle(c, "width", "100%")
        if (isFirstishRender(c)) elSetStyle(c, "height", "100%")

        imElSvgBegin(c, EL_SVG_POLYGON); {
            if (isFirstishRender(c)) elSetAttr(c, "points", "0,5 10,10 10,0 0,5");
            if (isFirstishRender(c)) elSetAttr(c, "style", `fill:currentColor;stroke-width:0;`);
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

    if (imIf(c) && rel.relationshipName) {

        const editing = s.currentlyEditing.relId === relId;

        imLayoutBegin(c, ROW); imBg(c, cssVars.bg); {
            const hovered = s.hoveredRelId === relId;

            if (elHasMouseOver(c)) {
                s.hoveredRelIdNext = relId;
            }

            if (isFirstishRender(c)) elSetStyle(c, "padding", "3px 10px");
            if (imMemo(c, hovered)) elSetStyle(c, "border", hovered ? `2px solid ${cssVars.fg}` : "");
            if (isFirstishRender(c)) elSetClass(c, cn.pre);

            if (imIf(c) && editing) {
                if (imMemo(c, true)) {
                    s.newName = rel.relationshipName;
                }

                const ev = imTextInputOneLine(c, s.newName, "Name...", true, true);
                if (ev) {
                    if (ev.newName !== undefined) {
                        s.newName = ev.newName;
                    }
                    if (ev.submit || ev.cancel) {
                        console.log(ev);
                        if (s.newName === " ") {
                            s.newName = "";
                        }
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

                imLayoutBegin(c, ROW); {
                    if (isFirstishRender(c)) elSetClass(c, cn.userSelectNone);

                    imStr(c, rel.relationshipName);

                    const dblClickEv = imOn(c, EV_DBLCLICK);
                    if (dblClickEv) {
                        s.currentlyEditing = { relId };
                    }
                } imLayoutEnd(c);
            } imIfEnd(c);
        } imLayoutEnd(c);
    } imIfEnd(c);

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

    imLayoutBegin(c, type);
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
    imLayoutBegin(c, BLOCK); imListRowCellStyle(c); imButton(c); {
    } // imLayoutEnd
}

// If you pass cleanup = false, don't forget to call cleanupInvalidRelationships yourself!
function deleteConcept(s: GraphMappingsViewState, graph: MappingGraph, conceptId: number, cleanup = true) {
    if (conceptId < 0 && conceptId >= graph.concepts.length) {
        return;
    }

    graph.concepts[conceptId] = null;

    if (cleanup) {
        cleanupInvalidRelationshipsAndSubsets(s, graph);
    }
}

function cleanupInvalidRelationshipsAndSubsets(s: GraphMappingsViewState, graph: MappingGraph) {
    for (let relId = 0; relId < graph.relationships.length; relId++) {
        const rel = graph.relationships[relId];
        if (!rel) continue;

        const src = graph.concepts[rel.srcId];
        const dst = graph.concepts[rel.dstId];
        if (!src || !dst) {
            graph.relationships[relId] = null;
        }
    }

    const cleanupSubset = (s: ConceptSubset) => {
        filterInPlace(s.conceptIds, conceptIdx => !!graph.concepts[conceptIdx]);
    }
    for (const s of graph.subsets) {
        cleanupSubset(s);
    }
    filterInPlace(graph.subsets, s => s.conceptIds.length > 0);

    cleanupSubset(s.selection.selected);
}

function deleteRelationship(graph: MappingGraph, relId: number) {
    if (relId < 0 && relId >= graph.relationships.length) return;
    graph.relationships[relId] = null;
}

function imSubset(
    c: ImCache,
    s: GraphMappingsViewState,
    graph: MappingGraph,
    view: MappingGraphView,
    subset: ConceptSubset,
    root: HTMLElement,
    ctxEv: MouseEvent | null,
) {
    const mouse = getGlobalEventSystem().mouse;

    if (imIf(c) && subset.conceptIds.length > 0) {
        let minX = 0, maxX = 0, minY = 0, maxY = 0;

        for (let subsetIdx = 0; subsetIdx < subset.conceptIds.length; subsetIdx++) {
            const conceptIdx = subset.conceptIds[subsetIdx];

            const concept = graph.concepts[conceptIdx];
            if (!concept) continue;

            const conceptUi = s.conceptsUiState[conceptIdx];

            if (subsetIdx === 0) {
                minX = conceptUi.left;
                minY = conceptUi.top;
                maxX = conceptUi.right;
                maxY = conceptUi.bottom;
            } else {
                minX = Math.min(conceptUi.left, minX);
                minY = Math.min(conceptUi.top, minY);
                maxX = Math.max(conceptUi.right, maxX);
                maxY = Math.max(conceptUi.bottom, maxY);
            }
        }

        const padding = toScreenLength(view, 30);
        const x0 = minX - padding;
        const x1 = maxX + padding;
        const y0 = minY - padding;
        const y1 = maxY + padding;
        imLayoutBegin(c, BLOCK); imAbsoluteXY(c, x0, PX, y0, PX);  imSize(c, x1 - x0, PX, y1 - y0, PX); {
            const hovered = elHasMouseOver(c);

            if (isFirstishRender(c)) elSetStyle(c, "border", "2px solid " + cssVars.fg);
            if (isFirstishRender(c)) elSetStyle(c, "borderRadius", "10px");
            if (imMemo(c, hovered)) elSetStyle(c, "border", `2px solid ${hovered ? cssVars.fg : cssVars.mg}`);

            if (ctxEv && hovered) {
                // TODO: multiple subsets may be overlapping each other. 
                // Removal may be ambiguous when clicking on an overlapped region, esp. in subsets
                // of subsets. We need some way to resolve this. Maybe sort sets by their size?

                s.rightClicked = { subset };
            }

            if (imIf(c) && !isDraggingAnything(s) && elHasMouseOver(c) && mouse.leftMouseButton) {
                startDraggingConcepts(s, graph, view, root);

                for (const conceptIdx of subset.conceptIds) {
                    s.conceptsUiState[conceptIdx].dragging.isDragging = true;
                }
            } imIfEnd(c);
        } imLayoutEnd(c);
    } imIfEnd(c);
}

function onSelectionUpdated(s: GraphMappingsViewState) {
    s.selection.selected.conceptIds.length = 0;
    for (let conceptId = 0; conceptId < s.conceptsUiState.length; conceptId++) {
        const cUi = s.conceptsUiState[conceptId];
        if (cUi.selected) {
            s.selection.selected.conceptIds.push(conceptId);
        }
    }
}
