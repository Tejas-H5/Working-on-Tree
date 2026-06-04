import { cnApp } from "src/app-styling";
import { FuzzyFindRange } from "src/utils/fuzzyfind";
import { im, ImCache, imdom } from "src/utils/im-js";
import { imui, INLINE } from "src/utils/im-js/im-ui";

export function imTextWithHighlightedRanges(c: ImCache, text: string, ranges: FuzzyFindRange[], truncate: boolean) {
    const diffState = im.GetInline(c, imTextWithHighlightedRanges) ??
        im.Set<{ text: string; ranges: FuzzyFindRange[] }>(c, {
            text: "",
            ranges: []
        });

    if (im.Memo(c, text) | im.Memo(c, ranges) | im.Memo(c, truncate)) {
        if (ranges.length > 0 && truncate) {
            // Let's truncate with context.

            const contextWindow = 10;

            let matchStart = ranges[0][0] - contextWindow;

            let truncateStart = matchStart !== 0;
            if (matchStart < 0) {
                matchStart = 0;
                truncateStart = false;
            }

            let matchEnd = ranges[ranges.length - 1][1] + contextWindow;
            let truncateEnd = matchEnd !== text.length;
            if (matchEnd > text.length) {
                matchEnd = text.length;
                truncateEnd = false;
            }

            text = text.substring(matchStart, matchEnd);

            let rangeOffset = matchStart;
            if (truncateStart) {
                text = "... " + text;
                rangeOffset -= "... ".length;
            }

            if (truncateEnd) text = text + " ...";

            ranges = ranges.map(r => [r[0] - rangeOffset, r[1] - rangeOffset]);
        }

        diffState.ranges = ranges;
        diffState.text = text;
    }

    imui.Begin(c, INLINE); {
        if (im.Memo(c, truncate)) imdom.setStyle(c, "whiteSpace", truncate ? "" : "pre-wrap");

        let lastStart = 0;
        const { text, ranges } = diffState;
        im.For(c); for (let i = 0; i < ranges.length; i++) {
            const [start, nextLastStart] = ranges[i];

            const beforeHighlighted = text.substring(lastStart, start);
            const highlighted = text.substring(start, nextLastStart);

            lastStart = nextLastStart;

            imui.Begin(c, INLINE); {
                if (im.isFirstishRender(c)) {
                    imdom.setClass(c, cnApp.defocusedText);
                }

                imdom.Str(c, beforeHighlighted);
            } imui.End(c);
            imui.Begin(c, INLINE); imdom.Str(c, highlighted); imui.End(c);
        } im.ForEnd(c);

        if (im.If(c) && lastStart !== text.length) {
            imui.Begin(c, INLINE); {
                if (im.isFirstishRender(c)) {
                    imdom.setClass(c, cnApp.defocusedText);
                }

                imdom.Str(c, text.substring(lastStart));
            } imui.End(c);
        } im.IfEnd(c);
    } imui.End(c);
}
