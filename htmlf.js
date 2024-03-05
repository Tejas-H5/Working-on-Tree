const assert = (trueVal, ...msg) => {
    if (!trueVal) { 
        console.error(...msg); 
        throw new Error("assertion failed!"); 
    } 
};

// this used to be a typescript file, actually

// https://stackoverflow.com/questions/10730309/find-all-text-nodes-in-html-page
// const __textNodesUnder = (el: Element) => {
const __textNodesUnder = (el) => {
    var n,
        a = [],
        walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    while ((n = walk.nextNode())) {
        // a.push(<Text>n); // it is guaranteed that these will all be text nodes
        a.push(n); // it is guaranteed that these will all be text nodes
    }
    return a;
};

// It doesn't work with tables.
// I haven't tried it, but it probably doesn't work with list items either
// const __createHtmlElement = (html: string): Element => {
const __createHtmlElement = (html) => {
    html = html.trim();
    const createEl = document.createElement("div");

    createEl.innerHTML = html;

    if (createEl.children.length !== 1) {
        // TODO: don't log sensitive data in production
        throw new Error(`print html must exactly have 1 root node - "${html}"`);
    }

    return createEl.children[0];
};

// const FormatDirectiveErrorComponent = (directive: string, error: any) => {
const FormatDirectiveErrorComponent = (directive, error) => {
    return fmt(
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

const __getHTMLElementForPercentVDirective = (
    // directiveName: string,
    // componentOrHTMLfReturnVal: any
    directiveName,
    componentOrHTMLfReturnVal,
) => {
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

const __insertArgumentForPercentVDirective = (
    // arg: HTMLFormatArg,
    // endNode: Element | Text,
    // directiveName: string,
    arg,
    endNode,
    directiveName,
) => {
    if (Array.isArray(arg)) {
        for (const e of arg) {
            __insertArgumentForPercentVDirective(e, endNode, directiveName);
        }

        return;
    }

    const el = __getHTMLElementForPercentVDirective(directiveName, arg);

    // endNode.parentNode!.insertBefore(el, endNode);
    endNode.parentNode.insertBefore(el, endNode);
};

// const pushElement = <T>(group: T[], element: T): T => {
const pushElement = (group, element) => {
    group.push(element);
    return element;
};

// type HTMLFormatArgBase = string | Element | Component;
// type HTMLFormatArg =
//     | HTMLFormatArgBase
//     | Array<HTMLFormatArgBase>
//     | (() => HTMLFormatArgBase);

const htmlf = (
    // html: string,
    // args?: { [argName: string]: HTMLFormatArg }
    html,
    args,
// ): Component => {
) => {
    const element = __createHtmlElement(html);
    if (!args) {
        return { el: element };
    }

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

            node = node2;
            node.nodeValue = nodeValue.substring(nameEnd + 1);
            nodeValue = node.nodeValue || "";
            i = -1; //-1 to account for the for-loop incrementing this.
        }
    }

    return { el: element };
};

// export type Component = { el: Element };

// const replaceChildren = (comp: Component, ...children: Component[]) => {
const replaceChildren = (comp, ...children) => {
    comp.el.replaceChildren(...children.map((c) => c.el));
};

const appendChild = (mountPoint, child) => {
    mountPoint.el.appendChild(child.el);
};

const removeChild = (mountPoint, child) => {
    const childParent = child.el.parentElement;
    if (!childParent) {
        return;
    }

    if (childParent !== mountPoint.el) {
        throw new Error("This component is not attached to this parent");
    }

    child.el.remove();
};

const clearChildren = (mountPoint) => {
    mountPoint.el.replaceChildren();
};

const setClass = (
    component,
    cssClass,
    state
) => {
    if (state) {
        component.el.classList.add(cssClass);
    } else {
        component.el.classList.remove(cssClass);
    }

    return state;
};

const setAttr = (component, attribute, value) => {
    component.el.setAttribute(attribute, value);
};


const copyStyles = (src, dst) => {
    const styles = getComputedStyle(src.el);
    for (const style of styles) {
        const srcEl = src.el;
        const dstEl = dst.el;

        // @ts-ignore
        dstEl.style[style] = srcEl.style[style];
    }
};

const eventListener = (component, event, fn) => {
    component.el.addEventListener(event, fn);
}

const setVisible = (component, state) => {
    if (state) {
        component.el.classList.remove("hidden");
    } else {
        component.el.classList.add("hidden");
    }
    return state;
}



const resizeComponentPool = (root, compPool, newLength, createFn) => {
    while(compPool.length > newLength) {
        // could also just hide these with setVisible(false)
        const component = compPool.pop();
        component.el.remove();
    } 
    
    while (compPool.length < newLength) {
        // could also just show these with setVisible(true)
        const component = createFn();
        compPool.push(component);
        appendChild(root, component);
    }

    if (compPool.length !== newLength) {
        assert("Holy frick");
    }
}

const setInputValueAndResize = (inputComponent, text) => {
    setInputValue(inputComponent, text);
    resizeInputToValue(inputComponent);
}

const resizeInputToValue = (inputComponent) => {
    inputComponent.el.setAttribute("size", inputComponent.el.value.length);
}

const setTextContent = (component, text) => {
    if (component.el.textContent === text) {
        // Actually a huge performance speedup!
        return;
    }

    component.el.textContent = text;
};

/** NOTE: assumes that component.el is an HTMLInputElement */
const setInputValue = (component, text) => {
    const inputElement = component.el;

    if (inputElement.value === text) {
        // might be a huge performance speedup! ?
        return;
    }

    inputElement.value = text;
};