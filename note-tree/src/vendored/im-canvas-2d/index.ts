import { imdom, el } from "im-layer";
import { im, ImCache } from "im-layer";
import * as c2d from "canvas-2d";

export function imC2dBegin(c: ImCache, aspectRatio: number): c2d.State | undefined { 
	let canvasState: c2d.State | undefined;

	const canvasRoot = imdom.ElBegin(c, el.CANVAS); {
		if (im.IsFirstRender(c)) {
			imdom.setStyle(c, "userSelect", "none");
		}

		canvasState = 
			im.Get(c, c2d.createContext) ??
			im.Set(c, c2d.createContext(canvasRoot.root));

		if (im.If(c) && canvasState) {
			const clientWidth = canvasRoot.root.clientWidth;
			if (im.Memo(c, clientWidth)) {
				c2d.applyAspectRatioToHeight(canvasState, aspectRatio);
			}

			c2d.beginFrame(canvasState);
		} //  im.IfEnd
	} // imdom.ElEnd

	return canvasState;
}

export function imC2dEnd(c: ImCache, canvasState: c2d.State | undefined) {
	{
		{
			if (canvasState) {
				c2d.endFrame(canvasState);
			}
		} im.IfEnd(c);
	} imdom.ElEnd(c, el.CANVAS);
}
