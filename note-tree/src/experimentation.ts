

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
