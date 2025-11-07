/*
	Double Pendulum Simulator in p5.js with math.js for future math utilities
	- 3/4 screen: simulation canvas
	- 1/4 screen: control panel
	- Features:
		* Adjustable gravity, air resistance
		* Adjustable string elasticity (stiffness)
		* Toggle bob-bob collision
		* Adjustable masses of bobs and strings (strings mass lumped to free bob)
		* Adjustable lengths and initial angles
		* Interactive external forces: place multiple force sources with angle, magnitude, radius
		* Drag bobs and pivot to set initial conditions
*/

// -------------------------------
// Global state
// -------------------------------
let canvas;
let simW = 800, simH = 600;

const state = {
	// Physical parameters (SI friendly where applicable)
	g: 9.81, // m/s^2 (downwards)
	air: 0, // linear drag kg/s
	collideBobs: false,

	// Scale and lengths
	pxPerM: 100, // pixels per meter
	L1_m: 2.0, // meters
	L2_m: 2.0, // meters
	k1: 5000, // elasticity maps to spring stiffness
	k2: 5000,
	m1: 1,
	m2: 1,
	ms1: 0, // string 1 mass (lumped to bob1)
	ms2: 0, // string 2 mass (lumped to bob2)

	// Integration
	dt: 0.016, // seconds per frame
	substeps: 5,

	// Geometry
	pivot: null, // p5.Vector once canvas exists

	// External forces
	forces: [], // {id, x(px), y(px), angleDeg, magnitude(N), radius_m}
	nextForceId: 1,
	placingForce: false,

	paused: false,
};

// Dynamic state of bobs
let p1, p2; // positions
let v1, v2; // velocities
let trail1 = [], trail2 = [];
const MAX_TRAIL_POINTS = 800;

// Interaction
let dragging = { type: null, idx: -1 }; // type: 'pivot' | 'bob' | 'force'

// -------------------------------
// Helpers
// -------------------------------
function pctToStiffness(pct) {
	// Map 0..100% to a usable stiffness range [50 .. 20000]
	const kMin = 50;
	const kMax = 20000;
	const t = Math.pow(pct / 100, 2); // ease-in for more control at high values
	return kMin + (kMax - kMin) * t;
}

function bobRadius(m) {
	return 8 + Math.sqrt(Math.max(0.1, m)) * 4; // visual only
}

function vec(x, y) { return new p5.Vector(x, y); }
function fromAngleDeg(a) { return p5.Vector.fromAngle((a * Math.PI) / 180); }

function addExternalForces(pos) {
	let F = vec(0, 0);
	for (const f of state.forces) {
		const d = dist(pos.x, pos.y, f.x, f.y);
		const rpx = (f.radius_m ?? 0) * state.pxPerM;
		if (d <= rpx) {
			const dir = fromAngleDeg(f.angleDeg);
			// Convert N -> pixels units
			F.add(dir.mult(f.magnitude * state.pxPerM));
		}
	}
	return F;
}

function applyAngles(theta1Deg, theta2Deg) {
	const t1 = (theta1Deg * Math.PI) / 180;
	const t2 = (theta2Deg * Math.PI) / 180;
	const base = state.pivot.copy();
	const L1px = state.L1_m * state.pxPerM;
	const L2px = state.L2_m * state.pxPerM;
	p1 = base.copy().add(p5.Vector.fromAngle(t1).mult(L1px));
	p2 = p1.copy().add(p5.Vector.fromAngle(t1 + t2).mult(L2px));
	v1.set(0, 0);
	v2.set(0, 0);
}

function resetSim() {
	// Defaults in SI; conversions happen inside physics
	state.pxPerM = 100;
	state.g = 9.81;
	state.air = 0;
	state.collideBobs = false;
	state.L1_m = 2.0;
	state.L2_m = 2.0;
	state.k1 = pctToStiffness(100);
	state.k2 = pctToStiffness(100);
	state.m1 = 1;
	state.m2 = 1;
	state.ms1 = 0;
	state.ms2 = 0;
	state.dt = 0.016;
	state.substeps = 8;
	state.forces = [];
	state.nextForceId = 1;
	state.placingForce = false;
		state.showTrails = true;

	// UI sync
	byId('gravity').value = String(state.g);
		byId('gravityOut').textContent = state.g.toFixed(2);
	byId('air').value = String(state.air);
	byId('airOut').textContent = state.air.toFixed(2);
	byId('collideBobs').checked = state.collideBobs;
	byId('L1').value = String(state.L1_m.toFixed(2));
	byId('L2').value = String(state.L2_m.toFixed(2));
	byId('elast1').value = '100';
	byId('elast1Out').textContent = '100%';
	byId('elast2').value = '100';
	byId('elast2Out').textContent = '100%';
	byId('m1').value = String(state.m1);
	byId('m2').value = String(state.m2);
	byId('ms1').value = String(state.ms1);
	byId('ms2').value = String(state.ms2);
	byId('theta1').value = String(-30);
	byId('theta2').value = String(-30);
	byId('dt').value = String(state.dt);
		byId('substeps').value = String(state.substeps);
		if (byId('pxPerM')) byId('pxPerM').value = String(state.pxPerM);
		if (byId('showTrails')) byId('showTrails').checked = true;
	renderForceList();

	applyAngles(-30, -30);
		// Clear trails
		trail1 = []; trail2 = [];
}

function byId(id) { return document.getElementById(id); }

// -------------------------------
// p5 lifecycle
// -------------------------------
function setup() {
	const holder = document.getElementById('canvas-holder');
	resizeSimToHolder();
	canvas = createCanvas(simW, simH);
	canvas.parent('canvas-holder');
	state.pivot = vec(simW * 0.5, simH * 0.2);
	p1 = vec(0, 0); p2 = vec(0, 0);
	v1 = vec(0, 0); v2 = vec(0, 0);
	resetSim();

	// UI events
	wireUI();
}

function windowResized() {
	resizeSimToHolder();
	resizeCanvas(simW, simH);
}

function resizeSimToHolder() {
	const holder = document.getElementById('canvas-holder');
	if (!holder) return;
	const rect = holder.getBoundingClientRect();
	simW = Math.max(200, Math.floor(rect.width));
	simH = Math.max(200, Math.floor(rect.height));
}

function draw() {
	background(10, 12, 28);
	drawGrid();

	// Physics update
	if (!state.paused) {
		const steps = Math.max(1, Math.floor(state.substeps));
		const h = Number(state.dt) / steps;
		for (let i = 0; i < steps; i++) stepPhysics(h);
			updateTrails();
	}

	// Render system
		drawTrails();
	drawStrings();
	drawPivot();
	drawBobs();
	drawForces();
}

// -------------------------------
// Physics
// -------------------------------
function stepPhysics(dt) {
	const m1eff = state.m1 + state.ms1; // approximate lumping of string mass
	const m2eff = state.m2 + state.ms2;

	// Forces on bob1
	let F1 = vec(0, 0);
	// Gravity (convert to px/s^2)
	F1.y += (state.g * state.pxPerM) * m1eff;
	// Air drag
	F1.add(v1.copy().mult(-state.air));
	// Spring to pivot (string 1)
	const d1 = p5.Vector.sub(p1, state.pivot);
	const len1 = Math.max(1e-6, d1.mag());
	const dir1 = d1.copy().div(len1);
	const ext1 = len1 - state.L1_m * state.pxPerM;
	const k1 = state.k1;
	// Damping along spring direction (critical-ish damping)
	const c1 = 2 * Math.sqrt(k1 * m1eff) * 0.05;
	const v1n = v1.dot(dir1);
	F1.add(dir1.copy().mult(-k1 * ext1 - c1 * v1n));
	// Spring to bob2 (string 2)
	const d12 = p5.Vector.sub(p2, p1);
	const len2 = Math.max(1e-6, d12.mag());
	const dir12 = d12.copy().div(len2);
	const ext2 = len2 - state.L2_m * state.pxPerM;
	const k2 = state.k2;
	const c2 = 2 * Math.sqrt(k2 * Math.min(m1eff, m2eff)) * 0.05;
	const vrel12 = p5.Vector.sub(v2, v1);
	const vrel12n = vrel12.dot(dir12);
	const F12 = dir12.copy().mult(k2 * ext2 + c2 * vrel12n);
	// On bob1, the force is +F12 (pull towards bob2)
	F1.add(F12);
	// External forces on bob1
	F1.add(addExternalForces(p1));

	// Forces on bob2
	let F2 = vec(0, 0);
	F2.y += (state.g * state.pxPerM) * m2eff;
	F2.add(v2.copy().mult(-state.air));
	// Spring 2 on bob2 is -F12
	F2.add(F12.copy().mult(-1));
	// External forces on bob2
	F2.add(addExternalForces(p2));

	// Integrate (semi-implicit Euler)
	const a1 = F1.copy().div(m1eff);
	const a2 = F2.copy().div(m2eff);
	v1.add(a1.mult(dt));
	v2.add(a2.mult(dt));
	p1.add(v1.copy().mult(dt));
	p2.add(v2.copy().mult(dt));

	// Optional collision between bobs
	if (state.collideBobs) handleBobCollision(m1eff, m2eff);
}

function handleBobCollision(m1eff, m2eff) {
	const R1 = bobRadius(state.m1);
	const R2 = bobRadius(state.m2);
	const delta = p5.Vector.sub(p2, p1);
	const dist12 = delta.mag();
	const minDist = Math.max(1e-6, R1 + R2);
	if (dist12 < minDist) {
		const n = delta.copy().div(Math.max(dist12, 1e-6));
		const overlap = minDist - dist12;
		// Separate positions equally
		p1.add(n.copy().mult(-overlap * 0.5));
		p2.add(n.copy().mult(+overlap * 0.5));
		// Elastic collision along normal
		const rv = p5.Vector.sub(v2, v1);
		const vn = rv.dot(n);
		const e = 1.0; // perfectly elastic
		const j = (-(1 + e) * vn) / (1 / m1eff + 1 / m2eff);
		const impulse = n.copy().mult(j);
		v1.add(impulse.copy().mult(-1 / m1eff));
		v2.add(impulse.copy().mult(+1 / m2eff));
	}
}

// -------------------------------
// Trails
// -------------------------------
function updateTrails() {
	if (!state.showTrails) return;
	trail1.push(p1.copy());
	trail2.push(p2.copy());
	if (trail1.length > MAX_TRAIL_POINTS) trail1.shift();
	if (trail2.length > MAX_TRAIL_POINTS) trail2.shift();
}

function drawTrails() {
	if (!state.showTrails) return;
	push();
	noFill();
	// Bob1 trail (match bob color)
	stroke(255, 120, 120, 150);
	strokeWeight(2);
	beginShape();
	for (const pt of trail1) vertex(pt.x, pt.y);
	endShape();
	// Bob2 trail (match bob color)
	stroke(120, 220, 255, 150);
	beginShape();
	for (const pt of trail2) vertex(pt.x, pt.y);
	endShape();
	pop();
}

// -------------------------------
// Drawing
// -------------------------------
function drawGrid() {
	push();
	const s = 30;
	stroke(255, 255, 255, 20);
	strokeWeight(1);
	for (let x = (width % s); x < width; x += s) line(x, 0, x, height);
	for (let y = (height % s); y < height; y += s) line(0, y, width, y);
	pop();
}

function drawPivot() {
	push();
	noStroke();
	fill(0, 212, 255);
	rectMode(CENTER);
	rect(state.pivot.x, state.pivot.y, 10, 10, 2);
	pop();
}

function drawStrings() {
	push();
	stroke(200, 220, 255);
	strokeWeight(2);
	line(state.pivot.x, state.pivot.y, p1.x, p1.y);
	line(p1.x, p1.y, p2.x, p2.y);
	pop();
}

function drawBobs() {
	push();
	noStroke();
	fill(255, 120, 120);
	circle(p1.x, p1.y, bobRadius(state.m1) * 2);
	fill(120, 220, 255);
	circle(p2.x, p2.y, bobRadius(state.m2) * 2);
	pop();
}

function drawForces() {
	for (const f of state.forces) {
		push();
		// Area of effect
		noFill();
		stroke(0, 255, 180, 100);
		const rpx = (f.radius_m ?? 0) * state.pxPerM;
		circle(f.x, f.y, rpx * 2);
		// Arrow
		const dir = fromAngleDeg(f.angleDeg);
		const arrowLen = Math.min(120, 10 + f.magnitude * 0.5); // visual only
		const tip = createVector(f.x, f.y).add(dir.copy().mult(arrowLen));
		stroke(0, 255, 180);
		strokeWeight(3);
		line(f.x, f.y, tip.x, tip.y);
		// Arrowhead
		const left = dir.copy().rotate(3.14159 * 0.75).mult(8);
		const right = dir.copy().rotate(-3.14159 * 0.75).mult(8);
		line(tip.x, tip.y, tip.x + left.x, tip.y + left.y);
		line(tip.x, tip.y, tip.x + right.x, tip.y + right.y);
		pop();
	}
}

// -------------------------------
// Mouse interactions
// -------------------------------
function mousePressed() {
	if (!isMouseInCanvas()) return;

	// If placing a force, add it where clicked
	if (state.placingForce) {
		const id = state.nextForceId++;
		state.forces.push({ id, x: mouseX, y: mouseY, angleDeg: 0, magnitude: 0, radius_m: 0.8 });
		state.placingForce = false;
		renderForceList();
		return;
	}

	// Allow dragging forces
	for (const f of state.forces) {
		if (dist(mouseX, mouseY, f.x, f.y) <= 12) {
			dragging = { type: 'force', idx: f.id };
			return;
		}
	}

	// Only allow dragging pivot
	if (dist(mouseX, mouseY, state.pivot.x, state.pivot.y) <= 10) {
		dragging = { type: 'pivot', idx: -1 };
		return;
	}
}

function mouseDragged() {
	if (!isMouseInCanvas()) return;
	if (dragging.type === 'pivot') {
		state.pivot.set(mouseX, mouseY);
		v1.set(0, 0); v2.set(0, 0);
	} else if (dragging.type === 'force') {
		const f = state.forces.find(ff => ff.id === dragging.idx);
		if (f) { f.x = mouseX; f.y = mouseY; }
	}
}

function mouseReleased() {
	dragging = { type: null, idx: -1 };
}

function isMouseInCanvas() {
	return mouseX >= 0 && mouseX < width && mouseY >= 0 && mouseY < height;
}

// -------------------------------
// UI wiring
// -------------------------------
function wireUI() {
	// Play/Pause
	const pauseBtn = byId('pausePlayBtn');
	pauseBtn.addEventListener('click', () => {
		state.paused = !state.paused;
		pauseBtn.textContent = state.paused ? 'Play' : 'Pause';
	});

	byId('resetBtn').addEventListener('click', resetSim);

	// Environment
	byId('gravity').addEventListener('input', (e) => {
		state.g = Number(e.target.value);
			byId('gravityOut').textContent = state.g.toFixed(2);
	});
	byId('air').addEventListener('input', (e) => {
		state.air = Number(e.target.value);
		byId('airOut').textContent = state.air.toFixed(2);
	});
	byId('collideBobs').addEventListener('change', (e) => {
		state.collideBobs = e.target.checked;
	});

	// Geometry (meters)
	byId('L1').addEventListener('change', (e) => { state.L1_m = Math.max(0.1, Number(e.target.value)); });
	byId('L2').addEventListener('change', (e) => { state.L2_m = Math.max(0.1, Number(e.target.value)); });
	byId('applyAnglesBtn').addEventListener('click', () => {
		const th1 = Number(byId('theta1').value) || 0;
		const th2 = Number(byId('theta2').value) || 0;
		applyAngles(th1, th2);
	});

	// Elasticity
	byId('elast1').addEventListener('input', (e) => {
		const pct = Number(e.target.value);
		state.k1 = pctToStiffness(pct);
		byId('elast1Out').textContent = pct + '%';
	});
	byId('elast2').addEventListener('input', (e) => {
		const pct = Number(e.target.value);
		state.k2 = pctToStiffness(pct);
		byId('elast2Out').textContent = pct + '%';
	});

	// Masses
	byId('m1').addEventListener('change', (e) => { state.m1 = Math.max(0.1, Number(e.target.value)); });
	byId('m2').addEventListener('change', (e) => { state.m2 = Math.max(0.1, Number(e.target.value)); });
	byId('ms1').addEventListener('change', (e) => { state.ms1 = Math.max(0, Number(e.target.value)); });
	byId('ms2').addEventListener('change', (e) => { state.ms2 = Math.max(0, Number(e.target.value)); });

		// External forces
		byId('addForceBtn').addEventListener('click', () => {
			state.placingForce = true;
		});

	// Advanced
	byId('dt').addEventListener('change', (e) => { state.dt = Math.max(0.001, Number(e.target.value)); });
	byId('substeps').addEventListener('change', (e) => { state.substeps = Math.max(1, Number(e.target.value)); });
	if (byId('pxPerM')) {
		byId('pxPerM').addEventListener('change', (e) => {
			state.pxPerM = Math.max(10, Number(e.target.value));
		});
	}
			// Display
			byId('showTrails').addEventListener('change', (e) => {
				state.showTrails = e.target.checked;
			});
}

function renderForceList() {
	const list = byId('forceList');
	list.innerHTML = '';
	state.forces.forEach((f) => {
		const wrapper = document.createElement('div');
		wrapper.className = 'force-item';
		wrapper.dataset.id = String(f.id);

		const header = document.createElement('div');
		header.className = 'force-header';
		const title = document.createElement('div');
		title.className = 'force-title';
		title.textContent = `Force #${f.id}`;
		const removeBtn = document.createElement('button');
		removeBtn.className = 'danger';
		removeBtn.textContent = 'Remove';
		removeBtn.addEventListener('click', () => {
			state.forces = state.forces.filter(ff => ff.id !== f.id);
			renderForceList();
		});
		header.appendChild(title);
		header.appendChild(removeBtn);
		wrapper.appendChild(header);

		// Angle & magnitude
		const row1 = document.createElement('div');
		row1.className = 'row2';
		const angleLabel = document.createElement('label');
		angleLabel.innerHTML = `Angle (deg)
			<input type="number" step="1" value="${f.angleDeg}" />`;
		const angInput = angleLabel.querySelector('input');
		angInput.addEventListener('change', (e) => {
			f.angleDeg = Number(e.target.value);
		});
		const magLabel = document.createElement('label');
		magLabel.innerHTML = `Magnitude (N)
			<input type="number" step="0.1" value="${f.magnitude}" />`;
		const magInput = magLabel.querySelector('input');
		magInput.addEventListener('change', (e) => {
			f.magnitude = Number(e.target.value);
		});
		row1.appendChild(angleLabel);
		row1.appendChild(magLabel);
		wrapper.appendChild(row1);

				// Radius (m) & Position (m)
		const row2 = document.createElement('div');
		row2.className = 'row2';
		const radLabel = document.createElement('label');
			radLabel.innerHTML = `Radius (m)
					<input type="number" step="0.01" min="0.1" value="${f.radius_m ?? 0.8}" />`;
		const radInput = radLabel.querySelector('input');
		radInput.addEventListener('change', (e) => {
				f.radius_m = Math.max(0.1, Number(e.target.value));
		});
				const xyWrap = document.createElement('div');
				xyWrap.className = 'row2';
				const xLabel = document.createElement('label');
						xLabel.innerHTML = `X (m)
							<input type="number" step="0.01" value="${(f.x / state.pxPerM).toFixed(2)}" />`;
				const xInput = xLabel.querySelector('input');
				xInput.addEventListener('change', (e) => {
							f.x = Number(e.target.value) * state.pxPerM;
				});
				const yLabel = document.createElement('label');
						yLabel.innerHTML = `Y (m)
							<input type="number" step="0.01" value="${(f.y / state.pxPerM).toFixed(2)}" />`;
				const yInput = yLabel.querySelector('input');
				yInput.addEventListener('change', (e) => {
							f.y = Number(e.target.value) * state.pxPerM;
				});
				row2.appendChild(radLabel);
				wrapper.appendChild(row2);
				xyWrap.appendChild(xLabel);
				xyWrap.appendChild(yLabel);
				wrapper.appendChild(xyWrap);

				// Hint
				const hint = document.createElement('div');
				hint.style.color = 'var(--muted)';
				hint.style.marginTop = '6px';
				hint.textContent = 'Tip: Drag the circle in the viewport to move this force.';
				wrapper.appendChild(hint);

		list.appendChild(wrapper);
	});
}

