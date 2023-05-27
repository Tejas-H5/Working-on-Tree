// ---- helpers
const remove = (arr, obj) => {
    const index = arr.indexOf(obj);
    if (index === -1) return null;

    arr.splice(index, 1);
    return obj;
};

const resize = (arr, newSize) => arr.splice(newSize, arr.length - newSize);
const clear = (arr) => arr.splice(0, arr.length)
const clearChildren = (mountPoint) => mountPoint.replaceChildren();
const assert = (trueVal, msg) => {if (!trueVal) { throw new Error(msg); } };

const replaceChildren = (mountPoint, children) => {
    if (!mountPoint) return;

    if (Array.isArray(mountPoint)) {
        clear(mountPoint)
        mountPoint.push(...children);
    } else {
        clearChildren(mountPoint);
        mountPoint.replaceChildren(...children);
    }
}

const appendChildren = (mountPoint, children) => {
    if (!mountPoint) return;
    
    if (Array.isArray(mountPoint)) {
        mountPoint.push(...children);
    } else {
        for (const c of children) {
            mountPoint.appendChild(c);
        }
    }
}



/** @returns {Object<string, HTMLElement>} */
const createComponent = (mountPoint, html) => {
    const createDiv = document.createElement("div");
    createDiv.innerHTML = html.trim();

    const selectedNodes = {};
    createDiv.querySelectorAll("[--id]").forEach((sel) => {
        const names = sel.getAttribute("--id");
        sel.removeAttribute("--id");
        names.split(' ').forEach(name => {
            selectedNodes[name] = sel;
        });
    });

    selectedNodes["root"] = createDiv.childNodes[0];

    appendChildren(mountPoint, createDiv.childNodes);

    return selectedNodes;
};


const createAnimation = (animateFunc) => {
    let t0,
        started = false;

    const animate = (t) => {
        if (t0 === null) {
            t0 = t;
        } else {
            let deltaTimeSeconds = (t - t0) / 1000;
            t0 = t;

            if (animateFunc(deltaTimeSeconds)) {
                started = false;
                return;
            }
        }

        window.requestAnimationFrame(animate);
    };

    const startAnimation = () => {
        if (started) return;
        started = true;
        t0 = null;

        window.requestAnimationFrame(animate);
    };

    return startAnimation;
};

const renderList = (mountPoint, wantedCount, renderFn, ...args) => {
    while (mountPoint.childNodes.length < wantedCount) {
        renderFn(mountPoint, ...args);
    }

    while (mountPoint.childNodes.length > wantedCount) {
        mountPoint.removeChild(mountPoint.childNodes[mountPoint.childNodes.length - 1]);
    }
};

const renderKeyedList = (
    mountPoint,
    listElements,
    newElementsBuffer,
    keyNodeMap,
    keyFn,
    renderFn,
    updateFn, 
    ...args
) => {
    for (const data of keyNodeMap.values()) {
        data.shouldDelete = true;
    }

    clear(newElementsBuffer)

    for (const obj of listElements) {
        const key = keyFn(obj);
        if (!keyNodeMap.has(key)) {
            const { root: newEl } = renderFn(null, obj, ...args);
            keyNodeMap.set(key, {
                el: newEl,
                shouldDelete: false
            });
        }

        const data = keyNodeMap.get(key);
        data.shouldDelete = false;

        updateFn(data.el, obj);
        newElementsBuffer.push(data.el);
    }

    for (const [key, data] of keyNodeMap.entries()) {
        if (data.shouldDelete) {
            keyNodeMap.delete(key);
        }
    }

    // not redundant. It dismounts all children at once, so that when we call this again,
    // we aren't constantly dismounts and moving children
    mountPoint.replaceChildren();
    mountPoint.replaceChildren(...newElementsBuffer);
};

const onResize = (domNode, callback) => {
    const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            if (entry.borderBoxSize) {
                callback(entry.borderBoxSize[0].inlineSize, entry.borderBoxSize[0].blockSize);
            } else {
                callback(entry.contentRect.width, entry.contentRect.height);
            }
        }
    });
    resizeObserver.observe(domNode);

    return () => resizeObserver.disconnect();
};

// An oldie but goodie: https://www.w3schools.com/howto/howto_js_draggable.asp
// I changed it a bit, but it is mostly the same
const onDrag = (domNode, { onDragStart, onDrag, onDragEnd }) => {
    let startX, startY, deltaX, deltaY;

    domNode.addEventListener("mousedown", dragMouseDown);

    function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();

        startX = e.pageX;
        startY = e.pageY;
        onDragStart && onDragStart(startX, startY);

        document.addEventListener("mouseup", closeDragElement);
        document.addEventListener("mousemove", elementDrag);
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();

        deltaX = e.pageX - startX;
        deltaY = e.pageY - startY;
        onDrag && onDrag(deltaX, deltaY);
    }

    function closeDragElement() {
        document.removeEventListener("mouseup", dragMouseDown);
        document.removeEventListener("mousemove", elementDrag);
        onDragEnd && onDragEnd(deltaX, deltaY);
    }
};


const setVisible = (el, state) => {
    if (state) {
        el.classList.remove("hidden");
    } else {
        el.classList.add("hidden");
    }
}

/** 
 * This function ensures there is 1 element and 1 component for every object in the data array, instantiating
 * elements and components with the createFn if needed.
 */
const resizeListRenderPool = (data, elements, components, createFn) => {
    resize(elements, data.length);
    resize(components, data.length);

    for(let i = 0; i < data.length; i++) {
        if (elements.length === i) { // initialize new notes in the list
            createFn(i);
            assert(i === elements.length - 1, 'it ')
            assert(i === components.length - 1, 'it  2')
        }
    }
}
