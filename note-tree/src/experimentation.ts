

/**
 *
 *
 *
 *
 *
 *
 


// Maybe the question is how to make this as efficient as possible:

function UserProfileHeader({ user }) {
    divClass("flex-1", [
        divClass("image-container", [
            el("img", { src: user.profileImage }),
            divClass("spacer"),
            divClass("profile-name", [
                "Hello, ",
                user.FirstName,
                " ",
                user.LastName,
                "!"
            ]),
        ])
    ]);
}

function UserName() {
    const r = newRecursiveRoot(div({ class: "flex-1" }));
    const component = newComponent<User>(r, render);

    function render() {
        const { user } = component.args;

        r.divClass("profile-name", (r) => {
            r.text("Hello, ");
            r.text(user.FirstName);
            r.text(" ");
            r.text(user.LastName);
        }),
    }
}

function UserProfileHeader2() {
    const rg = newRenderGroup();
    const r = newRecursiveRoot(div({ class: "flex-1" }));
    const component = newComponent<User>(r, rg.render);

    function render() {
        const { user } = component.args;

        r.render((r) => {
            r.divClass("image-container", (r) => {
                r.el("img", { src: user.profileImage }),
            }),
            r.divClass("spacer"),
            r.component(rg(UserName(), (userName) => {
                if (setVisible(userName, !!user.FirstName)) {
                    userName.render({ user });
                }
            }),
            r.divClass("separator"),
            r.component(rg(externalComponent), (externalComponent) => {
                externalComponent.rendeR();
            }),
            r.divClass("separator"),
            r.component(externalComponent2),
        });

        externalComponent.render({});
    }

    return component;
}

function UserName() {
    const rg = newRenderGroup();
    const root = div({ class: "profile-name" }, [
        "Hello, ",
        rg.text(() => component.args.user.FirstName),
        " ",
        rg.text(() => component.args.user.LastName)
    ]);

    const component = newComponent<User>(root, rg.render);
    return component;
}

function UserProfileHeader2() {
    const rg = newRenderGroup();
    const r = newRecursiveRoot(div({ class: "flex-1" }));
    const component = newComponent<User>(r, rg.render);

    function render() {
        const { user } = component.args;

        r.render((r) => {
            r.divClass("image-container", (r) => {
                r.el("img", { src: user.profileImage }),
            }),
            r.divClass("spacer"),
            r.component(rg(UserName(), (userName) => {
                if (setVisible(userName, !!user.FirstName)) {
                    userName.render({ user });
                }
            }),
            r.divClass("separator"),
            r.component(rg(externalComponent), (externalComponent) => {
                externalComponent.rendeR();
            }),
            r.divClass("separator"),
            r.component(externalComponent2),
        });

        externalComponent.render({});
    }

    return component;
}




function UserProfileHeader2() {
    const rg = newRenderGroup();

    const root = divClass("flex-1", [
        divClass("image-container", [
            rg(el("img), (el) => setAttr(el, "src", c.args.profileImage)),
        ]),
        divClass("spacer"),
        divClass("profile-name", [
            "Hello, ",
            rg.text(() => c.args.user.FirstName),
            " ",
            rg.text(() => c.args.user.LastName),
        ]),
        externalComponent,
        divClass("separator"),
        externalComponent2,
    ]);
    
    const component = newComponent<User>(r, render);

    function render() {
        const { user } = component.args;

        r.render((r) => {
            r.divClass("image-container", (r) => {
                r.el("img", { src: user.profileImage }),
            }),
            r.divClass("spacer"),
            r.divClass("profile-name", (r) => {
                r.text("Hello, ");
                r.text(user.FirstName);
                r.text(" ");
                r.text(user.LastName);
            }),
            r.divClass("separator"),
            r.component(externalComponent),
            r.divClass("separator"),
            r.component(externalComponent2),
        });

        externalComponent.render({});
    }

    return component;
}






 *
 *
 *
 *
 *
 *
 *
 *
 *
 */

// function ExperimantalComponent() {
//     type ItemArgs = {
//         text: string;
//         color: string;
//     };
//     function Item() {;
//         const rg = newRenderGroup();
//         const root = divStyled("inline-block", "font-size: 4px; width: 5px; height: 5px;", []);
//
//         const c = newComponent<ItemArgs>(root, render);
//
//         function render() {
//             rg.render();
//             setStyle(root, "backgroundColor", c.args.color);
//         }
//
//         return c;
//     }
//
//     const items: ItemArgs[] = [];
//     for (let i = 0; i < 5000; i++) {
//         let text = "";
//         for (let i = 0; i < 3; i++) {
//             text += uuid();
//         }
//
//         const col = () => Math.floor(Math.random() * 255);
//
//         const color = `rgb(${col()}, ${col()}, ${col()})`
//
//         items.push({ text, color });
//     }
//
//     const shuffleButton = makeButton("Shuffle");
//     const rg = newRenderGroup();
//     const root = divStyled("", "", [
//         rg(newListRenderer(divStyled("", "line-height: 5px"), Item), (list) => {
//             list.render(() => {
//                 for (const item of items) {
//                     list.getNext().render(item);
//                 }
//             });
//         }),
//         shuffleButton
//     ]);
//
//     const c = newComponent(root, render);
//
//     function render() {
//         const start = Date.now();
//
//         rg.render();
//
//         const end = Date.now();
//
//         console.log("rerendering took ", formatDuration(end-start));
//     }
//
//     shuffleButton.el.addEventListener("click", () => {
//         shuffleArray(items);
//         render();
//     })
//
//     return c;
// }
//
//
//













/*

// this is a good usecase of render groups actually. How tf do we do this without render groups, if possible?

const mouseScrollList = [
    rg(buttons.rectSelect, (c) => c.render({
        name: "Rect",
        onClick: rerenderLocal,
        tool: "rect-select",
    })),
    rg(buttons.freeformSelect, (c) => c.render({
        name: "Draw",
        onClick: rerenderLocal,
        tool: "freeform-select" satisfies ToolType,
    })),
    rg(buttons.lineSelect, (c) => c.render({
        name: "Line",
        onClick: rerenderLocal,
        tool: "line-select",
    })),
    rg(buttons.rectOutlineSelect, (c) => c.render({
        name: "Rect Outline",
        onClick: rerenderLocal,
        tool: "rect-outline-select",
    })),
    rg(buttons.bucketFillSelect, (c) => c.render({
        name: "Fill",
        onClick: rerenderLocal,
        tool: "fill-select",
    })),
    rg(buttons.bucketFillSelectOutline, (c) => c.render({
        name: "Fill Outline",
        onClick: rerenderLocal,
        tool: "fill-select-outline",
    })),
    rg(buttons.bucketFillSelectConnected, (c) => c.render({
        name: "Fill Connected",
        onClick: rerenderLocal,
        tool: "fill-select-connected",
    })),
];

const toolbar = div({ class: "", style: "justify-content: center; gap: 5px;" }, [
    div({ class: "inline-block"}, [
        rg(buttons.lessRows, (c) => c.render({
            name: "-",
            onClick: () => {
                resizeLayers(canvasState, getNumRows(canvasState) - NUM_ROWS_INCR_AMOUNT, getNumCols(canvasState));
                rerenderLocal();
            },
        })),
        div({ style: "display: inline-block; min-width: 3ch; text-align: center;" }, [
            rg.text(() => "rows: " + getNumRows(canvasState)),
        ]),
        rg(buttons.moreRows, (c) => c.render({
            name: "+",
            onClick: () => {
                resizeLayers(canvasState, getNumRows(canvasState) + NUM_ROWS_INCR_AMOUNT, getNumCols(canvasState));
                rerenderLocal();
            },
        })),
        rg(buttons.lessCols, (c) => c.render({
            name: "-",
            onClick: () => {
                resizeLayers(canvasState, getNumRows(canvasState), getNumCols(canvasState) - NUM_COLUMNS_INCR_AMOUNT);
                rerenderLocal();
            },
        })),
        div({ style: "display: inline-block; min-width: 3ch; text-align: center;" }, [
            rg.text(() => "cols: " + getNumCols(canvasState)),
        ]),
        rg(buttons.moreCols, (c) => c.render({
            name: "+",
            onClick: () => {
                const wantedCols = Math.max(
                    getNumCols(canvasState) + NUM_COLUMNS_INCR_AMOUNT,
                    MIN_NUM_COLS,
                );
                resizeLayers(canvasState, getNumRows(canvasState), wantedCols);
                rerenderLocal();
            },
        })),
    ]),
    spacer(),
    div({ class: "inline-block"}, [
        rg.text(() => "Selection (Ctrl + [Q/E]): "),
        ...mouseScrollList,
    ]),
    spacer(),
    div({ class: "inline-block"}, [
        rg(buttons.invertSelection, (c) => c.render({
            name: "Invert Selection",
            onClick: () => {
                forEachCell(canvasState, (c) => selectCell(canvasState, c.i, c.j, !c.isSelected));
                rerenderLocal();
            },
        })),
    ]),
    spacer(),
    div({ class: "inline-block"}, [
        rg(buttons.copyToClipboard, (button) => {
            button.render({
                name: "Copy",
                onClick: copyCanvasToClipboard,
                selected: copied,
            })
        }),
        rg(buttons.pasteFromClipboard, (button) => {
            button.render({
                name: "Paste",
                onClick: () => {
                    pasteClipboardToCanvas(cursorCell?.i || 0, cursorCell?.j || 0, false);
                    rerenderLocal();
                },
                selected: pastedNoTransparency,
                disabled: !canPaste,
            });
        }),
        rg(buttons.pasteFromClipboardTransparent, (button) => {
            button.render({
                name: "Paste (transparent)",
                onClick: () => {
                    pasteClipboardToCanvas(cursorCell?.i || 0, cursorCell?.j || 0, false);
                    rerenderLocal();
                },
                selected: pastedWithTransparency,
                disabled: !canPaste,
            });
        }),
    ]),
    spacer(),
    div({ class: "inline-block"}, [
        rg(buttons.linesFromSelection, (c) => c.render({
            name: "Draw Lines",
            onClick: () => {
                generateLines(canvasState);
                rerenderLocal();
            }
        })),
    ]),
    div({ class: "inline-block"}, [
        rg(buttons.undoButton, (c) => c.render({
            name: "Undo",
            selected: undoDone,
            disabled: !canUndo(canvasState),
            onClick: undo,
        })),
        rg.text(() => (1 + canvasState.undoLogPosition) + " / " + canvasState.undoLog.length),
        rg(buttons.redoButton, (c) => c.render({
            name: "Redo",
            selected: redoDone,
            disabled: !canRedo(canvasState),
            onClick: redo,
        })),
    ]),
]);


const mouseScrollList = [
    ... the args
];


const toolbar = div({ class: "", style: "justify-content: center; gap: 5px;" });





, [
    div({ class: "inline-block"}, [
        rg(buttons.lessRows, (c) => c.render({
            name: "-",
            onClick: () => {
                resizeLayers(canvasState, getNumRows(canvasState) - NUM_ROWS_INCR_AMOUNT, getNumCols(canvasState));
                rerenderLocal();
            },
        })),
        div({ style: "display: inline-block; min-width: 3ch; text-align: center;" }, [
            rg.text(() => "rows: " + getNumRows(canvasState)),
        ]),
        rg(buttons.moreRows, (c) => c.render({
            name: "+",
            onClick: () => {
                resizeLayers(canvasState, getNumRows(canvasState) + NUM_ROWS_INCR_AMOUNT, getNumCols(canvasState));
                rerenderLocal();
            },
        })),
        rg(buttons.lessCols, (c) => c.render({
            name: "-",
            onClick: () => {
                resizeLayers(canvasState, getNumRows(canvasState), getNumCols(canvasState) - NUM_COLUMNS_INCR_AMOUNT);
                rerenderLocal();
            },
        })),
        div({ style: "display: inline-block; min-width: 3ch; text-align: center;" }, [
            rg.text(() => "cols: " + getNumCols(canvasState)),
        ]),
        rg(buttons.moreCols, (c) => c.render({
            name: "+",
            onClick: () => {
                const wantedCols = Math.max(
                    getNumCols(canvasState) + NUM_COLUMNS_INCR_AMOUNT,
                    MIN_NUM_COLS,
                );
                resizeLayers(canvasState, getNumRows(canvasState), wantedCols);
                rerenderLocal();
            },
        })),
    ]),
    spacer(),




















*/
