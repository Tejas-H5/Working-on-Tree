import "./htmlf.css";

export function assert(trueVal: any, ...msg: any[]): asserts trueVal {
    if (!trueVal) { 
        console.error(...msg); 
        throw new Error("assertion failed!"); 
    } 
};

// this used to be a typescript file, actually

// https://stackoverflow.com/questions/10730309/find-all-text-nodes-in-html-page
function __textNodesUnder(el: Element): Text[] {
    var n,
        a  = [],
        walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    while ((n = walk.nextNode())) {
        a.push(n as Text); // it is guaranteed that these will all be text nodes
    }
    return a;
};

// It doesn't work with tables.
// I haven't tried it, but it probably doesn't work with list items either
function __createHtmlElement<T extends HTMLElement>(html: string): T {
    html = html.trim();
    const createEl = document.createElement("div");

    createEl.innerHTML = html;

    if (createEl.children.length !== 1) {
        // TODO: don't log sensitive data in production
        throw new Error(`print html must exactly have 1 root node - "${html}"`);
    }

    return createEl.children[0] as T;
};

export function FormatDirectiveErrorComponent(directive: string, error: any) {
    return htmlf(
        `<div style="background-color:white;border:2px solid red;color: red; font-family: Arial, Helvetica, sans-serif;">
            <div>
                %{errorMsg}
            </div>
            <div style="code">
                %{error}
            </div>
        </div>`,
        {
            errorMsg: `An error occurred when instantiating %{${directive}}:`,
            error: () => `${error}`, // could potentially error again. when turning it into a string...
        }
    );
};

function __getHTMLElementForPercentVDirective(
    directiveName: string,
    componentOrHTMLfReturnVal: any
) {
    if (typeof componentOrHTMLfReturnVal === "function") {
        // error boundary implementation
        try {
            componentOrHTMLfReturnVal = componentOrHTMLfReturnVal();
        } catch (err) {
            componentOrHTMLfReturnVal = FormatDirectiveErrorComponent(
                directiveName,
                err
            );
        }
    }

    if (componentOrHTMLfReturnVal.el) {
        componentOrHTMLfReturnVal = componentOrHTMLfReturnVal.el
    }
    if (componentOrHTMLfReturnVal.el) {
        componentOrHTMLfReturnVal = componentOrHTMLfReturnVal.el
    }

    if (typeof componentOrHTMLfReturnVal === "string")
        return document.createTextNode(componentOrHTMLfReturnVal);
    if (componentOrHTMLfReturnVal instanceof Element)
        return componentOrHTMLfReturnVal;

    console.error(
`
Error with argument to %{${directiveName}}:
    Received ${componentOrHTMLfReturnVal} instead of an acceptable input.

Acceptable inputs include:
- objects with at least { el: domNode } 
- strings
- arrays of the above
- a function that returns one of the above when called
        - NOTE: only functions can be instantiated in multiple places in a template string
`, componentOrHTMLfReturnVal);

    throw("Error with format directive");
};

function __insertArgumentForPercentVDirective(
    arg: HTMLFormatArg,
    endNode: Element | Text,
    directiveName: string,
) {
    if (Array.isArray(arg)) {
        for (const e of arg) {
            __insertArgumentForPercentVDirective(e, endNode, directiveName);
        }

        return;
    }

    const el = __getHTMLElementForPercentVDirective(directiveName, arg);

    endNode.parentNode!.insertBefore(el, endNode);
};

export function pushElement<T>(group: T[], element: T): T {
    group.push(element);
    return element;
};

type HTMLFormatArgBase = string | Element | Insertable;
type HTMLFormatArg =
    | HTMLFormatArgBase
    | Array<HTMLFormatArgBase>
    | (() => HTMLFormatArgBase);

export function htmlf<T extends HTMLElement>(
    html: string,
    args?: { [argName: string]: HTMLFormatArg }
): InsertableGeneric<T> {
    const element = __createHtmlElement<T>(html);
    if (!args) {
        return { el: element };
    }

    const argsUsed = new Set<string>();

    const nodes = __textNodesUnder(element);
    for (let node of nodes) {
        let nodeValue = node.nodeValue || "";
        for (let i = 0; i < nodeValue.length; i++) {
            const couldBeFormatDirective =
                nodeValue[i] !== "%" || nodeValue[i + 1] !== "{";
            if (couldBeFormatDirective) {
                continue;
            }

            const isEscaped = nodeValue[i - 1] === "\\";
            if (isEscaped) {
                continue;
            }

            const nameStart = i + 2;
            const nameEnd = nodeValue.indexOf("}", nameStart);
            if (nameEnd === -1) {
                const directiveApproxName = nodeValue.substring(i, i + 10);

                throw new Error(
                    `Couldn't find closing '}' for format directive ${directiveApproxName}`
                );
            }

            const directiveName = nodeValue.substring(nameStart, nameEnd);
            if (!(directiveName in args)) {
                throw new Error(
                    `Couldn't find format argument for ${directiveName}`
                );
            }

            const arg = args[directiveName];
            const node2 = node.splitText(i);
            __insertArgumentForPercentVDirective(arg, node2, directiveName);

            argsUsed.add(directiveName);

            node = node2;
            node.nodeValue = nodeValue.substring(nameEnd + 1);
            nodeValue = node.nodeValue || "";
            i = -1; //-1 to account for the for-loop incrementing this.
        }
    }

    for (const key in args) {
        if (!argsUsed.has(key)) {
            console.warn(`Format directive was provided in args, but was never used: ${key}`);
        }
    }

    return { el: element };
};

export type InsertableGeneric<T extends HTMLElement> = { el: T };
export type Insertable = InsertableGeneric<HTMLElement>

export function replaceChildren(comp: Insertable, ...children: Insertable[]) {
    comp.el.replaceChildren(...children.map((c) => c.el));
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

export function setAttr(
    component: Insertable, 
    attribute: string, 
    value: string,
) {
    component.el.setAttribute(attribute, value);
};


export function copyStyles(src: Insertable, dst: Insertable) {
    const styles = getComputedStyle(src.el);
    for (const style of styles) {
        const srcEl = src.el;
        const dstEl = dst.el;

        // @ts-ignore
        dstEl.style[style] = srcEl.style[style];
    }
};

export function setVisible(component: Insertable, state: boolean): boolean {
    return !setClass(component, "hidden", !state);
}

type ComponentPool<T extends Insertable> = {
    components: T[];
    resize(n: number): void;
}

export function makeComponentList<T extends Insertable>(root: Insertable, createFn: () => T): ComponentPool<T> {
    return {
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
        }
    }
}


export function setInputValueAndResize (inputComponent: Insertable, text: string) {
    setInputValue(inputComponent, text);
    resizeInputToValue(inputComponent);
}

export function resizeInputToValue(inputComponent: Insertable) {
    inputComponent.el.setAttribute("size", "" + (inputComponent.el as HTMLInputElement).value.length);
}

export function setTextContent(component: Insertable, text: string) {
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
 * A component is exactly like a `htmf` return value in that it can be inserted into the dom with `htmf`, but
 * it also has a `rerender` function that can be used to hydrate itself, and possibly it's children.
 * You would need to do this yourself in renderFn, however.
 * 
 * @param root is a return-value from `htmf` that will be the root dom-node of this component
 * @param renderFn is called each time to rerender the comopnent.
 * 
 * It stores args in the `args` object, so that any event listeners can update their behaviours when the main
 * component re-renders.
 */
export function makeComponent<T>(root: Insertable, renderFn: () => void) {
    const component : Renderable<T> = {
        ...root,
        // @ts-ignore this is always set before we render the component
        args: null,
        rerender: function(argsIn) {
            component.args = argsIn;
            renderFn();
        },
    };

    return component;
}

export type Renderable<T> = Insertable & {
    args: T;
    rerender(args: T):void;
}