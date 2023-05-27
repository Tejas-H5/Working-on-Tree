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

const assert = (trueVal, msg) => {
    if (!trueVal) {
        throw new Error(msg);
    }
};

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

const createEvent = () => {
    const handlers = [];

    // Remove events for dom nodes that have disconnected themselves.
    // I wasn't able to find a good way to observe a component and disconnect it via an event,
    // so I am doing it like this.
    const cleanHandlers = () => {
        for (let i = handlers.length - 1; i >= 0; i--) {
            if (!handlers[i][0].isConnected) {
                handlers.splice(i, 1);
            }
        }
    };

    const invoke = (...args) => {
        if (invokingEvent) {
            return;
        }

        invokingEvent = true;
        try {
            cleanHandlers();
            for (let i = handlers.length - 1; i >= 0; i--) {
                handlers[i][1](...args);
            }
        } finally {
            invokingEvent = false;
        }
    };

    // if several dom nodes get unsubscribed but this event is never invoked later, then we have leaked memory
    const subscribe = (domNode, callback, ...args) => {
        assert(
            domNode instanceof HTMLElement,
            "events must be subscribed to dom elements, so they can be automatically unsubscribed"
        );

        // Avoid the case where UI elements are constantly created and destroyed, and
        // they keep subscribing to an event that is never fired and therefore never cleaned.
        cleanHandlers();

        handlers.push([domNode, callback]);
        invokingEvent = true;
        try {
            callback(...args);
        } finally {
            invokingEvent = false;
        }
    };

    return [subscribe, invoke];
};

const createState = (initialState) => {
    let state = initialState,
        invokingEvent = false;

    const [subscribe, invoke] = createEvent();

    const get = () => state;

    const set = (val) => {
        if (invokingEvent) {
            // prevent infinite loops.
            return;
        }

        state = val;
        invoke(state);
    };

    const subscribeWrapper = (domNode, callback) => {
        subscribe(domNode, callback, state);
    };

    return [get, set, subscribeWrapper];
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

const displayOne = (num, choices) => {
    for(let i = 0; i < choices.length; i++) {
        if (i == num) {
            choices[i].classList.remove("hidden");
        } else {
            choices[i].classList.add("hidden");
        }
    }
}