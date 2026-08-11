// --- The arm chain ---
// A chain of rigid segments ("arms") joined end to end, anchored at a fixed
// base. jointAngles[i] is the angle (radians) of arm i, relative to the arm
// before it — like a shoulder, elbow, wrist chain — so jointAngles[0] is
// relative to the positive x-axis, and each one after that is relative to
// wherever the previous arm ended up pointing. armLengths[i] is how long
// arm i is. Both arrays are always the same length: one entry per arm.
const ARM_LENGTH_MIN = 20;
const ARM_LENGTH_MAX = 150;
const DEFAULT_ARM_LENGTH = 80;
const MAX_ITERATIONS = 30; // iteration budget for one Solve click
const CONVERGENCE_THRESHOLD = 1; // px — how close counts as "reached"

let armLengths = [];
let jointAngles = [];
let target = { x: 120, y: 80 };
let iterationsRemaining = 0;

// --- Forward kinematics: angles -> positions ---
// The reverse of what solveIKStep() below needs to figure out. Given the
// current joint angles, walks out along the chain to find where every
// joint actually is right now — including the very last one, the "end
// effector" (the tip of the arm, the part trying to reach the target).
// Returns an array of {x, y} points, starting with the fixed base at the
// origin (0, 0).
function forwardKinematics(jointAngles, armLengths) {
  const joints = [{ x: 0, y: 0 }];
  let cumulativeAngle = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < armLengths.length; i++) {
    cumulativeAngle += jointAngles[i];
    x += armLengths[i] * Math.cos(cumulativeAngle);
    y += armLengths[i] * Math.sin(cumulativeAngle);
    joints.push({ x, y });
  }
  return joints;
}

// --- Self-collision ---
// Whether any two arm segments overlap — used below to stop the solver
// from letting the arm pass through itself.

// Cross product of (b - a) and (c - a). Sign tells you which side of the
// line through a→b point c falls on — the building block for the segment
// intersection test right below it.
function direction(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// p1/p2 are one segment's endpoints, p3/p4 the other's. Two segments cross
// exactly when each one's endpoints land on opposite sides of the other's
// line.
function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);

  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

// True if any two NON-ADJACENT segments of the arm overlap. Adjacent
// segments always share a joint, which isn't a collision — that's why j
// starts at i + 2 instead of i + 1.
function armHasSelfCollision(jointAngles, armLengths) {
  const joints = forwardKinematics(jointAngles, armLengths);

  for (let i = 0; i < armLengths.length; i++) {
    for (let j = i + 2; j < armLengths.length; j++) {
      if (segmentsIntersect(joints[i], joints[i + 1], joints[j], joints[j + 1])) {
        return true;
      }
    }
  }

  return false;
}

// --- Inverse kinematics: figuring out the joint angles (YOU write this) ---
// Forward kinematics (above) goes from angles to a position. This is the
// reverse problem: given where you WANT the end effector to end up, work
// out what the joint angles need to be.
//
// Called once per animation frame while a solve is running (see the Solve
// button below) — should do ONE pass of your algorithm, nudging
// jointAngles a little closer to target, not solve the whole thing in one
// call. That's what makes the arm visibly swing into place over a few
// frames instead of teleporting there.
function solveIKStep(jointAngles, armLengths, target) {
  let angles = [...jointAngles];

  for (let i = angles.length - 1; i >= 0; i--) {
    let joints = forwardKinematics(angles, armLengths);
    const currentJoint = joints[i];
    const endEffector = joints[joints.length - 1];

    const angleToEnd = Math.atan2(
      endEffector.y - currentJoint.y,
      endEffector.x - currentJoint.x,
    );
    const angleToTarget = Math.atan2(
      target.y - currentJoint.y,
      target.x - currentJoint.x,
    );

    const candidateAngles = [...angles];
    candidateAngles[i] = angles[i] + (angleToTarget - angleToEnd);

    // Only take the move if it doesn't make the arm cross itself —
    // otherwise this joint just sits still for this pass and gets another
    // chance next frame, once the joints after it (already processed,
    // since this loop runs last-to-first) have shifted too.
    if (!armHasSelfCollision(candidateAngles, armLengths)) {
      angles = candidateAngles;
    }
  }

  return angles;
}

// --- Arm setup panel ---
// Rebuilds the arm-length sliders whenever "Number of Arms" changes.
// Existing lengths are kept where the arm still exists, so shrinking the
// count and growing it back doesn't forget what you had dialed in.
function rebuildArmLengthInputs(numArms) {
  const previousLengths = armLengths;
  const container = document.getElementById("armLengthInputs");
  container.innerHTML = "";

  const newLengths = [];
  for (let i = 0; i < numArms; i++) {
    const length =
      previousLengths[i] !== undefined
        ? previousLengths[i]
        : DEFAULT_ARM_LENGTH;
    newLengths.push(length);

    const item = document.createElement("div");
    item.className = "slider-item";

    const label = document.createElement("label");
    label.setAttribute("for", `armLength${i}`);
    const valueSpan = document.createElement("span");
    valueSpan.id = `armLength${i}Value`;
    valueSpan.textContent = length;
    label.append(`Arm ${i + 1} Length: `, valueSpan);

    const input = document.createElement("input");
    input.type = "range";
    input.id = `armLength${i}`;
    input.min = ARM_LENGTH_MIN;
    input.max = ARM_LENGTH_MAX;
    input.step = 1;
    input.value = length;
    input.addEventListener("input", () => {
      armLengths[i] = Number(input.value);
      valueSpan.textContent = input.value;
      iterationsRemaining = 0; // arm setup changed — wait for another Solve click rather than resuming mid-change
    });

    item.append(label, input);
    container.appendChild(item);
  }

  armLengths = newLengths;
  jointAngles = armLengths.map(() => 0); // fully extended along +x — the topology changed, so old angles don't line up anymore
  iterationsRemaining = 0;
}

const numArmsInput = document.getElementById("numArmsInput");
const numArmsValue = document.getElementById("numArmsValue");
numArmsInput.addEventListener("input", () => {
  numArmsValue.textContent = numArmsInput.value;
  rebuildArmLengthInputs(Number(numArmsInput.value));
});

// --- Target ---
const targetXInput = document.getElementById("targetXInput");
const targetXValue = document.getElementById("targetXValue");
const targetYInput = document.getElementById("targetYInput");
const targetYValue = document.getElementById("targetYValue");

// Matches each target slider's own starting `value` attribute in the HTML.
const DEFAULT_TARGET = {
  x: Number(targetXInput.value),
  y: Number(targetYInput.value),
};

// Moving the target stops any solve in progress — jointAngles is left as
// wherever they were, and the Solve button starts a fresh attempt at the
// (possibly new) target on demand.
function setTarget(x, y) {
  target = { x, y };
  iterationsRemaining = 0;
}

// Updates the sliders themselves too — used by Reset Target and by
// clicking the canvas, both of which move the target from outside the
// sliders' own input events.
function setTargetAndSliders(x, y) {
  targetXInput.value = x;
  targetYInput.value = y;
  targetXValue.textContent = x;
  targetYValue.textContent = y;
  setTarget(x, y);
}

targetXInput.addEventListener("input", () => {
  targetXValue.textContent = targetXInput.value;
  setTarget(Number(targetXInput.value), target.y);
});
targetYInput.addEventListener("input", () => {
  targetYValue.textContent = targetYInput.value;
  setTarget(target.x, Number(targetYInput.value));
});

document.getElementById("resetArmButton").addEventListener("click", () => {
  jointAngles = armLengths.map(() => 0);
  iterationsRemaining = 0;
});

document.getElementById("resetTargetButton").addEventListener("click", () => {
  setTargetAndSliders(DEFAULT_TARGET.x, DEFAULT_TARGET.y);
});

// The only thing that actually runs the solver — every other control above
// just sets up the arm/target and waits. Gives solveIKStep() a fresh
// iteration budget; the animation loop below calls it once per frame until
// either it converges or that budget runs out.
document.getElementById("solveButton").addEventListener("click", () => {
  iterationsRemaining = MAX_ITERATIONS;
});

// --- Canvas ---
const canvas = document.getElementById("ikCanvas");
const ctx = canvas.getContext("2d");

// The base sits at the center of the canvas so the arm has room to reach
// in every direction. Math coordinates (what target/jointAngles use, and
// what forwardKinematics() returns) have +y pointing UP, like a normal
// graph — canvas pixels have +y pointing down, so converting between them
// means flipping the y-axis around the base.
const BASE_X = canvas.width / 2;
const BASE_Y = canvas.height / 2;

function toCanvasCoords(mathX, mathY) {
  return { x: BASE_X + mathX, y: BASE_Y - mathY };
}

const SCENE_THEME = {
  dark: {
    background: "#1c212b",
    axis: "#2f3542",
    base: "#d7dde5",
    arm: "#00e5ff",
    joint: "#d7dde5",
    endEffector: "#39ff88",
    target: "#ffcc33",
    text: "#d7dde5",
  },
  light: {
    background: "#ffffff",
    axis: "#ccd3dc",
    base: "#1c212b",
    arm: "#0077b6",
    joint: "#1c212b",
    endEffector: "#1fa855",
    target: "#e0a800",
    text: "#1c212b",
  },
};

function drawTargetMarker(point, color) {
  const size = 7;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(point.x - size, point.y - size);
  ctx.lineTo(point.x + size, point.y + size);
  ctx.moveTo(point.x + size, point.y - size);
  ctx.lineTo(point.x - size, point.y + size);
  ctx.stroke();
}

function drawScene(joints, distance) {
  const theme = document.documentElement.classList.contains("light-theme")
    ? SCENE_THEME.light
    : SCENE_THEME.dark;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Axes through the base, for a sense of the coordinate system.
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, BASE_Y);
  ctx.lineTo(canvas.width, BASE_Y);
  ctx.moveTo(BASE_X, 0);
  ctx.lineTo(BASE_X, canvas.height);
  ctx.stroke();

  // Arm segments.
  const canvasJoints = joints.map((p) => toCanvasCoords(p.x, p.y));
  ctx.strokeStyle = theme.arm;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(canvasJoints[0].x, canvasJoints[0].y);
  for (const point of canvasJoints.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();

  // Joints (including the base, but not the end effector — it gets its
  // own marker below).
  ctx.fillStyle = theme.joint;
  for (const point of canvasJoints.slice(0, -1)) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Base, drawn slightly larger so it reads as "anchored."
  ctx.fillStyle = theme.base;
  ctx.beginPath();
  ctx.arc(canvasJoints[0].x, canvasJoints[0].y, 7, 0, Math.PI * 2);
  ctx.fill();

  // End effector — green once it's within CONVERGENCE_THRESHOLD of target.
  const endEffector = canvasJoints[canvasJoints.length - 1];
  ctx.fillStyle =
    distance <= CONVERGENCE_THRESHOLD ? theme.endEffector : theme.arm;
  ctx.beginPath();
  ctx.arc(endEffector.x, endEffector.y, 6, 0, Math.PI * 2);
  ctx.fill();

  // Target.
  drawTargetMarker(toCanvasCoords(target.x, target.y), theme.target);
}

function updateReadout(distance, totalReach) {
  const readout = document.getElementById("ikReadout");
  const targetDistanceFromBase = Math.hypot(target.x, target.y);

  if (targetDistanceFromBase > totalReach) {
    readout.textContent = `Target is out of reach — the arm's max reach is ${totalReach.toFixed(0)}px, target is ${targetDistanceFromBase.toFixed(0)}px away.`;
    readout.classList.remove("solved");
  } else if (distance <= CONVERGENCE_THRESHOLD) {
    readout.textContent = `Target reached! (${distance.toFixed(1)}px away)`;
    readout.classList.add("solved");
  } else {
    readout.textContent = `Distance to target: ${distance.toFixed(1)}px`;
    readout.classList.remove("solved");
  }
}

// --- Animation loop ---
// Always running, but only actually solving while iterationsRemaining is
// positive — which only happens right after a Solve click. Each such
// frame runs one more solveIKStep() pass (until either the end effector is
// close enough to target, or the iteration budget runs out) and redraws.
// Since solveIKStep() only nudges jointAngles a little each call, the arm
// visibly swings into place over several frames instead of snapping
// straight there.
function animationLoop() {
  const joints = forwardKinematics(jointAngles, armLengths);
  const endEffector = joints[joints.length - 1];
  const distance = Math.hypot(
    target.x - endEffector.x,
    target.y - endEffector.y,
  );

  if (distance > CONVERGENCE_THRESHOLD && iterationsRemaining > 0) {
    jointAngles = solveIKStep(jointAngles, armLengths, target);
    iterationsRemaining--;
  }

  const totalReach = armLengths.reduce((sum, length) => sum + length, 0);
  drawScene(joints, distance);
  updateReadout(distance, totalReach);

  requestAnimationFrame(animationLoop);
}

// Clicking the canvas moves the target directly, in addition to the
// sliders — converts the click's pixel position back into the same math
// coordinate space the sliders use, then clamps it to their min/max so a
// click near the very edge of the canvas can't set an out-of-range value.
canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const mathX = event.clientX - rect.left - BASE_X;
  const mathY = BASE_Y - (event.clientY - rect.top);

  const clampedX = Math.max(
    Number(targetXInput.min),
    Math.min(Number(targetXInput.max), Math.round(mathX)),
  );
  const clampedY = Math.max(
    Number(targetYInput.min),
    Math.min(Number(targetYInput.max), Math.round(mathY)),
  );

  setTargetAndSliders(clampedX, clampedY);
});

rebuildArmLengthInputs(Number(numArmsInput.value));
setTarget(Number(targetXInput.value), Number(targetYInput.value));
requestAnimationFrame(animationLoop);
