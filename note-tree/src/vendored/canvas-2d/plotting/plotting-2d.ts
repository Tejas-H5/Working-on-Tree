import * as c2d from "..";
import {
	newAxisSettings,
	AxisSettings,
	ClientRect,
	newClientRect,
	getTickSizeForDomain,
	getAxisTickSize,
	getAxisTickStart
} from "./shared";

export const POINT = 0;
export const LINE  = 1;

export type Type =
 | typeof POINT
 | typeof LINE
 ;

export type PlotState2d = {
	x: AxisSettings;
	y: AxisSettings;

	fontSize:           number;
	clientRect:         ClientRect;
	axisOffsetFromEdge: number;

	version: number;
	dragState: {
		interaction: DragInteractionType;
		x: number; xLo: number; xHi: number;
		y: number; yLo: number; yHi: number;
		version: number;
	};
}

export function newPlotState2d(): PlotState2d {
	return {
		version: 0,

		x: newAxisSettings(),
		y: newAxisSettings(),
		fontSize: 0, 
		clientRect: newClientRect(),

		axisOffsetFromEdge: 0,

		dragState: {
			version: 0,
			interaction: NOTHING,
			x: 0, y: 0, xLo: 0, xHi: 0, yLo: 0, yHi: 0,
		}
	};
}

export function refitPlot2d(plotState: PlotState2d, xAxis: number[], yAxis: number[]) {
	let xMin = 0; let xMax = 0;
	let yMin = 0; let yMax = 0;

	for (let i = 0; i < xAxis.length; i++) {
		xMin = Math.min(xMin, xAxis[i]);
		xMax = Math.max(xMax, xAxis[i]);
		yMin = Math.min(yMin, yAxis[i]);
		yMax = Math.max(yMax, yAxis[i]);
	}

	plotState.x.lo = xMin; plotState.x.hi = xMax;
	plotState.y.lo = yMin; plotState.y.hi = yMax;

	plotState.x.hi += getTickSizeForDomain(xMax - xMin);
	plotState.y.hi += getTickSizeForDomain(yMax - yMin);

	plotState.x.fitLo = plotState.x.lo; 
	plotState.y.fitLo = plotState.y.lo; 
	plotState.x.fitHi = plotState.x.hi;
	plotState.y.fitHi = plotState.y.hi;
}


export function initPlot(plot: PlotState2d, s: c2d.State) {
	plot.fontSize = plot.fontSize;

	const rect = s.canvas.getBoundingClientRect();
	plot.clientRect.left   = rect.left;
	plot.clientRect.top    = rect.top;
	plot.clientRect.width  = rect.width;
	plot.clientRect.height = rect.height;

	const gap                = 4;
	plot.axisOffsetFromEdge  = s.fontSizePx + gap;
}

export function plotCrosshairs(s: c2d.State, plot: PlotState2d, mouseX: number, mouseY: number) {
	mouseX -= plot.clientRect.left;
	mouseY -= plot.clientRect.top;
	c2d.drawLine(s, 0, mouseY, s.width, mouseY, 1);
	c2d.drawLine(s, mouseX, 0, mouseX, s.height, 1);
}

export function getAxisLabel(num: number): string {
	if (Math.abs(num) < 0.00000001) {
		return "0";
	}
	return num.toPrecision(3);
}

export function plotAxes(
	s: c2d.State,
	plot: PlotState2d,
	xAxisName: string, yAxisName: string,
) {
	const initialFontSize = s.fontSizePx;

	const xCenter = s.width  / 2;
	const yCenter = s.height / 2;

	c2d.drawLabel(s, xCenter, s.height, xAxisName, 0, -1, 0);
	c2d.drawLabelRotated(s, 0, yCenter, yAxisName, 0, 1, 0, -Math.PI / 2);

	const thickness = 1;

	c2d.setFont(s, s.fontName, initialFontSize / 2);

	// X axis
	{
		const yLine = s.height - plot.axisOffsetFromEdge;
		c2d.drawLine(s, 0, yLine, s.width, yLine, 1);

		const tickSize = 5;
		const tickGap  = getAxisTickSize(plot.x);
		const xStart   = getAxisTickStart(plot.x, tickGap);
		for (let x = xStart; x < plot.x.hi; x += tickGap) {
			const xTick = mapXAxisToScreenX(s, plot, x);
			c2d.drawLine(s, xTick, yLine, xTick, yLine - tickSize, thickness);
			c2d.drawLabel(s, xTick, yLine - tickSize, getAxisLabel(x), 0, -1, 2);
		}
	}

	// Y axis
	{
		const xLine = plot.axisOffsetFromEdge;
		c2d.drawLine(s, xLine, 0, xLine, s.height, thickness);

		const tickSize = 5;
		const tickGap  = getAxisTickSize(plot.y);
		const yStart   = getAxisTickStart(plot.y, tickGap);
		for (let y = yStart; y < plot.y.hi; y += tickGap) {
			const yTick = mapYAxisToScreenY(s, plot, y);
			c2d.drawLine(s, xLine, yTick, xLine + tickSize, yTick, thickness);
			c2d.drawLabel(s, xLine + tickSize, yTick, getAxisLabel(y), 1, 0, 4);
		}
	}

	c2d.setFont(s, s.fontName, initialFontSize);
}

export function isOverBottomAxis(plot: PlotState2d, mouseY: number): boolean {
	const top  = plot.clientRect.top;
	mouseY     = -(mouseY - top - plot.clientRect.height);
	return 0 < mouseY && mouseY < plot.axisOffsetFromEdge;
}

export function isOverLeftAxis(s: c2d.State, plot: PlotState2d, mouseX: number): boolean {
	mouseX -= plot.clientRect.left;
	return 0 < mouseX && mouseX < plot.axisOffsetFromEdge;
}

export const NOTHING  = 0;
export const DRAGGING = 1;
export const ZOOMING  = 2;

export type DragInteractionType = 
 | typeof NOTHING
 | typeof DRAGGING
 | typeof ZOOMING
 ;

export function handleDragInteraction(
	s: c2d.State,
	plot: PlotState2d,
	startingInteraction: boolean,
	interaction: DragInteractionType,
	mouseX: number, mouseY: number, 
) {
	const dragState = plot.dragState;

	if (startingInteraction) {
		dragState.interaction = interaction;
		dragState.x = mouseX;
		dragState.y = mouseY;
		dragState.xLo = plot.x.lo;
		dragState.xHi = plot.x.hi;
		dragState.yLo = plot.y.lo;
		dragState.yHi = plot.y.hi;
		dragState.version += 1;
	}

	if (dragState.interaction !== NOTHING) {
		plot.x.lo = dragState.xLo; plot.x.hi = dragState.xHi;
		plot.y.lo = dragState.yLo; plot.y.hi = dragState.yHi;

		const dx = -(mapScreenXToXAxis(s, plot, mouseX) - mapScreenXToXAxis(s, plot, dragState.x));
		const dy =   mapScreenYToYAxis(s, plot, mouseY) - mapScreenYToYAxis(s, plot, dragState.y);

		if (dragState.interaction === DRAGGING) {
			plot.x.lo = dragState.xLo + dx; plot.x.hi = dragState.xHi + dx;
			plot.y.lo = dragState.yLo + dy; plot.y.hi = dragState.yHi + dy;
		} else if (dragState.interaction === ZOOMING) {
			plot.x.lo = dragState.xLo - dx; plot.x.hi = dragState.xHi + dx;
			plot.y.lo = dragState.yLo - dy; plot.y.hi = dragState.yHi + dy;
		}

		fixPlotDomain(plot);

		plot.version += 1;
	}

	if (dragState.interaction !== interaction && interaction === NOTHING) {
		dragState.interaction = NOTHING;
		dragState.version += 1;
	}
}

export function mapYAxisToScreenY(s: c2d.State, plot: PlotState2d, val: number) {
	return s.height - mapValueToScreen(plot, plot.y, val, s.height);
}

export function mapScreenYToYAxis(s: c2d.State, plot: PlotState2d, val: number) {
	return mapScreenToValue(plot, plot.y, val - s.height, s.height);
}

export function mapXAxisToScreenX(s: c2d.State, plot: PlotState2d, val: number) {
	return mapValueToScreen(plot, plot.x, val, s.width);
}

export function mapScreenXToXAxis(s: c2d.State, plot: PlotState2d, val: number) {
	return mapScreenToValue(plot, plot.x, val, s.width);
}

export function plotPoints2d(s: c2d.State, options: PlotState2d, xAxis: number[], yAxis: number[], lines = false) {
	let numDataPoints = Math.max(xAxis.length, yAxis.length);

	let xPrev = 0, yPrev = 0;

	for (let i = 0; i < numDataPoints; i++) {
		const x = mapXAxisToScreenX(s, options, xAxis[i]);
		const y = mapYAxisToScreenY(s, options, yAxis[i]);

		if (lines) {
			if (i > 0) {
				c2d.drawLine(s, xPrev, yPrev, x, y, 2);
			}
		} 

		c2d.drawCircle(s, x, y, 4);

		xPrev = x;
		yPrev = y;
	}
}

export function mapValueToScreen(plot: PlotState2d, axisSettings: AxisSettings, val: number, screenSize: number): number {
	const offset   = plot.axisOffsetFromEdge;
	const realSize = screenSize - offset;
	let t = (val - axisSettings.lo) / (axisSettings.hi - axisSettings.lo);
	return offset + t * realSize;
}

export function mapScreenToValue(plot: PlotState2d, axisSettings: AxisSettings, val: number, screenSize: number): number {
	const offset   = plot.axisOffsetFromEdge;
	const realSize = screenSize - offset;
	const t = val / realSize;
	return t * (axisSettings.hi - axisSettings.lo) + axisSettings.lo;
}

export function fixPlotDomain(plot: PlotState2d) {
	fixPlotAxis(plot.x);
	fixPlotAxis(plot.y);
}

export function fixPlotAxis(axis: AxisSettings) {
	const size = axis.fitHi - axis.fitLo;
	const minSize = 0.001 * size;
	const maxSize = 2  * size;

	const axisSize = axis.hi - axis.lo;
	if (axisSize < minSize) {
		let mid = 0.5 * axis.hi + 0.5 * axis.lo;
		axis.lo = mid - minSize / 2;
		axis.hi = mid + minSize / 2;
	} else if (axisSize > maxSize) {
		let mid = 0.5 * axis.hi + 0.5 * axis.lo;
		axis.lo = mid - maxSize / 2;
		axis.hi = mid + maxSize / 2;
	}
}

