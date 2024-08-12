type ValidElement = HTMLElement | SVGElement;
export type Insertable<T extends ValidElement = HTMLElement> = {
    el: T;
    _isHidden: boolean;
};

export function replaceChildren(comp: Insertable, children: (Insertable | undefined)[]) {
    let iReal = 0;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child) {
            continue;
        }

        setChildAt(comp, child, iReal);
        iReal++;
    }

    while (iReal < comp.el.children.length) {
        comp.el.children[comp.el.children.length - 1].remove();
    }
};

export function appendChild<T extends ValidElement, U extends ValidElement>(mountPoint: Insertable<T>, child: Insertable<U>) {
    const children = mountPoint.el.children;
    if (children.length > 0 && children[children.length - 1] === child.el) {
        // This actually increases performance as well.
        // Because of this return statement, list renderers whos children haven't changed at all can be rerendered 
        // over and over again without moving any DOM nodes. And I have actually able to verify that it _does_ make a difference -
        // this return statement eliminated scrollbar-flickering inside of my scrolling list component
        return;
    }

    mountPoint.el.appendChild(child.el);
};

export function setChildAt<T extends ValidElement, U extends ValidElement>(
    mountPoint: Insertable<T>, child: Insertable<U>, i: number,
) {
    const children = mountPoint.el.children;

    if (i === children.length) {
        appendChild(mountPoint, child);
    }

    if (children[i] === child.el) {
        // saves perf as above.
        return;
    }

    mountPoint.el.replaceChild(child.el, children[i]);
}

export function removeChild(mountPoint: Insertable, child: Insertable) {
    const childParent = child.el.parentElement;
    if (!childParent) {
        return;
    }

    if (childParent !== mountPoint.el) {
        throw new Error("This component is not attached to this parent");
    }

    child.el.remove();
};

export function clearChildren(mountPoint: Insertable) {
    mountPoint.el.replaceChildren();
};

type StyleObject<U extends ValidElement> = (U extends HTMLElement ? keyof HTMLElement["style"] : keyof SVGElement["style"]);
/** 
 * A little more performant than setting the style directly.
 * Not as fast as memoizing the variables that effect the style, and then setting this directly only when those vars have changed
 */
export function setStyle<
    U extends ValidElement,
    // Apparently I can't just do `K extends keyof CSSStyleDeclaration` without type errors. lmao
    K extends StyleObject<U>,
>(
    root: Insertable<U>,
    val: K, style: U["style"][K]
) {
    if (root.el.style[val] !== style) {
        root.el.style[val] = style;
    }
}

/** 
 * A little more performant than adding/removing from the classList directly, but still quite slow actually.
 * Not as fast as memoizing the variables that effect the style, and then setting this directly only when those vars have changed
 */
export function setClass<T extends ValidElement>(
    component: Insertable<T>,
    cssClass: string,
    state: boolean,
): boolean {
    const contains = component.el.classList.contains(cssClass);
    if (state === contains) {
        // Yep. this is another massive performance boost. you would imagine that the browser devs would do this on 
        // their end, but they don't...
        // Maybe because if they did an additional check like this on their end, and then I decided I wanted to 
        // memoize on my end (which would be much faster anyway), their thing would be a little slower.
        // At least, that is what I'm guessing the reason is
        return state;
    }

    if (state) {
        component.el.classList.add(cssClass);
    } else {
        component.el.classList.remove(cssClass);
    }

    return state;
};

export function setVisibleGroup(state: boolean, groupIf: Insertable<HTMLElement | SVGElement>[], groupElse?: Insertable<HTMLElement | SVGElement>[]) {
    for (const i of groupIf) {
        setVisible(i, state);
    }

    if (groupElse) {
        for (const i of groupElse) {
            setVisible(i, !state);
        }
    }

    return state;
}

export function setVisible<U extends HTMLElement | SVGElement>(component: Insertable<U>, state: boolean | null | undefined): boolean {
    component._isHidden = !state;
    if (state) {
        component.el.style.setProperty("display", "", "")
    } else {
        component.el.style.setProperty("display", "none", "important")
    }
    return !!state;
}

// This is a certified jQuery moment: https://stackoverflow.com/questions/19669786/check-if-element-is-visible-in-dom
// NOTE: this component will also return false if it hasn't been rendered yet. This is to handle the specific case of
// when we might want to prevent a global event handler from running if our component isn't visible in a modal.
// This turns out to be one of the few reasons why I would ever use this method...
export function isVisible(component: Component<unknown, HTMLElement> | Insertable<HTMLElement>): boolean {
    if (wasHiddenOrUninserted(component)) {
        // if _isHidden is set, then the component is guaranteed to be hidden via CSS. 
        return true;
    }

    // If _isHidden is false, we need to perform additional checking to determine if a component is visible or not.
    // This is why we don't call isVisible to disable rendering when a component is hidden.

    if ("argsOrNull" in component && component.argsOrNull === null) {
        // Args are only populated once a component has been rendered for the first time.
        // They can be undefined, or some object.
        // In retrospect, I think I may have mixed up null and undefined here. Might be worth picking a better sentinel value.
        return false;
    }

    return isVisibleElement(component.el);
}

export function isVisibleElement(el: HTMLElement) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

type ComponentPool<T, U extends ValidElement> = {
    components: Component<T, U>[];
    lastIdx: number;
    getIdx(): number;
    render(renderFn: (getNext: () => Component<T, U>) => void): void;
}

type ValidAttributeName = string;

/** 
 * Any name and string is fine, but I've hardcoded a few for autocomplete. 
 * A common bug is to type 'styles' instead of 'style' and wonder why the layout isn't working
 */
type Attrs = { [qualifiedName: ValidAttributeName]: string | undefined } & {
    style?: string | Record<keyof HTMLElement["style"], string | null>;
    class?: string;
    href?: string;
    src?: string;
}

/**
 * NOTE: I've not actually checked if this has performance gains,
 * just assumed based on every other function.
 */
export function setAttr<T extends ValidElement>(
    el: Insertable<T>, 
    key: string, 
    val: string | undefined, 
    wrap = false,
) {
    if (val === undefined) {
        el.el.removeAttribute(key);
        return;
    }

    if (wrap) {
        el.el.setAttribute(key, (getAttr(el, key) || "") + val);
        return;
    }

    if (getAttr(el, key) !== val) {
        el.el.setAttribute(key, val);
    }
}

export function getAttr<T extends ValidElement>(
    el: Insertable<T>, key: string
) {
    return el.el.getAttribute(key);
}

export function init<T>(obj: T, fn: (obj: T) => void): T {
    fn(obj);
    return obj;
}

export function setAttrs<T extends ValidElement>(
    ins: Insertable<T>,
    attrs: Attrs,
    wrap = false,
): Insertable<T> {
    for (const attr in attrs) {
        if (attr === "style" && typeof attrs.style === "object") {
            const styles = attrs[attr] as Record<keyof HTMLElement["style"], string | null>;
            for (const s in styles) {
                // @ts-expect-error trust me bro
                setStyle(ins, s, styles[s]);
            }
        }

        setAttr(ins, attr, attrs[attr], wrap);
    }

    return ins;
}

export function addChildren<T extends ValidElement>(ins: Insertable<T>, children: ChildList<T>): Insertable<T> {
    const element = ins.el;

    if (!Array.isArray(children)) {
        children = [children];
    }

    for (const c of children) {
        if (c === false) {
            continue;
        }

        if (typeof c === "function") {
            c(ins);
            continue;
        }

        if (Array.isArray(c)) {
            for (const insertable of c) {
                element.appendChild(insertable.el);
            }
        } else if (typeof c === "string") {
            element.appendChild(document.createTextNode(c));
        } else {
            element.appendChild(c.el);
        }
    }

    return ins;
}
/**
 * Used to create svg elements, since {@link el} won't work for those.
 * {@link type} needs to be lowercase for this to work as well.
 *
 * Hint: the `g` element can be used to group SVG elements under 1 DOM node. It's basically the `div` of the SVG world, and
 * defers me from having to implement something like React fragments for 1 more day...
 */
export function elSvg<T extends SVGElement>(
    type: string,
    attrs?: Attrs,
    children?: ChildList<T>,
) {
    const xmlNamespace = "http://www.w3.org/2000/svg";
    const svgEl = document.createElementNS(xmlNamespace, type) as T;
    if (type === "svg") {
        // Took this from https://stackoverflow.com/questions/8215021/create-svg-tag-with-javascript
        // Not sure if actually needed
        svgEl.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:xlink", "http://www.w3.org/1999/xlink");
        svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    return elInternal<T>(svgEl, attrs, children);
}

/**
 * Creates an HTML element with the given attributes, and adds chldren.
 * NOTE: For svg elements, you'll need to use `elSvg`
 */
export function el<T extends HTMLElement>(
    type: string,
    attrs?: Attrs,
    children?: ChildList<T>,
): Insertable<T> {
    const element = document.createElement(type) as T;
    return elInternal(element, attrs, children);
}

function elInternal<T extends ValidElement>(
    element: T,
    attrs?: Attrs,
    children?: ChildList<T>,
): Insertable<T> {
    const insertable = newInsertable<T>(element);

    if (attrs) {
        setAttrs(insertable, attrs);
    }

    if (children) {
        addChildren(insertable, children);
    }

    return insertable;
}

// A function passed as a 'child' will be invoked on the parent once when it's being constructed.
// Sounds useless at first (and it is), but it's very useful when paired with render groups. 
type Functionality<T extends ValidElement> = (parent: Insertable<T>) => void;
type ChildListElement<T extends ValidElement> = Insertable<ValidElement> | string | false | Functionality<T>;
export type ChildList<T extends ValidElement> = ChildListElement<T> | ChildListElement<T>[];

/**
 * Creates a div, gives it some attributes, and then appends some children. 
 * It was so common to use el("div", ... that I've just made this it's own method.
 *
 * I use this instead of {@link el} 90% of the time
 *
 * NOTE: For svg elements, you'll need to use `elSvg`
 */
export function div(attrs?: Attrs, children?: ChildList<HTMLDivElement>) {
    return el<HTMLDivElement>("DIV", attrs, children);
}

export function span(attrs?: Attrs, children?: ChildList<HTMLSpanElement>) {
    return el<HTMLSpanElement>("SPAN", attrs, children);
}

export function divClass(className: string, attrs: Attrs = {}, children?: ChildList<HTMLDivElement>) {
    return setAttrs(div(attrs, children), { class: className }, true);
}

export function setErrorClass<T extends ValidElement>(root: Insertable<T>, state: boolean) {
    setClass(root, "catastrophic---error", state);
}

function handleRenderingError<T extends ValidElement>(root: Insertable<T>, renderFn: () => void) {
    // While this still won't catch errors with callbacks, it is still extremely helpful.
    // By catching the error at this component and logging it, we allow all other components to render as expected, and
    // It becomes a lot easier to spot the cause of a bug.

    try {
        setErrorClass(root, false);
        return renderFn();
    } catch (e) {
        setErrorClass(root, true);
        console.error("An error occured while rendering your component:", e);
    }
}

export type ListRenderer<R extends ValidElement, T, U extends ValidElement> = Insertable<R> & ComponentPool<T, U>;

export function newListRenderer<R extends ValidElement, T, U extends ValidElement>(
    root: Insertable<R>, 
    // TODO: templateFn?
    createFn: () => Component<T, U>,
): ListRenderer<R, T, U> {
    function getNext() {
        if (renderer.lastIdx > renderer.components.length) {
            throw new Error("Something strange happened when resizing the component pool");
        }

        if (renderer.lastIdx === renderer.components.length) {
            const component = createFn();
            renderer.components.push(component);
            appendChild(root, component);
        }

        return renderer.components[renderer.lastIdx++];
    }

    let renderFn: ((getNext: () => Component<T, U>) => void) | undefined;
    function renderFnBinded() {
        renderFn?.(getNext);
    }

    const renderer: ListRenderer<R, T, U> = {
        el: root.el,
        get _isHidden() { return root._isHidden; },
        set _isHidden(val: boolean) { root._isHidden = val; },
        components: [],
        lastIdx: 0,
        getIdx() {
            // (We want to get the index of the current iteration, not the literal value of lastIdx)
            return this.lastIdx - 1;
        },
        render(renderFnIn) {
            this.lastIdx = 0;

            renderFn = renderFnIn;

            renderFnBinded();

            while (this.components.length > this.lastIdx) {
                const component = this.components.pop()!;
                component.el.remove();
            }
        },
    };

    return renderer;
}

/** 
 * Why extract such simple method calls as `addEventListener` into it's own helper function?
 * It's mainly so that the code minifier can minify all usages of this method, which should reduce the total filesize sent to the user.
 * So in other words, the methods are extracted based on usage frequency and not complexity.
 *
 * Also I'm thinkig it might make defining simple buttons/interactions a bit simpler, but I haven't found this to be the case just yet.
 * TODO: extend to SVG element
 */
export function on<K extends keyof HTMLElementEventMap>(
    ins: Insertable<HTMLElement>,
    type: K,
    listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
) {
    ins.el.addEventListener(type, listener, options);
    return ins;
}

/** I've found this is very rarely used compared to `on`. Not that there's anything wrong with using this, of course */
export function off<K extends keyof HTMLElementEventMap>(
    ins: Insertable<HTMLElement>,
    type: K,
    listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
) {
    ins.el.removeEventListener(type, listener, options);
    return ins;
}




type TextElement = HTMLTextAreaElement | HTMLInputElement;

export function setInputValueAndResize<T extends TextElement>(inputComponent: Insertable<T>, text: string) {
    setInputValue(inputComponent, text);
    resizeInputToValue(inputComponent);
}

/** This is how I know to make an input that auto-sizes to it's text */
export function resizeInputToValue<T extends TextElement>(inputComponent: Insertable<T>) {
    setAttr(inputComponent, "size", "" + inputComponent.el.value.length);
}

function wasHiddenOrUninserted<T extends ValidElement>(ins: Insertable<T>) {
    return ins._isHidden || !ins.el.parentElement;
}

function checkForRenderMistake<T extends ValidElement>(ins: Insertable<T>) {
    if (!ins.el.parentElement) {
        console.warn("A component hasn't been inserted into the DOM, but we're trying to do things with it anyway.");
    }
}

/** 
 * A LOT faster than just setting the text content manually.
 *
 * However, there are some niche use cases (100,000+ components) where you might need even more performance. 
 * In those cases, you will want to avoid calling this function if you know the text hasn't changed.
 */
export function setText(component: Insertable, text: string) {
    if ("rerender" in component) {
        console.warn("You might be overwriting a component's internal contents by setting it's text");
    };

    if (component.el.textContent === text) {
        // Actually a huge performance speedup!
        return;
    }

    component.el.textContent = text;
};

export function isEditingInput(component: Insertable): boolean {
    return document.activeElement === component.el;
}

/** NOTE: assumes that component.el is an HTMLInputElement */
export function setInputValue<T extends TextElement>(component: Insertable<T>, text: string) {
    const inputElement = component.el;

    // Yeah, its up to you to call it on the right component. 
    // I don't want to add proper types here, because I can't infer the type `htmlf` will return
    if (inputElement.value === text) {
        // might be a huge performance speedup! ?
        return;
    }

    const { selectionStart, selectionEnd } = inputElement;

    inputElement.value = text;

    inputElement.selectionStart = selectionStart;
    inputElement.selectionEnd = selectionEnd;
};


export type State<T> = {
    /** This is the raw value */
    argsOrUndefined: T | undefined;
    /**
     * A getter that will assert that the args have actually been set
     * before returning them. This should be the case in 99% of normal use-cases
     */
    args: T;
}

/**
 * Typically used to store and get the last arguments a component got.
 * Stateless by default.
 */
export function newState<T = undefined>(initialValue: T | undefined = undefined) {
    const state: State<T> = {
        argsOrUndefined: initialValue,
        set args(val: T) {
            state.argsOrUndefined = val;
        },
        get args() {
            if (state.argsOrUndefined === undefined) {
                // If u programmed it right you won't be seeing this error
                throw new Error("A component must be rendered with Args at least once before it's state can be accessed.");
            }

            return state.argsOrUndefined;
        }
    };

    return state;
}

/** 
 * Makes a 'component'.
 * This thing used to be the main way to make components, but I've made it private now - 
 * it's been officially superseeded by the render groups.
 *
 * A component is exactly like a {@link el} return value in that it can be inserted into the dom with {@link el}, but
 * it also has a `rerender` function that can be used to hydrate itself, and possibly it's children.
 * You would need to do this yourself in renderFn, however.
 * Consider using `const rg = newRenderGroup();` and then passing rg.render as the render function.
 * {@link newRenderGroup}
 * 
 * @param root is a return-value from {@link el} that will be the root dom-node of this component
 * @param renderFn is called each time to rerender the comopnent.
 * 
 * It stores args in the `args` object, so that any event listeners can update their behaviours when the main
 * component re-renders.
 *
 * NOTE: The template types will be inferred by arguments if you're using this thing right.
 * If you are setting them manually, you're using this method in a suboptimal way that wasn't intended.
 *
 * An example of a correct usage:
 *
 * ```
 * function UserProfile() {
 *      const s = newState<{ user: User }>();
 *
 *      const rg = newRenderGroup();
 *      const root = div({}, [ 
 *          div({}, rg.text(() => s.args.user.FirstName + " " + s.args.user.LastName)),
 *          div({}, rg.text(() => "todo: implement the rest of this component later")),
 *      ]);
 *
 *      function render() {
 *          rg.render();
 *      }
 *      
 *      // if `s` and `root` are specified and have known types, the type of this component will be correctly inferred.
 *      return newComponent(root, render, s);
 * }
 * ```
 *
 */
export function __newRealComponentInternal<T, U extends ValidElement>(root: Insertable<U>, renderFn: () => void, s: State<T> = newState()) {
    const component: Component<T, U> = {
        el: root.el,
        skipErrorBoundary: false,
        get _isHidden() { return root._isHidden; },
        set _isHidden(val: boolean) { root._isHidden = val; },
        state: s,
        render(args: T) {
            s.args = args;

            checkForRenderMistake(this);

            if (component.skipErrorBoundary) {
                renderFn();
            } else {
                handleRenderingError(this, renderFn);
            }
        },
    };

    return component;
}

export type RenderGroup = {
    instantiated: boolean;
    templateName: string;
    skipErrorBoundary: boolean;
    render: () => void;
    text: (fn: () => string) => Insertable<HTMLSpanElement>;
    c: <U extends ValidElement>(component: Component<unknown, U>) => Component<unknown, U>;
    cArgs: <T, U extends ValidElement>(
        component: Component<T, U>,
        renderFn: (c: Component<T, U>) => void,
    ) => Component<T, U>;
    /** Sets a component visible based on a predicate, and only renders it if it is visible */
    if: <U extends ValidElement> (predicate: () => boolean, templateFn: TemplateFn<unknown, U>) => Component<unknown, U>,
    /** Same as `if` - will hide the component if T is undefined, but lets you do type narrowing */
    with: <U extends ValidElement, T> (predicate: () => T | undefined, templateFn: TemplateFn<T, U>) => Component<T, U>,
    // TODO: extend to SVGElement as well. you can still use it on both, but the autocomplete won't work
    on: <K extends keyof HTMLElementEventMap>(
        type: K,
        listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
        options?: boolean | AddEventListenerOptions
    ) => Functionality<HTMLElement>;
    attr: <U extends ValidElement>(attrName: string, valueFn: () => string) => Functionality<U>;
    class: <U extends ValidElement>(className: string, predicate: () => boolean) => Functionality<U>;
    style: <U extends ValidElement, K extends StyleObject<U>>(val: K, valueFn: () => U["style"][K]) => Functionality<U>;
    functionality: <U extends ValidElement> (fn: (val: Insertable<U>) => void) => Functionality<U>;
    // NOTE: this root might be redundant now...
    renderFn: (fn: () => void) => void;
    preRenderFn: (fn: () => void) => void;
};

let debug = false;
export function enableDebugMode() {
    debug = true;
}

const renderCounts = new Map<string, { c: number, t: number; s: Set<RenderGroup>}>();
function countRender(name: string, ref: RenderGroup, num: number) {
    if (!debug) return;

    if (!renderCounts.has(name)) {
        renderCounts.set(name, { c: 0, s: new Set(), t: 0 });
    }
    const d = renderCounts.get(name)!;
    d.c+=num;
    d.t++;
    d.s.add(ref);
}

export function printRenderCounts() {
    if (!debug) return;

    let totalComponents = 0;
    let totalRenderFns = 0;
    let totalRenders = 0;

    for (const v of renderCounts.values()) {
        totalRenderFns += v.c;
        totalRenders += v.t;
        totalComponents += v.s.size;
    }

    for (const [k, v] of renderCounts) {
        if (v.t === 0) {
            renderCounts.delete(k);
        }
    }

    console.log(
        ([...renderCounts].sort((a, b) => a[1].c - b[1].c))
            .map(([k, v]) => `${k} (${v.s.size} unique) rendered ${v.c} fns and ${v.t} times, av = ${(v.c / v.t).toFixed(2)}`)
            .join("\n") + "\n\n" 
            + `total num components = ${totalComponents}, total render fns  ${totalRenderFns}`
    );

    for (const v of renderCounts.values()) {
        v.c = 0;
        v.t = 0;
        v.s.clear();
    }
}

/**
 * This function allows you to declaratively define a component's behaviour, which can save a lot of time, and can work alongside a regular render function. 
 *
 * The following two components are identical in appearance and behaviour:
 *
 * ```
 * function UserProfileBannerNoRendergroups() {
 *      const s = newState<{
 *          user: User;
 *      }>();
 *
 *      const nameEl = div();
 *      const infoList = newListRenderer(div(), UserProfileInfoPair);
 *      const bioEl = div();
 *
 *      const root = div({}, [
 *          nameEl,
 *          bioEl,
 *          infoList,
 *      ]);
 * 
 *      function render() {
 *          const { user } = s.args;
 *
 *          setText(nameEl, user.FirstName + " " + user.LastName;
 *
 *          setText(bioEl, user.ProfileInfo.Bio);
 *
 *          infoList.render((getNext) => {
 *              // todo: display this info properly
 *              for (const key in user.ProfileInfo) {
 *                  if (key === "Bio") {
 *                      continue;
 *                  }
 *
 *                  getNext().render({ key: key, value: user.ProfileInfo[key] });
 *              }
 *          });
 *      }
 *
 *      return newComponent(root, render, s);
 * }
 *
 * function UserProfileBannerRg() {
 *      const s = newState<{
 *          user: User;
 *      }>();
 *
 *      const nameEl = div();
 *      const infoList = newListRenderer(div(), UserProfileInfoPair);
 *      const bioEl = div();
 *
 *      const rg = newRenderGroup();
 *      const root = div({}, [
 *          div({}, [ rg.text(() => s.args.user.FirstName + " " + s.args.user.LastName) ]),
 *          div({}, [ rg.text(() => s.args.user.ProfileInfo.Bio) ],
 *          rg.list(div(), UserProfileInfoPair, (getNext) => {
 *              // todo: display this info properly
 *              for (const key in user.ProfileInfo) {
 *                  // We're already rendering this correctly
 *                  if (key === "Bio") {
 *                      continue;
 *                  }
 *
 *                  getNext().render({ key: key, value: user.ProfileInfo[key] });
 *              }
 *          })
 *      ]);
 *
 *      return newComponent(root, rg.render, s);
 * }
 * ```
 *
 * The render groups version is FAR easier to write (especially when you aren't 100% sure what data `User` actually contains and you're
 * relying on autocomplete) and is fewer lines of code, and higher signal to noise ratio, at the expense of increased complexity.
 * You will need to be awaire that each time you call `rg(el, fn)` or any of it's helpers, you're pushing a render function onto an array inside of `rg`, 
 * and calling rg.render() will simply call each of these render methods one by one. 
 * It's important that you only call these array-pushing functions only once when initializing the component, and not again inside of a render. 
 *
 * TODO: rewrite doc. Rendergroup has completely changed - it's much more powerful than before
 *
 */
export function newRenderGroup(): RenderGroup {
    const renderFns: ({ fn: () => void; })[] = [];

    const rg: RenderGroup = {
        instantiated: false,
        templateName: "unknown",
        skipErrorBoundary: false,
        render() {
            rg.instantiated = true;
            countRender(rg.templateName, rg, renderFns.length);
            for (let i = 0; i < renderFns.length; i++) {
                renderFns[i].fn();
            }
        },
        text: (fn: () => string): Insertable<HTMLSpanElement> => {
            const e = span();
            renderFns.push({ fn: () => setText(e, fn())  });
            return e;
        },
        with: (predicate, templateFn) => {
            const c = newComponent(templateFn);
            rg.renderFn(() => {
                const val = predicate();
                if (setVisible(c, val !== undefined)) {
                    c.render(val!);
                }
            });

            return c;
        },
        if: (predicate, templateFn) => {
            const c = newComponent(templateFn);

            rg.renderFn(() => {
                if (setVisible(c, predicate())) {
                    c.render(undefined);
                }
            });

            return c;
        },
        c: (component) => {
            rg.renderFn(() => component.render(undefined));
            return component;
        },
        cArgs: (component, renderFn) => {
            rg.renderFn(() => renderFn(component));
            return component;
        },
        on(type, listener, options,) {
            return (parent) => {
                on(parent, type, listener, options);
            }
        },
        attr: (attrName, valueFn) => {
            return (parent) => {
                const currentAttrValue = getAttr(parent, attrName);
                rg.renderFn(() => setAttr(parent, attrName, currentAttrValue + valueFn()));
            }
        },
        class: (className, predicate) => {
            return (parent) => {
                rg.renderFn(() => setClass(parent, className, predicate()));
            }
        },
        style: (styleName, valueFn) => {
            return (parent) => {
                const currentStyle = parent.el.style[styleName];
                rg.renderFn(() => setStyle(parent, styleName, valueFn() || currentStyle));
            };
        },
        functionality: (fn) => {
            return (parent) => {
                rg.renderFn(() => fn(parent));
            };
        },
        renderFn: (fn) => {
            if (rg.instantiated) {
                throw new Error("Can't add event handlers to this template (" + rg.templateName + ") after it's been instantiated");
            }
            renderFns.push({ fn });
        },
        preRenderFn: (fn) => {
            if (rg.instantiated) {
                throw new Error("Can't add event handlers to this template (" + rg.templateName + ") after it's been instantiated");
            }
            renderFns.unshift({ fn });
        },
    };

    return rg;
}


type TemplateFn<T, U extends ValidElement> = (rg: RenderGroup, state: State<T>) => Insertable<U>;
type TemplateFnPRO<T, U extends ValidElement, R> = (rg: RenderGroup, state: State<T>) => readonly [Insertable<U>, R];

/**
 * Turns out that this is really good. 
 */
export function newComponent<T, U extends ValidElement>(
    templateFn: TemplateFn<T, U>,
    initialState?: T,
    skipErrorBoundary = false
) {
    const rg = newRenderGroup();
    rg.templateName = templateFn.name ?? "unknown fn name";
    const state = newState<T>(initialState);
    const root = templateFn(rg, state);
    const component = __newRealComponentInternal(root, rg.render, state);
    component.skipErrorBoundary = skipErrorBoundary;
    return component;
}

/**
 * Used when your component is hella complex and you need to return a second object with it.
 * This second object can be internal state, functions, anything really.
 * Most components won't need this, but sometimes you'll need this 
 * for large monolithic components and there is nothing wrong with using it (unlike React's useImperativeHandle).
 *
 * The '2' is because it returns 2 things (and not because it is lazily named, actually)
 */
export function newComponent2<T, U extends ValidElement, R>(
    templateFn: TemplateFnPRO<T, U, R>,
    initialState?: T,
    skipErrorBoundary = false
) {
    const rg = newRenderGroup();
    rg.templateName = templateFn.name ?? "unknown fn name";
    const state = newState<T>(initialState);
    const [root, imperativeHandle] = templateFn(rg, state);
    const component = __newRealComponentInternal(root, rg.render, state);
    component.skipErrorBoundary = skipErrorBoundary;
    return [component, imperativeHandle] as const;
}

export function newInsertable<T extends ValidElement>(el: T): Insertable<T> {
    return {
        el,
        _isHidden: false,
    };
}

export type Component<T, U extends ValidElement> = Insertable<U> & {
    /**
     * A renderable's arguments will be null until during or after the first render
     * .args is actually a getter that will throw an error if they are null 
     * (but not if they are undefined, which is currently the only way to do 
     * stateless components)
     *
     * ```
     *
     * function Component() {
     *      const s = newState<{ count: number; }>();
     *      const rg = newRenderGroup();
     *      const div2 = div();
     *
     *      // this works, provider rg.render is only called during or after the first render
     *      const button = el("button", {}, ["Clicked ", rg.text(() => s.args.count), " time(s)"]);
     *
     *      const root = div({}, [
     *          button, 
     *          div2,
     *      ]);
     *
     *      // Runtime error: Args were null!
     *      setText(div2, "" + s.args.count);   
     *
     *      function render() {
     *          // this works, s.args being called during (at least) the first render.
     *          const { count } = s.args;
     *      }
     *
     *      button.el.addEventListener("click", () => {
     *          // this works, assuming the component is rendered immediately before the user is able to click the button in the first place.
     *          const { count } = s.args;
     *      });
     *
     *      document.on("keydown", () => {
     *          // this will mostly work, but if a user is holding down keys before the site loads, this will error!
     *          // You'll etiher have to use s.argsOrNull and check for null, or only add the handler once during the first render 
     *          // (or something more applicable to your project)
     *          const { count } = s.args;
     *      });
     *
     *      return newComponent<Args>(root, render, s);
     * }
     * ```
     */
    render(args: T): void;
    state: State<T>;
    skipErrorBoundary: boolean;
}

export function isEditingTextSomewhereInDocument(): boolean {
    const el = document.activeElement;
    if (!el) {
        return false;
    }

    const type = el.nodeName.toLocaleLowerCase();
    if (
        type === "textarea" ||
        type === "input"
    ) {
        return true;
    }

    return false;
}

/**
 * Scrolls {@link scrollParent} to bring scrollTo into view.
 * {@link scrollToRelativeOffset} specifies where to to scroll to. 0 = bring it to the top of the scroll container, 1 = bring it to the bottom
 */
export function scrollIntoView(
    scrollParent: HTMLElement,
    scrollTo: Insertable<HTMLElement>,
    scrollToRelativeOffset: number,
    horizontal = false,
) {
    if (horizontal) {
        // NOTE: this is a copy-paste from below

        const scrollOffset = scrollToRelativeOffset * scrollParent.offsetWidth;
        const elementWidthOffset = scrollToRelativeOffset * scrollTo.el.getBoundingClientRect().width;

        // offsetLeft is relative to the document, not the scroll container. lmao
        const scrollToElOffsetLeft = scrollTo.el.offsetLeft - scrollParent.offsetLeft;

        scrollParent.scrollLeft = scrollToElOffsetLeft - scrollOffset + elementWidthOffset;

        return;
    }

    const scrollOffset = scrollToRelativeOffset * scrollParent.offsetHeight;
    const elementHeightOffset = scrollToRelativeOffset * scrollTo.el.getBoundingClientRect().height;

    // offsetTop is relative to the document, not the scroll container. lmao
    const scrollToElOffsetTop = scrollTo.el.offsetTop - scrollParent.offsetTop;

    scrollParent.scrollTop = scrollToElOffsetTop - scrollOffset + elementHeightOffset;
}

export function setCssVars(vars: [string, string][]) {
    const cssRoot = document.querySelector(":root") as HTMLElement;
    for (const [k, v] of vars) {
        cssRoot.style.setProperty(k, v);
    }
};

export type StyleGenerator = {
    prefix: string;
    makeClass(className: string, styles: string[]): string;
};

let lastClass = 0;
/**
 * NOTE: this should always be called at a global scope on a *per-module* basis, and never on a per-component basis.
 * Otherwise you'll just have a tonne of duplicate styles lying around in the DOM. 
 */
export function newStyleGenerator(): StyleGenerator {
    const root = el<HTMLStyleElement>("style", { type: "text/css" });
    document.body.appendChild(root.el);

    lastClass++;

    const obj: StyleGenerator = {
        // css class names can't start with numbers, but uuids occasionally do. hence "s".
        // Also, I think the "-" is very important for preventing name collisions.
        prefix: "s" + lastClass + "-",
        makeClass: (className: string, styles: string[]): string => {
            const name = obj.prefix + className;

            for (const style of styles) {
                root.el.appendChild(
                    document.createTextNode(`.${name}${style}\n`)
                );
            }

            return name;
        }
    };

    return obj;
}
