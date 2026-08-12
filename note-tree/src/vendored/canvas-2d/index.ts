export type State = {
	canvas:   HTMLCanvasElement;
	ctx:      CanvasRenderingContext2D;
	width:    number;
	height:   number;

	fontSizePx: number;
	fontName: string;

	frameTime: number;
	t0:        number;
	
	currentColor: {
		r: number;
		g: number;
		b: number;
		a: number;
	};
};

export function createContext(canvas: HTMLCanvasElement): State | undefined {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		// Never seen this happen, but it technically could I guess
		return undefined;
	}

	const context: State = {
		canvas: canvas,
		ctx:    ctx,
		width:  0,
		height: 0,

		fontName: "",
		fontSizePx:   0,

		frameTime: 0,
		t0:        0,

		currentColor: {
			r: -1,
			g: -1,
			b: -1,
			a: -1,
		},
	};

	return context;
}

export function getCanvasWidthForWidth(width: number) {
	const dpi = window.devicePixelRatio;
	return width * dpi;
}

// Use this to drive the canvas's height from it's width
export function applyAspectRatioToHeight(s: State, aspectRatio: number) {
	const desiredHeight   = s.ctx.canvas.clientWidth / aspectRatio;
	s.canvas.style.height = desiredHeight + "px";

	s.width  = getCanvasWidthForWidth(s.ctx.canvas.clientWidth);
	s.height = getCanvasWidthForWidth(desiredHeight)
	s.canvas.setAttribute("width", s.width + "px");
	s.canvas.setAttribute("height", s.height + "px");
}

export function drawLine(s: State, x0: number, y0: number, x1: number, y1: number, thickness: number) {
	s.ctx.lineWidth = thickness;
	s.ctx.beginPath(); {
		s.ctx.moveTo(x0, y0);
		s.ctx.lineTo(x1, y1);
		s.ctx.stroke();
	} s.ctx.closePath();
}

export function drawRect(s: State, x0: number, y0: number, width: number, height: number) {
	s.ctx.beginPath(); {
		s.ctx.rect(x0, y0, width, height);
		s.ctx.fill();
	} s.ctx.closePath();
}

export function drawSquare(s: State, x: number, y: number, radius: number) {
	drawRect(s, x - radius, y - radius, 2 * radius, 2 * radius);
}

export function drawBackground(s: State) {
	drawRect(s, 0, 0, s.width, s.height);
}

export function drawCircle(s: State, x: number, y: number, radius: number) {
	s.ctx.beginPath(); {
		s.ctx.arc(x, y, radius, 0, 2 * Math.PI);
		s.ctx.fill();
	} s.ctx.closePath();
}


export function drawLabel(s: State, x: number, y: number, label: string, xDir: number, yDir: number, gap: number) {
	const metrics = s.ctx.measureText(label);
	const width   = metrics.width;
	const height  = s.fontSizePx;

	s.ctx.textAlign    = "left";
	s.ctx.textBaseline = "top";

	// Offset the label by a particular direction such that it doesn't overlap the thing it's labelling
	const xDirProjected = xDir * (width + gap) / 2;
	const yDirProjected = yDir * (height + gap) / 2;

	const labelPosX = x - width / 2  + xDirProjected;
	const labelPosY = y - height / 2 + yDirProjected;

	s.ctx.fillText(label, labelPosX, labelPosY);
}

function rotateX(x: number, y: number, angle: number): number {
	return x * Math.cos(angle) - y * Math.sin(angle);
}

function rotateY(x: number, y: number, angle: number): number {
	return x * Math.sin(angle) + y * Math.cos(angle);
}

export function drawLabelRotated(s: State, x: number, y: number, label: string, xDir: number, yDir: number, gap: number, angle: number) {
	if (angle === 0) {
		drawLabel(s, x, y, label, xDir, yDir, gap);
		return;
	}

	const metrics = s.ctx.measureText(label);
	const width   = metrics.width;
	const height  = s.fontSizePx;

	s.ctx.textAlign    = "left";
	s.ctx.textBaseline = "top";

	// Offset the label by a particular direction such that it doesn't overlap the thing it's labelling
	const xDirProjected = xDir * (width + gap) / 2;
	const yDirProjected = yDir * (height + gap) / 2;

	s.ctx.translate(x, y);
	s.ctx.rotate(angle);
	s.ctx.translate(-width / 2, -height / 2);
	s.ctx.translate(xDirProjected, yDirProjected);

	s.ctx.fillText(label, 0, 0);
	s.ctx.resetTransform();
}

export function setFont(s: State, fontName: string, fontSizePx: number) {
	if (s.fontName === fontName && s.fontSizePx === fontSizePx) {
		return;
	}

	s.fontName   = fontName;
	s.fontSizePx = fontSizePx;

	s.ctx.font = "" + fontSizePx + "px " + fontName;
}

export function beginFrame(s: State) {
	s.t0 = performance.now();

	setFont(s, "Times New Roman", 12);
	setColor(s, 0, 0, 0, 1);
}

export function endFrame(s: State) {
	s.frameTime = performance.now() - s.t0;
}

export function setColor(s: State, r: number, g: number, b: number, a: number = 1) {
	if (
		s.currentColor.r === r &&
		s.currentColor.g === g &&
		s.currentColor.b === b &&
		s.currentColor.a === a
	) {
		return;
	}

	s.currentColor.r = r;
	s.currentColor.g = g;
	s.currentColor.b = b;
	s.currentColor.a = a;

	// No alpha here xD
	const color = "rgb(" + 
		Math.round(255 * r) + " " +
		Math.round(255 * g) + " " +
		Math.round(255 * b)
	")";

	s.ctx.fillStyle   = color;
	s.ctx.strokeStyle = color;
	s.ctx.globalAlpha = a;
}
