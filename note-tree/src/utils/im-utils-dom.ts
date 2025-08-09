import {
    addDestructor,
    getCurrentRoot,
    getImCore,
    imBeginRoot,
    ImCore,
    imInit,
    imRef,
    imState,
    rerenderImCore,
    UIRoot,
    ValidElement
} from "./im-utils-core";

export type DomAppender<E extends ValidElement = ValidElement> = { root: E; idx: number; };

export type KeyPressEvent = {
    key: string;
    code: string;
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
};

export type SizeState = {
    width: number;
    height: number;
}

export type ImKeyboardState = {
    // We need to use this approach instead of a buffered approach like `keysPressed: string[]`, so that a user
    // may call `preventDefault` on the html event as needed.
    // NOTE: another idea is to do `keys.keyDown = null` to prevent other handlers in this framework
    // from knowing about this event.
    keyDown: KeyboardEvent | null;
    keyUp: KeyboardEvent | null;
    blur: boolean;
};


export type ImMouseState = {
    lastX: number;
    lastY: number;

    leftMouseButton: boolean;
    middleMouseButton: boolean;
    rightMouseButton: boolean;
    hasMouseEvent: boolean;

    dX: number;
    dY: number;
    X: number;
    Y: number;

    /**
     * NOTE: if you want to use this, you'll have to prevent scroll event propagation.
     * See {@link imPreventScrollEventPropagation}
     */
    scrollWheel: number;

    clickedElement: object | null;
    lastClickedElement: object | null;
    lastClickedElementOriginal: object | null;
    hoverElement: object | null;
    hoverElementOriginal: object | null;
};

export type ImGlobalEventSystem = {
    core: ImCore | null,
    keyboard: ImKeyboardState;
    mouse:    ImMouseState;
    globalEventHandlers: {
        mousedown:  (e: MouseEvent) => void;
        mousemove:  (e: MouseEvent) => void;
        mouseenter: (e: MouseEvent) => void;
        mouseup:    (e: MouseEvent) => void;
        wheel:      (e: WheelEvent) => void;
        keydown:    (e: KeyboardEvent) => void;
        keyup:      (e: KeyboardEvent) => void;
        blur:       () => void;
    };
}

export function newImGlobalEventSystem(): ImGlobalEventSystem {
    const keyboard: ImKeyboardState = {
        keyDown: null,
        keyUp: null,
        blur: false,
    };

    const mouse: ImMouseState = {
        lastX: 0,
        lastY: 0,

        leftMouseButton: false,
        middleMouseButton: false,
        rightMouseButton: false,
        hasMouseEvent: false,

        dX: 0,
        dY: 0,
        X: 0,
        Y: 0,

        scrollWheel: 0,

        clickedElement: null,
        lastClickedElement: null,
        lastClickedElementOriginal: null,
        hoverElement: null,
        hoverElementOriginal: null,
    };

    const eventSystem: ImGlobalEventSystem = {
        core: null,
        keyboard, 
        mouse,
        // stored, so we can dispose them later if needed.
        globalEventHandlers: {
            mousedown: (e: MouseEvent) => {
                setClickedElement(mouse, e.target);
                mouse.hasMouseEvent = true;
                if (e.button === 0) {
                    mouse.leftMouseButton = true;
                } else if (e.button === 1) {
                    mouse.middleMouseButton = true;
                } else if (e.button === 2) {
                    mouse.rightMouseButton = true;
                }
            },
            mousemove: (e: MouseEvent) => {
                mouse.lastX = mouse.X;
                mouse.lastY = mouse.Y;
                mouse.X = e.clientX;
                mouse.Y = e.clientY;
                mouse.dX += mouse.X - mouse.lastX;
                mouse.dY += mouse.Y - mouse.lastY;
                mouse.hoverElementOriginal = e.target;
            },
            mouseenter: (e: MouseEvent) => {
                mouse.hoverElementOriginal = e.target;
            },
            mouseup: (e: MouseEvent) => {
                if (mouse.hasMouseEvent === true) {
                    return;
                }
                if (e.button === 0) {
                    mouse.leftMouseButton = false;
                } else if (e.button === 1) {
                    mouse.middleMouseButton = false;
                } else if (e.button === 2) {
                    mouse.rightMouseButton = false;
                }
            },
            wheel: (e: WheelEvent) => {
                mouse.scrollWheel += e.deltaX + e.deltaY + e.deltaZ;
                mouse.hoverElementOriginal = e.target;
                e.preventDefault();
            },
            keydown: (e: KeyboardEvent) => {
                keyboard.keyDown = e;
                const core = eventSystem.core;
                if (core !== null) {
                    rerenderImCore(core, core.lastTime, true);
                }
            },
            keyup: (e: KeyboardEvent) => {
                keyboard.keyUp = e;
                const core = eventSystem.core;
                if (core !== null) {
                    rerenderImCore(core, core.lastTime, true);
                }
            },
            blur: () => {
                resetMouseState(mouse, true);
                resetKeyboardState(keyboard);
                keyboard.blur = true;
                const core = eventSystem.core;
                if (core !== null) {
                    rerenderImCore(core, core.lastTime, true);
                }
            }
        },
    };

    return eventSystem;
}


/** Sets an input's value while retaining it's selection */
export function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
    if (
        // performance speedup, and required to be able to select text
        el.value !== text
    ) {
        const { selectionStart, selectionEnd } = el;

        el.value = text;

        el.selectionStart = selectionStart;
        el.selectionEnd = selectionEnd;
    }
}

export function isEditingTextSomewhereInDocument(): boolean {
    const type = document.activeElement?.nodeName;
    if (type) {
        return stringsAreEqual2Versions(type, "textarea", "TEXTAREA") ||
            stringsAreEqual2Versions(type, "input", "INPUT");
    }
    return false;
}


function stringsAreEqual2Versions(val: string, lowercase: string, uppercase: string) {
    if (val.length !== lowercase.length) return false;
        for (let i = 0; i < lowercase.length; i++) {
            if (val[i] !== lowercase[i] && val[i] !== uppercase[i]) return false;
    }
    return true;
}


// Flags vastly reduces the need for boolean flags, and look nicer in code compared to  booleans. They also don't allocate memory like args objects
export const HORIZONTAL = 1 << 1;
export const VERTICAL   = 1 << 2;
export const START      = 1 << 3;
export const END        = 1 << 4;

/**
 * Get the amount you will need to scroll along the horizontal and vertical axes to get the element into view
 */
export function getScrollVH(
    scrollParent: HTMLElement,
    scrollTo: HTMLElement,
    verticalOffset: number | null = null,
    horizontalOffset: number | null = null,
) {
    let scrollLeft = scrollParent.scrollLeft;
    let scrollTop = scrollParent.scrollTop;

    if (horizontalOffset !== null) {
        const scrollOffset = horizontalOffset * scrollParent.offsetWidth;
        const elementWidthOffset = horizontalOffset * scrollTo.getBoundingClientRect().width;

        // offsetLeft is relative to the document, not the scroll parent. lmao
        const scrollToElOffsetLeft = scrollTo.offsetLeft - scrollParent.offsetLeft;

        scrollLeft = scrollToElOffsetLeft - scrollOffset + elementWidthOffset;
    }

    if (verticalOffset !== null) {
        // NOTE: just a copy paste from above
        
        const scrollOffset = verticalOffset * scrollParent.offsetHeight;
        const elementHeightOffset = verticalOffset * scrollTo.getBoundingClientRect().height;

        // offsetTop is relative to the document, not the scroll parent. lmao
        const scrollToElOffsetTop = scrollTo.offsetTop - scrollParent.offsetTop;

        scrollTop = scrollToElOffsetTop - scrollOffset + elementHeightOffset;
    }

    return { scrollTop, scrollLeft };
}


/**
 * Scrolls {@link scrollParent} to bring scrollTo into view.
 * {@link scrollToRelativeOffset} specifies where to to scroll to. 0 = bring it to the top of the scroll container, 1 = bring it to the bottom
 */
export function scrollIntoViewVH(
    scrollParent: HTMLElement,
    scrollTo: HTMLElement,
    verticalOffset: number | null = null,
    horizontalOffset: number | null = null,
) {
    const { scrollLeft, scrollTop } = getScrollVH(
        scrollParent,
        scrollTo,
        verticalOffset,
        horizontalOffset
    );

    scrollParent.scrollLeft = scrollLeft;
    scrollParent.scrollTop = scrollTop;
}

export function scrollIntoViewRect(
    scrollParent: HTMLElement,
    scrollTo: HTMLElement,
    x0: number, y0: number, 
    x1: number, y1: number
) {
    let scrollH: number | null = null;
    let scrollV: number | null = null;

    if (getElementExtentNormalized(scrollParent, scrollTo, VERTICAL | START) < y0) {
        scrollV = y0;
    } else if (getElementExtentNormalized(scrollParent, scrollTo, VERTICAL | END) > y1) {
        scrollV = y1
    }

    if (getElementExtentNormalized(scrollParent, scrollTo, HORIZONTAL | START) < x0) {
        scrollH = x0;
    } else if (getElementExtentNormalized(scrollParent, scrollTo, HORIZONTAL | END) > x1) {
        scrollH = x1;
    }

    scrollIntoViewVH(scrollParent, scrollTo, scrollV, scrollH);
}

// Useful for scrolling.
// numbers < 0 indicate offscreen in the negative direction, and > 1 in the positive. kind-of - just hte top or bottom edge, not whole thing
export function getElementExtentNormalized(scrollParent: HTMLElement, scrollTo: HTMLElement, flags = VERTICAL | START) {
    let result;

    if ((flags & VERTICAL) !== 0) {
        const scrollOffset = scrollTo.offsetTop - scrollParent.scrollTop - scrollParent.offsetTop;

        if (flags & END) {
            result = (scrollOffset + scrollTo.getBoundingClientRect().height) / scrollParent.offsetHeight;
        } else {
            result = scrollOffset / scrollParent.offsetHeight;
        }
    } else {
        // NOTE: This is just a copy-paste from above. 
        // I would paste a vim-macro here, but it causes all sorts of linting errors.

        const scrollOffset = scrollTo.offsetLeft - scrollParent.scrollLeft - scrollParent.offsetLeft;

        if ((flags & END) !== 0) {
            result = (scrollOffset + scrollTo.getBoundingClientRect().width) / scrollParent.offsetWidth;
        } else {
            result = scrollOffset / scrollParent.offsetWidth;
        }
    }

    return result;
}




export function appendToDomRoot(domAppender: DomAppender, child: ValidElement) {
    const i = ++domAppender.idx;
    const root = domAppender.root;

    const children = root.children;
    if (i === children.length) {
        root.appendChild(child);
    } else if (children[i] !== child) {
        root.insertBefore(child, children[i]);
    }
}

export function setClass(val: string, enabled: boolean | number = true, r = getCurrentRoot()): boolean {
    if (enabled !== false && enabled !== 0) {
        r.root.classList.add(val);
    } else {
        r.root.classList.remove(val);
    }

    return !!enabled;
}

/**
 * NOTE: this method is not ideal - it can only manage a single text node under a DOM element at a time.
 * This is usually not enough. You're better off making a text abstraction.
 */
export function setText(text: string, r = getCurrentRoot()) {
    if (r.hasRealChildren === true) throw new Error("But think about the children! (Don't overwrite them with text)");
    if (r.elementSupplier === null) throw new Error("You probably didn't want to call this on a list root");

    // While this is a performance optimization, we also kinda need to do this - 
    // otherwise, if we're constantly mutating the text, we can never select it!
    if (r.lastText !== text) {
        r.lastText = text;
        setTextSafetyRemoved(text);
    }
}

/**
 * Use this if you are already memoizing the text somehow on your end
 */
export function setTextSafetyRemoved(text: string, r = getCurrentRoot()) {
    if (r.root.childNodes.length === 0) {
        r.root.appendChild(document.createTextNode(text));
    } else {
        const textNode = r.root.childNodes[0];
        textNode.nodeValue = text;
    }
}

export function setAttrElement(e: ValidElement, attr: string, val: string | null) {
    if (val !== null) {
        e.setAttribute(attr, val);
    } else {
        e.removeAttribute(attr);
    }
}

export function setAttr(k: string, v: string, r = getCurrentRoot()) {
    return setAttrElement(r.root, k, v);
}

export function pushAttr(k: string, v: string, r = getCurrentRoot()) {
    return setAttrElement(r.root, k, getAttr(k, r) + v);
}

export function getAttr(k: string, r = getCurrentRoot()) : string {
    return r.root.getAttribute(k) || "";
}

function newIsOnScreenState() {
    const r = getCurrentRoot();
    const self = {
        isOnScreen: false,
        observer: new IntersectionObserver((entries) => {
            for (const entry of entries) {
                self.isOnScreen = entry.isIntersecting;
            }
        })
    };

    const core = getImCore();
    self.observer.observe(r.root);
    core.numIntersectionObservers++;
    addDestructor(r, () => {
        core.numIntersectionObservers--;
        self.observer.disconnect()
    });

    return self;
}

export function imIsOnScreen() {
    const isOnScreenRef = imState(newIsOnScreenState);
    return isOnScreenRef.isOnScreen;
}


export function addClasses(classes: string[]) {
    for (let i = 0; i < classes.length; i++) {
        setClass(classes[i]);
    }
}


export function setStyle<K extends (keyof ValidElement["style"])>(key: K, value: string, r = getCurrentRoot()) {
    if (r.elementSupplier === null) throw new Error("Setting text on a list root can't be done - it doesn't have an associated DOM element");

    // NOTE: memoization should be done on your end, not mine

    // @ts-expect-error it sure is
    r.root.style[key] = value;
}

///////// 
// Realtime immediate-mode events API


function newImGetSizeState(): {
    size: SizeState;
    observer: ResizeObserver;
    resized: boolean;
} {
    const r = getCurrentRoot();
    const core = getImCore();

    const self = {
        size: { width: 0, height: 0, },
        resized: false,
        observer: new ResizeObserver((entries) => {
            for (const entry of entries) {
                // NOTE: resize-observer cannot track the top, right, left, bottom of a rect. Sad.
                self.size.width = entry.contentRect.width;
                self.size.height = entry.contentRect.height;
                break;
            }

            rerenderImCore(core, core.lastTime, false);
        })
    };

    self.observer.observe(r.root);
    core.numResizeObservers++;
    addDestructor(r, () => {
        core.numResizeObservers--;
        self.observer.disconnect()
    });

    return self;
}

export function imTrackSize() {
    return imState(newImGetSizeState);
}

export function createSvgElement<E extends SVGElement>(type: string): E {
    const xmlNamespace = "http://www.w3.org/2000/svg";
    const svgEl = document.createElementNS(xmlNamespace, type) as E;
    if (type === "svg" || type === "SVG") {
        // Took this from https://stackoverflow.com/questions/8215021/create-svg-tag-with-javascript
        // Not sure if actually needed
        svgEl.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:xlink", "http://www.w3.org/1999/xlink");
        svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }

    return svgEl;
}

export function newDiv() {
    return document.createElement("div");
}

export function newSpan() {
    return document.createElement("span");
}

export function imBeginDiv(): UIRoot<HTMLDivElement> {
    return imBeginRoot<HTMLDivElement>(newDiv);
}

export function imBeginSpan(): UIRoot<HTMLSpanElement> {
    return imBeginRoot<HTMLSpanElement>(newSpan);
}



/**
 * Mouse press is distinct from mouse-click - A click is what happens when we release the mouse
 * above the same element that we pressed it on. However a press happens immediately on mouse-down.
 * TODO: add elementHasMouseClick
 */
export function elementHasMousePress(r = getCurrentRoot()) {
    const mouse = getImCore().imEventSystem.mouse;
    if (mouse.leftMouseButton === true) {
        return r.root === mouse.clickedElement;
    }
    return  false;
}

export function elementHasMouseDown(
    mouse: ImMouseState,
    // Do we care that this element was initially clicked?
    // Set to false if you want to detect when an element drags their mouse over this element but 
    // it didn't initiate the click from this element.
    hadClick = true
) {
    const r = getCurrentRoot();

    if (hadClick === true) {
        return r.root === mouse.lastClickedElement;
    }

    return mouse.leftMouseButton && elementHasMouseHover(mouse);
}

export function elementHasMouseHover(mouse: ImMouseState) {
    const r = getCurrentRoot();
    return r.root === mouse.hoverElement;
}

export function getHoveredElement(mouse: ImMouseState) {
    return mouse.hoverElement;
}

export function setClickedElement(mouse: ImMouseState, el: object | null) {
    mouse.clickedElement = el;
    mouse.lastClickedElement = el;
    mouse.lastClickedElementOriginal = el;
}

function newPreventScrollEventPropagationState() {
    return { 
        isBlocking: true,
        scrollY: 0,
    };
}


/**
 * Attatch an event handler of your choice to the current UI Root, and 
 * handle the event directly in the render function without lambdas.
 * 
 * This significanlty simplifies the implementation of error boundaries that respond to 
 * errors in arbitrary events.
 * 
 * NOTE: The event type must never change, because the event handler only gets added on the first render.
 * I have found that adding assertion code and even diffing code here has a significant impact on performance,
 * so I've chosen to not add it for now. In the future, I may expose the 
 * event types as integer enums, which should fix this issue. 
 */
export function imOn<K extends keyof HTMLElementEventMap>(type: K): HTMLElementEventMap[K] | null {
    const eventRef = imRef<HTMLElementEventMap[K]>();
    const core = getImCore();

    if (imInit() === true) {
        const r = getCurrentRoot();

        const handler = (e: HTMLElementEventMap[K]) => {
            eventRef.val = e;
            rerenderImCore(core, core.lastTime, true);
        }
        r.root.addEventListener(
            type, 
            // @ts-expect-error this thing is fine, actually.
            handler
        );

        core.numEventHandlers++;

        addDestructor(r, () => {
            core.numEventHandlers--;

            r.root.removeEventListener(
                type,
                // @ts-expect-error this thing is fine, actually.
                handler
            );
        });
    }

    if (eventRef.val === null) return null;

    const ev = eventRef.val;
    eventRef.val = null;
    return ev;
}


export function imPreventScrollEventPropagation(mouse: ImMouseState) {
    const state = imState(newPreventScrollEventPropagationState);

    if (imInit() === true) {
        const r = getCurrentRoot();
        const handler = (e: Event) => {
            if (state.isBlocking === true) {
                e.preventDefault();
            }
        }
        r.root.addEventListener("wheel", handler);
        addDestructor(r, () => {
            r.root.removeEventListener("wheel", handler);
        });
    }

    if (state.isBlocking === true && elementHasMouseHover(mouse) && mouse.scrollWheel !== 0) {
        state.scrollY += mouse.scrollWheel;
        mouse.scrollWheel = 0;
    } else {
        state.scrollY = 0;
    }

    return state;
}


export function resetKeyboardState(keyboard: ImKeyboardState) {
    keyboard.keyDown = null;
    keyboard.keyUp = null;
    keyboard.blur = false;
}

export function resetMouseState(mouse: ImMouseState, clearPersistedStateAsWell: boolean) {
    mouse.dX = 0;
    mouse.dY = 0;
    mouse.lastX = mouse.X;
    mouse.lastY = mouse.Y;

    mouse.clickedElement = null;
    mouse.scrollWheel = 0;

    if (clearPersistedStateAsWell === true) {
        mouse.leftMouseButton = false;
        mouse.middleMouseButton = false;
        mouse.rightMouseButton = false;

        mouse.lastClickedElement = null;
        mouse.lastClickedElementOriginal = null;
        mouse.hoverElement = null;
        mouse.hoverElementOriginal = null;
    }
}


export function getImMouse() {
    return getImCore().imEventSystem.mouse;
}

export function getImKeys() {
    return getImCore().imEventSystem.keyboard;
}

export function addDocumentAndWindowEventListeners(eventSystem: ImGlobalEventSystem) {
    document.addEventListener("mousedown", eventSystem.globalEventHandlers.mousedown);
    document.addEventListener("mousemove", eventSystem.globalEventHandlers.mousemove);
    document.addEventListener("mouseenter", eventSystem.globalEventHandlers.mouseenter);
    document.addEventListener("mouseup", eventSystem.globalEventHandlers.mouseup);
    document.addEventListener("wheel", eventSystem.globalEventHandlers.wheel);
    document.addEventListener("keydown", eventSystem.globalEventHandlers.keydown);
    document.addEventListener("keyup", eventSystem.globalEventHandlers.keyup);
    window.addEventListener("blur", eventSystem.globalEventHandlers.blur);
}

export function removeDocumentAndWindowEventListeners(eventSystem: ImGlobalEventSystem) {
    document.removeEventListener("mousedown", eventSystem.globalEventHandlers.mousedown);
    document.removeEventListener("mousemove", eventSystem.globalEventHandlers.mousemove);
    document.removeEventListener("mouseenter", eventSystem.globalEventHandlers.mouseenter);
    document.removeEventListener("mouseup", eventSystem.globalEventHandlers.mouseup);
    document.removeEventListener("wheel", eventSystem.globalEventHandlers.wheel);
    document.removeEventListener("keydown", eventSystem.globalEventHandlers.keydown);
    document.removeEventListener("keyup", eventSystem.globalEventHandlers.keyup);
    window.removeEventListener("blur", eventSystem.globalEventHandlers.blur);
}

export function beginProcessingImEvent(eventSystem: ImGlobalEventSystem) {
    // persistent things need to be reset every frame, for bubling order to remain consistent per render
    eventSystem.mouse.lastClickedElement = eventSystem.mouse.lastClickedElementOriginal;
    eventSystem.mouse.hoverElement = eventSystem.mouse.hoverElementOriginal;
}

export function endProcessingImEvent(eventSystem: ImGlobalEventSystem) {
    resetKeyboardState(eventSystem.keyboard);
    resetMouseState(eventSystem.mouse, false);
    eventSystem.mouse.hasMouseEvent = false;
}

export function bubbleMouseEvents(r: UIRoot, eventSystem: ImGlobalEventSystem) {
    const notDerived = r.elementSupplier !== null;
    if (notDerived) {
        // Defer the mouse events upwards, so that parent elements can handle it if they want
        const el = r.root;
        const parent = el.parentNode;

        const mouse = eventSystem.mouse;
        if (mouse.clickedElement === el) {
            mouse.clickedElement = parent;
        }
        if (mouse.lastClickedElement === el) {
            mouse.lastClickedElement = parent;
        }
        if (mouse.hoverElement === el) {
            mouse.hoverElement = parent;
        }
    }
}
