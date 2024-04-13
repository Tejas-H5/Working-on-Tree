import { Insertable, appendChild } from "./dom-utils";
import { App } from "./main";

const root: Insertable = {
    el: document.getElementById("app")!
};

export const app = App();

appendChild(root, app);
app.render(undefined);