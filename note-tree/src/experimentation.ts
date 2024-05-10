

/*

Cant seem to think of a better API that is simple...
only some conventions:


// keep all local state just above the render function i.e call to makeComponent
// name your component `component` or `c`
// the root element must be called `root`
// add event listeners _after_ your render method ?? I think this is good but not sure



type ComponentNameArgs = {

}

function ComponentName<ComponentNameArgs>() {
    const root = div();

    const component = makeComponent<ComponentNameArgs>(root, () => {
        const { } = component.args;

    });

    return component;
}


function ComponentName() {
    const root = div();

    const component = makeComponent<ComponentNameArgs>(root, () => {
        
    });

    return component;
}


type CounterArgs = {
    count: number;
    setCount(val: number): void;
}

function Counter({
    count,
    setCount,
}: CounterArgs) {

    return (
        <div style={{ display: "flex", gap: 5 }} >
            <div onClick={() => setCount(count + 1)} > Click me! </div>
            {count}
        </div>
    );
}

function Counter3() {
    let count = 0;
    return (
        div({ style: "display:flex;gap:5px" }, [
            events(div({}, [ "Click Me" ]), {
                "click": (self, e) => count++;,
            }),
            text(getCount),
        ])
    );
}

function Counter4() {
    const buttonEl = <div click={({count, setCount}, e) => setcount(count+1)} />;
    const countEl = <div/>

    cons root = (
        <div style={{ dispay: "flex", gap: 5 }}>
            {buttonEl}
            {countEl}
        </div>
    );

    const root = div({ style: "display:flex;gap:5px" }, [
        buttonEl,
        countEl
    ]);

    const component = makeComponent(root, () => {
        const { count } = component.args;
        setTextContent(countEl, count);
    });

    return component;
}

function Counter5() {

    const countEl = div();
    const buttonEl = div();
    const root = div({ style: "display:flex;gap:5px" }, [
        buttonEl,
        countEl
    ]);

    eventListener(buttonEl, "click", () => {
        const { count, setCount } = component.args;
        setCount(count + 1);
    });

    const component = makeComponent(root, () => {
        const { count } = component.args;
        setTextContent(countEl, count);
    });

    return component;
}


function Counter() {
    const countEl = div();
    const buttonEl = div();
    eventListener(buttonEl, "click", () => {
        const { count, setCount } = component.args;
        setCount(count + 1);
    });

    const root = div({ style: "display:flex;gap:5px" }, [
        buttonEl,
        countEl
    ]);

    const component = makeComponent(root, () => {
        const { count } = component.args;
        setTextContent(countEl, count);
    });

    return component;
}


function Counter2() {
    const countEl = div();
    const buttonEl = div();
    eventListener(buttonEl, "click", () => {
        const { setCount, count } = component.args;
        setCount(count + 1);
    });

    const component = makeComponent(
        () => setTextContent(countEl, component.args.count), 
        div({ style: "display:flex;gap:5px" }, [
            buttonEl,
            countEl
        ])
    );
}



*/
