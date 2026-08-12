export function filterInPlace<T>(arr: T[], predicate: (v: T, i: number, i2: number) => boolean) {
    let i2 = 0;
    for (let i = 0; i < arr.length; i++) {
        if (predicate(arr[i], i, i2)) arr[i2++] = arr[i];
    }
    arr.length = i2;
}
