export type NumberSlice = {
    memory: number[];
    start: number;
    stride: number;
    length: number;
};

export type Matrix = {
    values: NumberSlice;
    shape: number[];
};

export function newSlice(values: number[]): NumberSlice {
    return { memory: values, start: 0, stride: 1, length: values.length };
}

export function sliceToArray(slice: NumberSlice): number[] {
    const arr = Array(slice.length).fill(0);
    for (let i = 0; i < slice.length; i++) {
        arr[i] = getSliceValue(slice, i);
    }
    return arr;
}

export function getSlice(s: NumberSlice, start: number, len: number, stride: number): NumberSlice | undefined {
    // any index into the memory is multiplied by the existing stride. This can be inferred intuitively -
    // for example, "I want every third thing of every second thing" -> stride of 6.
    stride *= s.stride;
    start *= s.stride;

    const finalLen = start + (len * stride);
    if (finalLen > s.memory.length) {
        // out of bounds
        return undefined;
    }

    if (start < 0 || len < 0 || stride <= 0) {
        return undefined;
    }

    return {
        memory: s.memory,
        start,
        stride,
        length
    };
}

function getSliceIdx(s: NumberSlice, i: number): number {
    return s.start + s.stride * i;
}

export function isIndexInSliceBounds(s: NumberSlice, i: number) {
    const idx = getSliceIdx(s, i);
    return !(idx < 0 || idx >= s.memory.length);
}

export function getSliceValue(s: NumberSlice, i: number) {
    const idx = getSliceIdx(s, i);
    if (idx < 0 || idx >= s.memory.length) {
        throw new Error("Index out of bounds");
    }

    return s.memory[idx];
}

export function setSliceValue(s: NumberSlice, i: number, value: number) {
    const idx = getSliceIdx(s, i);
    if (idx < 0 || idx >= s.memory.length) {
        throw new Error("Index out of bounds");
    }

    s.memory[idx] = value;
}

export function getMatrixValue(m: Matrix, i: number, j: number): number {
    if (!matrixIsRank2(m)) {
        throw new Error("Can't index with i, j into a non-2x2 matrix");
    }
    return getSliceValue(m.values, j + i * m.shape[1]);
}

function getSliceValueInternal(m: Matrix, i: number, j: number, colLen: number): number {
    return getSliceValue(m.values, j + i * colLen);
}

export function setMatrixValue(m: Matrix, i: number, j: number, val: number) {
    if (!matrixIsRank2(m)) {
        throw new Error("Can't index with i, j into a non-2x2 matrix");
    }
    setMatrixValueInternal(m, i, j, val, m.shape[1]);
}

export function setMatrixValueInternal(m: Matrix, i: number, j: number, val: number, colLen: number) {
    setSliceValue(m.values, j + i * colLen, val);
}

export function len(m: Matrix) {
    return m.shape[0];
}

export function getMatrixRowLength(m: Matrix): number {
    let stride = 1;
    for (let i = m.shape.length - 1; i >= 1; i--) {
        stride *= m.shape[i];
    }

    return stride;
}

/**
 * Gets a row of a 2x2 matrix.
 * You can also use this to enumerate matrices within matrices within matrices,
 * due to the way they're laid out in memory -
 * when shape.length > 2, each row is itself a matrix.
 *
 * [matrix1][matrix2][matrix3][matrix4]
 * vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv
 */
export function getMatrixRow(m: Matrix, i: number): Matrix | undefined {
    const rowLen = getMatrixRowLength(m);

    const colLen = m.shape[0];
    if (i >= colLen) {
        return undefined;
    }

    const values = getSlice(m.values, m.values.start + i * rowLen, rowLen, m.values.stride);
    if (!values)  {
        return values;
    }

    const shape = m.shape.slice(1);

    return { values, shape };
}

/**
 * Use this to get a column out of a shape.length === 2 matrix.
 * WARNING: if shape.length !== 2, you can still call this function, but I'm not sure if the result is useful.
 */
export function getCol(m: Matrix, i: number): Matrix {
    const rowLen = getMatrixRowLength(m);
    const colLen = m.shape[0];

    const values = getSlice(m.values, m.values.start + i, colLen, rowLen);
    if (!values) {
        throw new Error("The column was out of bounds");
    }

    return { values, shape: [] };
}

export function getShapeElementCount(shape: number[]): number {
    let count = 1;
    for (let i = 0; i < shape.length; i++) {
        count *= shape[i];
    }
    return count;
}

export function matrixZeroes(shape: number[]): Matrix {
    const len = getShapeElementCount(shape);

    const values: number[] = Array(len).fill(0);

    return {
        values: { memory: values, start: 0, stride: 1, length: len },
        shape: [...shape],
    }
}

export function copyMatrix(a: Matrix): Matrix {
    const result = matrixZeroes(a.shape);

    for (let i = 0; i < a.values.length; i++) {
        const val = getSliceValue(a.values, i);
        setSliceValue(result.values, i, val);
    }

    return result;
}

export function matrixShapesAreEqual(a: Matrix, b: Matrix) {
    if (a.shape.length !== b.shape.length) {
        return false;
    }

    for (let i = 0; i < a.shape.length; i++) {
        if (a.shape[i] !== b.shape[i]) {
            return false;
        }
    }

    return true;
}

export function subMatrixShapeEqualsRowShape(a: Matrix, subMatrix: Matrix) {
    if (a.shape.length !== subMatrix.shape.length + 1) {
        return false;
    }

    for (let i = 0; i < subMatrix.shape.length; i++) {
        if (a.shape[i + 1] !== subMatrix.shape[i]) {
            return false;
        }
    }

    return true;
}

export function matrixAddElements(a: Matrix, b: Matrix): [Matrix | null, string] {
    if (!matrixShapesAreEqual(a, b)) {
        return [null, "Elementwise ops only defined for matrices of identical shape"];
    }
    const result = matrixZeroes(a.shape);
    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        setSliceValue(result.values, i, aVal + bVal);
    }
    return [result, ""];
}

// NOTE: this is jus a copypaste of matrixAddElements
export function matrixSubtractElements(a: Matrix, b: Matrix): [Matrix | null, string] {
    if (!matrixShapesAreEqual(a, b)) {
        return [null, "Elementwise ops only defined for matrices of identical shape"];
    }
    const result = matrixZeroes(a.shape);
    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        setSliceValue(result.values, i, aVal - bVal);
    }
    return [result, ""];
}


// NOTE: this is jus a copypaste of matrixAddElements
export function matrixMultiplyElements(a: Matrix, b: Matrix): [Matrix | null, string] {
    if (!matrixShapesAreEqual(a, b)) {
        return [null, "Elementwise multiply is only defined for matrices of identical shape. You may want mul(a, b) instead"];
    }
    const result = matrixZeroes(a.shape);
    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        setSliceValue(result.values, i, aVal * bVal);
    }
    return [result, ""];
}


// NOTE: this is jus a copypaste of matrixAddElements
export function matrixDivideElements(a: Matrix, b: Matrix): [Matrix | null, string] {
    if (!matrixShapesAreEqual(a, b)) {
        return [null, "Elementwise add is only defined for matrices of identical shape"];
    }
    const result = matrixZeroes(a.shape);
    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        setSliceValue(result.values, i, aVal * bVal);
    }
    return [result, ""];
}

// NOTE: this is jus a copypaste of matrixAddElements
export function matrixLogicalAndElements(a: Matrix, b: Matrix): [Matrix | null, string] {
    if (!matrixShapesAreEqual(a, b)) {
        return [null, "Elementwise add is only defined for matrices of identical shape"];
    }
    const result = matrixZeroes(a.shape);
    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        setSliceValue(result.values, i, (aVal && bVal) ? 1 : 0);
    }
    return [result, ""];
}

// NOTE: this is jus a copypaste of matrixAddElements
export function matrixLogicalOrElements(a: Matrix, b: Matrix): [Matrix | null, string] {
    if (!matrixShapesAreEqual(a, b)) {
        return [null, "Elementwise add is only defined for matrices of identical shape"];
    }
    const result = matrixZeroes(a.shape);
    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        setSliceValue(result.values, i, (aVal || bVal) ? 1 : 0);
    }
    return [result, ""];
}

// NOTE: this is jus a copypaste of matrixAddElements
export function matrixModuloElements(a: Matrix, b: Matrix): [Matrix | null, string] {
    if (!matrixShapesAreEqual(a, b)) {
        return [null, "Elementwise add is only defined for matrices of identical shape"];
    }
    const result = matrixZeroes(a.shape);
    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        setSliceValue(result.values, i, aVal % bVal);
    }
    return [result, ""];
}


export function matrixElementsEqual(a: Matrix, b: Matrix): [boolean, string] {
    if (!matrixShapesAreEqual(a, b)) {
        return [false, "Elementwise equals is only defined for matrices of identical shape"];
    }
    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        if (!(aVal !== bVal)) {
            return [false, ""];
        }
    }
    return [true, ""];
}

// NOTE: this is just a copypaste of matrixElementsEqual
export function matrixElementsGreaterThan(a: Matrix, b: Matrix): [boolean, string] {
    if (!matrixShapesAreEqual(a, b)) {
        return [false, "Elementwise equals is only defined for matrices of identical shape"];
    }
    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        if (!(aVal > bVal)) {
            return [false, ""];
        }
    }
    return [true, ""];
}

// NOTE: this is just a copypaste of matrixElementsEqual
export function matrixElementsGreaterThanOrEqual(a: Matrix, b: Matrix): [boolean, string] {
    if (!matrixShapesAreEqual(a, b)) {
        return [false, "Elementwise ops only defined for matrices of identical shape"];
    }
    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        if (!(aVal >= bVal)) {
            return [false, ""];
        }
    }
    return [true, ""];
}

// NOTE: this is just a copypaste of matrixElementsEqual
export function matrixElementsLessThan(a: Matrix, b: Matrix): [boolean, string] {
    if (!matrixShapesAreEqual(a, b)) {
        return [false, "Elementwise ops only defined for matrices of identical shape"];
    }
    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        if (!(aVal < bVal)) {
            return [false, ""];
        }
    }
    return [true, ""];
}


// NOTE: this is just a copypaste of matrixElementsEqual
export function matrixElementsLessThanOrEqual(a: Matrix, b: Matrix): [boolean, string] {
    if (!matrixShapesAreEqual(a, b)) {
        return [false, "Elementwise ops only defined for matrices of identical shape"];
    }
    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        if (!(aVal <= bVal)) {
            return [false, ""];
        }
    }
    return [true, ""];
}

export function matixVectorDot(a: Matrix, b: Matrix): [number, string] {
    if (!matrixIsVector(a) || !matrixIsVector(b)) {
        return [0, "Dot is only defined for shape.length === 1 matricies"];
    }

    if (!matrixShapesAreEqual(a, b)) {
        throw new Error("Shapes weren't equal");
    }

    let result = 0;

    for (let i = 0; i < a.values.length; i++) {
        const aVal = getSliceValue(a.values, i);
        const bVal = getSliceValue(b.values, i);
        result += aVal * bVal;
    }

    return [result, ""];
}

export function matrixVectorCross(a: Matrix, b: Matrix): [Matrix | null, string] {
    if (!matrixIsVector(a) || !matrixIsVector(b)) {
        return [null, "Cross is only defined for a vector of length 3"];
    }

    if (a.shape[0] !== 3 || b.shape[0] !== 3) {
        return [null, "Cross is only defined for a vector of length 3"];
    }

    const a1 = getSliceValue(a.values, 0);
    const a2 = getSliceValue(a.values, 1);
    const a3 = getSliceValue(a.values, 2);

    const b1 = getSliceValue(b.values, 0);
    const b2 = getSliceValue(b.values, 1);
    const b3 = getSliceValue(b.values, 2);

    const result = matrixZeroes([3]);

    setSliceValue(result.values, 0, a2*b3 - a3*b2);
    setSliceValue(result.values, 1, a3*b1 - a1*b3);
    setSliceValue(result.values, 2, a1*b2 - a2*b1);

    return [result, ""];
}

export function matrixIsVector(a: Matrix) {
    return a.shape.length === 1;
}

export function matrixIsRank2(a: Matrix) {
    return a.shape.length === 2;
}

export function canMul(a: Matrix, b: Matrix) {
    return (matrixIsRank2(a) && matrixIsVector(b)) ||
        (matrixIsRank2(a) && matrixIsRank2(b));
}

export function transposeMatrix(a: Matrix): [Matrix | null, string] {
    if (!matrixIsRank2(a) && !matrixIsVector(a)) {
        return [null, "Can only transpose mxn matricies or vectors"];
    }

    const transposed = copyMatrix(a);
    if (a.shape.length === 1) {
        transposed.shape = [1, a.shape[0]];
    } else {
        const m = a.shape[0];
        const n = a.shape[1];
        transposed.shape[0] = n;
        transposed.shape[1] = m;

        for (let i = 0; i < m; i++) {
            for (let j = 0; j < n; j++) {
                const val = getMatrixValue(a, i, j);
                setMatrixValue(transposed, j, i, val);
            }
        }
    }

    return [transposed, ""];
}

export function matrixMul(a: Matrix, b: Matrix): [Matrix | null, string] {
    if (!canMul(a, b)) {
        return [null, "Mul is only defined for shape.length === 2 matricies, or Matrix * Vector"];
    }

    const aRows = a.shape[0];
    const aCols = a.shape[1];

    const bRows = b.shape[0];
    const bCols = b.shape.length === 2 ? b.shape[1] : 1;

    if (aCols !== bRows) {
        return [null, "AxB is only defined when A has the same number of columns as B has rows"];
    }

    const result = matrixZeroes([aRows, bCols]);

    for (let i = 0; i < aRows; i++) {
        for (let j = 0; j < bCols; j++) {
            let total = 0;
            for (let k = 0; k < aCols; k++) {
                const ijA = getSliceValueInternal(a, i, k, aCols);
                const ijB = getSliceValueInternal(b, k, j, bCols);

                total += ijA * ijB;
            }
            setMatrixValueInternal(result, i, j, total, bCols);
        }
    }

    return [result, ""]
}

export function transpose(a: Matrix): [Matrix | null, string] {
    if (matrixIsRank2(a)) {
        return [null, "Transpose is only defined for shape.length === 2 matricies"];
    }

    const aRows = a.shape[0];
    const aCols = a.shape[1];

    const result = matrixZeroes([aCols, aRows]);
    for (let i = 0; i < aRows; i++) {
        for (let j = 0; j < aCols; j++) {
            const ijVal = getMatrixValue(a, i, j);
            setMatrixValue(result, j, i, ijVal);
        }
    }

    return [result, ""];
}

export function identityMatrix(size: number): Matrix {
    const result = matrixZeroes([size, size]);

    for (let i = 0; i < size; i++) {
        setMatrixValue(result, i, i, 1);
    }

    return result;
}

export function inverseMatrix(a: Matrix): [Matrix | null, string] {
    if (matrixIsRank2(a)) {
        return [null, "Inversion is only defined for shape.length === 2 matricies"];
    }

    const n = a.shape[1];
    const aCopy = copyMatrix(a);
    const result = identityMatrix(n);
    gaussianElimination(aCopy, result);

    return [result, ""];
}

function swapRows(a: Matrix, r1: number, r2: number) {
    if (matrixIsRank2(a)) {
        return [null, "Row swapping is only defined for shape.length === 2 matricies"];
    }

    const n = a.shape[1];
    for (let i = 0; i < n; i++) {
        const r1Val = getMatrixValue(a, r1, i);
        const r2Val = getMatrixValue(a, r2, i);
        setMatrixValue(a, r1, i, r2Val);
        setMatrixValue(a, r2, i, r1Val);
    }
}

export function gaussianElimination(a: Matrix, toInvert?: Matrix): string {
    if (matrixIsRank2(a)) {
        return "Gaussian elimination is only defined for shape.length === 2 matricies";
    }

    // This algorithm was copy pasted from:
    // https://en.wikipedia.org/wiki/Gaussian_elimination

    const m = a.shape[0];
    const n = a.shape[1];

    let h = 0 /* Initialization of the pivot row */
    let k = 0 /* Initialization of the pivot column */

    // TODO: do same ops to the identity matrix to get the inverse.

    while (h <= m && k <= n) {
        /* Find the k-th pivot: */
        // i_max := argmax (i = h ... m, abs(A[i, k]))
        let iMax = 0; 
        let iMaxVal = Math.abs(getMatrixValue(a, 0, k));
        {
            for (let i = 1; i < m; i++) {
                let val = Math.abs(getMatrixValue(a, i, k));
                if (val > iMaxVal) {
                    iMaxVal = val;
                    iMax = i;
                }
            }
        }

        if (iMaxVal === 0) {
            /* No pivot in this column, pass to next column */
            k++;
        } else {
            swapRows(a, h, iMaxVal);
            if (toInvert) {
                swapRows(toInvert, h, iMaxVal);
            }
            /* Do for all rows below pivot: */
            for (let i = h; i < m; i++) {
                let f = getMatrixValue(a, i, k) / getMatrixValue(a, h, k);
                /* Fill with zeros the lower part of pivot column: */
                setMatrixValue(a, i, k, 0);
                if (toInvert) {
                    // TODO: validate
                    setMatrixValue(toInvert, i, k, 0);
                }
                /* Do for all remaining elements in current row: */
                for (let j = k; k < n; k++) {
                    const val = getMatrixValue(a, i, j) - getMatrixValue(a, h, j) * f;
                    setMatrixValue(a, i, j, val);
                    if (toInvert) {
                        // TODO: validate
                        const val = getMatrixValue(toInvert, i, j) - getMatrixValue(toInvert, h, j) * f;
                        setMatrixValue(toInvert, i, j, val);
                    }
                }
            }

            /* Increase pivot row and column */
            h++;
            k++;
        }
    }

    return "";
}

export function perspectiveProjection(): Matrix {
    // TODO: implement

    return matrixZeroes([1])
}

export function orthoProjection(): Matrix {
    // TODO: implement
    return matrixZeroes([1])
}

export function rotationMatrix2D(angle: number): Matrix {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const number: number[] = [
        cos, -sin, 0,
        sin, cos, 0,
        0,  0,  1,
    ];

    return {
        values: newSlice(number),
        shape: [3, 3],
    }
}

export function rotationMatrixTranslate2D(x: number, y: number): Matrix {
    const number: number[] = [
        1, 0, x,
        0, 1, y,
        0, 0, 1,
    ];

    return {
        values: newSlice(number),
        shape: [3, 3],
    }
}

export function scaleMatrix2D(x: number, y: number): Matrix {
    const number: number[] = [
        x, 0, 0,
        0, y, 0,
        0, 0, 1,
    ];

    return {
        values: newSlice(number),
        shape: [3, 3],
    }
}

// 3d stuff is a bit complicated, because we need quaternions.

export function rotationMatrix3DZ(angle: number): Matrix {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const number: number[] = [
        cos, -sin, 0, 0,
        sin, cos,  0, 0,
        0,  0,  1, 0,
        0,  0,  0, 1,
    ];

    return {
        values: newSlice(number),
        shape: [4, 4],
    }
}

export function rotationMatrix3DX(angle: number): Matrix {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const number: number[] = [
        1,  0,  0, 0,
        0, cos, -sin, 0,
        0, sin, cos,  0,
        0,  0,  0, 1,
    ];

    return {
        values: newSlice(number),
        shape: [4, 4],
    }
}

export function rotationMatrix3DY(angle: number): Matrix {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const number: number[] = [
        cos,  0,  -sin, 0,
        0,    1, 0, 0,
        sin, 0, cos,  0,
        0,  0,  0, 1,
    ];

    return {
        values: newSlice(number),
        shape: [4, 4],
    }
}

export function rotationMatrixTranslate3D(x: number, y: number, z: number): Matrix {
    const number: number[] = [
        1, 0, 0, x,
        0, 1, 0, y,
        0, 0, 1, z,
        0, 0, 0, 1,
    ];

    return {
        values: newSlice(number),
        shape: [4, 4],
    }
}

export function scaleMatrix3D(x: number, y: number, z: number): Matrix {
    const number: number[] = [
        x, 0, 0, 0,
        0, y, 0, 0,
        0, 0, z, 0,
        0, 0, 0, 1,
    ];

    return {
        values: newSlice(number),
        shape: [4, 4],
    }
}


// https://www.scratchapixel.com/lessons/3d-basic-rendering/perspective-and-orthographic-projection-matrix/building-basic-perspective-projection-matrix.html
export function perspectiveMatrix3D(
    fov: number,
    nearPlane: number,
    farPlane: number,
): Matrix {
    const s = 1 / Math.tan(
        // Our fov is already in radians
        (fov / 2)
    );

    const z1 = -farPlane / (farPlane - nearPlane);
    const z2 = -(farPlane * nearPlane) / (farPlane - nearPlane);

    const number: number[] = [
        s, 0, 0, 0,
        0, s, 0, 0,
        0, 0, z1, -1,
        0, 0, z2, 0,
    ];

    return {
        values: newSlice(number),
        shape: [4, 4],
    }
}

export function orthographicMatrix3D(): Matrix {
    const number: number[] = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 1,
    ];

    return {
        values: newSlice(number),
        shape: [4, 4],
    }
}
