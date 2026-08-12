import * as c2d from "..";

export type AxisSettings = {
	lo: number;
	hi: number;

	fitLo: number;
	fitHi: number;
}

export function newAxisSettings(): AxisSettings {
	return { lo: 0, hi: 1, fitLo: 0, fitHi: 1 };
}

export function getAxisDomain(axis: AxisSettings): number {
	return Math.abs(axis.hi - axis.lo);
}

export function getTickSizeForDomain(domain: number): number {
	// If size is 1, we want to have already switched to a tick size of 0.1.
	// This factor is a consistent way to do something similar for every size.
	// It's kinda arbitrary - I've tuned it by using it
	const tickFactor       = 0.4; 
	const closestPowerOf10 = Math.log10(tickFactor * domain);
	const tickSize         = Math.pow(10, Math.floor(closestPowerOf10));
	return tickSize;
}

export function getAxisTickSize(axis: AxisSettings) {
	const yDomain  = getAxisDomain(axis);
	const tickSize = getTickSizeForDomain(yDomain);
	return tickSize;
}

export function getAxisTickStart(axis: AxisSettings, tickSize: number): number {
	return Math.floor(axis.lo / tickSize) * tickSize;
}

export type ClientRect = {
	left:   number;
	top:    number;
	width:  number;
	height: number;
};

export function newClientRect(): ClientRect {
	return {
		left: 0,
		top: 0,
		width: 0,
		height: 0,
	};
}

export function initClientRect(clientRect: ClientRect, s: c2d.State) {
	const rect = s.canvas.getBoundingClientRect();
	clientRect.left   = rect.left;
	clientRect.top    = rect.top;
	clientRect.width  = rect.width;
	clientRect.height = rect.height;
}

