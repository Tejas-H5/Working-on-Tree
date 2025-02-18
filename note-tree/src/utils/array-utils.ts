export function swap(arr: unknown[], a: number, b: number) {
    if (
        a < 0 || a >= arr.length ||
        b < 0 || b >= arr.length
    ) {
        throw new Error("Index a or b out of bounds");
    }

    const temp = arr[a];
    arr[a] = arr[b];
    arr[b] = temp;
}

export function filterInPlace<T>(arr: T[], predicate: (v: T, i: number) => boolean) {
    for (let i = 0; i < arr.length; i++) {
        if (!predicate(arr[i], i)) {
            arr.splice(i, 1);
            i--;
        }
    }
}

export function countOccurances<T>(arr: T[], predicate: (v: T) => boolean): number {
    let count = 0;
    for (const val of arr) {
        if (predicate(val)) {
            count++;
        }
    }
    return count;
}

// This is a certified JavaScript moment
export function boundsCheck(arr: unknown[], i: number): boolean {
    return i >= 0 && i < arr.length;
}

export function shuffleArray<T>(arr: T[]) {
    for (let i = arr.length; i > 0; i--) {
        let randomIdx = Math.floor(Math.random() * i);

        const temp = arr[i - 1];
        arr[i - 1] = arr[randomIdx];
        arr[randomIdx] = temp;
    }
}

export function newArray<T>(n: number, fn: (i: number) => T): T[] {
    const arr = Array(n);
    for (let i = 0; i < arr.length; i++) {
        arr[i] = fn(i);
    }

    return arr;
}

/** 
 * Assumes arr is sorted. Finds where val is, or where it should be inserted if it isn't there already 
 *
 * NOTE: can return arr.length as an insert position
 */
export function findIndexIntoSortedArray<T, K>(arr: T[], val: K, key: (a: T) => K, comp: (a: K, b: K) => number) {
    if (arr.length === 0) {
        return 0;
    }

    if (comp(val, key(arr[0])) <= 0) {
        return 0;
    }

    if (comp(val, key(arr[arr.length - 1])) > 0) {
        return arr.length;
    }

    let start = 0, end = arr.length - 1;
    
    let safetyCounter = 100000;

    let mid = -1;
    while (start + 1 < end) {
        safetyCounter--;
        if (safetyCounter <= 1) {
            throw new Error("Hit the safety counter!!! - your data structure is just too big");
        }

        mid = start + Math.floor((end - start) / 2);
        const res = comp(val, key(arr[mid]));
        if (res <= 0) {
            // val is smaller than arr[mid].
            end = mid;
        } else {
            // val is >= arr[mid].
            start = mid;
        }
    }

    return end;
}

export function findInSortedArray<T, K>(arr: T[], val: K, key: (a: T) => K, comp: (a: K, b: K) => number) {
    const idx = findIndexIntoSortedArray(arr, val, key, comp);
    if (idx < arr.length && key(arr[idx]) !== val) {
        return undefined;
    }

    return arr[idx];
}

export function findLastIndex<T>(arr: T[], fn: (val: T) => boolean, start = -1): number {
    if (start < 0) {
        start = arr.length + start;
    }

    for (let i = start; i >= 0; i--) {
        if (fn(arr[i])) {
            return i;
        }
    }

    return -1;
}

export function clearArray(arr: unknown[]) {
    arr.splice(0, arr.length);
}

// Mainly for correct typing - use it when you know it could be out of bounds
export function arrayAt<T>(arr: T[], i: number): T | undefined {
    return arr[i];
}

export function clampIndexToArrayBounds(i: number, arr: unknown[]): number {
    return clampIndexToBounds(i, arr.length);
}

export function clampIndexToBounds(i: number, len: number): number {
    if (i < 0) return 0;
    if (i >= len) return len - 1;
    return i;
}

export function moveArrayItem(arr: unknown[], a: number, b: number) {
    if (a < 0 || a >= arr.length) {
        throw new Error("'a' out of bounds!");
    }
    if (b < 0 || b >= arr.length) {
        throw new Error("'b' out of bounds!");
    }

    while (a < b) {
        const temp = arr[a + 1];
        arr[a + 1] = arr[a];
        arr[a] = temp;
        a++;
    }

    while (a > b) {
        const temp = arr[a - 1];
        arr[a - 1] = arr[a];
        arr[a] = temp;
        a--;
    }
}
