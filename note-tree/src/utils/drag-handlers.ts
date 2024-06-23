export type DragHandlers = {
    onDragStart(e: MouseEvent): void;
    onDragEnd(e: MouseEvent): void;
    onDrag(dx: number, dy: number, e: MouseEvent): void;
};

/** 
 * The classic: https://www.w3schools.com/howto/howto_js_draggable.asp
 * This is a little different.
 *
 * NOTE: ideally you should only have 1 drag handler at the root level of a component instead of multiple smaller compoonents - 
 *      this setup doesn't really work if you don't recieve mouse input over the whole backdrop of the drag interaction
 */      
export function newDragManager({
    onDragStart,
    onDrag,
    onDragEnd,
}: DragHandlers) {
    // NOTE: We don't actually care about the real position of the mouse, we only work in deltas.
    // (Because I couldn't actually find a way to get the pageX but relative the component)

    const dragState = {
        startX: 0,
        startY: 0,
        dragThreshold: 5,
        isDragging: false,
    };

    let mouseDown = false;


    return {
        onMouseDown(e: MouseEvent) {
            e.stopImmediatePropagation();

            dragState.startX = e.pageX;
            dragState.startY = e.pageY;
            mouseDown = true;
        },
        onMouseMove(e: MouseEvent) {
            const dx = e.pageX - dragState.startX;
            const dy = e.pageY - dragState.startY;
            mouseDown = e.buttons !== 0;

            if (
                !dragState.isDragging && mouseDown &&
                Math.sqrt(dx * dx + dy * dy) > dragState.dragThreshold
            ) {
                dragState.isDragging = true;
                e.stopImmediatePropagation();
                onDragStart(e);
                console.log("start");
            }


            if (dragState.isDragging) {
                e.stopImmediatePropagation();

                if (mouseDown) {
                    onDrag(dx, dy, e);
                    console.log("doing");
                } else {
                    dragState.isDragging = false;
                    e.stopImmediatePropagation();
                    onDragEnd(e);
                    console.log("end");
                }
            }
        },
        onMouseUp(e: MouseEvent) {
            e.stopImmediatePropagation();

            // The isDragging flag should be able to block the "click" event when required -
            // this can only happen if it gets unset _after_ "click" is fired.

            setTimeout(() => {
                if (e.buttons === 0) {
                    dragState.isDragging = false;
                    mouseDown = false;
                    onDragEnd(e);
                }
            }, 1)
        }
    };
}

