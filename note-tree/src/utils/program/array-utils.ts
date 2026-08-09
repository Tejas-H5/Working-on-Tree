export function mapSet<K, V>(map: Map<K, V>, key: K, value: V) {
    map.set(key, value);
    return value;
}


export function filterInPlace<T>(arr: T[], predicate: (v: T, i: number) => boolean) {
    let i2 = 0;
    for (let i = 0; i < arr.length; i++) {
        if (predicate(arr[i], i)) arr[i2++] = arr[i];
    }
    arr.length = i2;
}

export function groupBy<K, V>(dst: Map<K, V[]>, values: V[], keyFn: (val: V) => K) {
    for (const v of values) {
        const k = keyFn(v);
        let value = dst.get(k);
        if (!value) {
            value = [];
            dst.set(k, value);
        }

        value.push(v);
    }
}


export function incSafetyCounter(safety: number, val: number): number {
    if (safety > val) {
        throw new Error("Safety counter was hit!");
    }
    return safety + 1;
}
