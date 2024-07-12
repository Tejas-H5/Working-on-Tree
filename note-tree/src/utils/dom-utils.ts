export type Insertable<T extends Element = Element> = { 
    el: T;
    _isHidden: boolean;
};

export function replaceChildren(comp: Insertable, children: (Insertable | undefined)[]) {
    comp.el.replaceChildren(
        ...children.filter(c => !!c).map((c) => {
            return c!.el;
        })
    );
};

export function appendChild(mountPoint: Insertable, child: Insertable) {
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

/** 
 * A little more performant than setting the style directly.
 * Not as fast as memoizing the variables that effect the style, and then setting this directly only when those vars have changed
 */
export function setStyle<
    U extends HTMLElement | SVGElement, 
    // Apparently I can't just do `K extends keyof CSSStyleDeclaration` without type errors. lmao
    K extends (U extends HTMLElement ? keyof HTMLElement["style"] : keyof SVGElement["style"])
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
export function setClass(
    component: Insertable,
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
export function isVisible(component: Renderable<unknown, HTMLElement> | Insertable<HTMLElement>): boolean {
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
    return !!( el.offsetWidth || el.offsetHeight || el.getClientRects().length );
}

type ComponentPool<U extends Element, T extends Insertable<U>> = {
    components: T[];
    lastIdx: number;
    getIdx(): number;
    render(renderFn: (getNext: () => T) => void): void;
}

type KeyedComponentPool<K, T extends Insertable<HTMLElement>> = {
    components: Map<K, { c: T, del: boolean }>;
    render(renderFn: (getNext: (key: K) => T) => void): void;
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
export function setAttr(el: Insertable, key: string, val: string | undefined, wrap = false) {
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

export function getAttr(el: Insertable, key: string) {
    return el.el.getAttribute(key);
}

export function init<T>(obj: T, fn: (obj: T) => void): T {
    fn(obj);
    return obj;
}

export function setAttrs<T extends Insertable>(
    ins: T,
    attrs: Attrs,
    wrap = false,
): T {
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

export function addChildren<T extends Insertable>(ins: T, children: ChildList): T {
    const element = ins.el;

    if (!Array.isArray(children)) {
        children = [children];
    }

    for (const c of children) {
        if (c === false) {
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
    children?: ChildList,
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
    children?: ChildList,
): Insertable<T> {
    const element = document.createElement(type) as T;
    return elInternal(element, attrs, children);
}

function elInternal<T extends Element>(
    element: T,
    attrs?: Attrs,
    children?: ChildList,
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

type ChildListElement = Insertable<Element> | string | false;
export type ChildList = ChildListElement | ChildListElement[];

/**
 * Creates a div, gives it some attributes, and then appends some children. 
 * It was so common to use el("div", ... that I've just made this it's own method.
 *
 * I use this instead of {@link el} 90% of the time
 *
 * NOTE: For svg elements, you'll need to use `elSvg`
 */
export function div(attrs?: Attrs, children?: ChildList) {
    return el<HTMLDivElement>("DIV", attrs, children);
}

export function span(attrs?: Attrs, children?: ChildList) {
    return el<HTMLSpanElement>("SPAN", attrs, children);
}

export function divClass(className: string, attrs: Attrs = {}, children?: ChildList) {
    return setAttrs(div(attrs, children), { class: className }, true);
}

export function setErrorClass(root: Insertable, state: boolean) {
    setClass(root, "catastrophic---error", state);
}

function handleRenderingError<T>(root: Insertable, renderFn: () => T | undefined) {
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

export type ListRenderer<
    R extends Element, 
    U extends Element, T extends Insertable<U>,
> = Insertable<R> & ComponentPool<U, T>;

export type KeyedComponentList<K, T extends Insertable<HTMLElement>> = Insertable & KeyedComponentPool<K, T>;

export function newListRenderer<
    R extends Element, 
    U extends Element, T extends Insertable<U>,
>(root: Insertable<R>, createFn: () => T): ListRenderer<R, U, T> {
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

    let renderFn: ((getNext: () => T) => void)  | undefined;
    function renderFnBinded() {
        renderFn?.(getNext);
    }

    const renderer: ListRenderer<R, U, T> = {
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

            while(this.components.length > this.lastIdx) {
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

/**
 * This seems to be a lot slower than the normal list render in a lot of situations, and
 * I can't figure out why. So I would suggest not using this for now.
 * I expect that it would be faster in very specific situations though. 
 * Can't think of any off the top of my head
 */
export function newKeyedListRenderer<K, T extends Insertable<HTMLElement>>(root: Insertable, createFn: () => T): KeyedComponentList<K, T> {
    function getNext(key: K) {
        const block = renderer.components.get(key);
        if (block) {
            if (!block.del) {
                console.warn("renderer key is trying to be used multiple times, which will cause your list render incorrectly: " + key);
            }
            block.del = false;
            updatedComponentList.push(block.c.el);
            return block.c;
        }

        const newComponent = createFn();
        renderer.components.set(key, { c: newComponent, del: false });

        return newComponent;
    };
    let renderFn: ((getNext: (key: K) => T) => void)  | undefined;
    function renderFnBinded() {
        renderFn?.(getNext);
    }
    const updatedComponentList : HTMLElement[] = [];
    const renderer: KeyedComponentList<K, T> = {
        el: root.el,
        get _isHidden() { return root._isHidden; },
        set _isHidden(val: boolean) { root._isHidden = val; },
        components: new Map<K, { c: T, del: boolean }>(), 
        render(renderFnIn) {
            renderFn = renderFnIn;

            for (const block of this.components.values()) {
                block.del = true;
            }

            this.el.replaceChildren();

            updatedComponentList.splice(0, updatedComponentList.length);
            for (const block of this.components.values()) {
                block.del = true;
            }

            renderFnBinded();

            for (const [k, v] of this.components) {
                if (v.del) {
                    this.components.delete(k);
                }
            }

            // TODO: try writing a diff-replace algo and see if it's any faster
            this.el.replaceChildren(...updatedComponentList);
        },
    };
    return renderer;
}

type InsertableInput = Insertable<HTMLTextAreaElement> | Insertable<HTMLInputElement>;

export function setInputValueAndResize(inputComponent: InsertableInput, text: string) {
    setInputValue(inputComponent, text);
    resizeInputToValue(inputComponent);
}

/** This is how I know to make an input that auto-sizes to it's text */
export function resizeInputToValue(inputComponent: InsertableInput) {
    setAttr(inputComponent, "size", "" + inputComponent.el .value.length);
}

function wasHiddenOrUninserted(ins: Insertable) {
    return ins._isHidden || !ins.el.parentElement;
}

function checkForRenderMistake(ins: Insertable) {
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
export function setInputValue(component: InsertableInput, text: string) {
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


type ComponentState<T> = {
    /**
     * A getter that will assert that the args have actually been set
     * before returning them. This should be the case in 99% of normal use-cases
     */
    args: T;
    /** 
     * Use this to check if args has been set or not. 
     * You can't simply check {@link args} because it will throw an exception if
     * it hasn't been set yet.
     */
    hasArgs(): boolean;
}

/**
 * Typically used to store and get the last arguments a component got.
 * Stateless by default.
 */
export function newState<T = undefined>(initialValue: T | null = null) {
    let argsOrNull: T | null = initialValue;
    const state: ComponentState<T> = {
        hasArgs() { return argsOrNull !== null },
        set args(val: T) {
            argsOrNull = val;
        },
        get args() {
            if (argsOrNull === null) {
                // If u programmed it right you won't be seeing this error
                throw new Error("A component must be rendered with Args at least once before it's state can be accessed.");
            }

            return argsOrNull;
        }
    };

    return state;
}

/** 
 * Makes a 'component'.
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
export function newComponent<T, U extends Element>(root: Insertable<U>, renderFn: () => void, s: ComponentState<T> = newState()) {
    const component : Renderable<T, U> = {
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

export type RenderGroup = (<U extends Element, T extends Insertable<U>>(el: T, updateFn: (el: T) => any) => T) & {
    render: () => void;
    /** This is actually implemented with a SPAN and not a text node like you may have thought */
    text: (fn: () => string) => Insertable<HTMLSpanElement>;
    /** This is just a shortcut for code like `rg(Renderable(), (c) => c.render(undefined))`. */
    c: <U extends Element>(renderable: Renderable<unknown, U>) => Renderable<unknown, U>;
    /** {@link insFn} is a function that gets it's own render group as an input, which will only render if fn() returned true.  */
    if: <U extends HTMLElement | SVGElement>(fn: () => boolean, insFn: (rg: RenderGroup) => Insertable<U>) => Renderable<unknown, U>;
};

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
 */
export function newRenderGroup(): RenderGroup {
    const renderables: Renderable[] =  [];

    const push = <U extends Element, T extends Insertable<U>>(el: T, updateFn: (el: T) => void): T => {
        const c = newComponent(el, () => updateFn(el));
        renderables.push(c);
        return el;
    }

    const rg: RenderGroup = Object.assign(push, {
        render () {
            for (const r of renderables) {
                r.render(undefined);
            }
        },
        text: (fn: () => string): Insertable<HTMLSpanElement> => {
            const spanEl = span();
            return push(spanEl, () => setText(spanEl, fn()));
        },
        c: <U extends Element>(renderable: Renderable<unknown, U>): Renderable<unknown, U> => {
            renderables.push(renderable);
            return renderable;
        },
        if: <U extends HTMLElement | SVGElement>(fn: () => boolean, insFn: (rg: RenderGroup) => Insertable<U>): Renderable<unknown, U> => {
            const c = inlineComponent(insFn);
            return push(c, () => {
                if (setVisible(c, fn())) {
                    c.render(undefined);
                }
            });
        },
    });

    return rg;
}


/**
 * I find that while this is very concise, it's very hard to reason about. 
 * Render groups seem to give the best bang for buck in terms of simplicity and 
 * ease of use. (So I would avoid using this for now)
 */
function inlineComponent<T = undefined, U extends Element = Element>(
    insFunction: (rg: RenderGroup, state: ComponentState<T>) => Insertable<U>
) {
    const rg = newRenderGroup();
    const state = newState<T>();
    const root = insFunction(rg, state);
    return newComponent(root, rg.render, state);
}

export const __experimental__inlineComponent = inlineComponent;

export function newInsertable<T extends Element>(el: T): Insertable<T> {
    return  {
        el,
        _isHidden: false,
    };
}

export type Renderable<T = unknown, U extends Element = Element> = Insertable<U> & {
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
     *      on(button, "click", () => {
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
    render(args: T):void;
    state: ComponentState<T>;
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
export function scrollIntoViewV(
    scrollParent: HTMLElement, 
    scrollTo: Insertable<HTMLElement>, 
    scrollToRelativeOffset: number,
) {
    const scrollOffset = scrollToRelativeOffset * scrollParent.offsetHeight;
    const elementHeightOffset = scrollToRelativeOffset * scrollTo.el.getBoundingClientRect().height;

    // offsetTop is relative to the document, not the scroll container. lmao
    const scrollToElOffsetTop = scrollTo.el.offsetTop - scrollParent.offsetTop;

    scrollParent.scrollTop = scrollToElOffsetTop - scrollOffset  + elementHeightOffset;
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
