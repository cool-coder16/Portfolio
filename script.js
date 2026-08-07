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

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const x = col * CELL_SIZE;
      const y = row * CELL_SIZE;

      ctx.fillStyle = grid[row][col] ? "#333" : "#fff";
      ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);

      ctx.strokeStyle = "#ccc";
      ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
    }
  }
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

  grid[row][col] = !grid[row][col]; // toggle wall on/off
  draw();
});

draw();
