/**
 * IM-DOM-utils v0.1.05 - @Tejas-H5
 * A variation on DOM-utils with the immediate-mode API isntead of the normal one. 
 * This one has been a better developer experience so far, but the other one is far simpler and has a 'proven' track record of actually working.
 * But in a matter of hours/days, I was able to implement features in this framework that I wasn't able to for months/years in the other one.
 * (Some examples: try-catch abstraction, switch abstraction, conditional rendering that respects type narrowing (mostly), destructors).
 * There are also a lot of features that I previosly considered very difficult to implement that become trivial in an immediate-mode
 * paradigm, even with the restriction that you have to call the same things in the same order every time.
 *
 * Code conventions:
 * - 'im' method prefix
 *      - All immediate mode methods should be prefixed with 'im'.
 *      - Any method calling another im method is also an im method, and should be prefixed
 *      - If some methods are only used with other im methods, prefix those with im too.
 *
 * - 'imBegin' and 'imEnd' method prefixes
 *      - most open/close method pairs should be prefixed with 'imBegin' and 'imEnd';
 *          - If the method is used often enough, and the name makes it obvious enough that the method is opening some sort of scope that will need to be closed by you later, you can choose to just do 'im'/'imEnd' instead. There are several such examples in this framework. `imIf`, `imElseIf`, `imElse`, `imSwitch`, `imTry`, `imCatch`, `imFor`, `imWhile`.
 *          - If the method is just a 1-level deep abstraction and will be that way forever, we should just be able to end it with {@link imEnd}
 *
 * Framework code conevtions:
 * - prefer not using early returns ever. Methods are more easily inlined this way, apparently
 * - prefer using if (x === true) instead of if (x). This appears to be better in performance.
 *
 * TODO:
 * - Use typeId + state
 * - Decouple framework from DOM
 * - Far less yapping
 */

// Purely for debug
import { newCssBuilder } from "./cssb";

// TODO: remove/invert dependency
import { addDocumentAndWindowEventListeners, appendToDomRoot, beginProcessingImEvent, bubbleMouseEvents, DomAppender, endProcessingImEvent, ImGlobalEventSystem, newImGlobalEventSystem, removeDocumentAndWindowEventListeners, setClass } from "./im-utils-dom";

export function hasDomDependency() { /** This code as a dependency on DOM */ };

function renderStub() {}

export type ImCore = {
    initialized:   boolean;
    uninitialized: boolean;
    appRoot:       UIRoot;

    currentStack:    (UIRoot | ListRenderer)[];

    // Only one of these is defined at a time.
    currentRoot:         UIRoot | undefined;
    currentListRenderer: ListRenderer | undefined;

    imDisabled:       boolean;

    renderFn: () => void;

    dtSeconds: number;
    tSeconds:  number;
    lastTime:  number;
    time:      number;

    isRendering: boolean;
    _isExcessEventRender: boolean;

    // TODO: move to im-utils-dom

    imEventSystem: ImGlobalEventSystem;

    /** These are used to display performance metrics in the UI. */
    itemsRendered: number;
    itemsRenderedLastFrame: number;
    numResizeObservers: number;
    numEventHandlers: number;
    numIntersectionObservers: number;
    numCacheMisses: number;
};

export type ValidElement = HTMLElement | SVGElement;

export type UIRootItem = UIRoot | ListRenderer | StateItem;

// Not defining them this early causes lexical whatever javascript errors
const ITEM_LIST_RENDERER = 2;
const ITEM_UI_ROOT = 1;
const ITEM_STATE = 3;

export const REMOVE_LEVEL_NONE = 1;
export const REMOVE_LEVEL_DETATCHED = 2;
export const REMOVE_LEVEL_DESTROYED = 3;

export type RemovedLevel 
    = typeof REMOVE_LEVEL_NONE
    | typeof REMOVE_LEVEL_DETATCHED   // This is the default remove level. The increase in performance far oughtweighs any memory problems. 
    | typeof REMOVE_LEVEL_DESTROYED;

/** Don't forget to initialize this core with {@link initImDomUtils} */
export function newImCore(root: HTMLElement = document.body): ImCore {
    const core: ImCore = {
        initialized: false,
        uninitialized: false,
        appRoot: newUiRoot(() => root),

        currentStack: [],
        currentRoot: undefined,
        currentListRenderer: undefined,

        imDisabled: false,

        renderFn: renderStub,

        dtSeconds: 0,
        tSeconds: 0,
        lastTime: 0,
        time: 0,
        isRendering: false,
        _isExcessEventRender: false,

        itemsRendered: 0,
        itemsRenderedLastFrame: 0,
        numResizeObservers: 0,
        numEventHandlers: 0,
        numIntersectionObservers: 0,
        numCacheMisses: 0,

        imEventSystem: newImGlobalEventSystem(),
    };

    hasDomDependency;
    core.imEventSystem.core = core;

    // the root is assumed to never be removed.
    core.appRoot.removeLevel = REMOVE_LEVEL_NONE;

    return core;
}

/** 
 * NOTE: some atypical usecases require multiple cores,
 * so make sure that your event handlers capture the one that is current
 * _at the time of adding the event_.
 *
 * Wrong:
 * ```ts
 * resizeObserver.onResize(() => rerenderCore(imCore));
 * ```
 *
 * Right:
 * ```ts
 * const core = imCore;
 * resizeObserver.onResize(() => rerenderCore(core));
 * ```
 */
const defaultCore = newImCore();

// Contains ALL the state. In an atypical usecase, there may be multiple cores that must switch between each other.
let imCore = defaultCore;


/** 
 * This is a node in the immediate-mode tree.
 * It's children can either be more UIRoots, regular state, or List renderers.
 *
 * Once a single render pass has completed, you have to render the same things
 * in the same order to a UI Root every time. This is because the order in which 
 * a method was called is what we use to correlate the state we persist for that callsite.
 *
 * List renderers can render an arbitrary number of UI roots. They form the basis of
 * how conditional and keyed rendering is implemented, which is why the
 * restriction of rendering the same things ever time doesn't actually restrict what can be built.
 *
 * TODO: it should all just be regular state. This will allow us to decouple from the DOM.
 */
export type UIRoot<E extends ValidElement = ValidElement> = {
    readonly t: typeof ITEM_UI_ROOT;

    readonly root: E;
    readonly domAppender: DomAppender<E>;
    // If there was no supplier, then this root is attached to the same DOM element as another UI root that does have a supplier.
    readonly elementSupplier: (() => ValidElement) | null;

    destructors: (() => void)[] | undefined;

    // TODO: use an SOA representation here. Can reduce 1 indirection I'm pretty sure.
    readonly items: UIRootItem[];

    itemsIdx: number;
    lastItemIdx: number;

    hasRealChildren:    boolean; // can we add text to this element ?
    completedOneRender: boolean; // have we completed at least one render without erroring?
    parentRoot: UIRoot<ValidElement> | null;
    parentListRenderer: ListRenderer | null;

    removeLevel: RemovedLevel; // an indication of an ancenstor's remove level.
    // is this root in the conditional pathway? NOTE: this is an internal variable that is only set when certain im-methods are actually rendering under this root and might need it.
    isInConditionalPathway: boolean; 
    // true for the first frame where this UI root is in the current code path.
    // you'll need this to correctly handle on-focus interactions.
    startedConditionallyRendering: boolean; 
    debug: boolean; // debug flag

    // We need to memoize on the last text - otherwise, we literally can't even select the text.
    lastText: string;
};


// Can be anything, I'm pretty sure.
export type ValidKey = string | number | Function | object | unknown;

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
    cacheRemoveLevel: typeof REMOVE_LEVEL_DETATCHED   | typeof REMOVE_LEVEL_DESTROYED;
}

// TODO: use TypeIds
export type StateItem<T = unknown>  = {
    t: typeof ITEM_STATE;
    v: T;
    supplier: () => unknown;
};

export type RenderFn<T extends ValidElement = ValidElement> = (r: UIRoot<T>) => void;
export type RenderFnArgs<A extends unknown[], T extends ValidElement = ValidElement> = (r: UIRoot<T>, ...args: A) => void;


export function newUiRoot<E extends ValidElement>(
    supplier: (() => E) | null,
    domAppender: DomAppender<E> | null = null
): UIRoot<E> {
    let root: E | undefined;
    if (domAppender === null) {
        if (supplier === null) throw new Error("Expected supplier to be present if domAppender was null");
        root = supplier();
        domAppender = { root, idx: -1 };
    } else {
        // If there was no supplier, then this root is attached to the same DOM element as another UI root that does have a supplier.
        if (domAppender === null) throw new Error("Expected domAppender to be present if supplier was null");
        root = domAppender.root;
    }

    return {
        t: ITEM_UI_ROOT,
        root,
        domAppender,
        elementSupplier: supplier, 
        destructors: undefined,
        items: [],
        itemsIdx: -1,
        lastItemIdx: -1,
        hasRealChildren: false,

        removeLevel: REMOVE_LEVEL_DETATCHED,
        parentRoot: null,
        isInConditionalPathway: false,
        parentListRenderer: null,

        startedConditionallyRendering: false,
        completedOneRender: false,
        lastText: "",

        debug: false,
    }
}

function __beginUiRoot(r: UIRoot, startDomIdx: number, startItemIdx: number, parent: UIRoot | null) {
    r.domAppender.idx = startDomIdx;
    r.itemsIdx = startItemIdx;
    r.parentRoot = parent;

    imCore.currentStack.push(r);
    imCore.currentRoot = r;
    imCore.currentListRenderer = undefined;
}

// Recursively destroys all UI roots under this one.
// Should only be called in one place, and never called twice on the same root.
function __onUIRootDestroy(r: UIRoot) {
    // don't re-traverse this bit.
    if (r.removeLevel < REMOVE_LEVEL_DESTROYED) {
        r.removeLevel = REMOVE_LEVEL_DESTROYED;

        for (let i = 0; i < r.items.length; i++) {
            const item = r.items[i];
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

        if (r.destructors) {
            for (const d of r.destructors) {
                try {
                    d();
                } catch (e) {
                    console.error("A destructor threw an error: ", e);
                }
            }
            r.destructors = undefined;
        }
    }
}

// Recursively soft-destroys (aka removes) all UI roots under this one.
// Can potentially be called again later after being un-removed.
function __onUIRootDomRemove(r: UIRoot) {
    // don't re-traverse this bit.
    if (r.isInConditionalPathway === true) {
        r.isInConditionalPathway = false;

        for (let i = 0; i < r.items.length; i++) {
            const item = r.items[i];
            if (item.t === ITEM_UI_ROOT) {
                __onUIRootDomRemove(item);
            } else if (item.t === ITEM_LIST_RENDERER) {
                const l = item;
                for (let i = 0; i < l.builders.length; i++) {
                    __onUIRootDomRemove(l.builders[i]);
                }
                if (l.keys !== undefined) {
                    for (const v of l.keys.values()) {
                        __onUIRootDomRemove(v.root);
                    }
                }
            }
        }
    }
}

// NOTE: If this is being called at the end of a render, or before we've rendered any components here, it should be ok.
// If it's being called during a render, then that is typically an incorrect usage - the domAppender's index may or may not be incorrect now, because
// we will have removed HTML elements out from underneath it. You'll need to ensure that this isn't happening in your use case.
export function __removeAllDomElementsFromUiRoot(r: UIRoot, removeLevel: RemovedLevel) {
    // Don't call this method twice at the same remove level
    if (r.removeLevel < removeLevel) {
        r.removeLevel = removeLevel;
        r.parentRoot = null;
        r.isInConditionalPathway = false;

        for (let i = 0; i < r.items.length; i++) {
            const item = r.items[i];
            if (item.t === ITEM_UI_ROOT) {
                item.domAppender.root.remove();
                if (removeLevel === REMOVE_LEVEL_DETATCHED) {
                    __onUIRootDomRemove(item);
                } else if (removeLevel === REMOVE_LEVEL_DESTROYED) {
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
}

export function addDestructor(r: UIRoot, destructor: () => void) {
    if (r.destructors === undefined) r.destructors = [];
    r.destructors.push(destructor);
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


/**
 * Opens a list rendering context under the current UI Root. 
 * This allows you to render a variable number of UI roots at a particular point in your component.
 * But each root, once rendered to, can't render anything else:
 *
 * ```ts
 * imBeginList(); 
 * for (const val of values) {
 *      imNextListRoot();
 *      imRenderComponent(val);
 * }
 * imEndList()
 * ```
 *
 * If zero things are rendered to a particular UI root in a render pass, that root
 * will be detatched from the DOM (or optionally destroyed). 
 * This allows us to do conditional rendering:
 * ```ts
 * imBeginlist()
 * if (imNextListRoot() && blah) {
 *      // render your component here.
 * } 
 * if (imNextListRoot() && blah) {
 *      // render your next component here.b
 * }
 * if (imNextListRoot() && blah) {
 *      // render your next component here.b
 * }
 * imEndList()
 * ```
 * As long as each call to `imNextListRoot()` always happens in the same order and no calls get skipped,
 * every callsite will resolve to the same immediate mode state each time, so this always works.
 * Here's a case where it won't work:
 * 
 * ``` ts
 * imBeginList();
 * if (imNextListRoot() && blah){}
 * else if (imNextListRoot() && blah2){}
 * if (imNextListRoot() && blah3) {
 *      // if blah was true the first render pass, and false in the second,
 *      // the framework has no way of knowing that the state for this if-statement
 *      // is not the same as the previous - all it can see is that this was the 
 *      // second call to `imNextListRoot()`. 
 * }
 * ```
 *
 * Also note that {@link imNextListRoot} can be passed a key, to avoid such errors.
 *
 * Also, I have found that the patterns that emerge from doing conditional rendering in this
 * way don't lend themselves to ease of pattern recognition and refactoring.
 * This is why I've added {@link imFor}, {@link imIf}, {@link imSwitch} et al, so I never use 
 * imBeginList directly in practice. But it does help to know how they are all the same think under the hood.
 */
export function imBeginList(removeLevel: ListRenderer["cacheRemoveLevel"] = REMOVE_LEVEL_DETATCHED): ListRenderer {
    const core = imCore;
    const r = getCurrentRoot();

    const items = r.items;
    const idx = getNextItemSlotIdx(r, core);

    let result: ListRenderer | undefined; 
    if (idx < items.length) {
        const box = items[idx];

        // The same immedaite mode state must be queried in the same order every time.
        if (box.t !== ITEM_LIST_RENDERER) throw new Error("immediate mode state was queried out of order - wrong box type");

        result = box;
    } else {
        if (r.lastItemIdx !== -1) throw new Error("too much immediate mode state was being pushed");

        result = newListRenderer(r);
        items.push(result);
        core.numCacheMisses++;
    }

    result.cacheRemoveLevel = removeLevel;
    __beginListRenderer(result);

    core.itemsRendered++;

    return result;
}

const cssb = newCssBuilder("im-dom-utils--debug");
const debug1PxSolidRed = cssb.cn("debug1pxSolidRed", [` { border: 1px solid red; }`]);

function getNextItemSlotIdx(r: UIRoot, core: ImCore): number {
    if (core.imDisabled === true) throw new Error("Immediate mode has beend disabled for this section");

    if (r.itemsIdx === -1) { 
        if (r.isInConditionalPathway === false) {
            r.isInConditionalPathway = true;
            r.startedConditionallyRendering = true;
            r.removeLevel = REMOVE_LEVEL_NONE;

            /*
            if (r.parentRoot !== null) {
                // The only way to know that a root is no longer removed is that
                // we have actually started rendering things underneath it.
                r.parentRoot.removeLevel = REMOVE_LEVEL_NONE;
            } */

            if (r.debug === true) {
                console.log("visibility change", r.parentRoot);
                setClass(debug1PxSolidRed, true, r);
                setTimeout(() => {
                    setClass(debug1PxSolidRed, false, r);
                }, 1000);
            }
        } else {
            // NOTE: if an error occured in the previous render, then
            // subsequent things that depended on `startedConditionallyRendering` being true won't run.
            // I think this is better than re-running all the things that ran successfully over and over again.
            r.startedConditionallyRendering = false;
        }
    }

    return ++r.itemsIdx;
}


/**
 * Helpers to make conditional rendering with the list easier to type and read.
 * See {@link imBeginList} for more info on how it works.
 *
 * ```ts
 * if (imIf() && c1) { 
 *      // component 1 
 * } else if (imElseIf() && c2) { 
 *      //component 2
 * } else { 
 *      imElse(); 
 *      // component 3
 * } imEndIf();
 * ```
 */
export function imIf() {
    imBeginList(REMOVE_LEVEL_DETATCHED);
    imNextListRoot();
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
 * NOTE: fallthrough introduces subtle double-component bugs.
 * You should use if-statements instead.
 *
 * ```
 * // Super subtle bug here - 
 * // You should prefer an if-statement here, or normalize the key to avoid fallthrough cases.
 * imSwitch(key); switch(key) {
 *      // effectively creates 2 unrelated instances of imComponent1And2Layout, with different internal states.
 *      case 1: 
 *      case 2: imComponent1And2Layout(); break; 
 *      case 3: imComponent3(); break;
 * } imEndSwitch();
 * ```
 */
export function imSwitch(key: ValidKey) {
    imBeginList(REMOVE_LEVEL_DETATCHED);
    imNextListRoot(key);
}

/** See {@link imSwitch} */
export function imEndSwitch() {
    imEndList();
}

/** See {@link imIf} */
export function imElseIf(): true {
    imNextListRoot();
    return true;
}

/** See {@link imIf} */
export function imElse(): true {
    imNextListRoot();
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
 * You can also do this with {@link imBeginList}/{@link imEndList} and {@link imNextListRoot},
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
    imNextListRoot();
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
 * This method appends a UI root to an open list-rendering context.
 * Read {@link imBeginList}'s doc and related helpers for info on what that is.
 *
 * You can optionally specify a {@link key}.
 * If a key is present, the same UIRoot that was rendered for that particular key will be re-used. 
 *      Make sure to not reuse the same key twice. Doing so will throw an error.
 *
 *      I figured I would rather throw an error and make you fix the specific problem, than bother with all the subtle as well as
 *      not-so-subtle bugs that can start occuring or be made much worse by trying to 'gracefully handle' this scenario.
 *
 * If no key is present, the same UIRoot that was rendered for the nth call of {@link imNextListRoot} without a key will be re-used.
 * 
 * NOTE: Keyed list renderers and non-keyed list renderers are stored in two completely seperate containers. So calling imNextList(5)
 *      will _not_ just give you the 5th root you got from the keyless call.
 * NOTE: Keys do not need to just be strings or numbers. They can be any object reference that has a stable reference.
 *
 * ```ts
 * imFor(); for (const item of items) {
 *      imNextListRoot(item);
 *      // render item here
 * } imEndFor();
 * ```
 *
 * When to use a key:
 *  - You need to render a different type of component per key. See {@link imSwitch}.
 *  - Each component in the list is complex, and may contain list rendering inside of it
 *  - Your components are not simply a function of state. You have untangible state that isn't stored anywere like text area focus/selection states, 
 *      so re-ordering your data and rendering it without keying it leads to bugs in your app
 *  - You just like using the key, actually
 *  - You have a key that you can use
 * 
 * When you probably don't need a key:
 *  - Your components are so simple and purely a function of state such that setting a bunch of attributes/styles/innerText is faster than moving DOM nodes around, and won't introduce bugs
 *
 * See the {@link UIRoot} docs for more info on what a 'UIRoot' even is, what it's limitations are, and how to effectively (re)-use them.
 */
export function imNextListRoot(key?: ValidKey) {
    if (imCore.currentRoot !== undefined) {
        const root = imCore.currentRoot;
        if (root.parentListRenderer === null) throw new Error("Expected this root to have a list renderer");
        imEnd(root.parentListRenderer.cacheRemoveLevel, root);
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
        if (block === undefined) {
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
         * If that is not the case, a more common cause is that you are mutating collections while iterating them.
         * By moving an element you've already iterated over down in the list such that you will iterate it again,
         * you've requested this key a second time, and are now rendering it.
         * Here's a potential way to temporarliy avoid doing this:
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
        if (block.rendered === true) throw new Error(
            "You've requested the same list key twice. This is indicative of a bug. The comment above this exception will explain more."
        );

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
            throw new Error("DEV: whenever l.builderIdx === this.builders.length, we should append another builder to the list");
        }
    }

    __beginUiRoot(result, result.domAppender.idx, -1, l.uiRoot);

    result.parentListRenderer = l;

    l.current = result;

    return result;
}


export type DeferredAction = (() => void) | undefined;


///////// 
// Common immediate mode UI helpers

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
 * In which chase, you'll set {@link inline} to true. This can be a bad idea -
 * you will be less likely to catch out-of-order rendering bugs that can corrupt your state.
 *
 * // TODO: delete this in favour of typeID + refs
 */
export function imState<T>(supplier: () => T, inline: boolean = false, r = getCurrentRoot()): T {
    return imStateInternal(supplier, inline, r).v;
}

function imStateInternal<T>(supplier: () => T, inline: boolean, r: UIRoot = getCurrentRoot()): StateItem<T> {
    const core = imCore;
    const items = r.items;
    const idx = getNextItemSlotIdx(r, core);

    let result: StateItem<T>;
    if (idx < items.length) {
        const box = r.items[idx];
        if (box.t !== ITEM_STATE) throw new Error("immediate mode state was queried out of order - wrong box type");

        // imState recieved a different supplier this render. If you're passing an inline lambda to this method, then use imStateInline to skip this check.
        // NOTE: However, this assertion exists to catch out-of-order rendering errors, which will lead to state corruption from 
        // hooks reading from and writing to the wrong object. The assertion won't be there in imStateInline.
        if (inline === false) {
            if (supplier !== box.supplier) throw new Error("immediate mode state was queried out of order - wrong supplier");
        }

        result = box as StateItem<T>;
    } else {
        if (r.lastItemIdx !== -1) throw new Error("too much immediate mode state was being pushed");

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
    if (core.currentRoot === undefined) throw new Error("You may be rendering a list right now, in which case calling this method is invalid");

    return core.currentRoot;
}

// You probably don't want to use this, if you can help it
export function getCurrentListRendererInternal(): ListRenderer {
    const core = imCore;

    /** Can't call this method without opening a new list renderer (see {@link imBeginList}) */
    if (core.currentListRenderer === undefined) throw new Error("You may be rendering a UIRoot now, in which case calling this method is invalid");

    return core.currentListRenderer;
}

function pushList(l: ListRenderer) {
    const core = imCore;

    core.currentStack.push(l);
    core.currentRoot = undefined;
    core.currentListRenderer = l;
}

export function imUnappendedRoot<E extends ValidElement = ValidElement>(
    elementSupplier: () => E,
    r: UIRoot<ValidElement>
): UIRoot<E> {
    hasDomDependency;

    const core = imCore;

    const items = r.items;
    const idx = getNextItemSlotIdx(r, core);

    let result: UIRoot<E> | undefined;
    if (idx < items.length) {
        result = items[idx] as UIRoot<E>;

        // The same immediate mode state must be queried in the same order every time.
        if (result.t !== ITEM_UI_ROOT) throw new Error("immediate mode state was queried out of order - wrong box type");
    
        // imBeginRoot was invoked with a different supplier from the previous render.
        // see INLINE_LAMBDA_BAD_HINT, COND_LIST_RENDERING_HINT.
        // string comparisons end up being quite expensive, so we're storing
        // a reference to the function that created the dom element and comparing those instead.
        if (result.elementSupplier !== elementSupplier) throw new Error("immediate mode state was queried out of order - element suppliers don't match");
    } else {
        if (r.lastItemIdx !== -1) throw new Error("too much immediate mode state was being pushed");

        result = newUiRoot(elementSupplier);
        items.push(result);
    }

    core.itemsRendered++;

    return result as UIRoot<E>;
} 


/**
const cssb = newCssBuilder("debug");
const debugClass = cssb.cn("debug1pxSolidRed", [` { border: 1px solid red; }`]);
// */

export function imBeginExistingRoot<E extends ValidElement = ValidElement>(
    root: UIRoot<E>,
    parent: UIRoot<ValidElement>
) {
    parent.hasRealChildren = true;

    appendToDomRoot(parent.domAppender, root.domAppender.root);

    __beginUiRoot(root, -1, -1, parent);
}

export function imBeginRoot<E extends ValidElement = ValidElement>(elementSupplier: () => E): UIRoot<E> {
    hasDomDependency;

    const r = getCurrentRoot();
    const result = imUnappendedRoot(elementSupplier, r);
    imBeginExistingRoot(result, r);
    return result;
}

/** 
 * This method pops any element from the global element stack that we created via {@link imBeginRoot}.
 * This is called `imEnd` instad of `end`, because `end` is a good variable name that we don't want to squat on.
 */
export function imEnd(removeLevel: RemovedLevel = REMOVE_LEVEL_DETATCHED, r: UIRoot = getCurrentRoot()) {
    bubbleMouseEvents(r, imCore.imEventSystem);

    __popStack();

    r.completedOneRender = true;

    if (r.itemsIdx === -1) {
        __removeAllDomElementsFromUiRoot(r, removeLevel);
    }

    if (r.itemsIdx !== -1 && r.itemsIdx !== r.items.length - 1) throw new Error("A different number of immediate mode state entries were pushed this render. You may be doing conditional rendering in a way that is invisible to this framework. See imIf, imElseIf, imElse, imSwitch, imFor, imWhile, imList, imNextListRoot, etc. for some alternatives.");
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
    if (imCore.currentRoot !== undefined) {
        const root = imCore.currentRoot;
        if (root.parentListRenderer === null) throw new Error("Expected this root to have a list renderer");
        imEnd(root.parentListRenderer.cacheRemoveLevel, root);
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
    if (l.cacheRemoveLevel === REMOVE_LEVEL_DESTROYED) {
        l.builders.length = l.builderIdx;
    }

    if (l.keys !== undefined) {
        for (const [k, v] of l.keys) {
            if (v.rendered === false) {
                __removeAllDomElementsFromUiRoot(v.root, l.cacheRemoveLevel);
                if (l.cacheRemoveLevel === REMOVE_LEVEL_DESTROYED) {
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
        cacheRemoveLevel: REMOVE_LEVEL_DETATCHED,
    };
}

export function abortListAndRewindUiStack(l: ListRenderer) {
    const core = imCore;

    // need to wind the stack back to the current list component
    const idx = core.currentStack.lastIndexOf(l);
    if (idx === -1) throw new Error("Expected this list element to be on the current element stack");
    core.currentStack.length = idx + 1;
    core.currentRoot = undefined;
    core.currentListRenderer = l;

    const r = l.current;
    if (r !== null) {
        __removeAllDomElementsFromUiRoot(r, REMOVE_LEVEL_DETATCHED);

        // need to reset the dom root, since we've just removed elements underneath it
        r.domAppender.idx = -1;
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
// You're better off using your own objects in 99% of scenarios.

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

export function imNewMap<K, V>(): Map<K, V> {
    return imState(newMap<K, V>);
}


function newSet<T>() {
    return new Set<T>();
}

export function imNewSet<K>(): Set<K> {
    return imState(newSet<K>);
}


const MEMO_INITIAL_VALUE = {};
function newMemoState(): { last: unknown } {
    // this way, imMemo always returns true on the first render
    return { last: MEMO_INITIAL_VALUE };
}


/**
 * Returns a non-zero value if it was different to the previous value.
 * ```ts
 * if (imMemo(val)) {
 *      // do expensive thing with val here
 *      setStyle("backgroundColor", getColor(val));
 * }
 * ```
 *
 * NOTE: also returns a non-zero value when:
 *      - we first render
 *      - we were not in the conditional-rendering code path before, but we are now
 *        when we are not in the conditional rendering path, we have no way to know if the value
 *        is changing while we're gone, so the idea is to just return true anyway once when we're back, assuming it probably has. 
 *        This is because memos usually gate computation of state that need to be kept up-to-date.
 *
 *  However, if you just want to run a side-effect when a component sees a change, you can 
 *  compare the result to {@link MEMO_CHANGED}.
 *  ```ts
 *  if (imMemo(val === MEMO_CHANGED)) { //side-effect }
 *  ```
 */
// NOTE: I had previously implemented imBeginMemo() and imEndMemo():
// ```
// if (imBeginMemo().val(x).objectVals(obj)) {
//      <Memoized component>
// } imEndMemo();
// ```
// It's pretty straightforward to implement - just memorize the dom index and the state index,
// ensure it returns true the first time so that you always have some components,
// and then onwards, if the values are the same, just advance the dom index and state index.
// else, return true and allow the rendering code to do this for you, and cache the new offsets
// in imEndMemo. Looks great right? Ended up with all sorts of stale state bugs so I deleted it.
// It's just not worth it ever, imo.
//
// I also previously had imMemoMany(), imMemoArray() and imMemoObjectVals, but these are a slipperly slope
// to imMemoDeep() which I definately don't want to ever implement. Also I was basically never using them. So I 
// have deleted them.
export function imMemo(val: unknown): ImMemoResult {
    const r = getCurrentRoot();
    const ref = imState(newMemoState, false, r);

    let result: ImMemoResult = MEMO_NOT_CHANGED;

    if (ref.last !== val) {
        result = ref.last === MEMO_INITIAL_VALUE ? MEMO_FIRST_RENDER : MEMO_CHANGED;
        ref.last = val;
    } else if (r.startedConditionallyRendering === true) {
        result = MEMO_FIRST_RENDER_CONDITIONAL;
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
/** 
 * returned by {@link imMemo} if this is is caused by the component
 * re-entering the conditional rendering codepath.
 */
export const MEMO_FIRST_RENDER_CONDITIONAL = 3;

export type ImMemoResult
    = typeof MEMO_NOT_CHANGED
    | typeof MEMO_CHANGED 
    | typeof MEMO_FIRST_RENDER
    | typeof MEMO_FIRST_RENDER_CONDITIONAL;

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
    addDocumentAndWindowEventListeners(core.imEventSystem);
}

export function uninitImCore(core: ImCore) {
    if (core.initialized === false) {
        console.warn("This context has not been initialized yet!");
        return;
    }

    if (core.uninitialized) {
        console.warn("This context has already been uninitialized!");
        return;
    }

    core.uninitialized = true;

    removeDocumentAndWindowEventListeners(core.imEventSystem);
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
    core.currentStack.length = 0;
    enableIm();
    __beginUiRoot(core.appRoot, -1, -1, null);

    beginProcessingImEvent(core.imEventSystem);

    // It is better to not try-catch this actually.
    // You shouldn't let any exceptions reach here under any circumstances.
    core.renderFn();

    // end frame

    endProcessingImEvent(core.imEventSystem);

    core.itemsRenderedLastFrame = core.itemsRendered;
    core.itemsRendered = 0;
    core.isRendering = false;
    if (isInsideEvent === true) {
        core._isExcessEventRender = isInsideEvent;
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


/**
 * This is similar to {@link imInit}, but does not create an im-state entry, which should speed up each render.
 * However, if components after this one throw an error in the first render, 
 * this flag will remain true for the next render as well. If you want real idempotency, use {@link imInit}.
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
export function imIsFirstishRender(): boolean {
    return getCurrentRoot().completedOneRender === false;
}

// Doing string comparisons every frame kills performance, if done for every singe DOM node.
// I'm still contemplating if this is a good idea or not.
// TODO: enum for all events
// TODO: enum for all styles
// TODO: enum for all DOM node types


