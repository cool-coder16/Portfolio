// --- Tempo ---
const BPM_MIN = 40;
const BPM_MAX = 240;
let bpm = 120; // matches #tempoValue's starting text in the HTML

function secondsPerBeat() {
  return 60 / bpm;
}

const tempoValue = document.getElementById("tempoValue");

function setBpm(newBpm) {
  bpm = Math.max(BPM_MIN, Math.min(BPM_MAX, newBpm));
  tempoValue.textContent = bpm;
}

document
  .getElementById("tempoDownButton")
  .addEventListener("click", () => setBpm(bpm - 1));
document
  .getElementById("tempoUpButton")
  .addEventListener("click", () => setBpm(bpm + 1));

// --- Scoring grid ---
// How finely taps get judged against — 1 = quarter notes (a full beat
// apart), 2 = eighth notes, 4 = sixteenth notes, 3 = eighth-note triplets.
// Matches the HTML <select>'s option values.
let subdivisionsPerBeat = 2;

const subdivisionSelect = document.getElementById("subdivisionSelect");
subdivisionSelect.addEventListener("change", () => {
  subdivisionsPerBeat = Number(subdivisionSelect.value);
});

function gridStepDuration() {
  return secondsPerBeat() / subdivisionsPerBeat;
}

// --- Web Audio metronome ---
// setInterval/setTimeout alone aren't precise enough for music — their
// timing drifts audibly. The standard fix (this "lookahead scheduler"
// pattern) uses the audio clock itself instead: every SCHEDULER_INTERVAL_MS,
// look SCHEDULE_AHEAD_TIME seconds into the future and schedule any clicks
// that fall in that window directly on the Web Audio timeline — actual
// playback timing then comes from the audio hardware, not from JS timers.
const SCHEDULE_AHEAD_TIME = 0.1;
const SCHEDULER_INTERVAL_MS = 25;

let audioContext = null;
let nextBeatTime = 0;
let schedulerTimerId = null;

function playClick(time) {
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = "square";
  osc.frequency.value = 1000;
  gain.gain.setValueAtTime(0.3, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start(time);
  osc.stop(time + 0.05);
}

function scheduler() {
  while (nextBeatTime < audioContext.currentTime + SCHEDULE_AHEAD_TIME) {
    playClick(nextBeatTime);
    beatTimes.push(nextBeatTime - recordingStartTime);
    nextBeatTime += secondsPerBeat();
  }
  schedulerTimerId = setTimeout(scheduler, SCHEDULER_INTERVAL_MS);
}

// --- Recording state ---
const COUNT_IN_BEATS = 4; // one measure in 4/4 — clicks play, but taps don't count yet

let recording = false;
let recordingStartTime = 0;
let recordingEndTime = 0; // seconds since recordingStartTime — the EXACT moment Stop was pressed
let countInDuration = 0; // seconds — recomputed from the current BPM each time recording starts
let hasAnnouncedRecording = false; // tracks whether the count-in -> recording readout switch has fired yet
let beatTimes = []; // seconds since recordingStartTime, one per metronome click (count-in included)
let tapTimes = []; // seconds since recordingStartTime, one per counted Spacebar tap
let quantizedResults = null; // filled in by quantizeTaps() once Stop is pressed

// Added to every tap the instant it's captured, to cancel out a
// consistent early/late bias — see the Calibrate button below. Persists
// across recordings on purpose, so calibrating once keeps applying to
// every take after it.
let calibrationOffset = 0;

const startStopButton = document.getElementById("startStopButton");

function celebrate(message) {
  const readout = document.getElementById("rhythmReadout");
  readout.textContent = message;
  readout.classList.add("solved");
}

function setReadout(message) {
  const readout = document.getElementById("rhythmReadout");
  readout.textContent = message;
  readout.classList.remove("solved");
}

function startRecording() {
  // AudioContext has to be created (or resumed) from inside a user
  // gesture like this click — browsers block audio that starts on its own.
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  beatTimes = [];
  tapTimes = [];
  quantizedResults = null;
  recording = true;
  hasAnnouncedRecording = false;
  recordingStartTime = audioContext.currentTime;
  nextBeatTime = recordingStartTime;
  countInDuration = COUNT_IN_BEATS * secondsPerBeat();
  scheduler();

  setReadout("Get ready — one measure count-in...");
  startStopButton.textContent = "Stop";
}

function stopRecording() {
  recording = false;
  // Captured now, before anything else — beatTimes can already include a
  // beat or two the scheduler pre-queued slightly into the future (that's
  // the whole point of its lookahead), which the user never actually had
  // a chance to reach yet. Using that as "how far did the recording get"
  // would make the missing-beat check flag beats that were never
  // reachable in the first place.
  recordingEndTime = audioContext.currentTime - recordingStartTime;
  clearTimeout(schedulerTimerId);
  startStopButton.textContent = "Start";

  if (tapTimes.length === 0) {
    setReadout("No taps recorded — press Start and tap Spacebar to the beat.");
    return;
  }

  quantizedResults = quantizeTaps(tapTimes, bpm, subdivisionsPerBeat);
  const score = computeAccuracyScore(quantizedResults, gridStepDuration());

  const meanErrorMs =
    (quantizedResults.reduce((sum, r) => sum + r.errorSeconds, 0) / quantizedResults.length) * 1000;
  const biasNote =
    Math.abs(meanErrorMs) < 3
      ? ""
      : ` — averaging ${Math.abs(meanErrorMs).toFixed(0)}ms ${meanErrorMs < 0 ? "early" : "late"}`;

  const message = `Accuracy: ${score.toFixed(0)}% (${tapTimes.length} tap${tapTimes.length === 1 ? "" : "s"})${biasNote}`;
  if (score >= 90) {
    celebrate(message);
  } else {
    setReadout(message);
  }

  // Wait one frame so the main animation loop's draw() has already
  // resized the canvas for review mode before scrolling — otherwise
  // scrollWidth would still reflect the old (narrower) live-view size.
  // Starts scrolled to the END so the view picks up right where the live
  // one left off; scrolling left from there reaches everything earlier.
  requestAnimationFrame(() => {
    canvasWrapper.scrollLeft = canvasWrapper.scrollWidth;
  });
}

// Shared by the button click and the Enter-key shortcut below, so both
// trigger identical start/stop behavior.
function toggleRecording() {
  if (recording) {
    stopRecording();
  } else {
    startRecording();
  }
}

startStopButton.addEventListener("click", toggleRecording);

document.getElementById("clearButton").addEventListener("click", () => {
  if (recording) stopRecording();
  beatTimes = [];
  tapTimes = [];
  quantizedResults = null;
  recordingEndTime = 0;
  setReadout("Press Start, then tap Spacebar along with the click.");
  draw();
});

// Locks in whatever bias the last recording showed — pulling future taps
// back toward the grid instead of just reporting how far off they were.
document.getElementById("calibrateButton").addEventListener("click", () => {
  if (!quantizedResults || quantizedResults.length === 0) {
    setReadout("Record a take first, then Calibrate to correct for it.");
    return;
  }
  const meanError =
    quantizedResults.reduce((sum, r) => sum + r.errorSeconds, 0) / quantizedResults.length;
  calibrationOffset -= meanError;
  const ms = Math.abs(meanError * 1000).toFixed(0);
  setReadout(`Calibrated — correcting future taps by ${ms}ms (you were ${meanError < 0 ? "early" : "late"}).`);
});

// event.repeat is true for the auto-repeated keydown events a held key
// fires — without filtering those out, holding a key down would count as
// dozens of taps/toggles instead of one.
window.addEventListener("keydown", (event) => {
  if (event.code === "Enter" && !event.repeat) {
    event.preventDefault();
    toggleRecording();
    return;
  }

  if (event.code !== "Space" || !recording || event.repeat) return;
  event.preventDefault(); // Spacebar's default behavior is scrolling the page

  const elapsed = audioContext.currentTime - recordingStartTime;
  if (elapsed < countInDuration) return; // still counting in — this tap doesn't count
  tapTimes.push(elapsed + calibrationOffset);
});

// --- Quantization (YOU write this) ---
// The core of this whole page: given when someone actually tapped, figure
// out which point on the beat grid each tap was "aiming for," and how far
// off it actually was.
//
// tapTimes: array of numbers — each tap's time in seconds since recording
// started (already collected above from the Spacebar handler).
// bpm: beats per minute. subdivisionsPerBeat: how many grid steps fit in
// one beat (1 = quarter notes, 2 = eighths, 4 = sixteenths, etc.) — same
// meaning as the dropdown above.
//
// Returns: an array the SAME LENGTH as tapTimes, in the SAME ORDER — one
// result object per tap — since draw() below matches them up by index.
// Each result should look like:
//   { tapTime, snappedStep, errorSeconds }
function quantizeTaps(tapTimes, bpm, subdivisionsPerBeat) {
  const gridStep = 60 / bpm / subdivisionsPerBeat;

  const data = [];
  for (const tapTime of tapTimes) {
    let snappedStep = Math.round(tapTime / gridStep);
    let snappedTime = snappedStep * gridStep;
    let errorSec = tapTime - snappedTime;

    data.push({
      tapTime: tapTime,
      snappedStep: snappedStep,
      errorSeconds: errorSec,
    });
  }
  return data;
}

// Turns per-tap timing errors into one 0-100 score. A tap exactly on the
// grid scores 100; a tap exactly halfway between two grid steps — as
// ambiguous/wrong as a tap can be — scores 0.
function computeAccuracyScore(results, gridStep) {
  if (results.length === 0) return 0;
  const tapScores = results.map((result) => {
    const errorRatio = Math.abs(result.errorSeconds) / (gridStep / 2);
    return Math.max(0, 100 * (1 - errorRatio));
  });
  return tapScores.reduce((sum, score) => sum + score, 0) / tapScores.length;
}

// --- Canvas ---
const canvas = document.getElementById("rhythmCanvas");
const ctx = canvas.getContext("2d");
const canvasWrapper = document.querySelector(".rhythm-canvas-wrapper");
const WINDOW_SECONDS = 8; // how much time is visible on screen at once — same in both modes
const LIVE_CANVAS_WIDTH = 640; // matches the HTML's starting width, used while recording
const MARGIN_LEFT = 10;
const MARGIN_RIGHT = 10;
const MARGIN_TOP = 10;
const MARGIN_BOTTOM = 30;
// Same scale in both modes, derived from the live view, so nothing visually
// "jumps" when Stop switches from a scrolling window to a scrollable one.
const PIXELS_PER_SECOND = (LIVE_CANVAS_WIDTH - MARGIN_LEFT - MARGIN_RIGHT) / WINDOW_SECONDS;

const SCENE_THEME = {
  dark: {
    background: "#1c212b",
    beatLine: "#00e5ff",
    subdivisionLine: "#2f3542",
    text: "#d7dde5",
    tapDefault: "#ffcc33",
  },
  light: {
    background: "#ffffff",
    beatLine: "#0077b6",
    subdivisionLine: "#ccd3dc",
    text: "#1c212b",
    tapDefault: "#e0a800",
  },
};
const ACCURACY_COLORS = { great: "#39ff88", ok: "#ffcc33", off: "#ff3b3b" };

// While recording, time keeps moving with the audio clock. Once stopped,
// the timeline freezes on whatever the last tap or beat was, rather than
// continuing to creep forward with real time.
function currentElapsedTime() {
  if (recording) return audioContext.currentTime - recordingStartTime;
  return recordingEndTime;
}

function draw() {
  const theme = document.documentElement.classList.contains("light-theme")
    ? SCENE_THEME.light
    : SCENE_THEME.dark;

  const elapsed = currentElapsedTime();
  // Once stopped, the canvas grows wide enough to hold the WHOLE recording
  // at the exact same per-second scale the live view used — the visible
  // portion (without scrolling) is still WINDOW_SECONDS wide either way,
  // this just makes the rest reachable by scrolling the wrapper div in the
  // HTML instead of throwing it away.
  const reviewMode = !recording && (tapTimes.length > 0 || beatTimes.length > 0);

  let windowStart, visibleRange;
  if (reviewMode) {
    windowStart = 0;
    visibleRange = Math.max(elapsed, WINDOW_SECONDS);
    canvas.width = MARGIN_LEFT + MARGIN_RIGHT + visibleRange * PIXELS_PER_SECOND;
  } else {
    canvas.width = LIVE_CANVAS_WIDTH;
    visibleRange = WINDOW_SECONDS;
    windowStart = Math.max(0, elapsed - WINDOW_SECONDS);
  }
  const xToPixel = (t) => MARGIN_LEFT + (t - windowStart) * PIXELS_PER_SECOND;

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subdivision gridlines (the fine grid taps get scored against).
  const gridStep = gridStepDuration();
  ctx.strokeStyle = theme.subdivisionLine;
  ctx.lineWidth = 1;
  const firstStep = Math.floor(windowStart / gridStep);
  const lastStep = Math.ceil((windowStart + visibleRange) / gridStep);
  for (let step = firstStep; step <= lastStep; step++) {
    const x = xToPixel(step * gridStep);
    ctx.beginPath();
    ctx.moveTo(x, MARGIN_TOP);
    ctx.lineTo(x, canvas.height - MARGIN_BOTTOM);
    ctx.stroke();
  }

  // Beat lines (the actual metronome clicks, count-in included).
  ctx.strokeStyle = theme.beatLine;
  ctx.lineWidth = 2;
  for (const beatTime of beatTimes) {
    if (beatTime < windowStart - 1 || beatTime > windowStart + visibleRange + 1) continue;
    const x = xToPixel(beatTime);
    ctx.beginPath();
    ctx.moveTo(x, MARGIN_TOP);
    ctx.lineTo(x, canvas.height - MARGIN_BOTTOM);
    ctx.stroke();
  }

  // Tap markers — colored by accuracy once quantizeTaps() has run
  // (after Stop), plain accent color while still recording.
  const midY = (MARGIN_TOP + (canvas.height - MARGIN_BOTTOM)) / 2;
  tapTimes.forEach((tapTime, i) => {
    if (tapTime < windowStart - 1 || tapTime > windowStart + visibleRange + 1) return;
    const x = xToPixel(tapTime);

    let color = theme.tapDefault;
    if (quantizedResults && quantizedResults[i]) {
      const errorRatio = Math.abs(quantizedResults[i].errorSeconds) / gridStep;
      color =
        errorRatio < 0.15
          ? ACCURACY_COLORS.great
          : errorRatio < 0.35
            ? ACCURACY_COLORS.ok
            : ACCURACY_COLORS.off;
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, midY, 7, 0, Math.PI * 2);
    ctx.fill();
  });

  // Missed-beat markers — an empty (outline-only) circle over any GRID
  // STEP, after the count-in, that no tap snapped to. Scanning grid steps
  // directly (rather than just beatTimes) matters once the subdivision
  // dropdown is set finer than quarter notes: the metronome only ever
  // clicks quarter notes, but eighth/sixteenth/triplet grids have extra
  // scoring positions in between beats that beatTimes alone would miss.
  if (quantizedResults) {
    const hitSteps = new Set(quantizedResults.map((result) => result.snappedStep));
    const countInStep = Math.round(countInDuration / gridStep);
    const firstVisibleStep = Math.max(countInStep, Math.floor(windowStart / gridStep));
    // Math.floor, not Math.round — a step that's merely CLOSE to the
    // recording's end time hasn't necessarily happened yet. Rounding
    // would count a step as "should have been tapped" even when it was
    // still a fraction of a beat in the future when Stop was pressed.
    const lastVisibleStep = Math.min(
      Math.floor(elapsed / gridStep),
      Math.ceil((windowStart + visibleRange) / gridStep),
    );

    for (let step = firstVisibleStep; step <= lastVisibleStep; step++) {
      if (hitSteps.has(step)) continue;

      const x = xToPixel(step * gridStep);
      ctx.strokeStyle = theme.beatLine;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, midY, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.fillStyle = theme.text;
  ctx.font = "12px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`${elapsed.toFixed(1)}s`, canvas.width - 8, canvas.height - 10);
  ctx.textAlign = "left";
}

// Switches the readout from "counting in" to "recording" the moment the
// count-in actually ends — checked every frame since that moment isn't
// tied to any single discrete event.
function updateCountInReadout() {
  if (!recording || hasAnnouncedRecording) return;
  if (audioContext.currentTime - recordingStartTime >= countInDuration) {
    hasAnnouncedRecording = true;
    setReadout("Recording — tap Spacebar along with the click.");
  }
}

function animationLoop() {
  updateCountInReadout();
  draw();
  requestAnimationFrame(animationLoop);
}

requestAnimationFrame(animationLoop);
