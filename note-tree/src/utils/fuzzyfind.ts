export type FuzzyFindRange = [start: number, end: number];


// Returns a result containing the matches, as well as a 'score' saying how good the match was.
export type FuzyyFindResult = {
    /**
     * If this is empty, that means there was no match, and vice-versa.
     */
    ranges: FuzzyFindRange[];

    /** 
     * NOTE: only scores using the same algorithm and query text may be compared with one another, due to their fuzzy nature.
     * For instance - a fuzzy find algorithm may simply return the number of characters in the query that were also in the document.
     * It's usally a bit more complicated than that, but not far off, actually.
     * But it means that longer queries just naturally have larger scores, for no meaningful reason other than
     * the fact that the query itself was long.
     **/
    score: number;
};

// Cheers: https://stackoverflow.com/questions/147824/how-to-find-whether-a-particular-string-has-unicode-characters-esp-double-byte
const nonLatinCharRegex = /[^\u0000-\u00ff]/;
function containsNonLatinCodepoints(s: string) {
    return nonLatinCharRegex.test(s);
}

export function fuzzyFind(text: string, query: string, {
    // NOTE: you probably never want to set this to anything higher than 1
    allowableMistakes = 1,
    mistakePenalty = 5,
    prefixBuff = 1,
    limit = 20,
}: {
    allowableMistakes?: number;
    mistakePenalty?: number;
    prefixBuff?: number;
    limit?: number;
}): FuzyyFindResult {
    const result: FuzyyFindResult = { ranges: [], score: 0 };

    query = query.toLowerCase();
    text = text.toLowerCase();

    if (query.length === 0) {
        return result;
    }

    // singular emoji have 2 length...
    if (query.length <= 2) {
        if (containsNonLatinCodepoints(query)) {
            // One instance of when we should allow 1-length queries is emojis or some strange unicode character.
            allowableMistakes = 0;
        } 

        if (query.length === 1) {
            return result;
        }
    }

    for (let i = 0; i + query.length - 1 < text.length; i++) {
        // need this to prevent 'a' from matching literally everything bc oh I just made 1 mistake hehe
        // but need to allow at least 1 mistake. so it doesn't instafail
        let mistakesRemaining = Math.max(0, Math.min(query.length - allowableMistakes, allowableMistakes));
        let mistakesFound = 0;

        let isMatch = true;
        let iTempOffset = 0;
        for (let j = 0; j < query.length; j++) {
            if (text[i + iTempOffset + j] !== query[j]) {
                // may have just swapped two characters, i.e
                // query: "just", text: "jsut".
                // but this same code also handles accidentally inserting a character:
                // query: "just", text: "jiust".

                // don't check for swapping errors if we aren't even inside the string yet.
                if (j > 0) {
                    if (text[i + iTempOffset + j] === query[j + 1]) {
                        j++;
                    } else if (text[i + iTempOffset + j + 1] === query[j]) {
                        if (j === 0) {
                        }
                        iTempOffset++;
                    }
                }

                mistakesRemaining--;
                mistakesFound++;
            }

            if (mistakesRemaining < 0) {
                isMatch = false;
                break;
            }
        }

        if (!isMatch) {
            continue;
        }

        result.ranges.push([i, i + query.length]);
        let thisMatchScore = 0
        thisMatchScore += 1 / (1 + mistakePenalty * mistakesFound);

        if (mistakesFound === 0 && prefixBuff) {
            // buff new words. When searching for "able", " able" should rank higher than "stable".
            if (
                i === 0 ||
                // NOTE: could be unicode-related bugs with this one. We don't care for now
                text[i - 1].trim() === ""
            ) {
                thisMatchScore += prefixBuff;
            }
            result.score += thisMatchScore; 
        }

        if (result.ranges.length >= limit) {
            break;
        }

        i += query.length - 1;
    }

    return result;
}
