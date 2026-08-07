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

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const x = col * CELL_SIZE;
      const y = row * CELL_SIZE;

      if (grid[row][col]) {
        ctx.fillStyle = "#333"; // wall
      } else if (row === START.row && col === START.col) {
        ctx.fillStyle = "#b6f2b6"; // start cell, light green
      } else if (row === END.row && col === END.col) {
        ctx.fillStyle = "#f2d98a"; // end cell, gold
      } else {
        ctx.fillStyle = "#fff";
      }
      ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);

      ctx.strokeStyle = "#ccc";
      ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
    }
  }

  // Draw the robot as a circle centered in its current cell.
  const centerX = robot.col * CELL_SIZE + CELL_SIZE / 2;
  const centerY = robot.row * CELL_SIZE + CELL_SIZE / 2;
  ctx.fillStyle = "#2b6fe0";
  ctx.beginPath();
  ctx.arc(centerX, centerY, CELL_SIZE / 3, 0, Math.PI * 2);
  ctx.fill();
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
// Maps each arrow key to the row/col change it causes.
const MOVES = {
  ArrowUp: { row: -1, col: 0 },
  ArrowDown: { row: 1, col: 0 },
  ArrowLeft: { row: 0, col: -1 },
  ArrowRight: { row: 0, col: 1 },
};

document.addEventListener("keydown", (event) => {
  const move = MOVES[event.key];
  if (!move) return; // not an arrow key, ignore

  // Arrow keys scroll the page by default — stop that so driving feels normal.
  event.preventDefault();

  const newRow = robot.row + move.row;
  const newCol = robot.col + move.col;

  const inBounds =
    newRow >= 0 && newRow < GRID_SIZE && newCol >= 0 && newCol < GRID_SIZE;
  if (!inBounds || grid[newRow][newCol]) return; // wall or edge of grid blocks movement

  robot.row = newRow;
  robot.col = newCol;
  draw();
});

draw();
