const assert = (trueVal, msg) => {if (!trueVal) { throw new Error(msg); } };
const unreachable = () => assert(false, "Unreachable code was reached!");

// https://stackoverflow.com/questions/10730309/find-all-text-nodes-in-html-page
const __textNodesUnder = (el) => {
    var n,
        a = [],
        walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    while ((n = walk.nextNode())) a.push(n);
    return a;
}


/** @returns { HTMLElement } */
const __createHtmlElement = (html) => {
    let dst = document.createElement("div");
    dst.innerHTML = html.trim();

    assert(dst.childNodes.length === 1, "print html must only have 1 root node");

    return dst.childNodes[0];
}


// /** @returns {Object<string, HTMLElement>} */
// const createComponent = (mountPoint, html) => {
//     const createDiv = document.createElement("div");
//     createDiv.innerHTML = html.trim();

//     const selectedNodes = {};
//     createDiv.querySelectorAll("[--id]").forEach((sel) => {
//         const names = sel.getAttribute("--id");
//         sel.removeAttribute("--id");
//         names.split(' ').forEach(name => {
//             selectedNodes[name] = sel;
//         });
//     });

//     selectedNodes["root"] = createDiv.childNodes[0];

//     appendChildren(mountPoint, createDiv.childNodes);

//     return selectedNodes;
// };



const __textAt = (str, pos, comparison) => {
    for(let i = 0; i < comparison.length; i++) {
        if (str[pos + i] !== comparison[i]) return false;
    }

    return true;
}

const __getPrintfArg = (args, i, copyFunc) => {
    if (copyFunc !== null)
        return copyFunc;

    assert(i < args.length, "Too many formatting directives, or not enough formatting args");
    return args[i];
}

// We don't care about performance here. I have made this purely for a bit of a laugh.
// The funny thing is that it is a somewhat valid way to avoid xss, because we are creating text nodes
// rather than putting it directly into the string like `${malicious_code}`.
// I hate that this is actually a good API, the more I use it

/** @augments printf */
const printf_internal = (html, ...args) => {
    const element = __createHtmlElement(html);
    if (args.length === 0) {
        return { el: element };
    }

    const nodes = __textNodesUnder(element);
    let currentArgIdx = 0;
    for(let node of nodes) {
        let text = node.nodeValue;
        for(let i = 0; i < text.length; i++) {
            if (text[i] !== "%") continue;

            const formattingDirective = text[i + 1];
            if (
                formattingDirective !== "s" &&  // string. gets escaped with document.createTextNode
                formattingDirective !== "c" &&  // component, (any JS object with { el: HTMLElement } shape).
                formattingDirective !== "a" &&  // array. inserts multiple things to the dom
                formattingDirective !== "r"     // raw. just throw it in and see what happens. useful for inserting raw dom nodes when inter-operating with other things
            ) {
                throw new Error(`invalid formatting directive - %${formattingDirective || "<end of string>"}`);
            }

            assert(currentArgIdx < args.length, "Too few format args provided to printf - " + `${args}`);

            let arg = args[currentArgIdx];
            
            let thingToInsert;
            if (formattingDirective === "s") {
                thingToInsert = document.createTextNode(arg);
            } else if(formattingDirective === "c") {
                assert(typeof arg.el === "object", `%c wants { el: html element, ... }, instead we got ${typeof arg.el} [${arg.el}]`);
                thingToInsert = arg.el;
            } else if(formattingDirective === "a") {
                assert(Array.isArray(arg), `%a wants an array of { el: html element, ... }, instead we got ${typeof arg} [${arg}]`);
                thingToInsert = arg;
            } else if (formattingDirective === "r") {
                // who knows what this could be ? :thinking:
                thingToInsert = arg;
            } else {
                unreachable();
            }

            // insert this thing precisely where we found the formatting directive for it
            const node2 = node.splitText(i);
            if (Array.isArray(thingToInsert)) {
                for(const thing of thingToInsert) {
                    if (thing === null) continue;
                    node2.parentNode.insertBefore(thing.el, node2);
                }
            } else {
                node2.parentNode.insertBefore(thingToInsert, node2);
            }
            node = node2;
            node.nodeValue = node.nodeValue.substring(2);
            text = node.nodeValue;
            i = -1; //-1 to account for the for-loop incrementing this.
            currentArgIdx++;
        }
    }

    assert(currentArgIdx === args.length, "Too few format directive args were provided");
    return { el: element };
};

/** 
 * Place components in a html tree with surgical precision using printf-like semantics.
 * %s -> formats as a string. Will just do document.createTextNode(`${arg}`) to your directive.
 * %c -> inserts a component. Wil 
 * 
 * Note: Doesn't work like normal printf, it can only replace formatting directives that are between tags, and not inside tags, like attributes.
 * 
 * @example
 * printf("<div>%s</div>", userInput);  // this works just fine
 * printf(`<div style="color:%s"`>%s</div>, userColor, userInput) // this won't work, because the first %s is inside a tag.
 * printf("<div>Hello, %c</div>", printf("<b>%s</b>", userInput));  // this works just fine too
 * 
 *  */
const printf = (html, ...args) => {
    if (html === "<div></div>") {
        return { el: document.createElement("div") };
    }
    if (html === "<span></span>") {
        return { el: document.createElement("span") };
    }

    return printf_internal(html, ...args);
}

// I am still debating whether this is even needed or not
// /** @returns {{ el: HTMLElement, selected: Object<string, HTMLElement> }} */
// const create = (html, initFn) => {
//     const element = __createHtmlElement(null, html);

//     const selectedNodes = {};
//     selectedNodes[element.tagName.toLowerCase()] = element;
//     for(const sel of element.querySelectorAll("[--id]")) {
//         const names = sel.getAttribute("--id");
//         sel.removeAttribute("--id");
//         for(const name of names.split(' ')) {
//             selectedNodes[name] = sel;
//         }
//     }

//     initFn(selectedNodes);

//     return { el: element, selected: selectedNodes };
// };


const array = (n, fn) => [...Array(n)].map(fn);
const replaceChildren2 = (comp, children) => {
    const parent = comp.el;
    const existing = parent.childNodes;

    // remove existing nodes
    let excess = existing.length - children.length;
    for(let i = 0; i < excess; i++) {
        existing[children.length + excess - i - 1].remove();
    }

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
}

// const __truncateArray = (arr, newMaxSize) => arr.splice(newMaxSize, arr.length - newMaxSize);

/** Maintains a list of data that is always in sync with it's html, provided we only insert/remove things with the methods provided. */
const elementList = (root, createFn) => {
    const dataList = [];
    const componentsList = [];
    root.el.replaceChildren();  // this clears the children, because replaceChildren expects ...args

    const getChildNodes = () => root.el.childNodes;

    const self = {
        el: root.el,
        assertLength: () => {
            const children = getChildNodes();

            assert(
                dataList.length !== componentsList.length || dataList.length !== children.length,
                `${dataList.length} !== ${componentsList.length} || ${dataList.length} !== ${children.length}`
            );
        },
        assertBounds: (i) => {
            assert(
                i >= 0 && i < dataList.length, 
                `Index ${i} should have been between 0 and ${dataList.length - 1}`
            );
        },
        length: () => {
            self.assertLength();
            return dataList.length;
        },
        push: (data) => {
            const children = getChildNodes();
            self.insertAt(children.length, data);
        },
        insertAt: (i, data) => {
            assert(
                i >= 0 && i <= dataList.length, 
                `Index ${i} should have been between 0 and ${dataList.length}`
            );

            const newComponent = createFn(data, self);
            const children = getChildNodes();
            if (i === children.length) {
                root.el.appendChild(newComponent.el)
                dataList.push(data)
                componentsList.push(newComponent);
            } else {
                root.el.insertBefore(newComponent.el, children[i]);
                dataList.splice(i, 0, data);
                componentsList.splice(i, 0, newComponent);
            }

            try {
                newComponent.onInsert && newComponent.onInsert();            
            } catch(err) {
                console.error(err);
            }

            return newComponent;
        },
        removeAt: (i) => {
            if (dataList.length === 0) {
                return;
            }

            self.assertBounds(i);

            const children = getChildNodes();
            children[i].remove();
            const component = componentsList[i];

            try {
                component.onRemove && component.onRemove();
            } catch(err) {
                throw err;
                console.error(err);
            }

            componentsList.splice(i, 1);    
            dataList.splice(i, 1);
        },
        replaceAll: (newData) => {
            const children = getChildNodes();
            for(let i = children.length - 1; i >= 0; i--) {
                self.removeAt(i);
            }
            dataList.splice(0, dataList.length);
            componentsList.splice(0, componentsList.length);

            for(let i = 0; i < newData.length; i++) {
                self.insertAt(i, newData[i])
            }
        },
        dataAt: (i) => {
            self.assertBounds(i);
            return dataList[i];
        },
        componentAt: (i) => {
            self.assertBounds(i);
            return componentsList[i];
        },
        indexOf: (data) => {
            for(let i = 0; i < dataList.length; i++) {
                if(dataList[i] === data) {
                    return i;
                }
            }

            return -1;
        },
        /** NOTE: this returns a shallow copy */
        toArray: () => [...dataList]
    }

    self.replaceAll(dataList);

    return self;
}

const append = (comp, newChild) => {
    comp.el.parentNode.appendChild(newChild.el);
}