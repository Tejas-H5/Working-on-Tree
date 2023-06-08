const assert = (trueVal, ...msg) => {
    if (!trueVal) { 
        console.error(...msg); 
        throw new Error("assertion failed!"); 
    } 
};
const assertEqual = (a, b, ...msg) => {
    assert(a === b, `${a} !== ${b}, fucking hell` ,...msg)
}
const unreachable = () => assert(false, "Unreachable code was reached!");

// https://stackoverflow.com/questions/10730309/find-all-text-nodes-in-html-page
const __textNodesUnder = (el) => {
    var n,
        a = [],
        walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    while ((n = walk.nextNode())) a.push(n);
    return a;
}

const getCreateElement = (html) => {
    return document.createElement("div");
}

// It doesn't work with tables. 
// I haven't tried it, but it probably doesn't work with list items either
/** @returns { HTMLElement } */
const __createHtmlElement = (html) => {
    html = html.trim();
    const createEl = getCreateElement(html);

    createEl.innerHTML = html;

    assert(createEl.childNodes.length === 1, `print html must exactly have 1 root node - "${html}"`, createEl.childNodes);

    return createEl.childNodes[0];
}

const __textAt = (str, pos, comparison) => {
    for(let i = 0; i < comparison.length; i++) {
        if (str[pos + i] !== comparison[i]) return false;
    }

    return true;
}

const __getHtmlfArg = (args, i, copyFunc) => {
    if (copyFunc !== null)
        return copyFunc;

    assert(i < args.length, "Too many formatting directives, or not enough formatting args");
    return args[i];
}

/** @returns { HTMLElement } */
const __getHTMLElementForComponentFormatDirective = (componentOrHTMLfReturnVal, errorMsg) => {
    if (typeof componentOrHTMLfReturnVal === typeof "string") return document.createTextNode(componentOrHTMLfReturnVal);
    if (componentOrHTMLfReturnVal.el) return componentOrHTMLfReturnVal.el;
    if (componentOrHTMLfReturnVal[0] && componentOrHTMLfReturnVal[0].el) return componentOrHTMLfReturnVal[0].el;

    throw new Error(errorMsg);
}

// We don't care about performance here. I have made this purely for a bit of a laugh.
// The funny thing is that it is a somewhat valid way to avoid xss, because we are creating text nodes
// rather than putting it directly into the string like `${malicious_code}`.
// I hate that this is actually a good API, the more I use it

/** @augments htmlf */
const htmlf_internal = (html, ...args) => {
    const element = __createHtmlElement(html);
    if (args.length === 0) {
        return [{ el: element }];
    }

    const nodes = __textNodesUnder(element);
    let currentArgIdx = 0;
    for(let node of nodes) {
        let text = node.nodeValue;
        for(let i = 0; i < text.length; i++) {
            if (text[i] !== "%") continue;

            const formattingDirective = text[i + 1];
            if (
                formattingDirective !== "c" &&  // component, (any JS object with { el: HTMLElement } shape).
                formattingDirective !== "a" &&  // array. inserts multiple things to the dom
                formattingDirective !== "r"     // raw. just throw it in and see what happens. useful for inserting raw dom nodes when inter-operating with other things
            ) {
                throw new Error(`invalid formatting directive - %${formattingDirective || "<end of string>"}`);
            }

            assert(currentArgIdx < args.length, "Too few format args provided to htmlf - " + `${args}`);

            let arg = args[currentArgIdx];

            let componentsToInsert;
            if(formattingDirective === "c") {
                componentsToInsert = [
                    __getHTMLElementForComponentFormatDirective(
                        arg, 
                        "object", `%c wants components (like { el: html element, ... }) or [ component ], instead we got ${typeof arg} [${arg}]`
                    )
                ];
            } else if(formattingDirective === "a") {
                assert(Array.isArray(arg), `%a wants an array, instead we got ${typeof arg} [${arg}]`);
                componentsToInsert = Array(arg.length);
                for (let i = 0; i < arg.length; i++) {
                    const thing = arg[i];
                    const component = __getHTMLElementForComponentFormatDirective(
                        thing, 
                        `%a wants components like ({ el: html element, ... }) or [ component ] in the array, instead we got ${typeof thing}} [${thing}] at index ${i}`
                    );

                    componentsToInsert[i] = component;
                }
            } else if (formattingDirective === "r") {
                // who knows what this could be ? :thinking:
                componentsToInsert = [arg];
            } else {
                unreachable();
            }

            // insert this thing precisely where we found the formatting directive for it
            const node2 = node.splitText(i);
            for(let j = 0; j < componentsToInsert.length; j++) {
                const component = componentsToInsert[j];
                if (component === null) continue;

                node2.parentNode.insertBefore(component, node2);
            }
            node = node2;
            node.nodeValue = node.nodeValue.substring(2);
            text = node.nodeValue;
            i = -1; //-1 to account for the for-loop incrementing this.
            currentArgIdx++;
        }
    }

    assert(currentArgIdx === args.length, "Too few format directive args were provided");
    return [{ el: element }, args];
};

/** 
 * Place components in a html tree with surgical precision using printf-like semantics.
 * Just stay away from anything table related, and you should be good. 
 * 
 * %c -> inserts a component or a string.
 *      A component is any object with the shape { el: HTMLNode }.
 *      Arrays like [ { el: HTMLNode }] will also get unwrapped 1 level, because we often want to feed the result of htmlf back into itself.
 * 
 * %a -> inserts an array of components
 * 
 * %r -> inserts a raw html dom node
 * 
 * 
 * 
 * Note: htmlf doesn't work like a typical printf -
 *      it can only replace formatting directives that are between tags, and not inside tags, like attributes.
 * 
 * @example
 * // this works just fine
 * const [root] = htmlf("<div>%s</div>", userInput);                                        
 * // this works just fine too
 * const [root, [bold]] = htmlf("<div>Hello, %c</div>", htmlf("<b>%s</b>", userInput));     
 * // this won't work, because %s is inside a tag.
 * const [root] = htmlf(`<div style="color:%s">hello</div>`, userInputtedColor)             
 * 
 * @returns {[{ el: HTMLElement }, [args]]}
 *  */
const htmlf = (html, ...args) => {
    return htmlf_internal(html, ...args);
}

/** @returns {{ el: HTMLElement }} */
const __assertIsComponent = (obj) => {
    assert(obj && obj.el, `assertion obj.el && obj.el instanceof HTMLElement failed for obj: ${obj} [typeof ${typeof obj}] `);
    return obj;
}

const array = (n, fn) => [...Array(n)].map(fn);

const replaceChildren1 = (comp, children) => {
    comp.el.replaceChildren(children.map(c => c.el));
}

const replaceChildren2 = (comp, children) => {
    const parent = comp.el;
    const existing = parent.childNodes;

    // add or replace new nodes, while ignoring unchanged ones
    for(let i = 0; i < children.length; i++) {
        const child = children[i].el;
        if (existing[i] === child) {
            continue;
        }

        if (i < existing.length) {
            parent.replaceChild(child, existing[i]);
        } else {
            parent.appendChild(child);
        }
    }

    // remove existing nodes till we have the same length
    let excess = existing.length - children.length;
    for(let i = 0; i < excess; i++) {
        existing[children.length + excess - i - 1].remove();
    }
}

const appendChild = (mountPoint, child) => {
    const mountComponent = __assertIsComponent(mountPoint);
    mountComponent.el.appendChild(child.el);
}

const removeChild = (mountPoint, child) =>{
    child.el.remove();
}

const clearChildren = (mountPoint) => {
    mountPoint.el.replaceChildren();
}

const setVisible = (component, state) => {
    if (state) {
        component.el.classList.remove("hidden");
    } else {
        component.el.classList.add("hidden");
    }
    return state;
}

const setClass = (component, cssClass, state) => {
    if (state) {
        component.el.classList.add(cssClass);
    } else {
        component.el.classList.remove(cssClass);
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

const eventListener = (component, event, fn) => {
    __assertIsComponent(component);
    component.el.addEventListener(event, fn);
}

const setTextContent = (component, text) => {
    if (component.el.textContent !== text) {
        component.el.textContent = text;    // a huge performance speedup!
    }
}

const setInputValue = (component, text) => {
    if (component.el.value !== text) {
        component.el.value = text;    // a huge performance speedup ? not sure here actually
    }
}

const setInputValueAndResize = (inputComponent, text) => {
    setInputValue(inputComponent, text);
    resizeInputToValue(inputComponent);
}

const resizeInputToValue = (inputComponent) => {
    inputComponent.el.setAttribute("size", inputComponent.el.value.length);
}

// TODO: implement this
const __updateCachedMap = (root, data, keyFn, map, initFn) => {
    const dontDelete = new Set();
    
    for(let i = 0; i < data.length; i++) {
        const key = keyFn(data[i]);
        if (!map.has(key)) {
            map[key] = initFn();
        }

        dontDelete.add(key);
    }

    // TODO: delete from map where not in dontDelete.
}

const copyStyles = (src, dst) => {
    const styles = getComputedStyle(src.el);
    for(const style of styles) {
        dst.el.style[style] = styles[style]
    }
}