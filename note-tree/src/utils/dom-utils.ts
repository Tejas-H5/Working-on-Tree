/**
   
// Component boilerplate snippet:
// If you use VS-Code, there's already a code snippet in this project for this.
// Vim users will have to copy-paste this and :s/CN/NewName/g over it

type CNArgs = {

}

function CN<CNArgs>() {
    const root = div();

    const component = makeComponent<CNArgs>(root, () => {
        const { } = component.args;

    });

    return component;
}
   
*/

export function assert(trueVal: any, ...msg: any[]): asserts trueVal {
    if (!trueVal) { 
        console.error(...msg); 
        throw new Error("assertion failed!"); 
    } 
};

export type InsertableGeneric<T extends HTMLElement | Text> = { 
    el: T;
    _isInserted: boolean;
};
export type Insertable = InsertableGeneric<HTMLElement>

export function replaceChildren(comp: Insertable, children: (Insertable | undefined)[]) {
    comp.el.replaceChildren(
        ...children.filter(c => !!c).map((c) => {
            c!._isInserted = true;
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

    child._isInserted = true;
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
export function setStyle<K extends keyof HTMLElement["style"]>(root: Insertable, val: K, style: HTMLElement["style"][K]) {
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

export function setVisibleGroup(state: boolean, groupIf: Insertable[], groupElse?: Insertable[]) {
    for (const i of groupIf) {
        setVisible(i, state);
    }

    if (groupElse) {
        for (const i of groupElse) {
            setVisible(i, !state);
        }
    }
}

export function setVisible(component: Insertable, state: boolean | null | undefined): boolean {
    if (state) {
        component.el.style.setProperty("display", "", "")
    } else {
        component.el.style.setProperty("display", "none", "important")
    }
    return !!state;
}

// This is a certified jQuery moment: https://stackoverflow.com/questions/19669786/check-if-element-is-visible-in-dom
export function isVisible(component: Insertable): boolean {
    const e = component.el;
    return !!( e.offsetWidth || e.offsetHeight || e.getClientRects().length );
}

type ComponentPool<T extends Insertable> = {
    components: T[];
    lastIdx: number;
    getNext(): T;
    getIdx(): number;
    render(renderFn: () => void | Promise<void>, noErrorBoundary?: boolean): void | Promise<void>;
}

type KeyedComponentPool<K, T extends Insertable> = {
    components: Map<K, { c: T, del: boolean }>;
    getNext(key: K): T;
    render(renderFn: () => void, noErrorBoundary?: boolean): void;
}

type ValidAttributeName = string;

/** 
 * Any name and string is fine, but I've hardcoded a few for autocomplete. 
 * A common bug is to type 'styles' instead of 'style' and wonder why the layout isn't working
 */
type Attrs = { [qualifiedName: ValidAttributeName]: string | undefined } & {
    style?: string;
    class?: string;
    href?: string;
    src?: string;
}

/** 
 * Useful for when you need to append to attributes/children 
 * on an Insertable returned by a function
 */
export function initEl<T extends Insertable>(
    ins: T,
    attrs?: Attrs,
    children?: ChildList,
): T {
    const element = ins.el;

    if (attrs) {
        for (const attr in attrs) { 
            const val = attrs[attr];
            if (val === undefined) {
                element.removeAttribute(attr);
            } else {
                element.setAttribute(attr, (element.getAttribute(attr) || "") + val);
            }
        }
    }

    if (children) {
        for(const c of children) {
            if (Array.isArray(c)) {
                for (const insertable of c) {
                    element.appendChild(insertable.el);
                    insertable._isInserted = true;
                }
            } else if (typeof c === "string") {
                element.appendChild(document.createTextNode(c));
            } else {
                element.appendChild(c.el);
                c._isInserted = true;
            }
        }
    }

    return ins;
}

/**
 * Creates an element, gives it some attributes, then appends it's children.
 * This is all you need for 99.9% of web dev use-cases
 */
export function el<T extends HTMLElement>(
    type: string, 
    attrs?: Attrs,
    children?: ChildList,
): InsertableGeneric<T> {
    const element = document.createElement(type);

    const insertable: InsertableGeneric<T> = {
        el: element as T,
        _isInserted: false,
    };


    initEl(insertable, attrs, children);

    return insertable;
}

export type ChildList = (Insertable | string | Insertable[])[];

/**
 * Creates a div, gives it some attributes, and then appends some children. 
 * I use this instead of {@link el} 90% of the time
 */
export function div(attrs?: Attrs, children?: ChildList) {
    return el<HTMLDivElement>("DIV", attrs, children);
}

// NOTE: function might be removed later
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

    return undefined;
}

export type ComponentList<T extends Insertable> = Insertable & ComponentPool<T>;

export type KeyedComponentList<K, T extends Insertable> = Insertable & KeyedComponentPool<K, T>;

export function newListRenderer<T extends Insertable>(root: Insertable, createFn: () => T): ComponentList<T> {
    return {
        ...root,
        components: [],
        lastIdx: 0,
        getIdx() {
            // (We want to get the index of the current iteration, not the literal value of lastIdx)
            return this.lastIdx - 1;
        },
        getNext() {
            if (this.lastIdx > this.components.length) {
                throw new Error("Something strange happened when resizing the component pool");
            }

            if (this.lastIdx === this.components.length) {
                // could also just show these with setVisible(true)
                const component = createFn();
                this.components.push(component);
                appendChild(root, component);
            }

            return this.components[this.lastIdx++];
        },
        render(renderFn, noErrorBoundary = false) {
            this.lastIdx = 0;

            let res;
            if (noErrorBoundary) {
                res = renderFn();
            } else {
                res = handleRenderingError(this, renderFn);
            }

            while(this.components.length > this.lastIdx) {
                // could also just hide these with setVisible(false)
                const component = this.components.pop()!;
                component.el.remove();
            } 

            return res;
        },
    }
}

export function newKeyedListRenderer<K, T extends Insertable>(root: Insertable, createFn: () => T): KeyedComponentList<K, T> {
    const updatedComponentList : HTMLElement[] = [];
    return {
        ...root,
        components: new Map<K, { c: T, del: boolean }>(), 
        getNext(key: K) {
            const block = this.components.get(key);
            if (block) {
                block.del = false;
                return block.c;
            }

            const newComponent = createFn();
            this.components.set(key, { c: newComponent, del: false });
            return newComponent;
        },
        render(renderFn, noErrorBoundary = false) {
            for (const block of this.components.values()) {
                block.del = true;
            }

            if (noErrorBoundary) {
                renderFn();
            } else {
                handleRenderingError(this, renderFn);
            }

        
            updatedComponentList.splice(0, updatedComponentList.length);
            for (const block of this.components.values()) {
                if (!block.del) {
                    updatedComponentList.push(block.c.el);
                }
                block.del = true;
            }

            // TODO: try writing a diff-replace algo and see if it's any faster
            this.el.replaceChildren(...updatedComponentList);
        },
    };
}

type InsertableInput = InsertableGeneric<HTMLTextAreaElement> | InsertableGeneric<HTMLInputElement>;

export function setInputValueAndResize(inputComponent: InsertableInput, text: string) {
    setInputValue(inputComponent, text);
    resizeInputToValue(inputComponent);
}

/** This is how I know to make an input that auto-sizes to it's text */
export function resizeInputToValue(inputComponent: Insertable) {
    inputComponent.el.setAttribute("size", "" + (inputComponent.el as HTMLInputElement).value.length);
}

/** 
 * A LOT faster than just setting the text content manually.
 *
 * However, there are some niche use cases (100,000+ components) where you might need even more performance. 
 * In those cases, you will want to avoid calling this function if you know the text hasn't changed.
 */
export function setText(component: Insertable, text: string) {
    // @ts-ignore
    if (component.rerender) {
        console.warn("You might be overwriting a component's internal contents by setting it's text");
    };

    if (!component._isInserted) {
        console.warn("A component hasn't been inserted into the DOM, but it's being rendered anway");
    }

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

/** 
 * Makes a 'component'.
 * A component is exactly like a {@link el} return value in that it can be inserted into the dom with {@link el}, but
 * it also has a `rerender` function that can be used to hydrate itself, and possibly it's children.
 * You would need to do this yourself in renderFn, however.
 * 
 * @param root is a return-value from {@link el} that will be the root dom-node of this component
 * @param renderFn is called each time to rerender the comopnent.
 * 
 * It stores args in the `args` object, so that any event listeners can update their behaviours when the main
 * component re-renders.
 *
 */
export function newComponent<T = undefined>(root: Insertable, renderFn: () => void | Promise<void>) {
    // We may be wrapping another component, i.e reusing it's root. So we should just do this
    root._isInserted = true;
    const component : Renderable<T> = {
        ...root,
        _isInserted: false,
        // @ts-ignore this is always set before we render the component
        args: null,
        render(argsIn, noErrorBoundary = false) {
            if (!this._isInserted) {
                console.warn("A component hasn't been inserted into the DOM, but it's being rendered anway");
                return
            }

            component.args = argsIn;
            if (noErrorBoundary) {
                return renderFn();
            } else {
                return handleRenderingError(this, renderFn);
            }
        },
    };

    return component;
}

export type Renderable<T = undefined> = Insertable & {
    args: T;
    render(args: T, noErrorBoundary?: boolean):void | Promise<void>;
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
    scrollTo: Insertable, 
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
