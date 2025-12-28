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
    imFg,
    imFlex,
    imFlex1,
    imGap,
    imJustify,
    imLayout,
    imLayoutEnd,
    imPadding,
    imRelative,
    imScrollOverflow,
    imSize,
    NA,
    PX,
    ROW,
    STRETCH
} from "src/components/core/layout";
import { cn, cssVars } from "src/components/core/stylesheets";
import { imB } from "src/components/core/text";
import { imLine, LINE_HORIZONTAL } from "src/components/im-line";
import { imTextInputOneLine } from "src/components/text-input";
import { GlobalContext } from "src/global-context";
import { arrayAt, filterInPlace } from "src/utils/array-utils";
import {
    getDeltaTimeSeconds,
    ImCache,
    imFor,
    imForEnd,
    imIf,
    imIfElse,
    imIfEnd,
    imMemo,
    isFirstishRender
} from "src/utils/im-core";
import {
    elHasMouseOver,
    elHasMousePress,
    elSetClass,
    elSetStyle,
    EV_CONTEXTMENU,
    EV_DBLCLICK,
    getGlobalEventSystem,
    imOn,
    imPreventScrollEventPropagation,
    imStr
} from "src/utils/im-dom";


// One year ago, I had tried making this exact widget. I gave up because of how hard it was. None of 
// the coordinate transforms worked. Events kept firing unexpectedly. Hover hitboxes kept not working quite right.
// Zooming to the mouse position? I understood the maths at the time, and had implemented it in several other places before then,
// but I just couldn't pull it off in my old framework. 
// Drag events? They kept treading on each other. Panning the graph would start dragging nodes, creating new edges, etc. 
// After I fixed it all, the code was unreadable, unmaintainable. It was a pain. I never touched it or used it ever again.
//
// The new framework has allowed me to make this widget to a much higher degree of polish, functinality, and maintainabilit
// in a couple of hours what took me a couple weeks in my previous framework. The rewrite was worth it after all.


export type GraphMappingConcept = {
    conceptName: string;
    description: string;
    x: number;
    y: number;
    zIndex: number;
};

export function newGraphMappingConcept(x: number, y: number, name: string): GraphMappingConcept {
    return {
        conceptName: name,
        description: "",
        x: x,
        y: y,
        zIndex: 0,
    };
}

// Not managed by the user. The system will infer them via the description!
export type GraphRelationship = {
    relationshipName: string;
    description: string;
    srcId: number;
    dstId: number;
};

export function newGraphRelationship(srcId: number, dstId: number) {
    return {
        relationshipName: "",
        description: "",
        srcId: srcId,
        dstId: dstId,
    };
}

export type GraphMappingsViewState = {
    // Order of the items will never change, as their index is also their ID. 
    // Also means the UI doesn't need to use keys to render them though, unless it is doing it's own sorting.
    concepts: (GraphMappingConcept | null)[];
    relationships: (GraphRelationship | null)[];

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

    zoom: number;
    targetZoom: number;
    pan: {
        x: number;
        y: number;

        isPanning: boolean;
        startX: number;
        startY: number;
        startMouseX: number;
        startMouseY: number;
    };

    conceptRightClickedOnIdx: number;
    conceptCurrentlyEditingIdx: number;

    relationshipCurrentlyEditingIdx: number;
    relationshipRightClickedOnIdx: number;

    _version: number;
};

export function newGraphMappingsViewState(): GraphMappingsViewState {
    const result: GraphMappingsViewState = {
        concepts: [],

        newName: "",

        dragConcept: {
            draggingIdx: -1,
            startX: 0,
            startY: 0,
            startMouseX: 0,
            startMouseY: 0,
        },

        zoom: 1,
        targetZoom: 1,
        pan: {
            x: 0,
            y: 0,

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

        conceptCurrentlyEditingIdx: -1,
        conceptRightClickedOnIdx: -1,

        relationshipCurrentlyEditingIdx: -1,
        relationshipRightClickedOnIdx: -1,

        relationships: [],
        _version: 0,
    };

    result.concepts.push(newGraphMappingConcept(100, 100, "A"));
    result.concepts.push(newGraphMappingConcept(500, 100, "B"));
    result.relationships.push(newGraphRelationship(0, 1));

    return result;
}

// Inserts at a tombstone, or at the very end.
function pushToNullableArray<T>(arr: (T | null)[], val: T): number {
    for (let i = 0; i < arr.length; i++) {
        if (!arr[i]) {
            arr[i] = val;
            return i;
        }
    }

    arr.push(val);
    return arr.length - 1;
}

function isDraggingAnything(s: GraphMappingsViewState): boolean {
    return s.dragConcept.draggingIdx !== -1 ||
        s.pan.isPanning ||
        s.dragNewEdge.srcId !== -1 ||
        s.dragExistingEdge.srcId !== -1;
}

function toGraphX(s: GraphMappingsViewState, mouseX: number) {
    return toGraphLength(s, mouseX) - s.pan.x;
}

function toGraphY(s: GraphMappingsViewState, mouseY: number) {
    return toGraphLength(s, mouseY) - s.pan.y;
}

function toGraphLength(s: GraphMappingsViewState, len: number) {
    return len / s.zoom;
}

function toScreenX(s: GraphMappingsViewState, x: number) {
    return (x + s.pan.x) * s.zoom;
}

function toScreenY(s: GraphMappingsViewState, y: number) {
    return (y + s.pan.y) * s.zoom;
}


function lerp(a: number, b: number, t: number) {
    if (Math.abs(a - b) < 0.0001) return b;

    return (1 - t) * a + t * b;
}

export function imGraphMappingsView(c: ImCache, ctx: GlobalContext, s: GraphMappingsViewState) {
    let edited = false;

    const { mouse } = getGlobalEventSystem();

    const dt = getDeltaTimeSeconds(c);

    const contextMenu = imContextMenu(c);

    const root = imLayout(c, COL); imFlex(c); imRelative(c); imScrollOverflow(c, true, true); {
        if (imMemo(c, s.zoom)) elSetStyle(c, "fontSize", s.zoom + "rem");
        if (isFirstishRender(c)) elSetStyle(c, "cursor", "move");

        const scroll = imPreventScrollEventPropagation(c);
        const scrollAmount = scroll.scrollY / 100;

        // zooming in and out
        {
            if (scrollAmount) {
                const scrollSpeed = 0.5;
                s.targetZoom /= 1.0 + scrollAmount * scrollSpeed;
                if (s.targetZoom < 0.01) s.targetZoom = 0.01;
                if (s.targetZoom > 10) s.targetZoom = 10;
            }

            // animate zooming in and out. We also need to ensure that the 'center' of the zoom is on the mouse cursor
            if (Math.abs(s.zoom - s.targetZoom) > 0.00001) {
                const rect = root.getBoundingClientRect();
                const zoomCenterXScreen = mouse.X - rect.x;
                const zoomCenterYScreen = mouse.Y - rect.y;

                const zoomCenterX = toGraphX(s, zoomCenterXScreen);
                const zoomCenterY = toGraphY(s, zoomCenterYScreen);

                // TODO: technically wrog way to use lerp with deltatime but I keep forgetting the real one. Maybe the framework should just have it?
                s.zoom = lerp(s.zoom, s.targetZoom, dt * 40);

                const zoomCenterXAfterZoom = toGraphX(s, zoomCenterXScreen);
                const zoomCenterYAfterZoom = toGraphY(s, zoomCenterYScreen);

                const dX = zoomCenterXAfterZoom - zoomCenterX;
                const dY = zoomCenterYAfterZoom - zoomCenterY;

                s.pan.x += dX;
                s.pan.y += dY;
            } else {
                s.zoom = s.targetZoom;
            }
        }

        const ctxEv = imOn(c, EV_CONTEXTMENU);
        if (ctxEv) {
            s.conceptRightClickedOnIdx = -1;
        }

        imFor(c); for (let relId = 0; relId < s.relationships.length; relId++) {
            const rel = s.relationships[relId];
            if (!rel) continue;

            const src = arrayAt(s.concepts, rel.srcId);
            const dst = arrayAt(s.concepts, rel.dstId);
            if (!src || !dst) continue;

            const x0 = toScreenX(s, src.x);
            const y0 = toScreenY(s, src.y);
            const x1 = toScreenX(s, dst.x);
            const y1 = toScreenY(s, dst.y);

            const editing = s.relationshipCurrentlyEditingIdx === relId;

            const isFlipped = imLayoutLine(c, ROW, x0, y0, x1, y1); imAlign(c, STRETCH); imGap(c, 20, PX); {
                // handleedge
                imLayout(c, ROW); imFlex(c); imAlign(c); {  
                    const col = elHasMouseOver(c) ? "red" : cssVars.fg;
                    imLayout(c, ROW); imFlex(c); imSize(c, 0, NA, 3, PX); imBg(c, col); imLayoutEnd(c);
                } imLayoutEnd(c);

                imLayout(c, BLOCK); {
                    if (imIf(c) && editing) {
                        if (imMemo(c, true)) s.newName = rel.relationshipName || "Unnamed";

                        const ev = imTextInputOneLine(c, s.newName, "Name...", true, true);
                        if (ev) {
                            if (ev.newName !== undefined) {
                                s.newName = ev.newName;
                            }
                            if (ev.submit !== undefined) {
                                rel.relationshipName = s.newName;
                                s.relationshipCurrentlyEditingIdx = -1;
                                edited = true;
                            }
                            if (ev.cancel) {
                                s.relationshipCurrentlyEditingIdx = -1;
                            }
                        }
                    } else {
                        imIfElse(c);

                        if (ctxEv && elHasMouseOver(c)) {
                            s.relationshipRightClickedOnIdx = relId;
                        }

                        imLayout(c, BLOCK); {
                            if (isFirstishRender(c)) elSetClass(c, cn.userSelectNone);

                            /// imStr(c, rel.srcId);
                            imStr(c, isFlipped ? " <<<<< " : " >>>>> "); // TODO: ARROWS!
                            imStr(c, rel.relationshipName || "Unnamed");
                            imStr(c, isFlipped ? " <<<<< " : " >>>>> "); // TODO: ARROWS!
                            // imStr(c, rel.dstId);

                            const dblClickEv = imOn(c, EV_DBLCLICK);
                            if (dblClickEv) {
                                s.relationshipCurrentlyEditingIdx = relId;
                            }
                        } imLayoutEnd(c);
                    } imIfEnd(c);
                } imLayoutEnd(c);

                // handleedge
                imLayout(c, ROW); imFlex(c); imAlign(c); {  
                    const col = elHasMouseOver(c) ? "red" : cssVars.fg;
                    imLayout(c, ROW); imFlex(c); imSize(c, 0, NA, 3, PX); imBg(c, col); imLayoutEnd(c);
                } imLayoutEnd(c);
            } imLayoutEnd(c);
        } imForEnd(c);

        const dragStart = arrayAt(s.concepts, s.dragNewEdge.srcId);
        if (imIf(c) && dragStart) {
            const x0 = toScreenX(s, dragStart.x);
            const y0 = toScreenY(s, dragStart.y);
            const x1 = toScreenX(s, s.dragNewEdge.currentX);
            const y1 = toScreenY(s, s.dragNewEdge.currentY);

            const dX = toGraphLength(s, mouse.X) - s.dragNewEdge.startMouseX;
            const dY = toGraphLength(s, mouse.Y) - s.dragNewEdge.startMouseY;
            s.dragNewEdge.currentX = s.dragNewEdge.startX + dX;
            s.dragNewEdge.currentY = s.dragNewEdge.startY + dY;

            imLayoutLine(c, ROW, x0, y0, x1, y1); imAlign(c); imJustify(c); {
                if (isFirstishRender(c)) elSetClass(c, cn.userSelectNone);
                imLayout(c, ROW); imFlex(c); {
                    imLine(c, LINE_HORIZONTAL, 3);
                } imLayoutEnd(c);
                imStr(c, " New edge... ");
                imLayout(c, ROW); imFlex(c); {
                    imLine(c, LINE_HORIZONTAL, 3);
                } imLayoutEnd(c);
            } imLayoutEnd(c);
        } imIfEnd(c);

        imFor(c); for (let conceptId = 0; conceptId < s.concepts.length; conceptId++) {
            const concept = s.concepts[conceptId];
            if (!concept) continue;

            const editing = conceptId === s.conceptCurrentlyEditingIdx;
            let dragging = conceptId === s.dragConcept.draggingIdx;

            imLayout(c, BLOCK); {
                imAbsoluteXY(c, toScreenX(s, concept.x), PX, toScreenY(s, concept.y), PX);
                imPadding(c, 20, PX, 20, PX, 20, PX, 20, PX);

                if (isFirstishRender(c)) elSetStyle(c, "transform", "translate(-50%, -50%");
                if (isFirstishRender(c)) elSetStyle(c, "cursor", "pointer");
                if (isFirstishRender(c)) elSetStyle(c, "borderRadius", (4 * s.zoom) + "px");

                let hoveredInner = false;
                imLayout(c, COL); {
                    hoveredInner = elHasMouseOver(c)

                    imPadding(c, 4 * s.zoom, PX, 10 * s.zoom, PX, 4 * s.zoom, PX, 10 * s.zoom, PX);
                    imBg(c, cssVars.bg);

                    if (isFirstishRender(c)) elSetStyle(c, "border", "2px solid " + cssVars.fg);
                    if (imMemo(c, editing)) elSetStyle(c, "cursor", editing ? "" : "pointer");
                    if (imMemo(c, s.zoom)) {
                        elSetStyle(c, "borderRadius", (4 * s.zoom) + "px");
                    }

                    if (!isDraggingAnything(s) && elHasMousePress(c) && mouse.leftMouseButton) {
                        s.dragConcept.draggingIdx = conceptId;
                        s.dragConcept.startMouseX = toGraphLength(s, mouse.X);
                        s.dragConcept.startMouseY = toGraphLength(s, mouse.Y);
                        s.dragConcept.startX = concept.x;
                        s.dragConcept.startY = concept.y;
                        dragging = true;
                    }

                    if (dragging) {
                        const dX = toGraphLength(s, mouse.X) - s.dragConcept.startMouseX;
                        const dY = toGraphLength(s, mouse.Y) - s.dragConcept.startMouseY;
                        concept.x = s.dragConcept.startX + dX;
                        concept.y = s.dragConcept.startY + dY;
                        edited = true;
                    }

                    if (imIf(c) && editing) {
                        if (imMemo(c, true)) s.newName = concept.conceptName || "Unnamed";

                        const ev = imTextInputOneLine(c, s.newName, "Name...", true, true);
                        if (ev) {
                            if (ev.newName !== undefined) {
                                s.newName = ev.newName;
                            }
                            if (ev.submit !== undefined) {
                                concept.conceptName = s.newName;
                                s.conceptCurrentlyEditingIdx = -1;
                                edited = true;
                            }
                            if (ev.cancel) {
                                s.conceptCurrentlyEditingIdx = -1;
                            }
                        }
                    } else {
                        imIfElse(c);

                        if (ctxEv && elHasMouseOver(c)) {
                            s.conceptRightClickedOnIdx = conceptId;
                        }

                        imLayout(c, BLOCK); {
                            if (isFirstishRender(c)) elSetClass(c, cn.userSelectNone);

                            imStr(c, concept.conceptName || "Unnamed");

                            const dblClickEv = imOn(c, EV_DBLCLICK);
                            if (dblClickEv) {
                                s.conceptCurrentlyEditingIdx = conceptId;
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
                            s.dragNewEdge.startMouseX = toGraphLength(s, mouse.X);
                            s.dragNewEdge.startMouseY = toGraphLength(s, mouse.Y);
                            s.dragNewEdge.startX = toGraphX(s, mouse.X - rect.x);
                            s.dragNewEdge.startY = toGraphY(s, mouse.Y - rect.y);
                            s.dragNewEdge.currentX = s.dragNewEdge.startX;
                            s.dragNewEdge.currentY = s.dragNewEdge.startY;
                        }
                    } else if (s.dragNewEdge.srcId !== -1 && s.dragNewEdge.srcId !== conceptId) {
                        canAcceptInEdge = true;

                        if (!mouse.leftMouseButton) {
                            // Drag accepted!
                            const rel = newGraphRelationship(s.dragNewEdge.srcId, conceptId);
                            pushToNullableArray(s.relationships, rel);

                            s.dragNewEdge.srcId = -1;
                        }
                    }
                }

                imBg(c, canDragOutEdge ? "rgba(255, 0, 0, 0.2)" : canAcceptInEdge ? "rgba(0, 255, 0, 0.2)" : "");
            } imLayoutEnd(c);
        } imForEnd(c);

        if (!isDraggingAnything(s) && elHasMousePress(c) && mouse.leftMouseButton) {
            s.pan.startMouseX = toGraphLength(s, mouse.X);
            s.pan.startMouseY = toGraphLength(s, mouse.Y);
            s.pan.startX = s.pan.x;
            s.pan.startY = s.pan.y;
            s.pan.isPanning = true;
        }

        if (s.pan.isPanning) {
            const dX = toGraphLength(s, mouse.X) - s.pan.startMouseX;
            const dY = toGraphLength(s, mouse.Y) - s.pan.startMouseY;
            s.pan.x = s.pan.startX + dX;
            s.pan.y = s.pan.startY + dY;
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
                        toGraphX(s, x),
                        toGraphY(s, y),
                        "Unnamed",
                    );

                    pushToNullableArray(s.concepts, newConcept);
                    s.conceptCurrentlyEditingIdx = s.concepts.length - 1;

                    contextMenu.open = false;
                }
            } imLayoutEnd(c);

            const conceptClickedOn = arrayAt(s.concepts, s.conceptRightClickedOnIdx);
            if (imIf(c) && conceptClickedOn) {
                const conceptId = s.conceptRightClickedOnIdx;

                imLine(c, LINE_HORIZONTAL);

                imContextMenuItem(c); {
                    imStr(c, "Rename concept");
                    if (elHasMousePress(c)) {
                        s.conceptCurrentlyEditingIdx = conceptId;
                        contextMenu.open = false;
                    }
                } imLayoutEnd(c);

                imContextMenuItem(c); {
                    imStr(c, "Delete concept");
                    if (elHasMousePress(c)) {
                        deleteConcept(s, conceptId);
                        contextMenu.open = false;
                    }
                } imLayoutEnd(c);
            } imIfEnd(c);

            const relClickedOn = arrayAt(s.relationships, s.relationshipRightClickedOnIdx);
            if (imIf(c) && relClickedOn) {
                const relId = s.relationshipRightClickedOnIdx;

                imLine(c, LINE_HORIZONTAL);

                imContextMenuItem(c); {
                    imStr(c, "Rename relationship");
                    if (elHasMousePress(c)) {
                        s.relationshipCurrentlyEditingIdx = relId;
                        contextMenu.open = false;
                    }
                } imLayoutEnd(c);
                imContextMenuItem(c); {
                    imStr(c, "Delete relationship");
                    if (elHasMousePress(c)) {
                        deleteRelationship(s, relId)
                        contextMenu.open = false;
                    }
                } imLayoutEnd(c);
            } imIfEnd(c);
        } imContextMenuEnd(c, contextMenu);
    } imIfEnd(c);

    if (edited) {
        s._version++;
    }

    // Some code above will check if elHasMouseOver() && dragInProgress && !mouseLeftButton
    // to handle a 'drop' event after a drag, so we're clearing them here at the bottom instead
    // of first thing at the top.
    if (!mouse.leftMouseButton) {
        s.dragConcept.draggingIdx = -1;
        s.pan.isPanning = false;
        s.dragNewEdge.srcId = -1;
        console.log("Cancel drag");
    }

}

function imLayoutLine(
    c: ImCache,
    type: DisplayType,
    x0: number, y0: number,
    x1: number, y1: number,
    neverUpsideDown = true,
): boolean {
    let isUpsideDown = x1 < x0;

    if (neverUpsideDown) {
        // try to make the line go left -> right so that the contents are never upside down
        if (isUpsideDown) {
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
    let angle = Math.atan2(dy, dx);

    elSetStyle(c, "transform", `translate(0, -50%) rotate(${angle}rad)`)
    elSetStyle(c, "transformOrigin", "center left")
    const len = Math.sqrt(dx * dx + dy * dy);
    elSetStyle(c, "width", len + "px");

    // imLayoutEnd

    return isUpsideDown;
}

function imContextMenuItem(c: ImCache) {
    imLayout(c, BLOCK); imListRowCellStyle(c); imButton(c); {
    } // imLayoutEnd
}

function deleteConcept(s: GraphMappingsViewState, conceptId: number) {
    if (conceptId < 0 && conceptId >= s.concepts.length) return;

    s.concepts[conceptId] = null;
    for (let relId = 0; relId < s.relationships.length; relId++) {
        const rel = s.relationships[relId];
        if (!rel) continue;
        if (rel.srcId !== conceptId && rel.dstId !== conceptId) continue;
        s.relationships[relId] = null;
    }
}

function deleteRelationship(s: GraphMappingsViewState, relId: number) {
    if (relId < 0 && relId >= s.relationships.length) return;
    s.relationships[relId] = null;
}
