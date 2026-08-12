import { assertNever } from "assert";
import { im, ImCache, imdom, key } from "im-js";
import { BLOCK, CENTER, COL, cssVars, INLINE, ROW, ROW_WRAP } from "im-js/im-ui";
import { imC2dBegin, imC2dEnd } from "im-canvas-2d";
import { ast, pl2 } from "pl2";
import * as c2d from "canvas-2d";
import {
    imB,
    imBegin,
    imCodeBegin,
    imCodeEnd,
    imCodeSpanBegin,
    imCodeSpanEnd,
    imEnd,
    imFlex,
    imHSpace,
    imHSpaceSmall,
    imPreWrap,
    imStr,
    imStrFmt,
    imSubHeading,
    imVDivider,
    imVSpace,
    imVSpaceSmall,
} from "./ui-primitives";
import * as plt from "canvas-2d/plotting";
import { imButtonPressed } from "im-js/im-ui/components/im-button";

export type Pl2CodeCellOutput = {
	iter:         pl2.ProgramIterator;

	environment: {
		width:  number;
		height: number;
	};

	evaluateTime:   number;
	canvasDrawTime: number;
};

export function newCodeCellOutput(): Pl2CodeCellOutput {
	return {
		iter: pl2.interpretCode(""),
		environment: {
			width: 0,
			height: 0,
		},
		evaluateTime: 0,
		canvasDrawTime: 0,
	};
}

export function updateCodeCellOutput(output: Pl2CodeCellOutput, code: string) {
	const environment = new Map<string, pl2.Result>([
		["screen_width",  pl2.newNumber(output.environment.width)],
		["screen_height", pl2.newNumber(output.environment.height)],
	]);
	output.iter = pl2.interpretCode(code, environment);
}

function initializeC2d(s: c2d.State) {
	c2d.setColor(s, 1, 1, 1, 1);
	c2d.drawBackground(s);
	c2d.setFont(s, "Inter", 20);
	c2d.setColor(s, 0, 0, 0, 1);
}

function getDesiredAspectRatio(): number {
	return window.innerWidth / window.innerHeight;
}

function imDrawCalls(c: ImCache, output: Pl2CodeCellOutput) {
	const drawCalls = output.iter.drawCalls;

	const s = imC2dBegin(c, getDesiredAspectRatio());
	if (s) {
		if (im.Memo(c, drawCalls)) {
			const t0 = performance.now();

			initializeC2d(s);

			for (let i = 0; i < drawCalls.length; i++) {
				const call = drawCalls[i];

				switch (call.type) {
					case pl2.DrawCall_Line: {
						c2d.drawLine(s, call.p0[0], call.p0[1], call.p1[0], call.p1[1], call.thickness);
					} break;
					case pl2.DrawCall_Circle: {
						c2d.drawCircle(s, call.p0[0], call.p0[1], call.radius);
					} break;
					case pl2.DrawCall_Square: {
						c2d.drawSquare(s, call.p0[0], call.p0[1], call.radius);
					} break;
					case pl2.DrawCall_Rectangle: {
						c2d.drawRect(s, call.p0[0], call.p0[1], call.p1[0], call.p1[1]);
					} break;
					case pl2.DrawCall_Background: {
						c2d.drawBackground(s);
					} break;
					case pl2.DrawCall_Label: {
						c2d.setFont(s, s.fontName, call.size);
						c2d.drawLabelRotated(
							s,
							call.p0[0], call.p0[1],
							call.text,
							call.direction[0], call.direction[1],
							s.fontSizePx / 5,
							call.rotation,
						);
					} break;
					case pl2.DrawCall_SetColor: {
						c2d.setColor(s, call.color.r, call.color.g, call.color.b, call.color.a);
					} break;
					case pl2.DrawCall_SetFontSize: {
						c2d.setFont(s, s.fontName, call.size);
					} break;
					default: assertNever(call)
				}
			}

			output.canvasDrawTime = performance.now() - t0;
		}
	} imC2dEnd(c, s);
}

export function imPl2CodeCellOutput(c: ImCache, output: Pl2CodeCellOutput) {
	// We'll need this to know the sizes of UI elements before we've ever drawn them.
	// Alternatively, we can just interpret the program once, figure out which UI elements it needs, get the 
	// sizes from the DOM, and re-interpret the programs. I have decided to avoid this route for performance reasons.
	const columnWidth = imdom.getElement(c).clientWidth;
	if (im.Memo(c, columnWidth)) {
		output.environment.width  = columnWidth * window.devicePixelRatio;
		output.environment.height = columnWidth * window.devicePixelRatio / getDesiredAspectRatio();
	}

	const interpretResult = output.iter;
	const code            = output.iter.program.code;

	if (im.If(c) && interpretResult.errors.length > 0) {
		// NOTE: maybe we want to persist the last good output here.
		im.For(c); for (const err of interpretResult.errors) {
			imBegin(c, ROW); imPreWrap(c); {
				imCodeSpanBegin(c); {
					if (im.If(c) && err.expr) {
						imStr(c, ast.expressionToString(code, err.expr));
					} else {
						im.IfElse(c);

						let start = Math.max(0, err.pos.i - 10);
						const end = err.pos.i + 1;
						imStr(c, code.substring(start, end));
					} im.IfEnd(c);
				} imCodeSpanEnd(c);

				imHSpace(c, cssVars.bg);

				imStr(c, err.message);
			} imEnd(c);
		} im.ForEnd(c);
	} else if (im.ElseIf(c)) {
		// imStr(c, "Ran in "); imStr(c, Math.round(output.evalTime)); imStr(c, "ms");

		imCodeBegin(c); {
			im.For(c); 
			if (interpretResult.printOutputs.length > 0) {
				for (const p of interpretResult.printOutputs) {
					imStr(c, p);
				} 
			} else {
				imStr(c, "No output");
			}
			im.ForEnd(c);
		} imCodeEnd(c);

		const globalVars = interpretResult.scopes[0].vars;
		if (im.If(c) && globalVars.size > 0) {
			imVDivider(c);

			im.For(c); for (const [k, v] of globalVars) {
				imBegin(c, BLOCK); {
					imCodeSpanBegin(c); {
						imStr(c, k);
					} imCodeSpanEnd(c);
					imStr(c, " = ");
					imStrFmt(c, v, pl2.resultToString);
					imStr(c, " | ");
					imStr(c, pl2.resultTypeToString(v.type));
				} imEnd(c);
			} im.ForEnd(c)
		} im.IfEnd(c);

		if (im.If(c) && interpretResult.drawCalls.length > 0) {
			imVDivider(c);
			
			imSubHeading(c, "Drawing");
			imDrawCalls(c, output);
			imStr(c, "Rendered in "); imStr(c, Math.round(output.canvasDrawTime)); imStr(c, "ms");
		} im.IfEnd(c);

		if (im.If(c) && interpretResult.dataOutputs.length > 0) {
			im.For(c); for (const output of interpretResult.dataOutputs) {
				imSubHeading(c, output.title);

				im.Switch(c, output.type); switch(output.type) {
					case pl2.DataVisualiserType_Table: {
						// A table is great way to visualise data when we have no clue how to visualise the data
						imTable(c, output);
					} break;
					case pl2.DataVisualiserType_Point: {
						imPlot(c, output);
					} break;
					case pl2.DataVisualiserType_Line: {
						imPlot(c, output);
					} break;
					case pl2.DataVisualiserType_Line3d: {
						imPlot3d(c, output);
					} break;
					case pl2.DataVisualiserType_Point3d: {
						imPlot3d(c, output);
					} break;
					case pl2.DataVisualiserType_Histogram: {
						imStr(c, "TODO: implement histograms");
					} break;
					case pl2.DataVisualiserType_Histogram3d: {
						imStr(c, "TODO: implement histogram 3d");
					} break;
					default: assertNever(output.type);
				} im.SwitchEnd(c);
			} im.ForEnd(c);
		} im.IfEnd(c);
	} im.IfEnd(c);
}


function imTable(c: ImCache, output: pl2.DataOutput) {
	imBegin(c, BLOCK); {
		if (im.Memo(c, output.axes.length)) {
			imdom.setStyle(c, "display", "grid");
			imdom.setStyle(c, "gridTemplateColumns", "1fr ".repeat(output.axes.length));
		}

		im.For(c); for (const axis of output.axes) {
			imBegin(c, BLOCK); imB(c); {
				imStr(c, axis.name);
			} imEnd(c);
		} im.ForEnd(c);

		let numDataPoints = 0;
		for (const axis of output.axes) {
			numDataPoints = Math.max(numDataPoints, axis.numbers.length);
		}

		im.For(c);
		for (let idx = 0; idx < numDataPoints; idx++) {
			for (let axisIdx = 0; axisIdx < output.axes.length; axisIdx++) {

				const axis = output.axes[axisIdx];
				let value = "-";
				if (idx < axis.numbers.length) {
					const num = axis.numbers[idx];
					if (axis.labels) {
						value = axis.labels[num];
					} else {
						value = "" + num;
					}
				}

				imBegin(c, BLOCK); {
					imStr(c, value);
				} imEnd(c);

			}
		}
		im.ForEnd(c);
	} imEnd(c);
}

type AxisSelectorEvent = { newAxis: number };

function imAxisSelector(c: ImCache, axisLabel: string, axes: pl2.DataOutputAxis[], currentAxis: number): AxisSelectorEvent | undefined {
	let result: AxisSelectorEvent | undefined;

	let isNotFirst = false;

	imBegin(c, ROW_WRAP); imFlex(c); {
		imStr(c, axisLabel);

		imHSpaceSmall(c);

		im.For(c); for (let i = 0; i < axes.length; i++) {
			if (isNotFirst) imHSpaceSmall(c);
			isNotFirst = true;

			imBegin(c, INLINE); {
				const axis = axes[i];
				if (imButtonPressed(c, axis.name, currentAxis === i)) {
					result = { newAxis: i };
				}
				imVSpaceSmall(c);
			} imEnd(c);
		} im.ForEnd(c);
	} imEnd(c);

	return result;
}

function imPlot(c: ImCache, output: pl2.DataOutput) {
	const axes      = output.axes;
	const plotState = im.State(c, plt.newPlotState2d);
	const state     = im.GetInline(c, imPlot) ?? im.Set(c, { xAxis: 0, yAxis: 0 });

	if (im.If(c) && axes.length > 1) {
		imBegin(c, ROW, CENTER); {
			const xAxisSelect = imAxisSelector(c, "X: ", output.axes, state.xAxis);
			if (xAxisSelect) {
				state.xAxis = xAxisSelect.newAxis;
			}

			imHSpace(c);

			imBegin(c, COL, CENTER); {
				if (imButtonPressed(c, "<->")) {
					[state.xAxis, state.yAxis] = [state.yAxis, state.xAxis];
				}
			} imEnd(c);

			imHSpace(c);

			const yAxisSelect = imAxisSelector(c, "Y:", output.axes, state.yAxis);
			if (yAxisSelect) {
				state.yAxis = yAxisSelect.newAxis;
			}
		} imEnd(c);

		imVSpace(c);
	} im.IfEnd(c);

	const s = imC2dBegin(c, getDesiredAspectRatio());
	if (s) {
		if (im.IsFirstRender(c)) {
			imdom.setStyle(c, "cursor", "move");
		}

		const mouse           = imdom.getMouse();
		const startedDragging = imdom.hasMousePress(c);
		let interaction : plt.DragInteractionType = plt.NOTHING; 
		if (mouse.leftMouseButton) {
			if (imdom.isKeyHeld(key.SHIFT)) {
				interaction = plt.ZOOMING;
			} else {
				interaction = plt.DRAGGING;
			}
		}
		plt.handleDragInteraction(s, plotState, startedDragging, interaction, mouse.x, mouse.y);

		const outputChanged = im.Memo(c, output);
		const xAxisChanged  = im.Memo(c, state.xAxis);
		const yAxisChanged  = im.Memo(c, state.yAxis);
		const plotChanged   = im.Memo(c, plotState.version);
		const dragChanged   = im.Memo(c, plotState.dragState.version);

		if (outputChanged) {
			if (axes.length === 1) {
				state.xAxis = 0;
				state.yAxis = 0;
			} else if (axes.length > 1 && state.xAxis === state.yAxis) {
				state.xAxis = 0;
				state.yAxis = 1;
			}
		}

		const xAxis = axes[state.xAxis];
		const yAxis = axes[state.yAxis];

		if (outputChanged || xAxisChanged || yAxisChanged) {
			initializeC2d(s);
			plt.refitPlot2d(plotState, xAxis.numbers, yAxis.numbers);
		}

		let crosshairX = -10; 
		let crosshairY = -10;
		if (imdom.hasMouseOver(c)) {
			crosshairX = mouse.x;
			crosshairY = mouse.y;
		}
		const crosshairXChanged = im.Memo(c, crosshairX); 
		const crosshairYChanged = im.Memo(c, crosshairY);

		if (outputChanged || xAxisChanged || yAxisChanged || dragChanged || plotChanged || crosshairXChanged || crosshairYChanged) {
			initializeC2d(s);
			plt.initPlot(plotState, s);

			const lines = output.type === pl2.DataVisualiserType_Line;

			c2d.setColor(s, 1, 1, 1, 1);
			c2d.drawBackground(s)
			c2d.setColor(s, 0, 0, 0, 1);

			plt.plotCrosshairs(s, plotState, crosshairX, crosshairY)
			plt.plotAxes(s, plotState, xAxis.name, yAxis.name);
			plt.plotPoints2d(s, plotState, xAxis.numbers, yAxis.numbers, lines);
		}
	} imC2dEnd(c, s);
}

let angle = 0;
function imPlot3d(c: ImCache, output: pl2.DataOutput) {
	const state = im.GetInline(c, imPlot) ?? im.Set(c, { xAxis: 0, yAxis: 0, zAxis: 0 });

	angle += im.getDeltaTimeSeconds(c) * Math.PI;

	imBegin(c, ROW, CENTER); {
		const xAxisSelect = imAxisSelector(c, "X: ", output.axes, state.xAxis);
		if (xAxisSelect) {
			state.xAxis = xAxisSelect.newAxis;
		}
	} imEnd(c);

	imBegin(c, ROW, CENTER); {
		const yAxisSelect = imAxisSelector(c, "Y: ", output.axes, state.yAxis);
		if (yAxisSelect) {
			state.yAxis = yAxisSelect.newAxis;
		}
	} imEnd(c);

	imBegin(c, ROW, CENTER); {
		const zAxisSelect = imAxisSelector(c, "Z: ", output.axes, state.zAxis);
		if (zAxisSelect) {
			state.zAxis = zAxisSelect.newAxis;
		}
	} imEnd(c);

	const s = imC2dBegin(c, getDesiredAspectRatio());
	if (s) {

	} imC2dEnd(c, s);
}

