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

export function filterInPlace<T>(arr: T[], predicate: (v: T) => boolean) {
    for (let i = 0; i < arr.length; i++) {
        if (!predicate(arr[i])) {
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

