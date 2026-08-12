export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
export type Vec = number[];

export function vec2(): Vec2 {
	return Array(2).fill(0) as Vec2;
}

export function vec3(): Vec3 {
	return Array(3).fill(0) as Vec3;
}

export function vec4(): Vec3 {
	return Array(4).fill(0) as Vec3;
}

export function len2(v: Vec) {
	let result = 0;
	for (let i = 0; i < v.length; i++) {
		result += v[i] * v[i];
	}
	return result;
}

export function len(v: Vec) {
	return Math.sqrt(len2(v));
}

export function normalize(v: Vec) {
	const length = len(v);
	divScalar(v, length);
}

export function clear(dst: Vec) {
	for (let i = 0; i < dst.length; i++) dst[i] = 0;
}

export function dot(a: Vec, b: Vec): number {
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result += a[i] * b[i];
	}
	return result;
}

// NOTE: only valid for 3D vectors.
export function cross(dst: Vec, a: Vec, b: Vec) {
	const x = a[1] * b[2] - a[2] * b[1];
	const y = a[2] * b[0] - a[0] * b[2];
	const z = a[0] * b[1] - a[1] * b[0];

	dst[0] = x;
	dst[1] = y;
	dst[2] = z;
}

export function add(dst: Vec, src: Vec) {
	for (let i = 0; i < dst.length; i++) dst[i] += src[i];
}

export function sub(dst: Vec, src: Vec) {
	for (let i = 0; i < dst.length; i++) dst[i] -= src[i];
}

export function mul(dst: Vec, src: Vec) {
	for (let i = 0; i < dst.length; i++) dst[i] *= src[i];
}

export function div(dst: Vec, src: Vec) {
	for (let i = 0; i < dst.length; i++) dst[i] /= src[i];
}

export function divScalar(dst: Vec, scalar: number) {
	for (let i = 0; i < dst.length; i++) dst[i] /= scalar;
}

export function mulScalar(dst: Vec, scalar: number) {
	for (let i = 0; i < dst.length; i++) dst[i] *= scalar;
}

