// --- The system being controlled (the "plant") ---
// A mass on a spring with some damping (friction) — push it, and it'll
// swing toward wherever the spring pulls it, overshooting and settling
// down over time, even with no controller at all. That's what makes it a
// good demo: unlike a system that just glides straight to the target, a
// spring-mass system already has interesting behavior for P/I/D to tame.
//
//   m * acceleration = force - damping * velocity - spring_k * position
//
// force is whatever the PID controller outputs each step.
const MASS = 1;
const SPRING_K = 2;
const DAMPING_C = 0.5;
const SETPOINT = 0.5; // the position we want the mass to settle at
const DT = 0.02; // seconds per physics step (fixed, regardless of frame rate)
const WINDOW_SECONDS = 10; // how much time the graph shows on screen at once

// --- PID controller (YOU write this) ---
// Every simulated step, this gets the current error (how far off the
// target the mass currently is) and has to return the force to apply.
//
//   P (proportional): reacts to the error right now. Bigger error, bigger
//     push. Alone, it always leaves a little error uncorrected — it needs
//     *some* leftover error to keep pushing at all.
//
//   I (integral): the running total of error over time. If a bit of error
//     keeps lingering, the integral keeps growing until it's finally
//     strong enough to close that last gap. Too much, and it overshoots
//     and oscillates, because it "remembers" being wrong for too long.
//
//   D (derivative): reacts to how fast the error is changing. It's a
//     brake — closing in on the target fast, D pushes back early instead
//     of letting P alone carry it straight into an overshoot.
//
//   output = Kp * error + Ki * integral + Kd * derivative
//
// `integral` and `previousError` are declared below and persist between
// calls within one simulation run — resetPIDState() clears them back to
// zero at the start of each run. Update them yourself inside
// pidController(): integral should accumulate error * dt each call, and
// derivative is (error - previousError) / dt.
let integral = 0;
let previousError = 0;

function resetPIDState() {
  integral = 0;
  previousError = 0;
}

function pidController(error, dt, kp, ki, kd) {
  // TODO: replace this with your own PID implementation!
  integral += error * dt;
  const dVal = (error - previousError) / dt;
  previousError = error;
  return kp * error + ki * integral + kd * dVal;
}

// --- Simulation state ---
// Runs continuously (see the animation loop below) instead of computing one
// fixed-length run up front — so the graph can scroll live as time passes,
// like an oscilloscope, rather than showing a single static snapshot.
let simTime = 0;
let position = 0;
let velocity = 0;
let history = []; // { t, position } — trimmed to the visible window as it grows, so this can't grow forever

function resetSimulationState() {
  simTime = 0;
  position = 0;
  velocity = 0;
  history = [];
  resetPIDState();
}

// One fixed-size physics step: read the current gains, ask pidController()
// for a force, apply it to the spring-mass system, and record the result.
function stepSimulation(kp, ki, kd) {
  const error = SETPOINT - position;
  const force = pidController(error, DT, kp, ki, kd);

  const acceleration = (force - DAMPING_C * velocity - SPRING_K * position) / MASS;
  velocity += acceleration * DT;
  position += velocity * DT;
  simTime += DT;

  history.push({ t: simTime, position });

  // Drop points that have already scrolled out of view (plus a little
  // slack) — otherwise this would just grow forever the longer the page
  // stays open.
  while (history.length > 0 && history[0].t < simTime - WINDOW_SECONDS - 1) {
    history.shift();
  }
}

// --- Graph ---
const canvas = document.getElementById("pidCanvas");
const ctx = canvas.getContext("2d");

const MARGIN_LEFT = 40;
const MARGIN_RIGHT = 10;
const MARGIN_TOP = 10;
const MARGIN_BOTTOM = 30;

function drawGraph() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1c212b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const plotWidth = canvas.width - MARGIN_LEFT - MARGIN_RIGHT;
  const plotHeight = canvas.height - MARGIN_TOP - MARGIN_BOTTOM;

  // The visible window is always the most recent WINDOW_SECONDS — until
  // enough time has actually passed, in which case it starts at 0 instead
  // (so the curve fills in from the left first, then starts scrolling once
  // there's more history than fits on screen).
  const windowStart = Math.max(0, simTime - WINDOW_SECONDS);

  // Auto-scales the y-axis to whatever the curve has actually done
  // recently (including the setpoint and 0, so both are always visible),
  // with a little padding so the curve never touches the very edge.
  const values = history.map((p) => p.position).concat([SETPOINT, 0]);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const padding = (maxVal - minVal) * 0.1 || 0.5;
  const yMin = minVal - padding;
  const yMax = maxVal + padding;

  const xToPixel = (t) => MARGIN_LEFT + ((t - windowStart) / WINDOW_SECONDS) * plotWidth;
  const yToPixel = (v) =>
    MARGIN_TOP + plotHeight - ((v - yMin) / (yMax - yMin)) * plotHeight;

  // axes
  ctx.strokeStyle = "#2f3542";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN_LEFT, MARGIN_TOP);
  ctx.lineTo(MARGIN_LEFT, MARGIN_TOP + plotHeight);
  ctx.lineTo(MARGIN_LEFT + plotWidth, MARGIN_TOP + plotHeight);
  ctx.stroke();

  // setpoint line
  ctx.strokeStyle = "#ffcc33";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(MARGIN_LEFT, yToPixel(SETPOINT));
  ctx.lineTo(MARGIN_LEFT + plotWidth, yToPixel(SETPOINT));
  ctx.stroke();
  ctx.setLineDash([]);

  // response curve — only the part of history inside the visible window
  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  let firstPoint = true;
  for (const point of history) {
    if (point.t < windowStart) continue;
    const x = xToPixel(point.t);
    const y = yToPixel(point.position);
    if (firstPoint) {
      ctx.moveTo(x, y);
      firstPoint = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // "time: ..." label, bottom-right of the graph
  ctx.fillStyle = "#d7dde5";
  ctx.font = "12px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`time: ${simTime.toFixed(1)}s`, canvas.width - 8, canvas.height - 10);
  ctx.textAlign = "left"; // restore the default so later text draws aren't affected
}

// --- Animation loop ---
// A fixed-timestep loop: however much real time actually passed since the
// last frame gets added to an accumulator, and physics steps run in DT-size
// chunks until the accumulator's used up. That keeps the simulation's
// behavior identical regardless of the browser's actual frame rate,
// instead of the physics quietly depending on how fast each frame renders.
let accumulator = 0;
let lastFrameTime = null;

function animationLoop(timestamp) {
  if (lastFrameTime === null) lastFrameTime = timestamp;
  const frameSeconds = Math.min((timestamp - lastFrameTime) / 1000, 0.1); // capped so a stalled tab can't "catch up" in one huge jump
  lastFrameTime = timestamp;
  accumulator += frameSeconds;

  const kp = Number(pSlider.value);
  const ki = Number(iSlider.value);
  const kd = Number(dSlider.value);

  while (accumulator >= DT) {
    stepSimulation(kp, ki, kd);
    accumulator -= DT;
  }

  drawGraph();
  requestAnimationFrame(animationLoop);
}

// --- Slider wiring ---
const pSlider = document.getElementById("pSlider");
const pValue = document.getElementById("pValue");
const iSlider = document.getElementById("iSlider");
const iValue = document.getElementById("iValue");
const dSlider = document.getElementById("dSlider");
const dValue = document.getElementById("dValue");

// Changing a gain takes effect on the very next physics step without
// resetting anything — animationLoop() re-reads the sliders' current
// values every frame, so a mid-run adjustment just bends the curve going
// forward instead of restarting the run from scratch.
pSlider.addEventListener("input", () => {
  pValue.textContent = Number(pSlider.value).toFixed(1);
});
iSlider.addEventListener("input", () => {
  iValue.textContent = Number(iSlider.value).toFixed(2);
});
dSlider.addEventListener("input", () => {
  dValue.textContent = Number(dSlider.value).toFixed(2);
});

// Matches each slider's own starting `value` attribute in the HTML.
const DEFAULT_GAINS = { p: 1, i: 0, d: 0 };

function setGain(slider, valueSpan, value, decimals) {
  slider.value = value;
  valueSpan.textContent = value.toFixed(decimals);
}

// Only touches the gains — same reasoning as the sliders above, it
// shouldn't restart the run either.
document.getElementById("resetGainsButton").addEventListener("click", () => {
  setGain(pSlider, pValue, DEFAULT_GAINS.p, 1);
  setGain(iSlider, iValue, DEFAULT_GAINS.i, 2);
  setGain(dSlider, dValue, DEFAULT_GAINS.d, 2);
});

// The only thing that restarts the run — separate from the gains
// entirely, so you can reset the clock/position without losing whatever
// P/I/D you've dialed in, or vice versa.
document.getElementById("resetTimeButton").addEventListener("click", () => {
  resetSimulationState();
});

resetSimulationState();
requestAnimationFrame(animationLoop);
