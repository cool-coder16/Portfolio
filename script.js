// --- Grid setup ---
// The maze is a grid of square cells. We store it as a 2D array of
// true/false values: grid[row][col] === true means "there's a wall here".
const GRID_SIZE = 15; // cells per side
const CELL_SIZE = 30; // pixels per cell

const canvas = document.getElementById("mazeCanvas");
const ctx = canvas.getContext("2d");

canvas.width = GRID_SIZE * CELL_SIZE;
canvas.height = GRID_SIZE * CELL_SIZE;

// Build a GRID_SIZE x GRID_SIZE grid, every cell starts as "no wall" (false).
const grid = Array.from({ length: GRID_SIZE }, () =>
  Array(GRID_SIZE).fill(false),
);

// --- Maze generation ---
// Builds a "perfect" maze with randomized depth-first search: start with
// every cell walled in, then carve passages by hopping between cells 2
// apart and knocking down the wall between them. Passable cells live on
// even row/col numbers; the odd cells between them are the connector walls
// that get carved away. Because we only ever connect a cell to a new
// (never-visited) neighbor, there's exactly one path between any two
// cells — no loops — so the Day 4 algorithm can always solve it.
function generateMaze() {
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      grid[row][col] = true;
    }
  }

  const visited = new Set();

  function carve(row, col) {
    visited.add(`${row},${col}`);
    grid[row][col] = false;

    // Shuffle the 4 directions (Fisher-Yates) so the maze differs each time.
    const directions = [
      [-2, 0],
      [2, 0],
      [0, -2],
      [0, 2],
    ];
    for (let i = directions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [directions[i], directions[j]] = [directions[j], directions[i]];
    }

    for (const [dRow, dCol] of directions) {
      const nextRow = row + dRow;
      const nextCol = col + dCol;
      const inBounds =
        nextRow >= 0 && nextRow < GRID_SIZE && nextCol >= 0 && nextCol < GRID_SIZE;
      if (inBounds && !visited.has(`${nextRow},${nextCol}`)) {
        grid[row + dRow / 2][col + dCol / 2] = false; // knock down the wall between
        carve(nextRow, nextCol);
      }
    }
  }

  carve(START.row, START.col);
}

// --- Robot setup ---
// Fixed start (top-left) and end (bottom-right) cells for now. The robot's
// position is just a row/col, same as a grid cell.
const START = { row: 0, col: 0 };
const END = { row: GRID_SIZE - 1, col: GRID_SIZE - 1 };
const robot = { row: START.row, col: START.col };

// The row/col change each direction causes.
const DELTAS = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
};

// A real robot doesn't know compass directions — it only knows what's in
// front of it, to its left, and to its right. So we track which way the
// robot is currently facing, and figure out "front/left/right" from that.
let heading = "right";

// --- Solution highlight ---
// Every cell visited since the last reset (manual driving + auto-solving
// both count) — shown in gold once solved, as "the path the robot actually
// took." Separate from `trail`, which only shows the last split-second of
// movement and fades away.
let visitedPath = [{ row: START.row, col: START.col }];

// The true shortest path from start to end, computed fresh each time the
// robot solves the maze — shown in blue for comparison against the gold
// "actual path" above.
let shortestPath = [];
let showSolutionPaths = false;

// --- Move trail ---
// A fading trail of small rectangles spanning the whole gap between the
// robot's old cell and its new one — like the arrow itself had an alpha
// and was animated sliding across, then left as a streak that fades out.
const TRAIL_FADE_MS = 250; // faster fade
const TRAIL_MAX_OPACITY = 0.5; // lighter — never fully solid red
const TRAIL_RECT_SIZE = CELL_SIZE * 0.5;
const TRAIL_POINTS = 24; // how many rectangles make up one streak — more = smoother
let trail = []; // each entry: { x, y, startTime } — x/y are pixel positions, not grid cells
let trailAnimating = false; // true while a requestAnimationFrame loop is fading the trail

// Lays down a row of rectangles along the straight line from (x1,y1) to
// (x2,y2) — the old and new centers of the robot — all starting at full
// opacity and fading together.
function addTrailStreak(x1, y1, x2, y2) {
  const startTime = Date.now();
  for (let i = 0; i <= TRAIL_POINTS; i++) {
    const t = i / TRAIL_POINTS;
    trail.push({
      x: x1 + (x2 - x1) * t,
      y: y1 + (y2 - y1) * t,
      startTime,
    });
  }
  if (!trailAnimating) {
    trailAnimating = true;
    requestAnimationFrame(animateTrail);
  }
}

// Runs once per frame only while the trail has something left to fade —
// stops itself once trail is empty, instead of running forever in the
// background.
function animateTrail() {
  const now = Date.now();
  trail = trail.filter((mark) => now - mark.startTime < TRAIL_FADE_MS);
  draw();

  if (trail.length > 0) {
    requestAnimationFrame(animateTrail);
  } else {
    trailAnimating = false;
  }
}

// Clockwise order, used to rotate a direction left (-1) or right (+1).
const DIR_ORDER = ["up", "right", "down", "left"];
function rotate(dir, steps) {
  const index = DIR_ORDER.indexOf(dir);
  return DIR_ORDER[(index + steps + DIR_ORDER.length) % DIR_ORDER.length];
}

// True if there's a wall (or the edge of the grid) one cell away from the
// robot, in the given direction.
function hasWall(dir) {
  const delta = DELTAS[dir];
  const row = robot.row + delta.row;
  const col = robot.col + delta.col;
  const inBounds = row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE;
  return !inBounds || grid[row][col];
}

// The robot's 3 sensor readings, relative to its current heading.
function getSensors() {
  return {
    front: hasWall(heading),
    left: hasWall(rotate(heading, -1)),
    right: hasWall(rotate(heading, 1)),
  };
}

// Moves the robot one cell in the direction it's currently facing, and
// leaves a trail streak behind it. Shared by manual arrow-key driving and
// the auto-solver, so both move the exact same way. Does nothing if a wall
// blocks the way.
function moveForward() {
  if (hasWall(heading)) return;

  // Moving again after a solve means you're exploring further — clear the
  // solved display so it doesn't stay stuck showing an old result.
  if (showSolutionPaths) {
    showSolutionPaths = false;
    shortestPath = [];
    document.getElementById("sensorReadout").classList.remove("solved");
  }

  const oldCenterX = robot.col * CELL_SIZE + CELL_SIZE / 2;
  const oldCenterY = robot.row * CELL_SIZE + CELL_SIZE / 2;

  const delta = DELTAS[heading];
  robot.row += delta.row;
  robot.col += delta.col;

  const newCenterX = robot.col * CELL_SIZE + CELL_SIZE / 2;
  const newCenterY = robot.row * CELL_SIZE + CELL_SIZE / 2;
  addTrailStreak(oldCenterX, oldCenterY, newCenterX, newCenterY);

  visitedPath.push({ row: robot.row, col: robot.col });
}

// Finds the true shortest path from start to end with breadth-first search
// — a different algorithm from chooseNextAction(), used only to draw the
// blue "optimal route" highlight for comparison once the maze is solved.
function computeShortestPath() {
  const startKey = `${START.row},${START.col}`;
  const cameFrom = new Map();
  const visited = new Set([startKey]);
  const queue = [{ row: START.row, col: START.col }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.row === END.row && current.col === END.col) break;

    for (const dir of DIR_ORDER) {
      const delta = DELTAS[dir];
      const nextRow = current.row + delta.row;
      const nextCol = current.col + delta.col;
      const inBounds =
        nextRow >= 0 && nextRow < GRID_SIZE && nextCol >= 0 && nextCol < GRID_SIZE;
      if (!inBounds || grid[nextRow][nextCol]) continue;

      const key = `${nextRow},${nextCol}`;
      if (!visited.has(key)) {
        visited.add(key);
        cameFrom.set(key, current);
        queue.push({ row: nextRow, col: nextCol });
      }
    }
  }

  // Walk backwards from the end to the start following cameFrom, then
  // reverse it into start-to-end order.
  const path = [];
  let currentKey = `${END.row},${END.col}`;
  let current = { row: END.row, col: END.col };
  while (currentKey !== startKey) {
    path.push(current);
    current = cameFrom.get(currentKey);
    if (!current) return []; // no path exists — shouldn't happen for a generated maze
    currentKey = `${current.row},${current.col}`;
  }
  path.push({ row: START.row, col: START.col });
  path.reverse();
  return path;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // lineWidth is part of the canvas's shared state, and later drawing (the
  // robot's rim stroke, the sensor lines) leaves it changed — without
  // resetting it here, the grid borders below would inherit whatever
  // thickness the previous frame's drawing left behind.
  ctx.lineWidth = 1;

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const x = col * CELL_SIZE;
      const y = row * CELL_SIZE;

      // These colors match the legend in index.html — keep them in sync.
      if (grid[row][col]) {
        ctx.fillStyle = "#f0f0f0"; // wall, almost-white
      } else if (row === START.row && col === START.col) {
        ctx.fillStyle = "#3aa0ff"; // start cell, neon blue (not green — keeps the green "clear" sensor line visible here)
      } else if (row === END.row && col === END.col) {
        ctx.fillStyle = "#ffcc33"; // end cell, neon gold
      } else {
        ctx.fillStyle = "#1c212b"; // open path
      }
      ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);

      ctx.strokeStyle = "#2f3542";
      ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
    }
  }

  drawSolutionPaths();
  drawTrail();

  // Draw the robot as a triangle pointing in the direction it's facing —
  // an arrow makes `heading` visible at a glance, instead of a plain circle
  // that looks the same no matter which way the robot is turned.
  const centerX = robot.col * CELL_SIZE + CELL_SIZE / 2;
  const centerY = robot.row * CELL_SIZE + CELL_SIZE / 2;
  drawRobotArrow(centerX, centerY);

  drawSensors(centerX, centerY);
  drawSolveFlash();
}

// Once solved, paints the robot's actual path in gold and the true
// shortest path in blue (as a smaller inset square, so it's still visible
// even on cells the gold path also covers).
function drawSolutionPaths() {
  if (!showSolutionPaths) return;

  // De-duplicate: the wall-follower often revisits the same cell more than
  // once (backtracking out of dead ends), and stacking a translucent fill
  // on top of itself makes revisited cells look brighter than cells only
  // passed through once. A Map keyed by position keeps one entry per cell.
  const uniqueCells = new Map();
  for (const cell of visitedPath) {
    uniqueCells.set(`${cell.row},${cell.col}`, cell);
  }

  for (const cell of uniqueCells.values()) {
    ctx.fillStyle = "rgba(255, 204, 51, 0.5)";
    ctx.fillRect(cell.col * CELL_SIZE, cell.row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  }

  const inset = CELL_SIZE * 0.3;
  for (const cell of shortestPath) {
    ctx.fillStyle = "#3aa0ff";
    ctx.fillRect(
      cell.col * CELL_SIZE + inset,
      cell.row * CELL_SIZE + inset,
      CELL_SIZE - inset * 2,
      CELL_SIZE - inset * 2,
    );
  }
}

// --- Solve flash ---
// A brief full-canvas gold flash the instant the maze is solved, fading
// out over SOLVE_FLASH_MS. Runs its own requestAnimationFrame loop, same
// pattern as the trail: keeps redrawing only while the flash is still fading.
const SOLVE_FLASH_MS = 700;
let solveFlashStart = null;

function triggerSolveFlash() {
  solveFlashStart = Date.now();
  requestAnimationFrame(animateSolveFlash);
}

function animateSolveFlash() {
  draw();
  if (solveFlashStart !== null && Date.now() - solveFlashStart < SOLVE_FLASH_MS) {
    requestAnimationFrame(animateSolveFlash);
  } else {
    solveFlashStart = null;
  }
}

function drawSolveFlash() {
  if (solveFlashStart === null) return;
  const age = Date.now() - solveFlashStart;
  const opacity = Math.max(0, 1 - age / SOLVE_FLASH_MS) * 0.5;
  ctx.fillStyle = `rgba(255, 204, 51, ${opacity})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Shared by both the auto-solver and manual driving reaching the end: shows
// the message, computes the shortest-path comparison, and kicks off the flash.
function celebrateSolve(message) {
  const readout = document.getElementById("sensorReadout");
  readout.textContent = message;
  readout.classList.add("solved");

  shortestPath = computeShortestPath();
  showSolutionPaths = true;

  triggerSolveFlash();
}

// Draws the robot's arrow shape at any position/heading/fill — shared by
// the real robot (opaque, glowing) and the fading trail ghosts (translucent).
function drawArrowShape(centerX, centerY, dir, fillStyle, strokeStyle) {
  // DIR_ORDER is already clockwise (up, right, down, left), so each step
  // through it is a 90-degree clockwise turn — same trick rotate() uses.
  const angle = (DIR_ORDER.indexOf(dir) * Math.PI) / 2;
  const size = CELL_SIZE / 2.2;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(angle); // rotates the triangle below (drawn pointing "up") to face `dir`

  ctx.beginPath();
  ctx.moveTo(0, -size); // tip
  ctx.lineTo(size * 0.6, size * 0.6); // back-right corner
  ctx.lineTo(-size * 0.6, size * 0.6); // back-left corner
  ctx.closePath();

  ctx.fillStyle = fillStyle;
  ctx.fill();

  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();
}

// Paints each trail rectangle, fading out (an alpha added to the highlight
// red) the older it gets. Runs every animation frame while the trail is active.
function drawTrail() {
  const now = Date.now();
  for (const mark of trail) {
    const age = now - mark.startTime;
    const opacity = Math.max(0, 1 - age / TRAIL_FADE_MS) * TRAIL_MAX_OPACITY;
    ctx.fillStyle = `rgba(255, 59, 59, ${opacity})`;
    ctx.fillRect(
      mark.x - TRAIL_RECT_SIZE / 2,
      mark.y - TRAIL_RECT_SIZE / 2,
      TRAIL_RECT_SIZE,
      TRAIL_RECT_SIZE,
    );
  }
}

function drawRobotArrow(centerX, centerY) {
  // A red glow + rim around the arrow — the "highlight".
  ctx.shadowColor = "#ff3b3b";
  ctx.shadowBlur = 10;
  drawArrowShape(centerX, centerY, heading, "#ffffff", "#ff3b3b");
  ctx.shadowBlur = 0; // reset so it doesn't bleed into the sensor lines drawn next
}

// Draws a short line from the robot toward each of its 3 sensor directions
// (front/left/right, relative to `heading`), colored by what it detects.
function drawSensors(centerX, centerY) {
  const sensors = getSensors();

  const lineLength = CELL_SIZE * 0.4;
  ctx.lineWidth = 3;

  for (const [label, dir] of [
    ["front", heading],
    ["left", rotate(heading, -1)],
    ["right", rotate(heading, 1)],
  ]) {
    const delta = DELTAS[dir];
    ctx.strokeStyle = sensors[label] ? "#ff3b3b" : "#39ff88"; // red = wall, green = clear
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + delta.col * lineLength,
      centerY + delta.row * lineLength,
    );
    ctx.stroke();
  }

  // While the "Solved!" message is showing, don't overwrite it — draw()
  // gets called continuously during the solve flash animation, and this
  // runs every time. moveForward() clears showSolutionPaths when you
  // actually move again, which is when the normal readout should return.
  if (showSolutionPaths) return;

  // Text readout, so the exact sensor state is readable, not just visual.
  const describe = (isWall) => (isWall ? "WALL" : "clear");
  document.getElementById("sensorReadout").textContent =
    `Front: ${describe(sensors.front)}  |  Left: ${describe(sensors.left)}  |  Right: ${describe(sensors.right)}`;
}

canvas.addEventListener("click", (event) => {
  // getBoundingClientRect() gives the canvas's position on the page, so we
  // can turn a raw mouse click (page coordinates) into a position relative
  // to the canvas itself, then into a row/col in our grid.
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const col = Math.floor(x / CELL_SIZE);
  const row = Math.floor(y / CELL_SIZE);

  const isStartOrEnd =
    (row === START.row && col === START.col) ||
    (row === END.row && col === END.col);
  if (isStartOrEnd) return; // don't let start/end become walls

  grid[row][col] = !grid[row][col]; // toggle wall on/off
  draw();
});

// --- Manual driving ---
// Maps each arrow key to the direction it represents.
const KEY_TO_DIR = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

document.addEventListener("keydown", (event) => {
  const dir = KEY_TO_DIR[event.key];
  if (!dir) return; // not an arrow key, ignore
  if (solving) return; // don't let manual driving fight with the auto-solver

  // Arrow keys scroll the page by default — stop that so driving feels normal.
  event.preventDefault();

  // Pressing a direction always turns the robot to face it, even if a wall
  // blocks the move — that's what lets you "look" at a wall and see the
  // front sensor go red without needing to move into it.
  heading = dir;
  moveForward();
  draw();

  if (robot.row === END.row && robot.col === END.col) {
    celebrateSolve("You solved it!");
  }
});

// --- Day 4: YOUR wall-following algorithm ---
// This is the one function you write yourself. Every step, the auto-solver
// calls it with the robot's current sensor readings and does whatever it
// returns. That's the whole game: the robot can only ever see what's
// immediately front/left/right of it — never the whole maze — same as a
// real one would.
//
// A classic strategy is "always keep a wall on your right hand" — at every
// step:
//   1. If there's NO wall to your right  -> turn right.
//   2. Else if there's NO wall in front  -> go forward.
//   3. Else if there's NO wall to your left -> turn left.
//   4. Else (walls on all 3 sides)       -> turn all the way around.
//
// Turning right/left also immediately steps into that direction if it's
// open — same as a real robot hugging a wall would: it doesn't turn and
// then pause to think again, it turns into the opening and keeps going.
// `turnAround` is the exception — you haven't sensed what's behind you, so
// it only turns; the next call senses the new front before deciding to move.
//
// `sensors` looks like { front: true, left: false, right: true } — true
// means "wall present". Return exactly one of these strings:
//   "forward"    — drive into the cell you're facing
//   "left"       — turn 90° left, then step forward if that's now open
//   "right"      — turn 90° right, then step forward if that's now open
//   "turnAround" — turn 180°, don't move
function chooseNextAction(sensors) {
  if (!sensors.right) {
    return "right";
  } else if (!sensors.front) {
    return "forward";
  } else if (!sensors.left) {
    return "left";
  } else {
    return "turnAround";
  }
}

// --- Auto-solve loop ---
// Turns chooseNextAction()'s answer into an actual robot movement.
function applyAction(action) {
  if (action === "left" || action === "right") {
    heading = rotate(heading, action === "left" ? -1 : 1);
    moveForward(); // no-ops safely if it turns out not to be open after all
  } else if (action === "turnAround") {
    heading = rotate(heading, 2);
  } else if (action === "forward") {
    moveForward();
  }
}

const SOLVE_STEP_DELAY_MS = 200; // pause between steps, so you can watch it think
const MAX_SOLVE_STEPS = 500; // safety net against an infinite loop in a buggy algorithm

let solving = false;
let solveStepCount = 0;
let solveTimeoutId = null;
const solveButton = document.getElementById("solveButton");

function autoSolveStep() {
  if (robot.row === END.row && robot.col === END.col) {
    celebrateSolve(`Solved in ${solveStepCount} steps!`);
    stopSolving();
    return;
  }

  if (solveStepCount >= MAX_SOLVE_STEPS) {
    document.getElementById("sensorReadout").textContent =
      `Stopped after ${MAX_SOLVE_STEPS} steps without reaching the end — check chooseNextAction().`;
    stopSolving();
    return;
  }

  applyAction(chooseNextAction(getSensors()));
  draw();
  solveStepCount++;

  solveTimeoutId = setTimeout(autoSolveStep, SOLVE_STEP_DELAY_MS);
}

function startSolving() {
  solving = true;
  solveStepCount = 0;
  solveButton.textContent = "Stop";
  autoSolveStep();
}

function stopSolving() {
  solving = false;
  clearTimeout(solveTimeoutId);
  solveButton.textContent = "Solve";
}

solveButton.addEventListener("click", () => {
  if (solving) {
    stopSolving();
  } else if (robot.row === END.row && robot.col === END.col) {
    // Pressing Solve while already at the end (from a previous solve, or
    // manual driving) would otherwise show a confusing "Solved in 0 steps!"
    document.getElementById("sensorReadout").textContent =
      "Already at the end — press Reset to try again.";
  } else {
    startSolving();
  }
});

// --- Reset & Randomize ---
// Puts the robot back at the start, without touching the maze walls — for
// re-running your algorithm on the same maze after tweaking it.
function resetRobot() {
  if (solving) stopSolving();
  robot.row = START.row;
  robot.col = START.col;
  heading = "right";
  trail = [];
  visitedPath = [{ row: START.row, col: START.col }];
  shortestPath = [];
  showSolutionPaths = false;
  solveFlashStart = null; // cancel any in-progress flash animation
  document.getElementById("sensorReadout").classList.remove("solved");
}

document.getElementById("resetButton").addEventListener("click", () => {
  resetRobot();
  draw();
});

document.getElementById("randomizeButton").addEventListener("click", () => {
  generateMaze();
  resetRobot();
  draw();
});

draw();
