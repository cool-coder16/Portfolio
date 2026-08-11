// --- The network ---
// A tiny 2-input, 1-hidden-layer, 1-output network: two coordinates go in,
// one number (0 to 1) comes out — "how sure am I this point is Class B."
// Every hidden neuron looks at both inputs; the output neuron looks at
// every hidden neuron. Both layers squash their result through sigmoid(),
// which maps any number onto the range 0 to 1.
//
//   network.hiddenWeights[h] = [weightOnX, weightOnY] for hidden neuron h
//   network.hiddenBiases[h]  = that neuron's bias
//   network.outputWeights[h] = the weight from hidden neuron h to the output
//   network.outputBias       = the output neuron's bias
const HIDDEN_NEURONS_MIN = 2;
const HIDDEN_NEURONS_MAX = 8;
const LEARNING_RATE_MIN = 0.05;
const LEARNING_RATE_MAX = 2;
const STEPS_PER_TRAIN_FRAME = 10; // how many trainStep() calls run per frame while Train is active — plain 1/frame would take way too long to visibly converge

let network = null;
let points = []; // { x, y, label } — x/y in [-1, 1], label is 0 or 1
let isTraining = false;

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function randomWeight() {
  return Math.random() * 2 - 1; // small, symmetric — breaks the symmetry that would otherwise keep every hidden neuron identical
}

function createNetwork(numHidden) {
  return {
    hiddenWeights: Array.from({ length: numHidden }, () => [
      randomWeight(),
      randomWeight(),
    ]),
    hiddenBiases: Array.from({ length: numHidden }, () => randomWeight()),
    outputWeights: Array.from({ length: numHidden }, () => randomWeight()),
    outputBias: randomWeight(),
  };
}

// --- Forward pass: weights -> a prediction ---
// Given the network's current weights, what does it currently think about
// this point? Used for both drawing the background shading and computing
// the loss readout — not for training itself (see trainStep() below,
// which needs to run its own forward pass anyway, to keep the hidden
// layer's activations around for backpropagation).
function predict(network, point) {
  const hiddenActivations = network.hiddenWeights.map((weights, h) => {
    const z =
      weights[0] * point.x + weights[1] * point.y + network.hiddenBiases[h];
    return sigmoid(z);
  });

  const outputZ = hiddenActivations.reduce(
    (sum, activation, h) => sum + activation * network.outputWeights[h],
    network.outputBias,
  );
  return sigmoid(outputZ);
}

// --- Training: adjusting the weights (YOU write this) ---
// predict() above goes from weights to a guess. This is the reverse
// problem: given a point whose real label you KNOW, nudge every weight
// and bias so the network's guess gets a little closer to that label next
// time. That's backpropagation — one call of this function should update
// the network for ONE point, not train it to completion in one go.
//
// point: {x, y}, both in [-1, 1]. label: 0 or 1, the point's true class.
// network: the object described at the top of this file — mutate its
// weights/biases directly; this function doesn't need to return anything.
// learningRate: how big a step to take down the gradient each call.
function trainStep(network, point, label, learningRate) {
  // TODO: replace this with your own backpropagation implementation!
  // The network won't learn until you do — right now this does nothing.
  // 1. Forward pass — same math as predict(), but keep the hidden
  //    activations and the final output around, you'll need them below.
  //      hidden[h] = sigmoid(hiddenWeights[h] . point + hiddenBiases[h])
  //      output    = sigmoid(sum(hidden[h] * outputWeights[h]) + outputBias)
  // 2. Output delta — how much, and which way, to nudge the output
  //    neuron's input so the loss (output - label)^2 shrinks:
  //      outputDelta = 2 * (output - label) * output * (1 - output)
  // 3. Hidden deltas — how responsible each hidden neuron was for that
  //    error, chained back through its own sigmoid:
  //      hiddenDelta[h] = outputDelta * outputWeights[h] * hidden[h] * (1 - hidden[h])
  //    Compute these BEFORE step 4 touches outputWeights — they need the
  //    old values, not the updated ones.
  // 4. Update the output layer:
  //      outputWeights[h] -= learningRate * outputDelta * hidden[h]
  //      outputBias       -= learningRate * outputDelta
  // 5. Update the hidden layer, same shape as step 4:
  //      hiddenWeights[h] -= learningRate * hiddenDelta[h] * point
  //      hiddenBiases[h]  -= learningRate * hiddenDelta[h]

  let hidden = [];
  for (let i = 0; i < network.hiddenWeights.length; i++) {
    hidden.push(
      sigmoid(
        network.hiddenWeights[i][0] * point.x +
          network.hiddenWeights[i][1] * point.y +
          network.hiddenBiases[i],
      ),
    );
  }
  const output = sigmoid(
    hidden.reduce(
      (sum, activation, h) => sum + activation * network.outputWeights[h],
      network.outputBias,
    ),
  );

  const outputDelta = 2 * (output - label) * output * (1 - output);
  let hiddenDeltas = [];
  for (let i = 0; i < network.outputWeights.length; i++) {
    hiddenDeltas.push(
      outputDelta * network.outputWeights[i] * hidden[i] * (1 - hidden[i]),
    );
  }

  for (let i = 0; i < network.outputWeights.length; i++) {
    network.outputWeights[i] -= learningRate * outputDelta * hidden[i];
    network.hiddenWeights[i][0] -= learningRate * hiddenDeltas[i] * point.x;
    network.hiddenWeights[i][1] -= learningRate * hiddenDeltas[i] * point.y;
    network.hiddenBiases[i] -= learningRate * hiddenDeltas[i];
  }
  network.outputBias -= learningRate * outputDelta;
}

// --- Presets ---
// A few classic 2D toy datasets. XOR in particular can't be separated by
// a straight line — no matter how you rotate one, at least one point ends
// up on the wrong side. That's the whole reason this network has a hidden
// layer at all: a plain input → output network (no hidden layer) can only
// ever draw a straight boundary, but stacking a hidden layer in between
// lets it bend that boundary into whatever shape the data actually needs.
function addJitteredCluster(target, centerX, centerY, label, count, spread) {
  for (let i = 0; i < count; i++) {
    target.push({
      x: centerX + (Math.random() - 0.5) * spread,
      y: centerY + (Math.random() - 0.5) * spread,
      label,
    });
  }
}

function makeXORPreset() {
  const newPoints = [];
  addJitteredCluster(newPoints, -0.5, -0.5, 0, 10, 0.4);
  addJitteredCluster(newPoints, 0.5, 0.5, 0, 10, 0.4);
  addJitteredCluster(newPoints, -0.5, 0.5, 1, 10, 0.4);
  addJitteredCluster(newPoints, 0.5, -0.5, 1, 10, 0.4);
  return newPoints;
}

function makeCirclesPreset() {
  const newPoints = [];
  for (let i = 0; i < 25; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 0.3; // inner circle
    newPoints.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      label: 0,
    });
  }
  for (let i = 0; i < 35; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.6 + Math.random() * 0.35; // outer ring
    newPoints.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      label: 1,
    });
  }
  return newPoints;
}

function makeBlobsPreset() {
  const newPoints = [];
  addJitteredCluster(newPoints, -0.5, 0, 0, 25, 0.7);
  addJitteredCluster(newPoints, 0.5, 0, 1, 25, 0.7);
  return newPoints;
}

function loadPoints(newPoints) {
  points = newPoints;
  isTraining = false;
  trainButton.textContent = "Train";
}

document.getElementById("xorPresetButton").addEventListener("click", () => {
  loadPoints(makeXORPreset());
});
document.getElementById("circlesPresetButton").addEventListener("click", () => {
  loadPoints(makeCirclesPreset());
});
document.getElementById("blobsPresetButton").addEventListener("click", () => {
  loadPoints(makeBlobsPreset());
});

// --- Network setup panel ---
const hiddenNeuronsInput = document.getElementById("hiddenNeuronsInput");
const hiddenNeuronsValue = document.getElementById("hiddenNeuronsValue");
const learningRateInput = document.getElementById("learningRateInput");
const learningRateValue = document.getElementById("learningRateValue");

hiddenNeuronsInput.addEventListener("input", () => {
  hiddenNeuronsValue.textContent = hiddenNeuronsInput.value;
  // Changes the network's shape entirely, so the old weights don't line
  // up anymore — same reasoning as changing the IK page's arm count.
  network = createNetwork(Number(hiddenNeuronsInput.value));
  isTraining = false;
  trainButton.textContent = "Train";
});

// Learning rate doesn't need any of that — trainStep() just reads
// learningRateInput.value fresh on every call, so dragging this slider
// takes effect on the very next step without disturbing anything else.
learningRateInput.addEventListener("input", () => {
  learningRateValue.textContent = Number(learningRateInput.value).toFixed(2);
});

// --- Class picker ---
function getSelectedClass() {
  return Number(
    document.querySelector('input[name="pointClass"]:checked').value,
  );
}

// --- Canvas ---
const canvas = document.getElementById("nnCanvas");
const ctx = canvas.getContext("2d");
const CENTER = canvas.width / 2;
const PIXELS_PER_UNIT = canvas.width / 2; // math coordinates run from -1 to 1, same on both axes (the canvas is square)
const HEATMAP_CELL_SIZE = 10; // px — coarser than 1:1 so the background redraws fast every frame regardless of hidden neuron count

// Math coordinates have +y pointing UP, like a normal graph — canvas
// pixels have +y pointing down, so converting between them means flipping
// the y-axis around the center.
function toCanvasCoords(mathX, mathY) {
  return {
    x: CENTER + mathX * PIXELS_PER_UNIT,
    y: CENTER - mathY * PIXELS_PER_UNIT,
  };
}
function toMathCoords(canvasX, canvasY) {
  return {
    x: (canvasX - CENTER) / PIXELS_PER_UNIT,
    y: (CENTER - canvasY) / PIXELS_PER_UNIT,
  };
}

const SCENE_THEME = {
  dark: {
    background: "#1c212b",
    classZero: "#00e5ff",
    classOne: "#ffcc33",
    pointBorder: "#0b0e14",
    text: "#d7dde5",
  },
  light: {
    background: "#ffffff",
    classZero: "#0077b6",
    classOne: "#e0a800",
    pointBorder: "#ffffff",
    text: "#1c212b",
  },
};

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function drawScene() {
  const theme = document.documentElement.classList.contains("light-theme")
    ? SCENE_THEME.light
    : SCENE_THEME.dark;

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Background shading: the network's current guess at every point on the
  // grid, blended between the two class colors by how confident it is.
  for (let px = 0; px < canvas.width; px += HEATMAP_CELL_SIZE) {
    for (let py = 0; py < canvas.height; py += HEATMAP_CELL_SIZE) {
      const mathPoint = toMathCoords(
        px + HEATMAP_CELL_SIZE / 2,
        py + HEATMAP_CELL_SIZE / 2,
      );
      const guess = predict(network, mathPoint);
      ctx.fillStyle = lerpColor(theme.classZero, theme.classOne, guess);
      ctx.fillRect(px, py, HEATMAP_CELL_SIZE, HEATMAP_CELL_SIZE);
    }
  }

  // The actual data points, drawn fully opaque (unlike the softer
  // background blend) so they stay easy to pick out.
  for (const point of points) {
    const canvasPoint = toCanvasCoords(point.x, point.y);
    ctx.fillStyle = point.label === 0 ? theme.classZero : theme.classOne;
    ctx.strokeStyle = theme.pointBorder;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function updateReadout() {
  const readout = document.getElementById("nnReadout");
  if (points.length === 0) {
    readout.textContent =
      "Click the canvas to add points (or load a preset), then Step or Train.";
    return;
  }

  const loss =
    points.reduce(
      (sum, point) => sum + (predict(network, point) - point.label) ** 2,
      0,
    ) / points.length;
  readout.textContent = `${points.length} point${points.length === 1 ? "" : "s"} — average loss: ${loss.toFixed(4)}`;
}

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const mathPoint = toMathCoords(
    event.clientX - rect.left,
    event.clientY - rect.top,
  );
  points.push({
    x: Math.max(-1, Math.min(1, mathPoint.x)),
    y: Math.max(-1, Math.min(1, mathPoint.y)),
    label: getSelectedClass(),
  });
  isTraining = false;
  trainButton.textContent = "Train";
});

// --- Controls ---
// Runs exactly one trainStep() call — the same call Train's animation
// makes (several times) every frame, just one instead of a whole batch.
// Skipped while Train is already running, so it can't fight the animation
// loop over the same network.
document.getElementById("stepButton").addEventListener("click", () => {
  if (isTraining) return;
  if (points.length === 0) return;
  const point = points[Math.floor(Math.random() * points.length)];
  trainStep(network, point, point.label, Number(learningRateInput.value));
});

const trainButton = document.getElementById("trainButton");
trainButton.addEventListener("click", () => {
  if (isTraining) {
    isTraining = false;
    trainButton.textContent = "Train";
    return;
  }
  if (points.length === 0) {
    document.getElementById("nnReadout").textContent =
      "Add some points first — click the canvas or load a preset.";
    return;
  }
  isTraining = true;
  trainButton.textContent = "Stop";
});

document.getElementById("resetNetworkButton").addEventListener("click", () => {
  network = createNetwork(Number(hiddenNeuronsInput.value));
  isTraining = false;
  trainButton.textContent = "Train";
});

document.getElementById("clearPointsButton").addEventListener("click", () => {
  loadPoints([]);
});

// --- Animation loop ---
// Always redraws every frame. Only actually trains while isTraining is
// true (i.e. between a Train click and either Stop or the next dataset
// change) — running several trainStep() calls per frame instead of just
// one, so the decision boundary visibly converges in a few seconds
// instead of a slow crawl.
function animationLoop() {
  if (isTraining && points.length > 0) {
    for (let i = 0; i < STEPS_PER_TRAIN_FRAME; i++) {
      const point = points[Math.floor(Math.random() * points.length)];
      trainStep(network, point, point.label, Number(learningRateInput.value));
    }
  }

  drawScene();
  updateReadout();

  requestAnimationFrame(animationLoop);
}

network = createNetwork(Number(hiddenNeuronsInput.value));
requestAnimationFrame(animationLoop);
