import { assert } from "./assert";
import * as vector from "./vector";

export type Matrix = {
	data: number[];
	rows: number;
	cols:  number;
}

export function toString(mat: Matrix): string {
	let sb: string[] = [];

	for (let row = 0; row < mat.rows; row++) {
		sb.push("\n    [");
		for (let col = 0; col < mat.cols; col++) {
			if (col !== 0) sb.push(", ");

			const idx = getIndex(mat, row, col);
			sb.push("" + mat.data[idx]);
		}
		sb.push("],");
	}

	return sb.join("");
}


export function getIndex(mat: Matrix, row: number, col: number): number {
	return row * mat.cols + col;
}

export function get(mat: Matrix, row: number, col: number): number {
	return mat.data[getIndex(mat, row, col)] ?? 0;
}

export function set(mat: Matrix, row: number, col: number, val: number) {
	const idx = getIndex(mat, row, col);
	if (idx < mat.data.length) {
		mat.data[idx] = val;
	}
}

export function setAxis(mat: Matrix, col: number, vec: vector.Vec) {
	for (let i = 0; i < vec.length; i++) {
		const idx = getIndex(mat, i, col);
		mat.data[idx] = vec[i];
	}
}

export function mulVec(m: Matrix, vec: number[], result: number[]): string | undefined {
	if (m.cols !== vec.length) {
		return "m1.cols !== vec.length";
	}

	for (let a1Row = 0; a1Row < m.rows; a1Row++) {
		let sum = 0;
		for (let k = 0; k < m.cols; k++) {
			const a1Idx = getIndex(m, a1Row, k);
			sum += m.data[a1Idx] * vec[k];
		}
		result[a1Row] = sum;
	}

	return undefined;
}

export function mulMatrixAllocate(m1: Matrix, m2: Matrix): Matrix {
	return {
		rows: m1.rows,
		cols: m2.cols,
		data: Array(m1.cols * m2.rows).fill(0),
	};
}

export function mulMatrix(m1: Matrix, m2: Matrix, result: Matrix): string | undefined {
	if (m1.cols !== m2.rows) return "m1.cols !== m2.rows";

	for (let a1Row = 0; a1Row < m1.rows; a1Row++) {
		for (let a2Col = 0; a2Col < m2.cols; a2Col++) {
			let sum = 0;
			for (let k = 0; k < m1.cols; k++) {
				const a1Idx = getIndex(m1, a1Row, k);
				const a2Idx = getIndex(m2, k, a2Col);
				sum += m1.data[a1Idx] * m2.data[a2Idx];
			}
			const resultIdx = getIndex(result, a1Row, a2Col);
			result.data[resultIdx] = sum;
		}
	}

	return undefined;
}

export function setScale(m: Matrix, x: number, y: number, z: number) {
	m.data.fill(0);
	set(m, 0, 0, x);
	set(m, 1, 1, y);
	set(m, 2, 2, z);
}

export function setPosTargetUp(m: Matrix, pos: vector.Vec3, target: vector.Vec3, up: vector.Vec3) {
	m.data.fill(0);

	const result = vector.vec4();

	// Avoiding quaternion like the plage for now. 
	// TODO: We'll add them later.

	vector.clear(result);
	vector.add(result, target);
	vector.sub(result, pos);
	vector.normalize(result);
	setAxis(m, 2, result); // forward axis

	// TODO: handle the case when target and up are kinda close.
	vector.normalize(up);
	setAxis(m, 1, up);

	vector.cross(result, result, up);
	setAxis(m, 0, result);

	// Also the camera transform.
	setAxis(m, 3, pos);

	// I guess we don't need the bottom row of the 4x4 matrix really ...
}

export function invert(m: Matrix): string | undefined {
	if (m.rows !== m.cols)                      return "Only square matrices are invertible";
	if (m.rows !== m.rows || m.cols !== m.cols) return "Destination and original should be the same size";

	switch (m.rows) {
		case 1: {
			m.data[0] = 1 / m.data[0]
		} break;
		case 2: {
			const aIdx = getIndex(m, 0, 0)
			const bIdx = getIndex(m, 0, 1)
			const cIdx = getIndex(m, 1, 0)
			const dIdx = getIndex(m, 1, 1)

			const a = m.data[aIdx];
			const b = m.data[bIdx];
			const c = m.data[cIdx];
			const d = m.data[dIdx];

			const det =  a * d - (b * c);
			m.data[aIdx] = d / det;
			m.data[bIdx] = -b / det;
			m.data[cIdx] = -c / det;
			m.data[dIdx] = a / det;
		} break;
		case 3: {
			// TODO: learn abt how this works - AI wrote this

			const aIdx = getIndex(m, 0, 0); const bIdx = getIndex(m, 0, 1); const cIdx = getIndex(m, 0, 2);
			const dIdx = getIndex(m, 1, 0); const eIdx = getIndex(m, 1, 1); const fIdx = getIndex(m, 1, 2);
			const gIdx = getIndex(m, 2, 0); const hIdx = getIndex(m, 2, 1); const iIdx = getIndex(m, 2, 2);

			const a = m.data[aIdx]; const b = m.data[bIdx]; const c = m.data[cIdx];
			const d = m.data[dIdx]; const e = m.data[eIdx]; const f = m.data[fIdx];
			const g = m.data[gIdx]; const h = m.data[hIdx]; const i = m.data[iIdx];

			const A = (e * i - h * f);
			const B = (f * g - d * i);
			const C = (d * h - g * e);

			const det = a * A + b * B + c * C;
			if (Math.abs(det) < 0.00001) return "Matrix doesn't have an inverse";

			const invDet = 1.0 / det;

			m.data[0] = A * invDet; m.data[1] = (c * h - b * i) * invDet; m.data[2] = (b * f - c * e) * invDet;
			m.data[3] = B * invDet; m.data[4] = (a * i - c * g) * invDet; m.data[5] = (d * c - a * f) * invDet;
			m.data[6] = C * invDet; m.data[7] = (g * b - a * h) * invDet; m.data[8] = (a * e - d * b) * invDet;
		} break;
		case 4: {
			// TODO: learn abt how this works - AI wrote this too

			const d = m.data;
			const inv = m.data;

			// First row cofactors
			const inv0 = d[5] * d[10] * d[15] - d[5] * d[11] * d[14] - d[9] * d[6] * d[15] +
				d[9] * d[7] * d[14] + d[13] * d[6] * d[11] - d[13] * d[7] * d[10];

			const inv1 = -d[1] * d[10] * d[15] + d[1] * d[11] * d[14] + d[9] * d[2] * d[15] -
				d[9] * d[3] * d[14] - d[13] * d[2] * d[11] + d[13] * d[3] * d[10];

			const inv2 = d[1] * d[6] * d[15] - d[1] * d[7] * d[14] - d[5] * d[2] * d[15] +
				d[5] * d[3] * d[14] + d[13] * d[2] * d[7] - d[13] * d[3] * d[6];

			const inv3 = -d[1] * d[6] * d[11] + d[1] * d[7] * d[10] + d[5] * d[2] * d[11] -
				d[5] * d[3] * d[10] - d[9] * d[2] * d[7] + d[9] * d[3] * d[6];

			// Second row cofactors
			const inv4 = -d[4] * d[10] * d[15] + d[4] * d[11] * d[14] + d[8] * d[6] * d[15] -
				d[8] * d[7] * d[14] - d[12] * d[6] * d[11] + d[12] * d[7] * d[10];

			const inv5 = d[0] * d[10] * d[15] - d[0] * d[11] * d[14] - d[8] * d[2] * d[15] +
				d[8] * d[3] * d[14] + d[12] * d[2] * d[11] - d[12] * d[3] * d[10];

			const inv6 = -d[0] * d[6] * d[15] + d[0] * d[7] * d[14] + d[4] * d[2] * d[15] -
				d[4] * d[3] * d[14] - d[12] * d[2] * d[7] + d[12] * d[3] * d[6];

			const inv7 = d[0] * d[6] * d[11] - d[0] * d[7] * d[10] - d[4] * d[2] * d[11] +
				d[4] * d[3] * d[10] + d[8] * d[2] * d[7] - d[8] * d[3] * d[6];

			// Third row cofactors
			const inv8 = d[4] * d[9] * d[15] - d[4] * d[11] * d[13] - d[8] * d[5] * d[15] +
				d[8] * d[7] * d[13] + d[12] * d[5] * d[11] - d[12] * d[7] * d[9];

			const inv9 = -d[0] * d[9] * d[15] + d[0] * d[11] * d[13] + d[8] * d[1] * d[15] -
				d[8] * d[3] * d[13] - d[12] * d[1] * d[11] + d[12] * d[3] * d[9];

			const inv10 = d[0] * d[5] * d[15] - d[0] * d[7] * d[13] - d[4] * d[1] * d[15] +
				d[4] * d[3] * d[13] + d[12] * d[1] * d[7] - d[12] * d[3] * d[5];

			const inv11 = -d[0] * d[5] * d[11] + d[0] * d[7] * d[9] + d[4] * d[1] * d[11] -
				d[4] * d[3] * d[9] - d[8] * d[1] * d[7] + d[8] * d[3] * d[5];

			// Fourth row cofactors
			const inv12 = -d[4] * d[9] * d[14] + d[4] * d[10] * d[13] + d[8] * d[5] * d[14] -
				d[8] * d[6] * d[13] - d[12] * d[5] * d[10] + d[12] * d[6] * d[9];

			const inv13 = d[0] * d[9] * d[14] - d[0] * d[10] * d[13] - d[8] * d[1] * d[14] +
				d[8] * d[2] * d[13] + d[12] * d[1] * d[10] - d[12] * d[2] * d[9];

			const inv14 = -d[0] * d[5] * d[14] + d[0] * d[6] * d[13] + d[4] * d[1] * d[14] -
				d[4] * d[2] * d[13] - d[12] * d[1] * d[6] + d[12] * d[2] * d[5];

			const inv15 = d[0] * d[5] * d[10] - d[0] * d[6] * d[9] - d[4] * d[1] * d[10] +
				d[4] * d[2] * d[9] + d[8] * d[1] * d[6] - d[8] * d[2] * d[5];

			// Assignment
			inv[0] = inv0; inv[1] = inv1; inv[2] = inv2; inv[3] = inv3;
			inv[4] = inv4; inv[5] = inv5; inv[6] = inv6; inv[7] = inv7;
			inv[8] = inv8; inv[9] = inv9; inv[10] = inv10; inv[11] = inv11;
			inv[12] = inv12; inv[13] = inv13; inv[14] = inv14; inv[15] = inv15;

			// Calculate the determinant
			const det = d[0] * inv0 + d[1] * inv4 + d[2] * inv8 + d[3] * inv12;

			// If the matrix is singular, error out
			if (Math.abs(det) < 0.000001) return "This matrix has no inverse";

			const invDet = 1 / det;

			// Multiply adjoint by the determinant
			for (let i = 0; i < 16; i++) {
				inv[i] = inv[i] * invDet;
			}
		} break;
		// TODO: Odin codebase does this with LU decomposition (but we dont care too much about the larger matrices yet though so I haven't bothered adding it yet)
		// In the previous attempt at this programming language, I did gauss-jordan elimination to invert the matrices I think. Could port that over too.
		default: return "We dont support inverting a matrix larger than 4, sorry";
	}

	return undefined;
}

export function transposed(m: Matrix): Matrix {
	const result = create(m.cols, m.rows);

	for (let row = 0; row < m.rows; row++) {
		for (let col = 0; col < m.cols; col++) {
			const srcIdx = getIndex(m, row, col);
			const dstIdx = getIndex(result, col, row);
			result.data[dstIdx] = m.data[srcIdx];
		}
	}

	return result;
}

export function create(rows: number, cols: number): Matrix {
	return {
		rows: rows,
		cols: cols,
		data: Array(cols * rows).fill(0),
	};
}

export function clone(mat: Matrix): Matrix {
	return {
		rows: mat.rows,
		cols: mat.cols,
		data: mat.data.map(x => x),
	};
}

export function clear(mat: Matrix) {
	mat.data.fill(0);
}

export function setIdentity(mat: Matrix) {
	mat.data.fill(0);
	for (let i = 0; i < mat.rows; i++) {
		set(mat, i, i, 1);
	}
}

export function copy(src: Matrix, dst: Matrix) {
	assert(src.rows === dst.rows);
	assert(src.cols === dst.cols);
	for (let i = 0; i < src.data.length; i++) {
		dst.data[i] = src.data[i];
	}
}
