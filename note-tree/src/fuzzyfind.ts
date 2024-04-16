
export type Range = [number, number];

// Returns a range with all the partial matches. 
// You can score how good the matches were using `scoreFuzzyFind`. 
// Right now, that function works without even needing to look at what the query/text string was.
export function fuzzyFind(text: string, query: string) : Range[] {
    const ranges: Range[] = [];

    if (query.length > text.length) {
        return ranges;
    }

    let maxMatchLength = 0;
    let maxMatchIdx = -1;
    let querySubstr = query;
    while(querySubstr !== "") {
        maxMatchLength = 0;
        maxMatchIdx = -1;

        for(let i = 0; i < text.length - querySubstr.length + 1; i++) {
            const numEqual = checkEqual(text, querySubstr, i);
            if (numEqual > maxMatchLength) {
                maxMatchLength = numEqual;
                maxMatchIdx = i;
            }
        }

        if (maxMatchIdx === -1) {
            querySubstr = querySubstr.substring(1);
        } else {
            ranges.push([maxMatchIdx, maxMatchIdx + maxMatchLength]);
            querySubstr = querySubstr.substring(maxMatchLength);
        }
    }

    // Improtant that these are sorted for the scoring to work
    ranges.sort((a, b) => a[0] - b[0]);

    // I think this actually results in better scores.
    fixRangesVisually(ranges);

    return ranges;
}

// returns how many were equal in sequence
function checkEqual(text:string, query: string, idx: number): number{
    for (let i = 0; i < query.length; i++) {
        if (text[idx + i] !== query[i]) {
            return i;
        }
    }

    return query.length;
}

/* 
 * Ensures ordered and non-overlapping ranges. 
 * May or may not be important...
 * (it certainly is for visuals, but I am not sure for scoring. it seems to be better though so I'm keeping it in for now)
 */
function fixRangesVisually(ranges: Range[]) {
    for (let i = 1; i < ranges.length; i++) {
        const prev = ranges[i-1];
        const curr = ranges[i];

        if (prev[1] < curr[0]) {
            continue;
        }

        // merge the two ranges if they overlap
        prev[1] = Math.max(prev[1], curr[1]);
        ranges.splice(i - 1, 1);
        i--;
    }
}


// Can't believe this thing works, lol. Somewhat inspired by https://medium.com/@Srekel/implementing-a-fuzzy-search-algorithm-for-the-debuginator-cacc349e6c55
// But he lost me near the middle of the blog post so I just winged the rest of it.
export function scoreFuzzyFind(ranges: Range[]): number {
    // The assumption is that all of the ranges match the query text almost exactly.
    // So this function doesn't really need to care about the original search/query text.
    // Rather, the longer the query, the higher the max possible score.
    
    let score = 0;
    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const rn = ranges[i + 1];

        // longer matches should give a proportionally larger score, i.e 4 1-length matches shouldn't ever be worth the same as 1 4-length match,
        // as the latter is far more superior. I also think this works for 1-off insertions/deletions for similar reasons
        score += Math.pow(r[1] - r[0], 2);

        if (rn) {
            // The space between the matches should severely negatively impact the score. But probably not by as much as x^2. Maybe just x?
            score -= Math.pow(rn[0] - r[1], 1);
        }
    }

    return score;
}

