import { el, im, ImCache, imdom } from "im-layer";
import { BLOCK, cssVars, DisplayType, imui, INLINE, LEFT } from "im-layer/im-ui";

export function imHeading(c: ImCache, text: string) {
	imdom.ElBegin(c, el.H2); {
		imStr(c, text);
	} imdom.ElEnd(c, el.H2);
}

export function imSubHeading(c: ImCache, text: string) {
	imdom.ElBegin(c, el.H4); {
		imStr(c, text);
	} imdom.ElEnd(c, el.H4);
}

export function imBegin(c: ImCache, type: DisplayType, align = LEFT, justify = LEFT) {
	const result = imui.Begin(c, type);
	imui.Align(c, align);
	imui.Justify(c, justify);
	return result;
}

export function imHSpace(c: ImCache, col: string = cssVars.bg) {
	imBegin(c, BLOCK); {
		if (im.IsFirstRender(c)) {
			imdom.setStyle(c, "width", "10px")
			imdom.setStyle(c, "backgroundColor", col);
		}
	} imEnd(c);
}

export function imHSpaceSmall(c: ImCache, col: string = cssVars.bg) {
	imBegin(c, BLOCK); {
		if (im.IsFirstRender(c)) {
			imdom.setStyle(c, "width", "4px")
			imdom.setStyle(c, "backgroundColor", col);
		}
	} imEnd(c);
}

export function imVSpace(c: ImCache, col: string = cssVars.bg) {
	imBegin(c, BLOCK); {
		if (im.IsFirstRender(c)) {
			imdom.setStyle(c, "height", "10px")
			imdom.setStyle(c, "backgroundColor", col);
		}
	} imEnd(c);
}

export function imVSpaceSmall(c: ImCache, col: string = cssVars.bg) {
	imBegin(c, BLOCK); {
		if (im.IsFirstRender(c)) {
			imdom.setStyle(c, "height", "4px")
			imdom.setStyle(c, "backgroundColor", col);
		}
	} imEnd(c);
}

export function imVDivider(c: ImCache) {
	imBegin(c, BLOCK); {
		if (im.IsFirstRender(c)) {
			imdom.setStyle(c, "minHeight", "10px")
		}
	} imEnd(c);
}

export const imEnd   = imui.End;
export const imFlex  = imui.Flex;
export const imStr    = imdom.Str;
export const imStrFmt = imdom.StrFmt;

export function imCodeBegin(c: ImCache) {
    const result = imBegin(c, BLOCK); // Prevent style leaking out
	if (im.IsFirstRender(c)) {
		imdom.setStyle(c, "fontFamily", "monospace")
		imdom.setStyle(c, "whiteSpace", "pre")
		imdom.setStyle(c, "tabSize", "4")
		imdom.setStyle(c, "backgroundColor", cssVars.bg2)
	}
	return result;
}

export function imCodeEnd(c: ImCache) {
	imEnd(c);
}

export function imCodeSpanBegin(c: ImCache) {
    const result = imBegin(c, INLINE); { // Prevent style leaking out
		imBegin(c, INLINE);  {
			if (im.IsFirstRender(c)) {
				imdom.setStyle(c, "fontFamily", "monospace")
				imdom.setStyle(c, "whiteSpace", "pre")
				imdom.setStyle(c, "tabSize", "4")
				imdom.setStyle(c, "background", cssVars.bg2)
			}
		} // imEnd
	} // imEnd

	return result;
}

export function imPre(c: ImCache) {
	if (im.IsFirstRender(c)) {
		imdom.setStyle(c, "whiteSpace", "pre")
	}
}

export function imPreWrap(c: ImCache) {
	if (im.IsFirstRender(c)) {
		imdom.setStyle(c, "whiteSpace", "pre-wrap")
	}
}

export function imB(c: ImCache) {
	if (im.IsFirstRender(c)) imdom.setStyle(c, "fontWeight", "bold");
}

export function imCodeSpanEnd(c: ImCache) {
	imEnd(c);
	imEnd(c);
}

export const imGap = imui.Gap;
