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

export type InsertableGeneric<T extends HTMLElement | Text> = { el: T };
export type Insertable = InsertableGeneric<HTMLElement>

export function replaceChildren(comp: Insertable, ...children: (Insertable | undefined)[]) {
    comp.el.replaceChildren(
        ...children.filter(c => !!c).map((c) => c!.el)
    );
};

export function appendChild(mountPoint: Insertable, child: Insertable) {
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

export function setClass(
    component: Insertable,
    cssClass: string,
    state: boolean,
): boolean {
    if (state) {
        component.el.classList.add(cssClass);
    } else {
        component.el.classList.remove(cssClass);
    }

    return state;
};

export function setVisible(component: Insertable, state: boolean): boolean {
    if (state) {
        component.el.style.setProperty("display", "", "")
    } else {
        component.el.style.setProperty("display", "none", "important")
    }
    return state;
}

type ComponentPool<T extends Insertable> = {
    components: T[];
    resize(n: number): void;
}

type ValidAttributeName = string;

/** 
 * Any name and string is fine, but I've hardcoded a few for autocomplete. 
 * A common bug is to type 'styles' instead of 'style' and wonder why the layout isn't working
 */
type Attrs = { [qualifiedName: ValidAttributeName]: string } & {
    style?: string;
    class?: string;
    href?: string;
    src?: string;
}

/**
 * Creates an element, gives it some attributes, then appends it's children.
 * This is all you need for 99.9% of web dev use-cases
 */
export function el<T extends HTMLElement>(type: string, attrs?: Attrs, children?: (Insertable | string)[]): InsertableGeneric<T> {
    const element = document.createElement(type);

    if (attrs) {
        for (const attr in attrs) { 
            element.setAttribute(attr, attrs[attr]);
        }
    }

    if (children) {
        for(const c of children) {
            if (typeof c === "string") {
                element.appendChild(document.createTextNode(c));
            } else {
                element.appendChild(c.el);
            }
        }
    }

    return {
        el: element as T
    };
}

/**
 * Creates a div, gives it some attributes, and then appends some children. 
 * I use this instead of {@link el} 90% of the time
 */
export function div(attrs?: Attrs, children?: (Insertable | string)[]) {
    return el<HTMLDivElement>("DIV", attrs, children);
}

export function makeComponentList<T extends Insertable>(root: Insertable, createFn: () => T): Insertable & ComponentPool<T> {
    return {
        el: root.el,
        components: [],
        resize(newLength) {
            if (newLength < 0) {
                throw new Error("Can't resize list to a negative length! You might have an error in some math you're doing");
            }

            while(this.components.length > newLength) {
                // could also just hide these with setVisible(false)
                const component = this.components.pop()!;
                component.el.remove();
            } 
            
            while (this.components.length < newLength) {
                // could also just show these with setVisible(true)
                const component = createFn();
                this.components.push(component);
                appendChild(root, component);
            }

            if (this.components.length !== newLength) {
                assert(false, "Error with component pool resizing");
            }
        },
        // TODO: Smarter algorithm that adds/removes at arbitrary positions based on keys
    }
}

export function setInputValueAndResize(inputComponent: Insertable, text: string) {
    setInputValue(inputComponent, text);
    resizeInputToValue(inputComponent);
}

/** This is how I know to make an input that auto-sizes to it's text */
export function resizeInputToValue(inputComponent: Insertable) {
    inputComponent.el.setAttribute("size", "" + (inputComponent.el as HTMLInputElement).value.length);
}

export function setTextContent(component: Insertable, text: string) {
    // @ts-ignore
    if (component.rerender) {
        console.warn("You might be overwriting a component's internal contents by setting it's text");
    };
    if (component.el.textContent === text) {
        // Actually a huge performance speedup!
        return;
    }

    component.el.textContent = text;
};

/** NOTE: assumes that component.el is an HTMLInputElement */
export function setInputValue(component: Insertable, text: string) {
    const inputElement = component.el as HTMLInputElement;

    // Yeah, its up to you to call it on the right component. 
    // I don't want to add proper types here, because I can't infer the type `htmlf` will return
    if (inputElement.value === text) {
        // might be a huge performance speedup! ?
        return;
    }

    // @ts-ignore 
    inputElement.value = text;
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
 */
export function makeComponent<T = undefined>(root: Insertable, renderFn: () => void) {
    const component : Renderable<T> = {
        ...root,
        // @ts-ignore this is always set before we render the component
        args: null,
        render: function(argsIn) {
            component.args = argsIn;
            renderFn();
        },
    };

    return component;
}

export type Renderable<T = undefined> = Insertable & {
    args: T;
    render(args: T):void;
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
