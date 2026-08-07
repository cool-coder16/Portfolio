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
  Array(GRID_SIZE).fill(false)
);

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

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

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

  // Draw the robot as a triangle pointing in the direction it's facing —
  // an arrow makes `heading` visible at a glance, instead of a plain circle
  // that looks the same no matter which way the robot is turned.
  const centerX = robot.col * CELL_SIZE + CELL_SIZE / 2;
  const centerY = robot.row * CELL_SIZE + CELL_SIZE / 2;
  drawRobotArrow(centerX, centerY);

  drawSensors(centerX, centerY);
}

function drawRobotArrow(centerX, centerY) {
  // DIR_ORDER is already clockwise (up, right, down, left), so each step
  // through it is a 90-degree clockwise turn — same trick rotate() uses.
  const angle = (DIR_ORDER.indexOf(heading) * Math.PI) / 2;
  const size = CELL_SIZE / 2.2;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(angle); // rotates the triangle below (drawn pointing "up") to face `heading`

  ctx.fillStyle = "#ff2fd0"; // hot pink — picked to contrast against the blue start cell
  ctx.beginPath();
  ctx.moveTo(0, -size); // tip
  ctx.lineTo(size * 0.6, size * 0.6); // back-right corner
  ctx.lineTo(-size * 0.6, size * 0.6); // back-left corner
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// Draws a short line from the robot toward each of its 3 sensor directions
// (front/left/right, relative to `heading`), colored by what it detects.
function drawSensors(centerX, centerY) {
  const sensors = {
    front: hasWall(heading),
    left: hasWall(rotate(heading, -1)),
    right: hasWall(rotate(heading, 1)),
  };

  const lineLength = CELL_SIZE * 0.6;
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
    ctx.lineTo(centerX + delta.col * lineLength, centerY + delta.row * lineLength);
    ctx.stroke();
  }

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

  // Arrow keys scroll the page by default — stop that so driving feels normal.
  event.preventDefault();

  // Pressing a direction always turns the robot to face it, even if a wall
  // blocks the move — that's what lets you "look" at a wall and see the
  // front sensor go red without needing to move into it.
  heading = dir;

  if (!hasWall(dir)) {
    const delta = DELTAS[dir];
    robot.row += delta.row;
    robot.col += delta.col;
  }

  draw();
});

draw();
