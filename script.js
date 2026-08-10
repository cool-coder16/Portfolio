// --- Grid setup ---
// The maze is a grid of square cells. We store it as a 2D array of
// true/false values: grid[row][col] === true means "there's a wall here".
// GRID_SIZE is adjustable via the Size slider, so it's a `let`, not a
// `const` — and it must always stay ODD, since generateMaze()'s carving
// trick relies on START and END both landing on even row/col indices.
let GRID_SIZE = 15; // cells per side
const CELL_SIZE = 30; // pixels per cell

const canvas = document.getElementById("mazeCanvas");
const ctx = canvas.getContext("2d");

canvas.width = GRID_SIZE * CELL_SIZE;
canvas.height = GRID_SIZE * CELL_SIZE;

// --- Customizable colors ---
// Every color a legend swatch controls, in one place. There are two full
// default palettes — one tuned to look right on a dark path background,
// one for a light path background — since colors that pop on dark (like a
// white robot) can vanish entirely on light, and vice versa. `colors` is
// the live, editable copy everything else reads from; `currentDefaults`
// points at whichever palette is active, so "Reset All Colors" restores
// the right one instead of always going back to dark mode's colors.
const DARK_DEFAULT_COLORS = {
  wall: "#f0f0f0",
  start: "#3aa0ff",
  end: "#ffcc33",
  robot: "#ffffff",
  robotHighlight: "#ff3b3b",
  sensorClear: "#39ff88",
  sensorWall: "#ff3b3b",
  actualPath: "#ffcc33",
  shortestPath: "#3aa0ff",
};
const LIGHT_DEFAULT_COLORS = {
  wall: "#1c212b",
  start: "#2b7fd1",
  end: "#e0a800",
  robot: "#20242c",
  robotHighlight: "#d32f2f",
  sensorClear: "#1fa855",
  sensorWall: "#d32f2f",
  actualPath: "#e0a800",
  shortestPath: "#2b7fd1",
};

// The open-path fill and grid lines aren't legend swatches (nothing to
// customize), but they still need to flip between themes, same reasoning.
const CANVAS_THEME = {
  dark: { path: "#1c212b", gridLine: "#2f3542" },
  light: { path: "#ffffff", gridLine: "#ccd3dc" },
};

let isLightMode = false;
let currentDefaults = DARK_DEFAULT_COLORS;
let canvasTheme = CANVAS_THEME.dark;
const colors = { ...currentDefaults };

// Build a GRID_SIZE x GRID_SIZE grid, every cell starts as "no wall" (false).
// Rebuilt from scratch by resizeMaze() whenever the Size slider changes.
let grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false));

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
        nextRow >= 0 &&
        nextRow < GRID_SIZE &&
        nextCol >= 0 &&
        nextCol < GRID_SIZE;
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
        nextRow >= 0 &&
        nextRow < GRID_SIZE &&
        nextCol >= 0 &&
        nextCol < GRID_SIZE;
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

      // Wall/start/end colors are user-customizable (see the `colors`
      // object above and the sidebar color pickers); open path and grid
      // lines follow the dark/light theme instead (canvasTheme).
      if (grid[row][col]) {
        ctx.fillStyle = colors.wall;
      } else if (row === START.row && col === START.col) {
        ctx.fillStyle = colors.start;
      } else if (row === END.row && col === END.col) {
        ctx.fillStyle = colors.end;
      } else {
        ctx.fillStyle = canvasTheme.path;
      }
      ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);

      ctx.strokeStyle = canvasTheme.gridLine;
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

  // globalAlpha (rather than baking alpha into an rgba string) lets this
  // stay translucent no matter what hex color the user picks.
  ctx.fillStyle = colors.actualPath;
  ctx.globalAlpha = 0.5;
  for (const cell of uniqueCells.values()) {
    ctx.fillRect(
      cell.col * CELL_SIZE,
      cell.row * CELL_SIZE,
      CELL_SIZE,
      CELL_SIZE,
    );
  }
  ctx.globalAlpha = 1; // reset so nothing drawn after this is accidentally translucent

  const inset = CELL_SIZE * 0.3;
  for (const cell of shortestPath) {
    ctx.fillStyle = colors.shortestPath;
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
  if (
    solveFlashStart !== null &&
    Date.now() - solveFlashStart < SOLVE_FLASH_MS
  ) {
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

// Paints each trail rectangle, fading out (via globalAlpha, so it works no
// matter what hex color is picked) the older it gets. Matches the robot's
// highlight color. Runs every animation frame while the trail is active.
function drawTrail() {
  const now = Date.now();
  ctx.fillStyle = colors.robotHighlight;
  for (const mark of trail) {
    const age = now - mark.startTime;
    ctx.globalAlpha = Math.max(0, 1 - age / TRAIL_FADE_MS) * TRAIL_MAX_OPACITY;
    ctx.fillRect(
      mark.x - TRAIL_RECT_SIZE / 2,
      mark.y - TRAIL_RECT_SIZE / 2,
      TRAIL_RECT_SIZE,
      TRAIL_RECT_SIZE,
    );
  }
  ctx.globalAlpha = 1; // reset so nothing drawn after this is accidentally translucent
}

function drawRobotArrow(centerX, centerY) {
  // Fill and the glow/rim "highlight" are both user-customizable now.
  ctx.shadowColor = colors.robotHighlight;
  ctx.shadowBlur = 10;
  drawArrowShape(
    centerX,
    centerY,
    heading,
    colors.robot,
    colors.robotHighlight,
  );
  ctx.shadowBlur = 0; // reset so it doesn't bleed into the sensor lines drawn next
}

// Draws a short line from the robot toward each of its 3 sensor directions
// (front/left/right, relative to `heading`), colored by what it detects.
function drawSensors(centerX, centerY) {
  const sensors = getSensors();

  const lineOffset = CELL_SIZE * 0.2; // gap between the robot's center and where each line starts
  const lineLength = CELL_SIZE * 0.4;
  ctx.lineWidth = 3;

  for (const [label, dir] of [
    ["front", heading],
    ["left", rotate(heading, -1)],
    ["right", rotate(heading, 1)],
  ]) {
    const delta = DELTAS[dir];
    ctx.strokeStyle = sensors[label] ? colors.sensorWall : colors.sensorClear;
    ctx.beginPath();
    ctx.moveTo(
      centerX + delta.col * lineOffset,
      centerY + delta.row * lineOffset,
    );
    ctx.lineTo(
      centerX + delta.col * (lineOffset + lineLength),
      centerY + delta.row * (lineOffset + lineLength),
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

// --- Maze editing (click, or click-and-drag) ---
// getBoundingClientRect() gives the canvas's position on the page, so we
// can turn a raw mouse position (page coordinates) into a position
// relative to the canvas itself, then into a row/col in our grid.
function getCellFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return {
    row: Math.floor(y / CELL_SIZE),
    col: Math.floor(x / CELL_SIZE),
  };
}

// Sets a cell to be a wall or not — as opposed to toggling it, this lets a
// whole drag stroke stay consistent (see dragAddsWalls below) instead of
// flipping each cell independently.
function setWallAt(row, col, shouldBeWall) {
  const isStartOrEnd =
    (row === START.row && col === START.col) ||
    (row === END.row && col === END.col);
  if (isStartOrEnd) return; // don't let start/end become walls
  if (grid[row][col] === shouldBeWall) return; // already matches, nothing to do

  grid[row][col] = shouldBeWall;
  draw();
}

// Dragging affects every cell the cursor passes over, instead of needing a
// separate click per cell. Whichever the very first cell of the drag was
// decides the whole stroke's direction: starting on an empty cell only
// adds walls for the rest of that drag, starting on a wall only clears
// them — so one stroke can't accidentally do both.
let isDragging = false;
let lastToggledCell = null;
let dragAddsWalls = true;

canvas.addEventListener("mousedown", (event) => {
  isDragging = true;
  const { row, col } = getCellFromEvent(event);
  lastToggledCell = `${row},${col}`;

  dragAddsWalls = !grid[row][col];
  setWallAt(row, col, dragAddsWalls);
});

canvas.addEventListener("mousemove", (event) => {
  if (!isDragging) return;

  const { row, col } = getCellFromEvent(event);
  const key = `${row},${col}`;
  if (key === lastToggledCell) return; // still inside the same cell as last time
  lastToggledCell = key;
  setWallAt(row, col, dragAddsWalls);
});

// Listens on the whole window, not just the canvas — if you release the
// mouse button after dragging off the canvas, this still catches it and
// stops the drag; a canvas-only listener would miss that entirely.
window.addEventListener("mouseup", () => {
  isDragging = false;
  lastToggledCell = null;
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

// --- A* pathfinding algorithm (YOU write this) ---
// This is a fundamentally different kind of algorithm from
// chooseNextAction() above. The wall-follower is reactive and local — it
// only ever sees front/left/right and reacts one step at a time, with no
// memory of the maze. A* is the opposite: it's given the *entire* grid up
// front (like a robot that already has a full map, e.g. from a prior
// scanning pass) and plans the complete shortest route before taking a
// single step.
//
// Write it here, returning an array of { row, col } objects — the path
// from the robot's current cell to END, inclusive of both ends — or an
// empty array [] if no path exists. Once you return a path, the rest of
// the app (see autoSolveStepAStar below) will drive the robot along it
// automatically, one cell per step, reusing the same turning/moving code
// as the wall-follower.
//
// --- A* pseudocode ---
// A* is Dijkstra's algorithm with a heuristic added, so it explores toward
// the goal instead of spreading out equally in every direction:
//
//   openSet = [startCell]
//   gScore = map of cell -> steps taken to reach it so far; gScore[start] = 0
//   fScore = map of cell -> gScore[cell] + heuristic(cell, END)
//   cameFrom = map of cell -> the cell we stepped from to reach it
//     (exactly like computeShortestPath() above already uses to rebuild
//     its path — that function is a good reference for the bookkeeping.)
//
//   while openSet is not empty:
//     current = the cell in openSet with the lowest fScore
//     if current is END: rebuild the path via cameFrom and return it
//     remove current from openSet
//
//     for each open, in-bounds neighbor of current (up/down/left/right):
//       tentativeG = gScore[current] + 1   (every move costs 1 step)
//       if neighbor has no gScore yet, or tentativeG is better than its
//       current gScore:
//         cameFrom[neighbor] = current
//         gScore[neighbor] = tentativeG
//         fScore[neighbor] = tentativeG + heuristic(neighbor, END)
//         add neighbor to openSet if it isn't already there
//
//   if the loop ends without reaching END, there's no path — return []
//
// heuristic(cell, END): Manhattan distance, |cell.row - END.row| +
// |cell.col - END.col| — a safe (never-overestimating) estimate here,
// since every move is exactly one grid step in one direction.
//
// A 15x15 grid is small enough that scanning openSet for the lowest
// fScore each loop (rather than a proper priority queue/heap) is plenty
// fast — no need to build anything fancier than a plain array.
function findPathAStar() {
  // Plans from wherever the robot actually is right now, not always from
  // the maze's fixed START tile — so this still makes sense if you've
  // manually driven partway before switching to A*.
  const startCell = { row: robot.row, col: robot.col };

  const cameFrom = new Map();
  const gScores = new Map();
  const fScores = new Map();

  const openSet = [startCell];
  gScores.set(`${startCell.row},${startCell.col}`, 0);
  fScores.set(`${startCell.row},${startCell.col}`, 0 + heuristic(startCell));

  while (openSet.length > 0) {
    let bestF = Infinity;
    let bestIdx = 0;
    openSet.forEach((cell, i) => {
      let fScore = fScores.get(`${cell.row},${cell.col}`);
      if (fScore < bestF) {
        bestF = fScore;
        bestIdx = i;
      }
    });

    let currentObj = openSet.splice(bestIdx, 1)[0];
    if (currentObj.row === END.row && currentObj.col === END.col) {
      const path = [];
      while (
        currentObj.row !== startCell.row ||
        currentObj.col !== startCell.col
      ) {
        path.unshift(currentObj);
        currentObj = cameFrom.get(`${currentObj.row},${currentObj.col}`);
      }
      path.unshift(startCell);
      return path;
    }

    const neighbors = [];
    if (openCell({ row: currentObj.row + 1, col: currentObj.col }))
      neighbors.push({ row: currentObj.row + 1, col: currentObj.col });

    if (openCell({ row: currentObj.row - 1, col: currentObj.col }))
      neighbors.push({ row: currentObj.row - 1, col: currentObj.col });

    if (openCell({ row: currentObj.row, col: currentObj.col + 1 }))
      neighbors.push({ row: currentObj.row, col: currentObj.col + 1 });

    if (openCell({ row: currentObj.row, col: currentObj.col - 1 }))
      neighbors.push({ row: currentObj.row, col: currentObj.col - 1 });

    neighbors.forEach((neighbor) => {
      const tentativeG = gScores.get(`${currentObj.row},${currentObj.col}`) + 1;
      const currentG =
        gScores.get(`${neighbor.row},${neighbor.col}`) ?? Infinity;
      if (tentativeG < currentG) {
        cameFrom.set(`${neighbor.row},${neighbor.col}`, currentObj);
        gScores.set(`${neighbor.row},${neighbor.col}`, tentativeG);
        fScores.set(
          `${neighbor.row},${neighbor.col}`,
          tentativeG + heuristic(neighbor),
        );

        if (
          !openSet.some(
            (cell) => cell.row === neighbor.row && cell.col === neighbor.col,
          )
        ) {
          openSet.push(neighbor);
        }
      }
    });
  }

  return [];
}

function openCell(cellObj) {
  if (cellObj.row < 0 || cellObj.row > 14) return false;
  if (cellObj.col < 0 || cellObj.col > 14) return false;
  if (grid[cellObj.row][cellObj.col]) return false;

  return true;
}

function heuristic(cellObj) {
  return Math.abs(cellObj.row - END.row) + Math.abs(cellObj.col - END.col);
}

// Figures out which of up/down/left/right leads from one cell to an
// adjacent one — used to translate findPathAStar()'s path into actual
// turns, since moveForward() only knows how to move in `heading`'s
// direction, not "go to this specific cell."
function directionBetween(from, to) {
  for (const dir of DIR_ORDER) {
    const delta = DELTAS[dir];
    if (from.row + delta.row === to.row && from.col + delta.col === to.col) {
      return dir;
    }
  }
  return null; // from/to aren't adjacent — shouldn't happen for a valid path
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

let SOLVE_STEP_DELAY_MS = 200; // pause between steps; adjustable via the Speed slider

// Safety net against an infinite loop in a buggy algorithm — scales with
// the maze's area so a bigger maze (more cells to possibly backtrack
// through) doesn't get flagged as "stuck" too early.
function getMaxSolveSteps() {
  return GRID_SIZE * GRID_SIZE * 3;
}

let solving = false;
let solveStepCount = 0;
let solveTimeoutId = null;
const solveButton = document.getElementById("solveButton");

// Does exactly one right-hand-rule step, returning true once solving is
// over (reached the end, or hit the step limit) — shared by the auto-solve
// loop below and the manual Step button, so both take a step identically.
function performRightHandStep() {
  if (robot.row === END.row && robot.col === END.col) {
    celebrateSolve(`Solved in ${solveStepCount} steps!`);
    return true;
  }

  if (solveStepCount >= getMaxSolveSteps()) {
    document.getElementById("sensorReadout").textContent =
      `Stopped after ${getMaxSolveSteps()} steps without reaching the end — check chooseNextAction().`;
    return true;
  }

  applyAction(chooseNextAction(getSensors()));
  draw();
  solveStepCount++;
  return false;
}

function autoSolveStep() {
  if (performRightHandStep()) {
    stopSolving();
    return;
  }
  solveTimeoutId = setTimeout(autoSolveStep, SOLVE_STEP_DELAY_MS);
}

// The A* equivalent of the pair above: instead of asking an algorithm what
// to do at every step, the whole route was already decided once by
// findPathAStar() before stepping started — each call just turns to face
// and steps into the next cell in that route.
let currentPath = [];
let pathStepIndex = 0;

function performAStarStep() {
  if (robot.row === END.row && robot.col === END.col) {
    celebrateSolve(`Solved in ${solveStepCount} steps!`);
    return true;
  }

  if (pathStepIndex >= currentPath.length) {
    document.getElementById("sensorReadout").textContent =
      "A* didn't reach the end — check findPathAStar().";
    return true;
  }

  const nextCell = currentPath[pathStepIndex];
  pathStepIndex++;

  const dir = directionBetween(robot, nextCell);
  if (dir) {
    heading = dir;
    moveForward();
  }

  draw();
  solveStepCount++;
  return false;
}

function autoSolveStepAStar() {
  if (performAStarStep()) {
    stopSolving();
    return;
  }
  solveTimeoutId = setTimeout(autoSolveStepAStar, SOLVE_STEP_DELAY_MS);
}

function getSelectedAlgorithm() {
  return document.querySelector('input[name="algorithm"]:checked').value;
}

// Locks the algorithm menu while solving — switching mid-run wouldn't
// actually change which algorithm is driving (that's decided once when
// solving starts), so letting the radios still look clickable would just
// be misleading.
function setAlgorithmMenuDisabled(disabled) {
  document.querySelectorAll('input[name="algorithm"]').forEach((input) => {
    input.disabled = disabled;
  });
}

function startSolving() {
  solving = true;
  solveStepCount = 0;
  solveButton.textContent = "Stop";
  setAlgorithmMenuDisabled(true);

  if (getSelectedAlgorithm() === "astar") {
    currentPath = findPathAStar();
    pathStepIndex = 1; // index 0 is the robot's current cell, already where it's standing
    if (currentPath.length === 0) {
      document.getElementById("sensorReadout").textContent =
        "A* returned no path — check findPathAStar().";
      stopSolving();
      return;
    }
    autoSolveStepAStar();
  } else {
    autoSolveStep();
  }
}

function stopSolving() {
  solving = false;
  clearTimeout(solveTimeoutId);
  solveButton.textContent = "Solve";
  setAlgorithmMenuDisabled(false);
}

// Runs exactly one step of whichever algorithm is currently selected, then
// stops — same per-step logic the auto-solver uses, just without
// scheduling another one afterward.
function stepOnce() {
  if (solving) return; // don't fight with the auto-solver while it's running

  if (getSelectedAlgorithm() === "astar") {
    if (currentPath.length === 0) {
      // Nothing computed yet for this run — plan it once, same as Solve
      // would, but still only take a single step.
      currentPath = findPathAStar();
      pathStepIndex = 1; // index 0 is the robot's current cell, already where it's standing
      solveStepCount = 0;
      if (currentPath.length === 0) {
        document.getElementById("sensorReadout").textContent =
          "A* returned no path — check findPathAStar().";
        return;
      }
    }
    performAStarStep();
  } else {
    performRightHandStep();
  }
}

document.getElementById("stepButton").addEventListener("click", stepOnce);

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
  currentPath = [];
  pathStepIndex = 0;
  solveStepCount = 0;
  document.getElementById("sensorReadout").classList.remove("solved");
}

document.getElementById("resetButton").addEventListener("click", () => {
  resetRobot();
  draw();
});

// Clears every wall back to an empty grid — for starting a hand-drawn maze
// over from scratch. Deliberately doesn't touch the robot at all (unlike
// Reset Robot or Randomize) — clearing walls can't strand it anywhere
// invalid, since every cell is now open.
document.getElementById("resetMazeButton").addEventListener("click", () => {
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      grid[row][col] = false;
    }
  }
  draw();
});

document.getElementById("randomizeButton").addEventListener("click", () => {
  generateMaze();
  resetRobot();
  draw();
});

// --- Parameters: size & speed sliders ---
// Rebuilds the maze at a new size — the canvas and the grid array are both
// only ever sized once at load normally, so changing GRID_SIZE alone
// wouldn't resize anything on its own; this is what actually applies it.
// Clears to an empty grid rather than auto-generating a new maze, so
// dragging the slider doesn't repeatedly throw away a hand-drawn maze —
// press Randomize afterward if you want a generated one at the new size.
function resizeMaze(newSize) {
  if (solving) stopSolving();

  GRID_SIZE = newSize;
  END.row = GRID_SIZE - 1;
  END.col = GRID_SIZE - 1;

  canvas.width = GRID_SIZE * CELL_SIZE;
  canvas.height = GRID_SIZE * CELL_SIZE;

  grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false));

  resetRobot();
  draw();
}

const sizeSlider = document.getElementById("sizeSlider");
const sizeValue = document.getElementById("sizeValue");
const speedSlider = document.getElementById("speedSlider");
const speedValue = document.getElementById("speedValue");

// Updates the on-screen "NxN" label live while dragging, but only actually
// resizes (which clears the maze) once the slider is released — otherwise
// dragging across several sizes would clear the maze once per size crossed.
sizeSlider.addEventListener("input", () => {
  sizeValue.textContent = `${sizeSlider.value}×${sizeSlider.value}`;
});
sizeSlider.addEventListener("change", () => {
  resizeMaze(Number(sizeSlider.value));
});

// Speed is framed as "steps per second" rather than a raw delay, since
// higher = faster reads naturally; SOLVE_STEP_DELAY_MS is just 1000 / that.
speedSlider.addEventListener("input", () => {
  const stepsPerSecond = Number(speedSlider.value);
  speedValue.textContent = stepsPerSecond;
  SOLVE_STEP_DELAY_MS = 1000 / stepsPerSecond;
});

// --- Color pickers ---
// Each legend swatch is a native <input type="color"> — clicking one opens
// the browser's own color picker, no extra library needed. This list maps
// each input's id to the key it controls in the `colors` object above.
const COLOR_INPUTS = [
  { id: "color-wall", key: "wall" },
  { id: "color-start", key: "start" },
  { id: "color-end", key: "end" },
  { id: "color-robot", key: "robot" },
  { id: "color-robot-highlight", key: "robotHighlight" },
  { id: "color-sensor-clear", key: "sensorClear" },
  { id: "color-sensor-wall", key: "sensorWall" },
  { id: "color-actual-path", key: "actualPath" },
  { id: "color-shortest-path", key: "shortestPath" },
];

for (const { id, key } of COLOR_INPUTS) {
  document.getElementById(id).addEventListener("input", (event) => {
    colors[key] = event.target.value;
    draw();
  });
}

// Applies a full palette to both the live `colors` object and the visible
// color-picker inputs (updating `colors` alone wouldn't move the pickers).
function applyColorPalette(palette) {
  Object.assign(colors, palette);
  for (const { id, key } of COLOR_INPUTS) {
    document.getElementById(id).value = palette[key];
  }
}

document.getElementById("resetColorsButton").addEventListener("click", () => {
  applyColorPalette(currentDefaults);
  draw();
});

// --- Dark / light mode ---
const themeToggleButton = document.getElementById("themeToggle");

// Shared by the initial page load and the toggle button, so both apply a
// theme change the exact same way.
function applyTheme(lightMode) {
  isLightMode = lightMode;

  document.documentElement.classList.toggle("light-theme", isLightMode);
  themeToggleButton.textContent = isLightMode ? "Dark Mode" : "Light Mode";

  canvasTheme = isLightMode ? CANVAS_THEME.light : CANVAS_THEME.dark;
  currentDefaults = isLightMode ? LIGHT_DEFAULT_COLORS : DARK_DEFAULT_COLORS;
  applyColorPalette(currentDefaults);
}

themeToggleButton.addEventListener("click", () => {
  applyTheme(!isLightMode);
  draw();
});

// Default to whatever the user's OS/browser is already set to, rather than
// always starting in dark mode. This only reads it once at load — if the
// user then toggles manually, we respect that choice instead of flipping
// the theme out from under them if their system setting changes later.
const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
applyTheme(prefersLight);

draw();
