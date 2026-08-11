// --- The system being controlled (the "plant") ---
// A mass on a spring with some damping (friction) — push it, and it'll
// swing toward wherever the spring pulls it, overshooting and settling
// down over time, even with no controller at all. That's what makes it a
// good demo: unlike a system that just glides straight to the target, a
// spring-mass system already has interesting behavior for P/I/D to tame.
//
//   m * acceleration = force - damping * velocity - spring_k * position
//
// force is whatever the PIDF controller outputs each step.
const MASS = 1;
const SPRING_K = 2;
const DAMPING_C = 0.5;
const SETPOINT = 0.5; // the position we want the mass to settle at
const DT = 0.02; // seconds per physics step (fixed, regardless of frame rate)
const WINDOW_SECONDS = 10; // how much time the graph shows on screen at once

// --- PIDF controller: the P/I/D portion (YOU write this) ---
// F gets added separately, below — this part just needs to return the
// P/I/D three-term contribution. Every simulated step, this gets the
// current error (how far off the target the mass currently is) and has to
// return the force to apply.
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
// calls within one simulation run — resetPIDFState() clears them back to
// zero at the start of each run. Update them yourself inside
// pidfController(): integral should accumulate error * dt each call, and
// derivative is (error - previousError) / dt.
let integral = 0;
let previousError = 0;

function resetPIDFState() {
  integral = 0;
  previousError = 0;
}

function pidfController(error, dt, kp, ki, kd) {
  // TODO: replace this with your own P/I/D implementation!
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
  resetPIDFState();
}

// F (feedforward): a constant force added on top of whatever the P/I/D
// portion computes, independent of error. Not part of the classic
// three-term P/I/D calculation — it's a separate technique, so it's
// handled here rather than inside pidfController(). Why it matters:
// holding the mass anywhere except its
// natural resting spot (0) requires *some* constant force forever, just to
// keep fighting the spring pulling it back — exactly spring_k * setpoint
// worth of force. Pure P can only supply that by keeping a permanent
// leftover error (its whole output is Kp * error, so it needs a nonzero
// error to keep pushing at all), which is why the curve settles short of
// the line instead of touching it. F supplies that steady force directly,
// so P only has to correct whatever's left over.
function stepSimulation(kp, ki, kd, kf) {
  const error = SETPOINT - position;
  const force = kf + pidfController(error, DT, kp, ki, kd);

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
const canvas = document.getElementById("pidfCanvas");
const ctx = canvas.getContext("2d");

const MARGIN_LEFT = 40;
const MARGIN_RIGHT = 10;
const MARGIN_TOP = 10;
const MARGIN_BOTTOM = 30;

// Two full palettes, same idea as the maze app's CANVAS_THEME — colors
// tuned to pop on a dark background don't necessarily still pop on light
// (or vice versa), so each mode gets its own set rather than reusing one.
const GRAPH_THEME = {
  dark: {
    background: "#1c212b",
    gridLine: "#2f3542",
    text: "#d7dde5",
    setpoint: "#ffcc33",
    curve: "#00e5ff",
  },
  light: {
    background: "#ffffff",
    gridLine: "#ccd3dc",
    text: "#1c212b",
    setpoint: "#e0a800",
    curve: "#0077b6",
  },
};

function drawGraph() {
  const theme = document.documentElement.classList.contains("light-theme")
    ? GRAPH_THEME.light
    : GRAPH_THEME.dark;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = theme.background;
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
  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN_LEFT, MARGIN_TOP);
  ctx.lineTo(MARGIN_LEFT, MARGIN_TOP + plotHeight);
  ctx.lineTo(MARGIN_LEFT + plotWidth, MARGIN_TOP + plotHeight);
  ctx.stroke();

  // setpoint line
  ctx.strokeStyle = theme.setpoint;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(MARGIN_LEFT, yToPixel(SETPOINT));
  ctx.lineTo(MARGIN_LEFT + plotWidth, yToPixel(SETPOINT));
  ctx.stroke();
  ctx.setLineDash([]);

  // response curve — only the part of history inside the visible window
  ctx.strokeStyle = theme.curve;
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
  ctx.fillStyle = theme.text;
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
  const kf = Number(fSlider.value);

  while (accumulator >= DT) {
    stepSimulation(kp, ki, kd, kf);
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
const fSlider = document.getElementById("fSlider");
const fValue = document.getElementById("fValue");

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
fSlider.addEventListener("input", () => {
  fValue.textContent = Number(fSlider.value).toFixed(1);
});

// Matches each slider's own starting `value` attribute in the HTML.
const DEFAULT_GAINS = { p: 1, i: 0, d: 0, f: 0 };

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
  setGain(fSlider, fValue, DEFAULT_GAINS.f, 1);
});

// The only thing that restarts the run — separate from the gains
// entirely, so you can reset the clock/position without losing whatever
// P/I/D you've dialed in, or vice versa.
document.getElementById("resetTimeButton").addEventListener("click", () => {
  resetSimulationState();
});

// --- Auto-Tune ---
// Runs a bunch of quick, invisible trial simulations — each with different
// candidate P/I/D gains plugged into the *actual* pidfController() above —
// and keeps whichever one settles onto the setpoint fastest with the least
// error along the way. F isn't searched: for this particular spring, the
// exact force needed to hold position steady at rest is known directly
// (spring_k * setpoint), so it's just computed instead of guessed.

// One simulated trial run, silent and separate from the live graph: same
// physics as stepSimulation(), just without touching position/velocity/
// history/simTime, so it can't disturb whatever's on screen. Returns a
// cost — lower is better — or Infinity if these gains blow up instead of
// settling (e.g. too much I with too little P to rein it in).
function simulateTrialCost(kp, ki, kd, kf, steps) {
  resetPIDFState();
  let trialPosition = 0;
  let trialVelocity = 0;
  let cost = 0;

  for (let i = 0; i < steps; i++) {
    const error = SETPOINT - trialPosition;
    const force = kf + pidfController(error, DT, kp, ki, kd);
    const acceleration = (force - DAMPING_C * trialVelocity - SPRING_K * trialPosition) / MASS;
    trialVelocity += acceleration * DT;
    trialPosition += trialVelocity * DT;

    if (!Number.isFinite(trialPosition) || Math.abs(trialPosition) > 1000) {
      return Infinity;
    }

    const errorAfterStep = SETPOINT - trialPosition;
    cost += errorAfterStep * errorAfterStep * DT;
  }

  // Extra weight on where it ends up, so "settled exactly on the line" beats
  // "wobbled less on average but still off target at the end."
  const finalError = SETPOINT - trialPosition;
  cost += 10 * finalError * finalError;
  return cost;
}

function snapToStep(value, step) {
  return Math.round(value / step) * step;
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

const TRIAL_STEPS = 400; // 8 simulated seconds per candidate
const CANDIDATE_COUNT = 400;

document.getElementById("autoTuneButton").addEventListener("click", () => {
  const idealF = SPRING_K * SETPOINT;

  let bestCost = Infinity;
  let bestGains = { kp: Number(pSlider.value), ki: Number(iSlider.value), kd: Number(dSlider.value) };

  for (let i = 0; i < CANDIDATE_COUNT; i++) {
    const kp = randomInRange(Number(pSlider.min), Number(pSlider.max));
    const ki = randomInRange(Number(iSlider.min), Number(iSlider.max));
    const kd = randomInRange(Number(dSlider.min), Number(dSlider.max));
    const cost = simulateTrialCost(kp, ki, kd, idealF, TRIAL_STEPS);
    if (cost < bestCost) {
      bestCost = cost;
      bestGains = { kp, ki, kd };
    }
  }

  setGain(pSlider, pValue, snapToStep(bestGains.kp, Number(pSlider.step)), 1);
  setGain(iSlider, iValue, snapToStep(bestGains.ki, Number(iSlider.step)), 2);
  setGain(dSlider, dValue, snapToStep(bestGains.kd, Number(dSlider.step)), 2);
  setGain(fSlider, fValue, snapToStep(idealF, Number(fSlider.step)), 1);

  // Trial runs above never touched the live sim, but they did leave
  // integral/previousError dirty — reset everything so the tuned gains get
  // a clean run from t=0, same as a fresh Reset Time.
  resetSimulationState();
});

resetSimulationState();
requestAnimationFrame(animationLoop);
