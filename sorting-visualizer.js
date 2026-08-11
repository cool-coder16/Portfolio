// --- The bars ---
// Each bar is { value }, where value is that bar's correct sorted rank —
// 0 for the bar that belongs at the far left once everything's in order,
// up to bars.length - 1 for the one that belongs at the far right. value
// never changes; only each bar's POSITION in the `bars` array does, as
// sorting moves it around. That position is also what gets drawn — bar i
// in the array is drawn as the i-th bar on the canvas.
//
// Height and color both come from the same value, just mapped two
// different ways (see valueToHeight()/valueToHue() near the drawing code
// below) — so a fully sorted arrangement reads as a rainbow ramp: short
// and red on the left, tall and violet on the right.
const MIN_BARS = 5;
const MAX_BARS = 40;

let bars = [];

// --- Bubble Sort's progress (YOU update this inside bubbleSortStep) ---
// Shrinks by 1 after every full pass — after a pass, the largest bar left
// in the unsorted region is guaranteed to have "bubbled" up past every
// bar to its right, so that rightmost position never needs checking
// again. Sorting is done once this reaches 1 (a single bar is trivially
// "sorted").
let bubblePassEnd = 0;

// --- Merge Sort's progress (YOU update this inside mergeSortStep) ---
// Doubles after every full pass. Starts at 1, since every single bar
// counts as its own sorted "run" of size 1 to begin with. Sorting is done
// once this reaches (or passes) bars.length — at that point the whole
// array is one single sorted run.
let mergeRunSize = 1;

function resetSortState() {
  bubblePassEnd = bars.length;
  mergeRunSize = 1;
  sortStepCount = 0;
}

// Fisher-Yates shuffle — every ordering equally likely, unlike naively
// sorting by Math.random() (which is both slower and not actually
// uniform).
function shuffleBars(numBars) {
  const newBars = [];
  for (let i = 0; i < numBars; i++) {
    newBars.push({ value: i });
  }
  for (let i = newBars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newBars[i], newBars[j]] = [newBars[j], newBars[i]];
  }
  bars = newBars;
  resetSortState();
}

// --- Bubble Sort (YOU write this) ---
// bars: the array being sorted — swap elements directly inside it, don't
// build or return a new array. bubblePassEnd is declared above; read and
// write it directly, the same way pidfController() on the PIDF page read
// and wrote `integral`.
function bubbleSortStep(bars) {
  // TODO: replace this with your own bubble sort pass!
  for (let i = 0; i <= bubblePassEnd - 2; i++) {
    if (bars[i].value > bars[i + 1].value) {
      [bars[i].value, bars[i + 1].value] = [bars[i + 1].value, bars[i].value];
    }
  }
  bubblePassEnd--;
  // One call = one full pass:
  //   for i from 0 to bubblePassEnd - 2:
  //     if bars[i].value > bars[i + 1].value:
  //       swap bars[i] and bars[i + 1]
  //   bubblePassEnd -= 1
  //
  // (shrinking bubblePassEnd is safe because after a full pass, the
  // largest bar left in the unsorted region has "bubbled" past every bar
  // to its right — that rightmost position never needs checking again)
}

// --- Merge Sort (YOU write this) ---
// bars: the array being sorted — write the merged result back into it in
// place. mergeRunSize is declared above; read and write it directly.
function mergeSortStep(bars) {
  // TODO: replace this with your own merge sort pass!

  for (let i = 0; i < bars.length; i += 2 * mergeRunSize) {
    const after = bars.splice(i + mergeRunSize * 2);
    const right = bars.splice(i + mergeRunSize, mergeRunSize);
    const left = bars.splice(i, mergeRunSize);

    let leftI = 0;
    let rightI = 0;
    while (leftI < left.length && rightI < right.length) {
      if (left[leftI].value < right[rightI].value) {
        bars.push(left[leftI]);
        leftI++;
      } else {
        bars.push(right[rightI]);
        rightI++;
      }
    }

    if (leftI === left.length) {
      bars.push(...right.slice(rightI));
    } else {
      bars.push(...left.slice(leftI));
    }

    bars.push(...after);
  }

  mergeRunSize *= 2;
  // One call = one full pass at the CURRENT run size. A "run" is a
  // stretch of bars already sorted among itself — every bar starts as
  // its own run of size 1.
  //
  //   for start from 0, in steps of (2 * mergeRunSize), up to bars.length:
  //     left  = the run of up to mergeRunSize bars beginning at `start`
  //     right = the run of up to mergeRunSize bars right after `left`
  //       (there might not be one — if `start + mergeRunSize` is already
  //       past the end of the array, just leave `left` where it is and
  //       move on to the next start)
  //     merge left and right back into bars, starting at `start`, in
  //       sorted order: keep comparing the front of `left` and the front
  //       of `right`, writing whichever is smaller into bars next, until
  //       both are empty
  //   mergeRunSize *= 2
}

// Safety net against an infinite loop in a buggy algorithm (e.g. if
// bubblePassEnd or mergeRunSize never gets updated) — same reasoning as
// the maze page's getMaxSolveSteps(). Bubble sort never needs more than
// bars.length passes and merge sort never needs more than log2(bars.length)
// — this leaves a very generous margin above either.
function getMaxSortSteps() {
  return bars.length * 2 + 20;
}

let sorting = false;
let sortStepCount = 0;
let sortTimeoutId = null;
let SORT_STEP_DELAY_MS = 200; // pause between steps; adjustable via the Speed slider
const sortButton = document.getElementById("sortButton");

function celebrateSort(message) {
  const readout = document.getElementById("sortReadout");
  readout.textContent = message;
  readout.classList.add("solved");
}

// Plain (non-celebratory) readout update — clears the gold "solved" pulse
// styling so it doesn't linger on an unrelated message after a Reset or
// Shuffle that happens to follow a completed sort.
function setReadout(message) {
  const readout = document.getElementById("sortReadout");
  readout.textContent = message;
  readout.classList.remove("solved");
}

// Does one bubble sort pass, returning true once sorting is over — shared
// by the auto-sort loop below and the manual Step button, so both take a
// step identically. Mirrors performRightHandStep() on the maze page.
function performBubbleSortStep() {
  if (bubblePassEnd <= 1) {
    celebrateSort(`Sorted in ${sortStepCount} passes!`);
    return true;
  }
  if (sortStepCount >= getMaxSortSteps()) {
    setReadout(
      `Stopped after ${getMaxSortSteps()} passes without finishing — check bubbleSortStep().`,
    );
    return true;
  }

  bubbleSortStep(bars);
  draw();
  sortStepCount++;
  return false;
}

function autoSortStepBubble() {
  if (performBubbleSortStep()) {
    stopSorting();
    return;
  }
  sortTimeoutId = setTimeout(autoSortStepBubble, SORT_STEP_DELAY_MS);
}

// The Merge Sort equivalent of performBubbleSortStep() above.
function performMergeSortStep() {
  if (mergeRunSize >= bars.length) {
    celebrateSort(`Sorted in ${sortStepCount} passes!`);
    return true;
  }
  if (sortStepCount >= getMaxSortSteps()) {
    setReadout(
      `Stopped after ${getMaxSortSteps()} passes without finishing — check mergeSortStep().`,
    );
    return true;
  }

  mergeSortStep(bars);
  draw();
  sortStepCount++;
  return false;
}

function autoSortStepMerge() {
  if (performMergeSortStep()) {
    stopSorting();
    return;
  }
  sortTimeoutId = setTimeout(autoSortStepMerge, SORT_STEP_DELAY_MS);
}

function getSelectedAlgorithm() {
  return document.querySelector('input[name="algorithm"]:checked').value;
}

// Locks the algorithm menu while sorting — switching mid-run wouldn't
// actually change which algorithm is driving (that's decided once when
// sorting starts), so letting the radios still look clickable would just
// be misleading. Same reasoning as the maze page's setAlgorithmMenuDisabled().
function setAlgorithmMenuDisabled(disabled) {
  document.querySelectorAll('input[name="algorithm"]').forEach((input) => {
    input.disabled = disabled;
  });
}

function startSorting() {
  sorting = true;
  sortStepCount = 0;
  sortButton.textContent = "Stop";
  setAlgorithmMenuDisabled(true);

  if (getSelectedAlgorithm() === "merge") {
    autoSortStepMerge();
  } else {
    autoSortStepBubble();
  }
}

function stopSorting() {
  sorting = false;
  clearTimeout(sortTimeoutId);
  sortButton.textContent = "Sort";
  setAlgorithmMenuDisabled(false);
}

// Runs exactly one step of whichever algorithm is currently selected, then
// stops — same per-step logic the auto-sort uses, just without scheduling
// another one afterward.
function stepOnce() {
  if (sorting) return; // don't fight with the auto-sort while it's running

  if (getSelectedAlgorithm() === "merge") {
    performMergeSortStep();
  } else {
    performBubbleSortStep();
  }
}

document.getElementById("stepButton").addEventListener("click", stepOnce);

sortButton.addEventListener("click", () => {
  if (sorting) {
    stopSorting();
  } else if (bubblePassEnd <= 1 && mergeRunSize >= bars.length) {
    // Already sorted (from a previous run, or this is a fresh trivial
    // 1-bar case) — same "nothing to do" guard as the maze page's Solve
    // button when the robot's already at the end.
    document.getElementById("sortReadout").textContent =
      "Already sorted — press Shuffle to try again.";
  } else {
    startSorting();
  }
});

document.getElementById("resetButton").addEventListener("click", () => {
  stopSorting();
  // Puts every bar's value back at its own array index — i.e. sorted —
  // then resets progress, so Reset always gives you a fresh, correctly
  // ordered starting point rather than reusing whatever scrambled state
  // sorting left behind.
  bars.forEach((bar, i) => (bar.value = i));
  resetSortState();
  setReadout("Reset — press Shuffle to scramble the bars again.");
  draw();
});

document.getElementById("shuffleButton").addEventListener("click", () => {
  stopSorting();
  shuffleBars(bars.length);
  setReadout("Shuffled — press Step or Sort to begin.");
  draw();
});

// --- Setup panel ---
const numBarsInput = document.getElementById("numBarsInput");
const numBarsValue = document.getElementById("numBarsValue");
numBarsInput.addEventListener("input", () => {
  numBarsValue.textContent = numBarsInput.value;
  stopSorting();
  shuffleBars(Number(numBarsInput.value));
  setReadout("Shuffled — press Step or Sort to begin.");
  draw();
});

// Slider is in steps/sec (higher = faster, which reads more naturally
// than a raw millisecond delay) — SORT_STEP_DELAY_MS is just 1000 / that.
const speedInput = document.getElementById("speedInput");
const speedValue = document.getElementById("speedValue");
speedInput.addEventListener("input", () => {
  const stepsPerSecond = Number(speedInput.value);
  speedValue.textContent = stepsPerSecond;
  SORT_STEP_DELAY_MS = 1000 / stepsPerSecond;
});

// --- Canvas ---
const canvas = document.getElementById("sortCanvas");
const ctx = canvas.getContext("2d");
const MAX_HUE = 270; // red (0) through violet (270) — stops short of wrapping back to red at 360

function valueToHue(value) {
  return (value / (bars.length - 1)) * MAX_HUE;
}

function valueToHeight(value) {
  const maxHeight = canvas.height - 20;
  return ((value + 1) / bars.length) * maxHeight;
}

const SCENE_THEME = {
  dark: { background: "#1c212b", text: "#d7dde5" },
  light: { background: "#ffffff", text: "#1c212b" },
};

function draw() {
  const theme = document.documentElement.classList.contains("light-theme")
    ? SCENE_THEME.light
    : SCENE_THEME.dark;

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const barWidth = canvas.width / bars.length;
  bars.forEach((bar, i) => {
    const height = valueToHeight(bar.value);
    // Rainbow hues stay fixed regardless of theme — the whole point is a
    // consistent color-to-value mapping, not something that should shift
    // between dark and light mode the way the rest of the page's chrome does.
    ctx.fillStyle = `hsl(${valueToHue(bar.value)}, 80%, 55%)`;
    ctx.fillRect(
      i * barWidth + 1,
      canvas.height - height,
      barWidth - 2,
      height,
    );
  });

  ctx.fillStyle = theme.text;
  ctx.font = "12px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`passes: ${sortStepCount}`, canvas.width - 8, canvas.height - 8);
  ctx.textAlign = "left";
}

shuffleBars(Number(numBarsInput.value));
draw();
