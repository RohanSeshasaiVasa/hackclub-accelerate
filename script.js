// Minimal 2D viewport with toggleable axes using p5.js (math.js loaded for future use)

let params = {
	showAxes: true,
};

let viewportEl;
let cnv;
let cam = { x: 0, y: 0, scale: 1 };
const BASE_STEP = 50; // pixels per world unit at scale=1

// World geometry (lines)
const lines = [];

// Add a world-space line (API)
// Usage: addWorldLine(x1, y1, x2, y2, { color: [r,g,b], weight: number })
window.addWorldLine = function (x1, y1, x2, y2, opts = {}) {
	const color = Array.isArray(opts.color) ? opts.color : [120, 200, 255];
	const weight = Number.isFinite(opts.weight) ? opts.weight : 2;
	lines.push({ x1, y1, x2, y2, color, weight });
};

function worldToScreen(wx, wy) {
	const step = BASE_STEP * cam.scale;
	const sx = width / 2 + cam.x + wx * step;
	const sy = height / 2 + cam.y - wy * step; // world +y up
	return { x: sx, y: sy };
}

function screenToWorld(sx, sy) {
	const step = BASE_STEP * cam.scale;
	const wx = (sx - (width / 2 + cam.x)) / step;
	const wy = ((height / 2 + cam.y) - sy) / step; // world +y up
	return { x: wx, y: wy };
}

function drawAxes() {
	const cx = width / 2 + cam.x; // screen position of world origin X
	const cy = height / 2 + cam.y; // screen position of world origin Y
	const step = BASE_STEP * cam.scale; // actual pixel spacing between grid lines
	const tick = 6;

	// Guard against degenerate zoom
	if (!isFinite(step) || step <= 0.01) return;

	// Grid (light)
	stroke(40, 45, 70);
	strokeWeight(1);

	// Vertical grid lines
	const startX = ((cx % step) + step) % step; // in [0, step)
	for (let x = startX; x < width; x += step) {
		line(x, 0, x, height);
	}

	// Horizontal grid lines
	const startY = ((cy % step) + step) % step; // in [0, step)
	for (let y = startY; y < height; y += step) {
		line(0, y, width, y);
	}

	// Axes
	stroke(120, 190, 255);
	strokeWeight(2);
	line(0, cy, width, cy); // X axis
	line(cx, 0, cx, height); // Y axis

	// Ticks and labels
	stroke(140, 200, 255);
	strokeWeight(2);
	fill(180, 200, 240);
	textSize(10);

	// X-axis ticks and labels
	textAlign(CENTER, TOP);
	for (let x = startX; x < width; x += step) {
		line(x, cy - tick, x, cy + tick);
		const u = Math.round((x - cx) / step);
		if (u !== 0) text(u.toString(), x, cy + 8);
	}

	// Y-axis ticks and labels
	textAlign(LEFT, CENTER);
	for (let y = startY; y < height; y += step) {
		line(cx - tick, y, cx + tick, y);
		const v = Math.round((cy - y) / step);
		if (v !== 0) text(v.toString(), cx + 8, y - 1);
	}
}

function setup() {
	viewportEl = document.getElementById('viewport');
	const w = viewportEl.clientWidth;
	const h = viewportEl.clientHeight || window.innerHeight;
	cnv = createCanvas(w, h);
	cnv.parent('viewport');
	pixelDensity(1);

	// Hook up UI
	const showAxesEl = document.getElementById('showAxes');

	// Defaults
	showAxesEl.checked = true; // required: default true
	params.showAxes = !!showAxesEl.checked;

	// Events
	showAxesEl.addEventListener('change', (e) => {
		params.showAxes = !!e.target.checked;
	});

	// Sample line: red from (1, 5) to (3, 4)
	window.addWorldLine(1, 5, 3, 4, { color: [255, 0, 0], weight: 2 });
}

function windowResized() {
	if (!viewportEl) return;
	const w = viewportEl.clientWidth;
	const h = viewportEl.clientHeight || window.innerHeight;
	resizeCanvas(w, h);
}

function draw() {
	// Background
	background(18, 20, 38);

	// Axes (optional)
	if (params.showAxes) drawAxes();

	// World lines
	drawWorldLines();

	// Placement preview
	drawPlacementPreview();
}

// Support scroll to pan and Ctrl+scroll (or pinch) to zoom, centered on mouse
function mouseWheel(event) {
	// Zoom when holding Ctrl/Cmd (desktop) or on pinch gesture (sets ctrlKey)
	if (event.ctrlKey || event.metaKey) {
		const zoomIntensity = 0.0015; // tune zoom speed
		const scaleFactor = Math.exp(-event.deltaY * zoomIntensity);
		const newScale = constrain(cam.scale * scaleFactor, 0.05, 20);

		// Keep world point under mouse fixed
		const stepOld = BASE_STEP * cam.scale;
		const stepNew = BASE_STEP * newScale;
		const cxOld = width / 2 + cam.x;
		const cyOld = height / 2 + cam.y;

		const uX = (mouseX - cxOld) / stepOld; // world units under cursor (x)
		const uY = (cyOld - mouseY) / stepOld; // world units under cursor (y, positive up)

		cam.scale = newScale;

		const cxNew = mouseX - uX * stepNew;
		const cyNew = mouseY + uY * stepNew;
		cam.x = cxNew - width / 2;
		cam.y = cyNew - height / 2;
	} else {
		// Pan with wheel
		cam.x += event.deltaX;
		cam.y += event.deltaY;
	}

	// Prevent page scroll while interacting with the canvas
	return false;
}

	// -------- Line drawing helpers & interactions --------
	function drawWorldLines() {
		for (const seg of lines) {
			const a = worldToScreen(seg.x1, seg.y1);
			const b = worldToScreen(seg.x2, seg.y2);
			stroke(...seg.color);
			strokeWeight(seg.weight);
			line(a.x, a.y, b.x, b.y);
		}
	}

	let placingLine = false;
	let placeStart = null; // {x,y} in world units

	function keyPressed() {
		if (key === 'l' || key === 'L') {
			placingLine = true;
			placeStart = null;
		}
	}

	function mousePressed() {
		// Only handle clicks inside the canvas
		if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;
		if (!placingLine) return;
		const wpt = screenToWorld(mouseX, mouseY);
		if (!placeStart) {
			placeStart = wpt;
		} else {
			// Commit line
			window.addWorldLine(placeStart.x, placeStart.y, wpt.x, wpt.y);
			placingLine = false;
			placeStart = null;
		}
	}

	function drawPlacementPreview() {
		if (!placingLine) return;
		const col = [255, 210, 90];
		stroke(...col);
		strokeWeight(2);
		if (placeStart) {
			// line from start to current mouse (preview)
			const a = worldToScreen(placeStart.x, placeStart.y);
			line(a.x, a.y, mouseX, mouseY);
		} else {
			// cursor crosshair
			line(mouseX - 6, mouseY, mouseX + 6, mouseY);
			line(mouseX, mouseY - 6, mouseX, mouseY + 6);
		}
	}
