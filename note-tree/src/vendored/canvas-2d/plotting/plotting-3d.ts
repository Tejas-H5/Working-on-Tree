import * as c2d from "..";
import { AxisSettings, ClientRect, newAxisSettings, newClientRect } from "./shared";

// NOTE: 2d and 3d plot are actually very similar. 
// Once we get 3d plot working, we can just delete the 2d plot and reuse the 3d plot for it.

export type Vec3 = {
	x: number;
	y: number;
	z: number;
}

export function newVec3(): Vec3 {
	return {
		x: 0,
		y: 0,
		z: 0,
	};
}

export type PlotState3d = {
	x: AxisSettings;
	y: AxisSettings;
	z: AxisSettings;

	fontSize:    number;
	clientRect:  ClientRect;

	computed: {
		relativePos: Vec3;
	};

	camera: {
		pos:    Vec3;
		target: Vec3;

		up:      Vec3;
		forward: Vec3;
		right:   Vec3;
	};

	version:   number;
}

export function newPlotState3d(): PlotState3d {
	return {
		version:   0,

		x: newAxisSettings(),
		y: newAxisSettings(),
		z: newAxisSettings(),

		fontSize:    0,
		clientRect:  newClientRect(),

		computed: {
			relativePos:  newVec3(),
		},

		camera: {
			pos:    newVec3(),
			target: newVec3(),

			up:      newVec3(),
			forward: newVec3(),
			right:   newVec3(),
		},
	};
}

export function initPlot3d(plot: PlotState3d, s: c2d.State) {
	plot.fontSize = plot.fontSize;

	const rect = s.canvas.getBoundingClientRect();
	plot.clientRect.left   = rect.left;
	plot.clientRect.top    = rect.top;
	plot.clientRect.width  = rect.width;
	plot.clientRect.height = rect.height;
}

export function plotPoints3d(s: c2d.State, plot3d: PlotState3d, xAxis: number[], yAxis: number[], zAxis: number[], lines = false) {
	let numDataPoints = Math.max(xAxis.length, yAxis.length);

	let xPrev = 0, yPrev = 0, zPrev = 0;

	const xCenter = s.width / 2;
	const yCenter = s.height / 2;

	const fovDegrees = 70;
	const fov        = (Math.PI / 180) * fovDegrees / 2;
	// Math - let's work through computing the x position of a point for a desired FOV - 
	//      tan(angleOfPointToCamera) = righrwardsPos / forwardsPos
	//
	//  x -\|   __^------|
	//   ___*--- a )     | rightwards
	// -----|-----v------+
	//    1    forwards
	//
	// AND: tan(fov) = this is something we can just compute here. 
	// If the center of the screen corresponds with an angle of 0, and the leftmost (or rightmost) point is an angle of fov, then
	// the x position on the screen would just be screenWidth * (righrwardsPos / forwardsPos) / tan(fov).
	// I've simply extracted screenWidth / tan(fov) into a reuseable factor here, so I can do xExtent * (righrwardsPos / forwardsPos)
	// Similar can be done for the y extent.
	// TODO: take aspect ratio into account, pretty sure we don't do that here.
	const xExtent = s.width  / Math.tan(fov);
	const yExtent = s.height / Math.tan(fov);

	for (let i = 0; i < numDataPoints; i++) {
		const x = xAxis[i];
		const y = yAxis[i];
		const z = zAxis[i];

		computeRelativePos(plot3d, x, y, z);

		// This is equivelant to a matrix multiplication
		const rightwardsPos = dot(plot3d.camera.right,   plot3d.computed.relativePos);
		const upwardsPos    = dot(plot3d.camera.right,   plot3d.computed.relativePos);
		const forwardsPos   = dot(plot3d.camera.forward, plot3d.computed.relativePos);

		const isBehindCamera = forwardsPos < 0;
		if (isBehindCamera) {
			continue
		}

		const xAmount = xExtent * (rightwardsPos / forwardsPos);
		const yAmount = yExtent * (upwardsPos    / forwardsPos);

		if (lines) {
			if (i > 0) {
				c2d.drawLine(s, xPrev, yPrev, x, y, 2);
			}
		} 

		c2d.drawCircle(s, xAmount, yAmount, 4);

		xPrev = x;
		yPrev = y;
	}
}

export function computeRelativePos(plot3d: PlotState3d, x: number, y: number, z: number) {
	const relativePos = plot3d.computed.relativePos;
	const cameraPos   = plot3d.camera.pos;
	relativePos.x = x - cameraPos.x;
	relativePos.y = y - cameraPos.y;
	relativePos.z = z - cameraPos.z;
}

export function dot(a: Vec3, b: Vec3): number {
	return a.x * b.x + 
		   a.y * b.y + 
		   a.z * b.z;
}
