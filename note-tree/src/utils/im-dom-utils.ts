// *IM* DOM-utils v0.1.02 - @Tejas-H5
// A variation on DOM-utils with the immediate-mode API isntead of the normal one. I'm still deciding which one I will continue to use.
// Right now, this one seems better, but the other one has a 'proven' track record of actually working.
// But in a matter of hours/days, I was able to implement features in this framework that I wasn't able to for months/years in the other one...
//
// Conventions:
// - All immediate mode methods should start with 'im', like imState.
//      - Any method that calls another method prefixed with `im` should automatically be considered an 'immediate mode method' 
//      - Some methods don't call any `im` methods, but if they are to be used alongside other im methods, you should call them imBlah anyway. E.g imListNext.
// - All immediate mode methods that open up a 'scope' must be prefixed with `imBegin`, and be closed by a corresponding `imEnd` method
//      The only exceptions are: 
//          - The control-flow helpers: `imIf`, `imElseIf`, `imElse`, `imSwitch`, `imTry`, `imCatch`, `imFor`, `imWhile`.
//          - `imEnd`. It's the same as imEndRoot. Used very often, and since a large number of abstractions end up being just 1 root deep, it can be used to end a lot of different things.
//          - If you can guarantee that your imBeginX method only needs a single imEnd method to finalize it well into the future, then 
//              you don't need to provide your own imEndX method.
//
//      Be very conservative when adding your own exceptions to this rule. Usually it's going to be for things that are so common that you want a shorter thing to type.

import { assert } from "./assert";

///////
// Various seemingly random/arbitrary functions that actually end up being very useful

/** 
 * This jQuery code is taken from: https://stackoverflow.com/questions/19669786/check-if-element-is-visible-in-dom
 * This method is mainly used in gobal event handlers to early-return when a UI component isn't visble yet, so
 * it will also return false if the component hasn't been rendered for the first time. 
 */
export function isVisibleEl(el: HTMLElement) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

export function isEditingInput(el: HTMLElement): boolean {
    return document.activeElement === el;
}


/**
 * Sets an input's value while retaining it's selection and undo history
 */
export function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
    if (el.value === text) {
        // performance speedup, and allows users to select the text
        return;
    }

    const { selectionStart, selectionEnd } = el;

    el.value = text;

    el.selectionStart = selectionStart;
    el.selectionEnd = selectionEnd;
}

export function isEditingTextSomewhereInDocument(): boolean {
    const type = document.activeElement?.nodeName?.toLowerCase();
    return type === "textarea" || type === "input";
}


// Flags are kinda based. vastly reduces the need for boolean flags, and API is also nicer looking.
export const HORIZONTAL = 1 << 1;
export const VERTICAL   = 1 << 2;
export const START      = 1 << 3;
export const END        = 1 << 4;

/**
 * Get the amount you will need to scroll along the horizontal and vertical axes to get the element
 * into view
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

export function getElementExtentNormalized(
    scrollParent: HTMLElement,
    scrollTo: HTMLElement,
    flags = VERTICAL | START
) {
    if (flags & VERTICAL) {
        const scrollOffset = scrollTo.offsetTop - scrollParent.scrollTop - scrollParent.offsetTop;

        if (flags & END) {
            return (scrollOffset + scrollTo.getBoundingClientRect().height) / scrollParent.offsetHeight;
        } else {
            return scrollOffset / scrollParent.offsetHeight;
        }
    } else {
        // NOTE: This is just a copy-paste from above. 
        // I would paste a vim-macro here, but it causes all sorts of linting errors.

        const scrollOffset = scrollTo.offsetLeft - scrollParent.scrollLeft - scrollParent.offsetLeft;

        if (flags & END) {
            return (scrollOffset + scrollTo.getBoundingClientRect().width) / scrollParent.offsetWidth;
        } else {
            return scrollOffset / scrollParent.offsetWidth;
        }
    }
}

///////// 
// The immediate-mode rendering API.
// You might think I made this for performance, but I didn't. 
// What I really wanted, was a UI framework that lets me colocate logic and UI, and composes correctly
// i.e There is never a scenario where I _have_ to create a function or a class to get some sort of 
// component-like behavior, and I can put 'state' as close to some UI as needed, so that we can
// evolve better abstractions.

function renderStub() {}

export type ImCore = {
    initialized:   boolean;
    uninitialized: boolean;
    appRoot:       UIRoot;

    currentStack:    (UIRoot | ListRenderer)[];
    currentContexts: StateItem[];

    // Only one of these is defined at a time.
    currentRoot:         UIRoot | undefined;
    currentListRenderer: ListRenderer | undefined;

    imDisabled:       boolean;

    renderFn: () => void;

    keyboard: ImKeyboardState;
    mouse:    ImMouseState;

    dtSeconds: number;
    tSeconds:  number;
    lastTime:  number;
    time:      number;

    isRendering: boolean;
    _isExcessEventRender: boolean;

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

    /** These are used to display performance metrics in the UI. */
    itemsRendered: number;
    itemsRenderedLastFrame: number;
    numResizeObservers: number;
    numIntersectionObservers: number;
    numCacheMisses: number;
};

const ITEM_LIST_RENDERER = 2;
const ITEM_UI_ROOT = 1;
const ITEM_STATE = 3;

// TODO: we added this, but I suspect it doesn't actually work yet - 
// the dom-appender code hasn't been updated to 'ignore' or 'step over'
// things that we have REMOVE_LEVEL_NONE removed, so that stuff ends up being pushed to the bottom of the DOM - not ideal.
// I recon we should see if there is an easy way to make it work.
export const REMOVE_LEVEL_NONE = 0;
export const REMOVE_LEVEL_DOM = 1;
export const REMOVE_LEVEL_DESTROY = 2;

export type RemovedLevel 
    = typeof REMOVE_LEVEL_NONE
    | typeof REMOVE_LEVEL_DOM   // This is the default remove level. The increase in performance far oughtweighs any memory problems. 
    | typeof REMOVE_LEVEL_DESTROY;


/**
 * Don't forget to initialize this core with {@link initImDomUtils}
 */
export function newImCore(root: HTMLElement = document.body): ImCore {
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

        /**
         * NOTE: if you want to use this, you may have to prevent normal scroll event propagation.
         * See {@link imPreventScrollEventPropagation}
         */
        scrollWheel: 0,

        clickedElement: null,
        lastClickedElement: null,
        lastClickedElementOriginal: null,
        hoverElement: null,
        hoverElementOriginal: null,
    };

    const core: ImCore = {
        initialized: false,
        uninitialized: false,
        appRoot: newUiRoot(() => root),

        currentStack: [],
        currentContexts: [],
        currentRoot: undefined,
        currentListRenderer: undefined,

        imDisabled: false,

        renderFn: renderStub,

        keyboard,
        mouse,

        dtSeconds: 0,
        tSeconds: 0,
        lastTime: 0,
        time: 0,
        isRendering: false,
        _isExcessEventRender: false,

        itemsRendered: 0,
        itemsRenderedLastFrame: 0,
        numResizeObservers: 0,
        numIntersectionObservers: 0,
        numCacheMisses: 0,

        // Event handlers
        globalEventHandlers: {
            mousedown: (e: MouseEvent) => {
                const { mouse } = core;
                setClickedElement(core, e.target);
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
                const { mouse } = core;
                mouse.lastX = mouse.X;
                mouse.lastY = mouse.Y;
                mouse.X = e.clientX;
                mouse.Y = e.clientY;
                mouse.dX += mouse.X - mouse.lastX;
                mouse.dY += mouse.Y - mouse.lastY;
                mouse.hoverElementOriginal = e.target;
            },
            mouseenter: (e: MouseEvent) => {
                const { mouse } = core;
                mouse.hoverElementOriginal = e.target;
            },
            mouseup: (e: MouseEvent) => {
                const { mouse } = core;
                if (mouse.hasMouseEvent) {
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
                const { mouse } = core;
                mouse.scrollWheel += e.deltaX + e.deltaY + e.deltaZ;
                mouse.hoverElementOriginal = e.target;
                e.preventDefault();
            },
            keydown: (e: KeyboardEvent) => {
                const { keyboard } = core;
                keyboard.keyDown = e;
                rerenderImCore(core, core.lastTime, true);
            },
            keyup: (e: KeyboardEvent) => {
                const { keyboard } = core;
                keyboard.keyUp = e;
                rerenderImCore(core, core.lastTime, true);
            },
            blur: () => {
                resetMouseState(core, true);
                resetKeyboardState(core);
                core.keyboard.blur = true;
                rerenderImCore(core, core.lastTime, true);
            }
        },
    };
    return core;
}

/** 
 * NOTE: some atypical usecases require multiple cores,
 * so make sure that your event handlers capture the one that is current
 * _at the time of adding the event_.
 *
 * Wrong:
 * ```ts
 * resizeObserver.onResize(() => {
 *      rerenderCore(imCore);
 * })
 * ```
 *
 * Right:
 * ```ts
 * const core = imCore;
 * resizeObserver.onResize(() => {
 *      rerenderCore(core);
 * })
 * ```
 */
const defaultCore = newImCore();

// Contains ALL the state. In an atypical usecase, there may be multiple cores that must switch between each other.
// This used to be called imContext, but this name was better suited for a feature similar to React.Context
let imCore = defaultCore;

export type ValidElement = HTMLElement | SVGElement;
export type StyleObject<U extends ValidElement> = (U extends HTMLElement ? keyof HTMLElement["style"] : keyof SVGElement["style"]);

export type StateItem<T = unknown>  = {
    t: typeof ITEM_STATE;
    v: T;
    supplier: () => unknown;
};

export type UIRootItem = UIRoot | ListRenderer | StateItem;

export type DomAppender<E extends ValidElement = ValidElement> = {
    root: E;
    idx: number;
    /** NOTE: we don't know anything about children that weren't appended via the framework */
    // children: ValidElement[];
};

export function resetDomAppender(domAppender: DomAppender, idx = -1) {
    domAppender.idx = idx;
}

export function appendToDomRoot(domAppender: DomAppender, child: ValidElement) {
    const i = ++domAppender.idx;

    const root = domAppender.root;

    // NOTE: it appears there's not much difference between querying the real children vs having a separate array.
    const children = root.children;
    if (i === children.length) {
        root.appendChild(child);
    } else if (children[i] !== child) {
        root.insertBefore(child, children[i]);
    }

    // NOTE: THere appears to be a bug in this code which isn't present in the above
    // if (i === domAppender.children.length) {
    //     root.appendChild(child);
    //     domAppender.children.push(child);
    // } else if (domAppender.children[i] !== child) {
    //     root.insertBefore(child, domAppender.children[i]);
    //     domAppender.children[i] = child;
    // }
}

export function finalizeDomRoot(domAppender: DomAppender) {
    // domAppender.children.length = domAppender.idx + 1e
}


/**
 * Whenever your app starts rendering, a {@link UIRoot} backed by the DOM root is pushed onto {@link currentStack}.
 * {@link imBeginRoot} will create a {@link UIRoot} backed by a custom DOM node, and push it onto {@link currentStack}.
 * {@link imEnd} will pop a {@link UIRoot} from {@link currentStack}.
 * {@link getCurrentRoot} can be used to get the current UIRoot.
 *
 * ```ts
 * function imApp() {
 *     r = getCurrentRoot()  // assertion failed - no current root
 *     imDiv(); {
 *          r = getCurrentRoot() // div that we rendered above
 *     } imEnd();
 *     r = getCurrentRoot()  // assertion failed - no current root
 * }
 * ```
 *
 * In the first render, any number of things can be rendered. 
 * To be more specific, a 'thing' is an immediate mode state entry. 
 * Only 3 methods can create im-state entries - {@link imBeginRoot}, {@link imState}, and {@link imBeginList}.
 * In every subsequent render, the same number of im-state entries must be 'created' in the same order.
 * This is because in subsequent renders, calls to the im-state functions don't recreate state, but 
 * increment an array index, and retrieve the state they created in the first render.
 * 
 * For example:
 *
 * ```ts
 * // Valid
 * function imApp() {
 *     imDiv(); imEnd();
 * }
 *
 * // Not valid
 * let n = 0;
 * function imApp() {
 *      n++;
 *      for (let i = 0; i < n; i++) {
 *          // As soon as n is incremented, the app will (ideally) throw an Error, complaining about a different number of 
 *          // things being rendered.
 *          imDiv(); imEnd{}; 
 *      }
 * }
 *
 * // Also not valid
 * let n = 0;
 * function imApp() {
 *      n++
 *      if (n < 10) {
 *          Component1();
 *      } else {
 *          // This is especially bad, because every im-state call in Component2 will retrieve state that was
 *          // created by Component1, and none of it will line up at all. You will corrupt your data, basically.
 *          // I haven't been able to think of any good safeguards against this.
 *          Component2();   
 *      }
 * }
 *
 * ```
 *
 * Then how the heck do we do conditional rendering, or list rendering, AKA anything actually useful?
 * You'll need to take a look at:
 * list rendering:
 *      {@link imBeginList}.
 * conditional rendering helpers (they are just variants on `imList`):
 *      {@link imIf}
 *      {@link imElseIf}
 *      {@link imElse}
 * control flow helpers (they are also just variants on `imList`):
 *      {@link imTry}
 *      {@link imCatch}
 *      {@link imSwitch}
 *
 */
export type UIRoot<E extends ValidElement = ValidElement> = {
    readonly t: typeof ITEM_UI_ROOT;

    readonly root: E;
    readonly domAppender: DomAppender<E>;
    // If there was no supplier, then this root is attached to the same DOM element as another UI root that does have a supplier.
    readonly elementSupplier: (() => ValidElement) | null;

    readonly destructors: (() => void)[];

    // TODO: use an SOA representation here. Can reduce 1 indirection I'm pretty sure.
    readonly items: UIRootItem[];

    itemsIdx: number;
    lastItemIdx: number;

    hasRealChildren:    boolean; // can we add text to this element ?
    removedLevel:       RemovedLevel; // how much has this been removed?
    completedOneRender: boolean; // have we completed at least one render without erroring?

    // We need to memoize on the last text - otherwise, we literally can't even select the text.
    lastText: string;
};

export function newUiRoot<E extends ValidElement>(supplier: (() => E) | null, domAppender: DomAppender<E> | null = null): UIRoot<E> {
    let root: E | undefined;
    if (domAppender === null) {
        assert(supplier !== null);
        root = supplier();
        domAppender = { root, idx: -1 };
    } else {
        assert(domAppender !== null);
        root = domAppender.root;
    }

    return {
        t: ITEM_UI_ROOT,
        root,
        domAppender,
        // If there was no supplier, then this root is attached to the same DOM element as another UI root that does have a supplier.
        elementSupplier: supplier, 
        destructors: [],
        items: [],
        itemsIdx: -1,
        lastItemIdx: -1,
        hasRealChildren: false,
        removedLevel: REMOVE_LEVEL_NONE,
        completedOneRender: false,
        lastText: "",
    }
}

function __beginUiRoot(r: UIRoot, startDomIdx: number, startItemIdx: number) {
    resetDomAppender(r.domAppender, startDomIdx);
    r.itemsIdx = startItemIdx;
    pushRoot(r);

    // NOTE: avoid any more asertions here - the component may error out, and
    // __end may not get called. No I'm not going to catch it with an exception stfu. We livin on the edge, bois.
}

function isDerived(r: UIRoot) {
    return r.elementSupplier === null;
}

function assertNotDerived(r: UIRoot) {
    // When elementSupplier is null, this is because the root is not the 'owner' of a particular DOM element - 
    // rather, we got it from a ListRenderer somehow - setting attributes on these React.fragment type roots is always a mistake
    assert(isDerived(r) === false);
}

export function setClass(val: string, enabled: boolean | number = true) {
    const r = getCurrentRoot();

    if (enabled) {
        r.root.classList.add(val);
    } else {
        r.root.classList.remove(val);
    }

    return !!enabled;
}

export function setText(text: string, r = getCurrentRoot()) {
    // don't overwrite the real children!
    assert(r.hasRealChildren === false);

    assertNotDerived(r);

    // While this is a performance optimization, we also kinda need to do this - 
    // otherwise, if we're constantly mutating the text, we can never select it!
    if (r.lastText === text) return;
    r.lastText = text;

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

export function __onUIRootDestroy(r: UIRoot) {
    // ensure only called once
    if (r.removedLevel === REMOVE_LEVEL_DESTROY) return;
    r.removedLevel = REMOVE_LEVEL_DESTROY;

    for (let i = 0; i < r.items.length; i++) { const item = r.items[i];
        if (item.t === ITEM_UI_ROOT) {
            __onUIRootDestroy(item);
        } else if (item.t === ITEM_LIST_RENDERER) {
            const l = item;
            for (let i = 0; i < l.builders.length; i++) {
                __onUIRootDestroy(l.builders[i]);
            }
            if (l.keys !== undefined) {
                for (const v of l.keys.values()) {
                    __onUIRootDestroy(v.root);
                }
            }
        }
    }

    for (const d of r.destructors) {
        try {
            d();
        } catch (e) {
            console.error("A destructor threw an error: ", e);
        }
    }
}

// NOTE: If this is being called before we've rendered any components here, it should be ok.
// if it's being called during a render, then that is typically an incorrect usage - the domAppender's index may or may not be incorrect now, because
// we will have removed HTML elements out from underneath it. You'll need to ensure that this isn't happening in your use case.
export function __removeAllDomElementsFromUiRoot(
    r: UIRoot,
    removeLevel: RemovedLevel,
) {
    if (r.removedLevel >= removeLevel) return;
    r.removedLevel = removeLevel;

    for (let i = 0; i < r.items.length; i++) {
        const item = r.items[i];
        if (item.t === ITEM_UI_ROOT) {
            item.domAppender.root.remove();
            if (removeLevel === REMOVE_LEVEL_DESTROY) {
                __onUIRootDestroy(item);
            }
        } else if (item.t === ITEM_LIST_RENDERER) {
            // needs to be fully recursive. because even though our UI tree is like
            //
            // -list
            //   -list
            //     -list
            // 
            // They're still all rendering to the same DOM root!!!
            
            const l = item;
            for (let i = 0; i < l.builders.length; i++) {
                __removeAllDomElementsFromUiRoot(l.builders[i], removeLevel);
            }
            if (l.keys !== undefined) {
                for (const v of l.keys.values()) {
                    __removeAllDomElementsFromUiRoot(v.root, removeLevel);
                }
            }
        }
    }
}

export function addDestructor(r: UIRoot, destructor: () => void) {
    r.destructors.push(destructor);
}

type ValidKey = string | number | Function | object;

export type ListRenderer = {
    readonly t: typeof ITEM_LIST_RENDERER;
    readonly uiRoot: UIRoot;

    readonly builders: UIRoot[];
    keys: Map<ValidKey, {
        root: UIRoot;
        rendered: boolean;
    }> | undefined;

    builderIdx: number;
    current: UIRoot | null;

    // TODO: add LRU cache for REMOVE_LEVEL_DOM. Otherwise we'll just infinitely grow in memory usage.
    // While not a problem for us yet, it will be eventually.
    cacheRemoveLevel: typeof REMOVE_LEVEL_DOM   | typeof REMOVE_LEVEL_DESTROY;
}

function __beginListRenderer(l: ListRenderer) {
    l.builderIdx = 0;
    if (l.keys !== undefined) {
        for (const v of l.keys.values()) {
            v.rendered = false;
        }
    }
    l.current = null;
    pushList(l);
}

export type RenderFn<T extends ValidElement = ValidElement> = (r: UIRoot<T>) => void;
export type RenderFnArgs<A extends unknown[], T extends ValidElement = ValidElement> = (r: UIRoot<T>, ...args: A) => void;

/**
 * Allows you to render a variable number of UI roots at a particular point in your component.
 * UI Roots that aren't rendered in subsequent renders get removed from the dom when you `end()` a list.
 *
 * See {@link imNextRoot} for more info.
 * See the {@link UIRoot} docs for more info on what a 'UIRoot' even is, what it's limitations are, and how to effectively (re)-use them.
 *
 * Normal usage:
 * ```ts
 * imList();
 * for (let i = 0; i < n; i++) {
 *      nextRoot(); {
 *          RenderComponent();
 *      } end();
 * }
 * end();
 * ```
 *
 * Keyed:
 *
 * ```ts
 * imList();
 * for (const item of items) {
 *      nextRoot(item.id); {
 *          RenderComponent();
 *      } end();
 * }
 * imEnd();
 * ```
 *
 * @param cached - if true, doesn't remove things from the DOM. 
 */
export function imBeginList(cached: ListRenderer["cacheRemoveLevel"] = REMOVE_LEVEL_DOM): ListRenderer {
    const core = imCore;

    // Don't access immediate mode state when immediate mode is disabled
    assert(core.imDisabled === false);

    const r = getCurrentRoot();

    let result: ListRenderer | undefined; 
    const items = r.items;
    const idx = ++r.itemsIdx;
    if (idx < items.length) {
        const val = items[idx];

        // The same immedaite mode state must be queried in the same order every time.
        assert(val.t === ITEM_LIST_RENDERER);

        result = val;
    } else {
        assertCanPushImmediateModeStateEntry(r);

        result = newListRenderer(r);
        items.push(result);
        core.numCacheMisses++;
    }

    result.cacheRemoveLevel = cached;
    __beginListRenderer(result);

    core.itemsRendered++;

    return result;
}

function assertCanPushImmediateModeStateEntry(r: UIRoot) {
    // You rendered more things in this render than in the previous render.
    // The same immediate mode state must be queried in the same order every time.
    assert(r.lastItemIdx === -1);
}

/**
 * Helpers to make conditional rendering with the list easier to type and read.
 *
 * ```ts
 *  if (imIf() && cond1) {
 *      imComponent1();
 *  } else if (imElseIf() && cond2) {
 *      imComponent2();
 *  } else {
 *      imElse()
 *      imComponent3();
 *  } imEndIf();
 * ```
 *
 * Everythig this method does can also be done using {@link imBeginList}, {@link imEndList} and {@link imNextRoot},
 * but you have to type more, and I feel that code doesn't evolve correctly with 
 * that approach. For example, the following code is valid:
 *
 * ```ts
 *  imList();
 *  if (nextSlot() && cond0) {
 *      imComponent0();
 *  }   
 *  // We don't need an imEndList() and imBeginList() here, so we won't add it.
 *  // However, this has the consequence that the if-statement above is always grouped with
 *  // the one below, sometimes unnecessarily, making it harder to spot potential refactorings.
 *  if (nextSlot() && cond1) {
 *      imComponent1();
 *  } else if (nextSlot() && cond2) {
 *      imComponent2();
 *  } else {
 *      nextSlot();
 *      imComponent3();
 *  }
 *  imEndList();
 * ```
 */
export function imIf() {
    imBeginList(REMOVE_LEVEL_DOM);
    imNextRoot();
    return true as const;
}

/**
 * Improves readability of imList being used for a switch.
 * ```ts
 * imSwitch(key); switch(key) {
 *     case 1: imComponent1(); break;
 *     case 2: imComponent2(); break;
 * } imEndSwitch();
 * ```
 *
 * Do note that you can introduce some subtle double-component bugs if you use fallthrough:
 *
 * ```
 * // Super subtle bug here - you've created 2 instances of imComponent1And2Layout, with different internal states.
 * // You should prefer an if-statement here, or normalize the key to avoid fallthrough cases.
 * imSwitch(key); switch(key) {
 *      case 1: case 2: {   
 *          imComponent1And2Layout();
 *      } break;
 *      case 3: imComponent3(); break;
 * } imEndSwitch();
 * ```
 */
export function imSwitch(key: ValidKey) {
    imBeginList(REMOVE_LEVEL_DOM);
    imNextRoot(key);
}

/** See {@link imSwitch} */
export function imEndSwitch() {
    imEndList();
}

/** See {@link imIf} */
export function imElseIf(): true {
    imNextRoot();
    return true;
}

/** See {@link imIf} */
export function imElse(): true {
    imNextRoot();
    return true;
}

/** See {@link imIf} */
export function imEndIf() {
    imEndList();
}

/** Added these too, because imBeginList is too many characters. */
export const imFor = imBeginList;
export const imEndFor = imEndList;
export const imWhile = imBeginList;
export const imEndWhile = imEndList;


/**
 * Helpers for implementing try-catch.
 * You can also do this with {@link imBeginList}/{@link imEndList} and {@link imNextRoot},
 * but you need to know what you're doing, and it is annoying to remember.
 *
 * ```ts
 * const errorRef = imRef<any>();
 *
 * const l = imTry();
 * try {
 *      if (imIf() && !errorRef.val) {
 *          imComponent1();
 *      } else {
 *          imElse()
 *          imErrorStateComponent();
 *      } imEndIf();
 * } catch (e) {
 *      // unmounts imComponent1 immediately, rewinds the stack back to this list.
 *      imCatch(l);     
 *
 *      // NOTE: you can't and shouldn't render any components in this region, since the
 *      // app rerenders ever frame, so the only way to keep a component you render here on the screen
 *      // is by throwing the same Error exception every frame. 
 *      // Aside from the fact that it is a bad idea, this typically won't happen if the Error was thrown when 
 *      // you were handling a mouse click or keyboard input, for example.
 *      // You'll need to do something else instead!
 *
 *      console.error("An error occured while rendering: ", e);
 *      errorRef.val = e;
 * } 
 * imEndTry();
 *
 * ```
 */
export function imTry(): ListRenderer {
    const l = imBeginList();
    imNextRoot();
    return l;
}

/** See {@link imTry} */
export function imCatch(l: ListRenderer) {
    abortListAndRewindUiStack(l);
    disableIm();
}

/** See {@link imTry} */
export function imEndTry() {
    enableIm();
    imEndList();
}


/**
 * Read {@link imBeginList}'s doc first for context and examples.
 *
 * You can optionally specify a {@link key}.
 * If a key is present, the same UIRoot that was rendered for that particular key will be re-used. Make sure
 *      to not reuse the same key twice.
 *
 * If no key is present, the same UIRoot that was rendered for the nth call of nextListSlot() without a key will be re-used.
 *
 * When to use a key:
 *  - You need to render a different type of component per key. See {@link imSwitch}.
 *  - Each component in the list is complex, and may contain list rendering inside of it
 *  - Your components are not simply a function of state. You have untangible state that isn't stored anywere like text area focus/selection states, 
 *      so re-ordering your data and rendering it without keying it leads to bugs in your app
 *  - You just like using the key, actually
 * 
 * When you probably don't need a key:
 *  - You want to keep the code simple
 *  - Your components are so simple and purely a function of state such that setting a bunch of attributes/styles/innerText is faster than moving DOM nodes around, and won't introduce bugs
 *  - Your components will never change order
 *
 * See the {@link UIRoot} docs for more info on what a 'UIRoot' even is, what it's limitations are, and how to effectively (re)-use them.
 */
export function imNextRoot(key?: ValidKey) {
    if (imCore.currentRoot !== undefined) {
        imEndListRoot(imCore.currentRoot);
    }

    const l = getCurrentListRendererInternal();

    let result;
    if (key !== undefined) {
        // use the map
        // TODO: consider array of pairs

        if (l.keys === undefined) {
            l.keys = new Map();
        }

        let block = l.keys.get(key);
        if (block === undefined || block.root.removedLevel === REMOVE_LEVEL_DESTROY) {
            block = {
                root: newUiRoot(null, l.uiRoot.domAppender),
                rendered: false,
            };
            l.keys.set(key, block);
            imCore.numCacheMisses++;
        } 

        /**
         * You're rendering this list element twice. You may have duplicate keys in your dataset.
         *
         * A more common cause is that you are mutating collections while iterating them.
         * Here's a potential way to avoid doing this:
         *
         * function Component() {
         *      let deferredAction: DeferredAction;
         *
         *      imFor(); for(let i = 0; i < list.length; i++) {
         *          const item = list[i];
         *          imNextRoot(item);
         *
         *          imBeginDiv(); {
         *              setText("Move down");
         *
         *              const click = imOn("click");
         *              if (click && i !== list.length - 1) {
         *                  // This line will causes this assertion to trigger, because the next iteration will rerender this item. 
         *                  // swap(list, i, i + 1); <- 
         *                  // Do this instead:
         *                  deferredAction = () => swap(list, i, i + 1);
         *              }
         *          } imEnd();
         *      } imEndFor();
         *
         *      if (deferredAction) deferredAction();
         * }
         *
         * This approach should:
         *  - allow debugging with accurate call stacks
         *  - Error boundaries will still catch errors in this method
         *  - Full control over when it happens. Profiler will report the parent components in the call tree instead of random timeout event
         *  - Action can be literally anything
         */
        assert(!block.rendered);

        block.rendered = true;

        result = block.root;
    } else {
        // use the array

        const idx = l.builderIdx++;

        if (idx < l.builders.length) {
            result = l.builders[idx];
        } else if (idx === l.builders.length) {
            result = newUiRoot(null, l.uiRoot.domAppender);
            l.builders.push(result);
            imCore.numCacheMisses++;
        } else {
            // DEV: whenever l.builderIdx === this.builders.length, we should append another builder to the list
            assert(false);
        }
    }

    __beginUiRoot(result, result.domAppender.idx, -1);

    l.current = result;

    return result;
}


export type DeferredAction = (() => void) | undefined;


///////// 
// Common immediate mode UI helpers

function imStateInternal<T>(supplier: () => T, skipSupplierCheck: boolean): StateItem<T> {
    const core = imCore;

    // Don't access immediate mode state when immediate mode is disabled
    assert(core.imDisabled === false);

    const r = getCurrentRoot();

    let result: StateItem<T>;
    const items = r.items;
    const idx = ++r.itemsIdx;
    if (idx < items.length) {
        const box = items[idx];
        assert(box.t === ITEM_STATE);

        // imState recieved a different supplier this render. If you're passing an inline lambda to this method, then use imStateInline to skip this check.
        // NOTE: However, this assertion exists to catch out-of-order rendering errors, which will lead to state corruption from 
        // hooks reading from and writing to the wrong object. The assertion won't be there in imStateInline.
        if (skipSupplierCheck === false) {
            assert(supplier === box.supplier);
        }

        result = box as StateItem<T>;
    } else {
        assertCanPushImmediateModeStateEntry(r);

        // supplier can call getCurrentRoot() internally, and even add destructors.
        // But it shouldn't be doing immediate mode shenanigans.
        disableIm();
        const v = supplier();
        enableIm();

        result = { t: ITEM_STATE, v, supplier };
        items.push(result);

        core.numCacheMisses++;
    }

    core.itemsRendered++;

    return result;
}

/**
 * This framework's equivelant of React.Context. 
 * It mainly helps reduce noise in certain APIs.
 * It is basically the same as `imState`, but you can access said state later via child components.
 *
 * ```ts
 * const supplier = () => ({ x: 0 });
 *
 * function imMain() {
 *     imBeginContext(supplier); {
 *          imThirdPartyComponent(); {
 *              someComponent();
 *          } imEndThirdPartyComponent();
 *     } imEndContext(supplier);
 *
 *     // If you didn't wrap this in imBeginContext somewhere up the call stack, this will throw. :)
 *     someComponent() 
 * }
 *
 * function someComponent() {
 *      // We didn't need to pass it via args to get it.
 *      const state = imGetContext(supplier);
 *      imBegin(); setText(state.x); imEnd();
 * }
 *
 * ```
 *
 * Do note that if you're deeply nesting contexts like you would in React, your code is not optimal.
 * ```
 * // The React(tm) way:
 * function imApp() {
 *      imBeginContext(newStateA); { 
 *          imBeginContext(newStateB); { 
 *              imBeginContext(newStateC); {
 *
 *              ...
 * }
 *
 * // Better: 
 * function allTheContexts() {
 *      return { 
 *          a: newStateA(),
 *          b: newStateB(),
 *          c: newStateC(),
 *      };
 * }
 *
 * function imApp() {
 *      imBeginContext(allTheContexts); { 
 *
 * }
 * ```
 *
 */
export function imBeginContext<T>(supplier: () => T): T {
    const core = imCore;
    const state = imStateInternal(supplier, false);
    core.currentContexts.push(state);
    return state.v;
}

export function imEndContext<T>(supplier: () => T) {
    const core = imCore;

    // You've popped more contexts than you've pushed
    assert(core.currentContexts.length > 0);

    const lastContext = core.currentContexts[core.currentContexts.length - 1];
    assert(lastContext.supplier === supplier);
    return (core.currentContexts.pop() as StateItem<T>).v;
}

export function imGetContext<T>(supplier: () => T): T {
    const core = imCore;

    for (let i = core.currentContexts.length - 1; i >= 0; i--) {
        const ctx = core.currentContexts[i];
        if (ctx.supplier === supplier) {
            return ctx.v as T;
        }
    }

    throw new Error("No context for " + supplier.name + " could be found on the context stack");
}

/**
 * This method returns a stable reference to some state, allowing your component to maintain
 * state between rerenders. This only works because of the 'rules of immediate mode state' idea
 * this framework is built upon, which are basically the same as the 'rule of hooks' from React,
 * except it extends to all immediate mode state that we want to persist and reuse between rerenders, 
 * including ui components.
 *
 * This method expects that you pass in the same supplier every time.
 * This catches out-of-order immediate-state rendering bugs, so it's better to use this where possible. 
 *
 * Sometimes, it is just way easier to do the state inline:
 * ```
 *      const s = getState(r, () => { ... some state } );
 * ```
 *
 * In which case, you'll need to use {@link imStateInline} instead. But try not to!
 */
export function imState<T>(supplier: () => T): T {
    return imStateInternal(supplier, false).v;
}

/**
 * Lets you do your suppliers inline, like `const s = imStateInline(() => ({ blah }));`.
 *
 * WARNING: using this method won't allow you to catch out-of-order im-state-rendering bugs at runtime, 
 * leading to potential data corruption. 
 *
 * I assume allocating the closure every frame is probably also not ideal.
 */
export function imStateInline<T>(supplier: () => T) : T {
    return imStateInternal(supplier, true).v;
}

/**
 * Allows you to get the current root without having a reference to it.
 * Mainly for use when you don't care what the type of the root is.
 */
export function getCurrentRoot(): UIRoot {
    const core = imCore;

    /** 
     * Can't call this method without opening a new UI root. Common mistakes include: 
     *  - using end() instead of endList() to end lists
     *  - calling beginList() and then rendering a component without wrapping it in nextRoot like `nextRoot(); { ...component code... } end();`
     */
    assert(core.currentRoot !== undefined);

    return core.currentRoot;
}

// You probably don't want to use this, if you can help it
export function getCurrentListRendererInternal(): ListRenderer {
    const core = imCore;

    /** Can't call this method without opening a new list renderer (see {@link imBeginList}) */
    assert(core.currentListRenderer !== undefined)

    return core.currentListRenderer;
}

function pushList(l: ListRenderer) {
    const core = imCore;

    core.currentStack.push(l);
    core.currentRoot = undefined;
    core.currentListRenderer = l;
}

function pushRoot(r: UIRoot) {
    const core = imCore;

    core.currentStack.push(r);
    core.currentRoot = r;
    core.currentListRenderer = undefined;
}

function startRendering(root: UIRoot, itemIdx: number, domIdx: number) {
    imCore.currentStack.length = 0;
    imCore.currentContexts.length = 0;
    enableIm();
    __beginUiRoot(root, itemIdx, domIdx);
}

export function imUnappendedRoot<E extends ValidElement = ValidElement>(elementSupplier: () => E): UIRoot<E> {
    const core = imCore;

    // Don't access immediate mode state when immediate mode is disabled
    assert(core.imDisabled === false);

    const r = getCurrentRoot();

    let result: UIRoot<E> | undefined;
    const items = r.items;
    const idx = ++r.itemsIdx;
    if (idx < items.length) {
        result = items[idx] as UIRoot<E>;

        // The same immediate mode state must be queried in the same order every time.
        assert(result.t === ITEM_UI_ROOT);
    
        // imBeginRoot was invoked with a different supplier from the previous render.
        // see INLINE_LAMBDA_BAD_HINT, COND_LIST_RENDERING_HINT.
        // string comparisons end up being quite expensive, so we're storing
        // a reference to the function that created the dom element and comparing those instead.
        assert(result.elementSupplier === elementSupplier);
    } else {
        assertCanPushImmediateModeStateEntry(r);

        result = newUiRoot(elementSupplier);
        items.push(result);
    }

    core.itemsRendered++;

    return result as UIRoot<E>;
} 

export function imBeginExistingRoot<E extends ValidElement = ValidElement>(root: UIRoot<E>) {
    const r = getCurrentRoot();

    r.hasRealChildren = true;
    r.removedLevel = REMOVE_LEVEL_NONE;
    appendToDomRoot(r.domAppender, root.domAppender.root);

    __beginUiRoot(root, -1, -1);
}

export function imBeginRoot<E extends ValidElement = ValidElement>(elementSupplier: () => E): UIRoot<E> {
    const result = imUnappendedRoot(elementSupplier);
    imBeginExistingRoot(result);
    return result;
}

/** 
 * This method pops any element from the global element stack that we created via {@link imBeginRoot}.
 * This is called `imEnd` instad of `end`, because `end` is a good variable name that we don't want to squat on.
 */
export function imEnd() {
    const r = getCurrentRoot();

    imEndRootInternal(r);

    if (r.itemsIdx === -1) {
        // we rendered nothing to r root, so we should just remove it.
        // however, we may render to it again on a subsequent render.
        __removeAllDomElementsFromUiRoot(r, REMOVE_LEVEL_DOM);
    }

    assert(r.itemsIdx === -1 || r.itemsIdx === r.items.length - 1);

    return true;
}

function imEndListRoot(r: UIRoot) {
    imEndRootInternal(r);

    const l = getCurrentListRendererInternal();
    if (r.itemsIdx === -1) {
        // A list render might want to actually destroy everything underneath it instead.
        __removeAllDomElementsFromUiRoot(r, l.cacheRemoveLevel);
    }

    assert(r.itemsIdx === -1 || r.itemsIdx === r.items.length - 1);

    return true;
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

    const core = imCore;
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


function imEndRootInternal(r: UIRoot) {
    // close out this UI Root.

    if (isDerived(r) === false) {
        finalizeDomRoot(r.domAppender);

        // Defer the mouse events upwards, so that parent elements can handle it if they want
        const el = r.root;
        const parent = el.parentNode;

        const mouse = getImMouse();
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

    __popStack();

    r.completedOneRender = true;
}


function __popStack() {
    const core = imCore;

    // fix the `current` variables
    core.currentStack.pop();
    if (core.currentStack.length === 0) {
        core.currentRoot = undefined;
        core.currentListRenderer = undefined;
    } else {
        const val = core.currentStack[core.currentStack.length - 1];
        if (val.t === ITEM_LIST_RENDERER) {
            core.currentListRenderer = val;
            core.currentRoot = undefined;
        } else {
            core.currentListRenderer = undefined;
            core.currentRoot = val;
        }
    }
}

export function imEndList() {
    const core = imCore;

    if (core.currentRoot !== undefined) {
        imEnd();
    }

    // NOTE: the main reason why I won't make a third ITEM_COMPONENT_FENCE 
    // to detect an incorrect number of calls to im() and imEnd() methods, is because
    // most UI components will interlace imList() and imRoot() methods frequently enough that
    // this assertion here or the one in imEnd() will already catch this bug most of the time.
    const l = getCurrentListRendererInternal();

    // close out this list renderer.

    // remove all the UI components that may have been added by other builders in the previous render.
    for (let i = l.builderIdx; i < l.builders.length; i++) {
        __removeAllDomElementsFromUiRoot(l.builders[i], l.cacheRemoveLevel);
    }
    if (l.cacheRemoveLevel === REMOVE_LEVEL_DESTROY) {
        l.builders.length = l.builderIdx;
    }

    if (l.keys !== undefined) {
        for (const [k, v] of l.keys) {
            if (v.rendered === false) {
                __removeAllDomElementsFromUiRoot(v.root, l.cacheRemoveLevel);
                if (l.cacheRemoveLevel === REMOVE_LEVEL_DESTROY) {
                    l.keys.delete(k);
                }
            }
        }
    }

    __popStack();
}

function newListRenderer(root: UIRoot): ListRenderer {
    return {
        t: ITEM_LIST_RENDERER,
        uiRoot: root,
        keys: undefined,
        builders: [],
        builderIdx: 0,
        current: null,
        cacheRemoveLevel: REMOVE_LEVEL_DOM,
    };
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

export function abortListAndRewindUiStack(l: ListRenderer) {
    const core = imCore;

    // need to wind the stack back to the current list component
    const idx = core.currentStack.lastIndexOf(l);
    assert(idx !== -1);
    core.currentStack.length = idx + 1;
    core.currentRoot = undefined;
    core.currentListRenderer = l;

    const r = l.current;
    if (r !== null) {
        __removeAllDomElementsFromUiRoot(r, REMOVE_LEVEL_DOM);

        // need to reset the dom root, since we've just removed elements underneath it
        resetDomAppender(r.domAppender);
    }
}

export type Ref<T> = { val: T | null; }
function newRef<T>(): Ref<T> {
    return { val: null };
}

/**
 * Set the state later in the function:
 * ```ts
 * const ref = imRef<HTMLDivElement>();
 *
 * ref.current = div().root; {
 *      text("The div: " + ref.val);
 * } end();
 * ```
 *
 * NOTE: Prefer {@link imState}, since you will catch out-of-order rendering bugs that way
 */
export function imRef<T>(): Ref<T> {
    return imState(newRef<T>);
}

export function setRef<T>(ref: Ref<T>, val: T): T {
    ref.val = val;
    return val;
}

// These are mainly for quick prototyping or simple logic.
// You're better off using real objects if that simplifies the code.

function newArray() {
    return [];
}

export function imArray<T>(): T[] {
    return imState(newArray);
}

export function newBoolean() {
    return { val: false };
}

export function newNumber() {
    return { val: 0 };
}

export function newString() {
    return { val: "" };
}

function newMap<K, V>() {
    return new Map<K, V>();
}

export function imMap<K, V>(): Map<K, V> {
    return imState(newMap<K, V>);
}


function newSet<T>() {
    return new Set<T>();
}

export function imSet<K>(): Set<K> {
    return imState(newSet<K>);
}


const MEMO_INITIAL_VALUE = {};
function newMemoState(): { last: unknown } {
    // this way, imMemo always returns true on the first render
    return { last: MEMO_INITIAL_VALUE };
}

/**
 * Returns true if it was different to the previous value.
 * ```ts
 * if (imMemo(val)) {
 *      // do expensive thing with val here
 *      setStyle("backgroundColor", getColor(val));
 * }
 * ```
 *
 * NOTE: I had previously implemented imBeginMemo() and imEndMemo():
 * ```
 * if (imBeginMemo().val(x).objectVals(obj)) {
 *      <Memoized component>
 * } imEndMemo();
 * ```
 * Looks great right? Ended up with all sorts of stale state bugs so 
 * I deleted it. 
 *
 * What I'm finding now, is that while imMemo is a super common pattern
 * that you will need in your components, it is really easy to lean on it
 * in situations where it isn't needed, and end up with a bad architecture.
 *
 * In other words, consider centralizing all your state into a single object, and using a setter instead.
 *
 * TODO: think about when it _is_ needed. 
 */
export function imMemo(val: unknown): ImMemoResult {
    const ref = imState(newMemoState);

    let result: ImMemoResult = MEMO_NOT_CHANGED;

    if (ref.last !== val) {
        result = ref.last === MEMO_INITIAL_VALUE ? MEMO_FIRST_RENDER : MEMO_CHANGED;
        ref.last = val;
    } 

    return result;
}

export const MEMO_NOT_CHANGED  = 0;
/** returned by {@link imMemo} if the value changed */
export const MEMO_CHANGED      = 1; 
/** 
 * returned by {@link imMemo} if this is simply the first render. 
 * Most of the time the distinction is not important, but sometimes,
 * you want to happen on a change but NOT the initial renderer.
 */
export const MEMO_FIRST_RENDER = 2;

export type ImMemoResult
    = typeof MEMO_NOT_CHANGED
    | typeof MEMO_CHANGED 
    | typeof MEMO_FIRST_RENDER;



// TODO: performance benchmark vs imMemo before this becomes the default.
export function imMemoMany(
    // NOTE (Dev): use `arugments` instead - I'm told that arguments is faster than using `val`
    ...args: unknown[]
): boolean {
    const arr = imArray();

    let changed = false;
    if (arguments.length !== arr.length) {
        changed = true;
        arr.length = arguments.length;
    }

    for (let i = 0; i < arguments.length; i++) {
        if (i === arr.length) {
            changed = true;
            arr.push(arguments[i]);
        } else if (arr[i] !== arguments[i]) {
            changed = true;
            arr[i] = arguments[i];
        }
    }

    return changed;
}

export function imMemoObjectVals(obj: Record<string, unknown>): boolean {
    const arr = imArray();

    let changed = false;
    let i = 0;
    for (const k in obj) {
        const val = obj[k];
        if (i === arr.length) {
            arr.push(val);
            changed = true;
        } else if (arr[i] !== val) {
            arr[i] = val;
            changed = true;
        }
        i++;
    }

    return changed;
}

export function disableIm() {
    imCore.imDisabled = true;
}

export function enableIm() {
    imCore.imDisabled = false;
}

export function getImCore(): ImCore {
    return imCore;
}

export function setImCore(core: ImCore) {
    imCore = core;
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
export function imOn<K extends keyof HTMLElementEventMap>(
    type: K
): HTMLElementEventMap[K] | null {
    const eventRef = imRef<HTMLElementEventMap[K]>();
    const core = imCore;

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

        addDestructor(r, () => {
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

/**
 * Returns true the first time it's called, and false every other time.
 */
export function imInit(): boolean {
    const val = imRef<boolean>();
    if (val.val === null) {
        val.val = true;

        return true;
    }

    return false;
}

/**
 * This is similar to {@link imInit}, but does not create an im-state entry, which speeds up each render.
 * However, if components after this one throw an error in the first render, 
 * this will remain true for the next render as well. If you want real idempotency, use {@link imInit}.
 *
 * Examples for when you may want to use isFirstRender for performance:
 * - setting text just once or twice
 * - setting a style just once or twice
 * - setting a css class just once or twice
 *
 * Examples for when you should use imInit instead: 
 * - when you are pushing attributes with {@link pushAttr} in the initialization phase - you don't want to infinitely grow this array in a failure state
 * - adding/removing event handlers. Bad things happen when we do this twice
 * - triggering API requests, initializing a thing. Not ideal to do it multiple times
 */
export function isFirstishRender(): boolean {
  return !getCurrentRoot().completedOneRender;
}

export function addClasses(classes: string[]) {
    for (let i = 0; i < classes.length; i++) {
        setClass(classes[i]);
    }
}


export function setStyle<K extends (keyof ValidElement["style"])>(key: K, value: string, r = getCurrentRoot()) {
    assertNotDerived(r);

    // NOTE: memoization should be done on your end, not mine

    // @ts-expect-error it sure can
    r.root.style[key] = value;
}

///////// 
// Realtime proper immediate-mode events API, with events.
//
// I wasn't able to find a good clean solution to the problem
// of adding and removing events locally, so I'm attempting to
// go down a second road of rerendering the entire app at 60fps.
//
// It would be interesting to see how far this approach scales. (23/03/2025)
//
// So far, it's going pretty great! (16/04/2025)

export type KeyPressEvent = {
    key: string;
    code: string;
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
};

export function getDeltaTimeSeconds(): number {
    return imCore.dtSeconds;
}

export function getTimeSeconds(): number {
    return imCore.tSeconds;
}


/**
 * This framework rerenders your entire application every event. 
 * This is required, so that we have a nice immediatem mode API for events, while 
 * also allowing for calling `e.preventDefault()` on any specific event, within that event cycle itself.
 *
 * This does mean that some expensive renders will become noticeably slow when you have multiple keys held down, for instance.
 *
 * ```ts
 * imCanvas2D(); 
 * if (!isExcessEventRender()) {
 *
 *      // draw expensive canvas thing
 * } 
 * imEnd();
 * ```
 *
 */
export function isExcessEventRender() {
    return imCore._isExcessEventRender;
}

/**
 * This method initializes an imCore you got from {@link newImCore}.
 * To start rendering to it, you'll either need to call {@link startAnimationLoop},
 * or call {@link rerenderImCore} by hand for a more custom render cycle.
 */
export function initImCore(core: ImCore) {
    if (core.initialized) {
        console.warn("You're trying to initialize this context twice!");
        return;
    }

    core.initialized = true;

    // Initialize events
    {
        document.addEventListener("mousedown", core.globalEventHandlers.mousedown);
        document.addEventListener("mousemove", core.globalEventHandlers.mousemove);
        document.addEventListener("mouseenter", core.globalEventHandlers.mouseenter);
        document.addEventListener("mouseup", core.globalEventHandlers.mouseup);
        document.addEventListener("wheel", core.globalEventHandlers.wheel);
        document.addEventListener("keydown", core.globalEventHandlers.keydown);
        document.addEventListener("keyup", core.globalEventHandlers.keyup);
        window.addEventListener("blur", core.globalEventHandlers.blur);
    }
}


export function uninitImCore(core: ImCore) {
    if (!core.initialized) {
        console.warn("This context has not been initialized yet!");
        return;
    }

    if (core.uninitialized) {
        console.warn("This context has already been uninitialized!");
        return;
    }

    core.uninitialized = true;

    // Remove the events
    {
        document.removeEventListener("mousedown", core.globalEventHandlers.mousedown);
        document.removeEventListener("mousemove", core.globalEventHandlers.mousemove);
        document.removeEventListener("mouseenter", core.globalEventHandlers.mouseenter);
        document.removeEventListener("mouseup", core.globalEventHandlers.mouseup);
        document.removeEventListener("wheel", core.globalEventHandlers.wheel);
        document.removeEventListener("keydown", core.globalEventHandlers.keydown);
        document.removeEventListener("keyup", core.globalEventHandlers.keyup);
        window.removeEventListener("blur", core.globalEventHandlers.blur);
    }
}

/** 
 * Call this with your render method to fully initialize im-dom-utlis.
 * Take a look inside if you need something more custom.
 */
export function initImDomUtils(renderFn: () => void): ImCore {
    initImCore(defaultCore);
    startAnimationLoop(defaultCore, renderFn);
    return defaultCore;
}

export function startAnimationLoop(
    core: ImCore,
    renderFn: () => void
) {
    if (core.renderFn !== renderStub) {
        console.warn("Something is trying to start a second animation loop for this context!");
        return;
    }

    core.renderFn = renderFn;

    const animation = (t: number) => {
        if (core.uninitialized === true) {
            return;
        }

        rerenderImCore(core, t, false);

        requestAnimationFrame(animation);
    };

    requestAnimationFrame(animation);
}

/**
 * This method is called automatically by the animation loop.
 * You don't ever need to call it manually unless you're doing some custom stuff
 */
export function rerenderImCore(core: ImCore, t: number, isInsideEvent: boolean) {
    setImCore(core);

    core.time      = t;
    core.tSeconds  = t / 1000;

    core.dtSeconds = (t - core.lastTime) / 1000;
    core.lastTime  = t;

    if (core.isRendering === true) {
        return;
    }

    if (isInsideEvent === false) {
        core._isExcessEventRender = false;
    }

    // begin frame

    core.isRendering = true;
    startRendering(core.appRoot, -1, -1);

    // persistent things need to be reset every frame, for bubling order to remain consistent per render
    core.mouse.lastClickedElement = core.mouse.lastClickedElementOriginal;
    core.mouse.hoverElement = core.mouse.hoverElementOriginal;

    // It is better to not try-catch this actually.
    // You shouldn't let any exceptions reach here under any circumstances.
    core.renderFn();

    // end frame
 
    resetKeyboardState(core);
    resetMouseState(core, false);

    core.mouse.hasMouseEvent = false;
    core.itemsRenderedLastFrame = core.itemsRendered;
    core.itemsRendered = 0;
    core.isRendering = false;
    if (isInsideEvent === true) {
        core._isExcessEventRender = isInsideEvent;
    }

    if (core.currentContexts.length !== 0) {
        throw new Error(`You've forgotten to pop some contexts: ${core.currentContexts.map(c => c.supplier.name).join(", ")}`);
    }

    if (core.currentStack.length !== 1) {
        if (core.currentStack.length < 1) {
            throw new Error("You've popped too many things off the stack. There is no good way to find the bug right now, sorry");
        } else {
            const message = "You forgot to pop some things off the stack: ";
            console.error(message, core.currentStack.slice(1));
            throw new Error(`${message}
            ${core.currentStack.slice(1).map(item => {
                if (item.t === ITEM_LIST_RENDERER) {
                    return "List renderer"
                } else {
                    return "UI Root - " + item.root.tagName;
                }
            }).join("\n")}`
            );
        }
    }
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

function resetKeyboardState(core: ImCore) {
    const keyboard = core.keyboard;
    keyboard.keyDown = null;
    keyboard.keyUp = null;
    keyboard.blur = false;
}

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

function resetMouseState(core: ImCore, clearPersistedStateAsWell: boolean) {
    const { mouse } = core;
    
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
    return imCore.mouse;
}

export function getImKeys(): ImKeyboardState {
    return imCore.keyboard;
}


// I cant fking believe this shit works, lol

/**
 * Mouse press is distinct from mouse-click - A click is what happens when we release the mouse
 * above the same element that we pressed it on. However a press happens immediately on mouse-down.
 * TODO: add elementHasMouseClick
 */
export function elementHasMousePress() {
    const mouse = getImMouse();
    const r = getCurrentRoot();
    if (mouse.leftMouseButton === true) {
        return r.root === mouse.clickedElement;
    }
    return  false;
}

export function elementHasMouseDown(
    // Do we care that this element was initially clicked?
    // Set to false if you want to detect when an element drags their mouse over this element but 
    // it didn't initiate the click from this element.
    hadClick = true
) {
    const r = getCurrentRoot();

    if (hadClick === true) {
        return r.root === imCore.mouse.lastClickedElement;
    }

    return imCore.mouse.leftMouseButton && elementHasMouseHover();
}

export function elementHasMouseHover() {
    const r = getCurrentRoot();
    return r.root === imCore.mouse.hoverElement;
}

export function getHoveredElement() {
    return imCore.mouse.hoverElement;
}

function setClickedElement(core: ImCore, el: object | null) {
    const { mouse } = core;

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

export function imPreventScrollEventPropagation() {
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

    const mouse = getImMouse();
    if (state.isBlocking && elementHasMouseHover() && mouse.scrollWheel !== 0) {
        state.scrollY += mouse.scrollWheel;
        mouse.scrollWheel = 0;
    } else {
        state.scrollY = 0;
    }

    return state;
}

export type SizeState = {
    width: number;
    height: number;
}

function newImGetSizeState(): {
    size: SizeState;
    observer: ResizeObserver;
    resized: boolean;
} {
    const r = getCurrentRoot();
    const core = imCore;

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

// Doing string comparisons every frame kills performance, if done for every singe DOM node.
// I'm still contemplating if this is a good idea or not.
// TODO: enum for all events
// TODO: enum for all styles
// TODO: enum for all DOM node types
