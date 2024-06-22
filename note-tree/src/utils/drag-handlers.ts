// The classic: https://www.w3schools.com/howto/howto_js_draggable.asp

import { Insertable } from "./dom-utils";

// This is a little different.
export function addDragHandlers(root: Insertable<HTMLElement>, {
    onDragStart,
    onDrag,
    onDragEnd,
}: {
    onDragStart(): void;
    onDragEnd(): void;
    onDrag(dx: number, dy: number): void;
}) {
    // NOTE: We don't actually care about the real position of the mouse, we only work in deltas.
    // (Because I couldn't actually find a way to get the pageX but relative the component)

    const dragState = {
        startX: 0,
        startY: 0,
        dragThreshold: 5,
        isDragging: false,
    };

    root.el.addEventListener("mousedown", (e) => {
        e.stopImmediatePropagation();

        dragState.startX = e.pageX;
        dragState.startY = e.pageY;
    });

    root.el.addEventListener("mousemove", (e) => {
        e.stopImmediatePropagation();

        const dx = e.pageX - dragState.startX;
        const dy = e.pageY - dragState.startY;


        if (Math.sqrt(dx*dx + dy*dy) > dragState.dragThreshold) {
            if (!dragState.isDragging) {
                dragState.isDragging = true;
                onDragStart();
            }
        }

        if (dragState.isDragging && e.buttons !== 0) {
            onDrag(dx, dy);
        }

        if (dragState.isDragging && e.buttons === 0) {
            dragState.isDragging = false;
            onDragEnd();
        }

    });

    root.el.addEventListener("mouseup", (e) => {
        e.stopImmediatePropagation();

        // The isDragging flag should be able to block the "click" event when required -
        // this can only happen if it gets unset _after_ "click" is fired.

        setTimeout(() => {
            if (e.buttons === 0) {
                dragState.isDragging = false;
                onDragEnd();
            }
        }, 1)
    });

    return dragState;
}

