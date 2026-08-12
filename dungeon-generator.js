// --- The BSP tree ---
// A node is either a LEAF (node.left/node.right are both null — it holds
// a room instead) or a branch with exactly two children covering the two
// halves of its own rect. The whole dungeon starts as a single leaf
// covering the entire area, and splits from there.
//
//   node = {
//     rect: { x, y, w, h },  // this node's slice of the dungeon
//     depth: 0,              // how many splits deep this node is
//     left: null,            // set once this node splits
//     right: null,
//     room: null,            // set once this node is confirmed a leaf
//   }
const DUNGEON_WIDTH = 620;
const DUNGEON_HEIGHT = 460;
const MAX_SPLIT_STEPS = 500; // safety net — see performSplitStep() below

function createNode(rect, depth) {
  return { rect, depth, left: null, right: null, room: null };
}

let maxDepth = 4;
let minLeafSize = 70;

let root = null;
let splitQueue = []; // nodes still waiting for their turn to (maybe) split
let corridors = []; // { from: room, to: room } — filled in once splitting finishes
let generationComplete = false;
let splitStepCount = 0;

function resetDungeon() {
  root = createNode({ x: 0, y: 0, w: DUNGEON_WIDTH, h: DUNGEON_HEIGHT }, 0);
  splitQueue = [root];
  corridors = [];
  generationComplete = false;
  splitStepCount = 0;
  setReadout("Press Step or Generate to build the dungeon.");
  draw();
}

// --- BSP Splitting (YOU write this) ---
// Called once per node, in whatever order they come off the queue. If you
// decide to split, create the two children, ATTACH them to node.left and
// node.right, and return them — the queue will give each one its own turn
// to (maybe) split further. If you decide NOT to split, leave
// node.left/node.right as null and return an empty array — this node is
// now a permanent leaf (a room gets carved into it later, once every
// branch has finished splitting).
//
// node: { rect: {x,y,w,h}, depth, left, right, room } — see the top of
// this file for what each field means. maxDepth/minLeafSize are declared
// above; read them directly, the same way bubbleSortStep() on the sorting
// page read bubblePassEnd.
function trySplitNode(node) {
  if (node.depth >= maxDepth) return [];

  const splitHorizontally = node.rect.w < node.rect.h;

  if (splitHorizontally && node.rect.h < minLeafSize * 2) return [];
  if (!splitHorizontally && node.rect.w < minLeafSize * 2) return [];

  if (splitHorizontally) {
    const splitY = ((Math.random() * 50 + 30) / 100) * node.rect.h;
    node.left = createNode(
      { x: node.rect.x, y: node.rect.y, w: node.rect.w, h: splitY },
      node.depth + 1,
    );
    node.right = createNode(
      {
        x: node.rect.x,
        y: node.rect.y + splitY,
        w: node.rect.w,
        h: node.rect.h - splitY,
      },
      node.depth + 1,
    );
  } else {
    const splitX = ((Math.random() * 50 + 30) / 100) * node.rect.w;
    node.left = createNode(
      { x: node.rect.x, y: node.rect.y, w: splitX, h: node.rect.h },
      node.depth + 1,
    );
    node.right = createNode(
      {
        x: node.rect.x + splitX,
        y: node.rect.y,
        w: node.rect.w - splitX,
        h: node.rect.h,
      },
      node.depth + 1,
    );
  }

  return [node.left, node.right];
}

// --- Room carving ---
// Shrinks a leaf's rect down into a smaller room with some random
// breathing room around it, so adjacent rooms never touch directly.
function carveRoom(rect, padding) {
  const w = Math.max(10, rect.w - padding * 2 - Math.random() * padding);
  const h = Math.max(10, rect.h - padding * 2 - Math.random() * padding);
  const x =
    rect.x + padding + Math.random() * Math.max(0, rect.w - w - padding * 2);
  const y =
    rect.y + padding + Math.random() * Math.max(0, rect.h - h - padding * 2);
  return { x, y, w, h };
}

function carveAllRooms(node, padding) {
  if (!node.left) {
    node.room = carveRoom(node.rect, padding);
    return;
  }
  carveAllRooms(node.left, padding);
  carveAllRooms(node.right, padding);
}

function countLeaves(node) {
  if (!node.left) return 1;
  return countLeaves(node.left) + countLeaves(node.right);
}

function collectAllRooms(node) {
  if (!node.left) return [node.room];
  return [...collectAllRooms(node.left), ...collectAllRooms(node.right)];
}

// --- Connecting rooms (YOU write this) ---
// Runs once, after every node has finished splitting and every leaf has a
// room. Walks the tree, connecting sibling subtrees with a corridor —
// same idea as merge sort's bottom-up merging, just building a graph of
// rooms instead of a sorted array.
//
// node: a BSP tree node (leaves have node.room set; branches have
// node.left/node.right).
//
// Returns: a single room ({x, y, w, h}) — "the room that represents this
// whole subtree" — so whichever node called this one level up has
// something to connect against. For a leaf, that's just its own room; for
// a branch, either child's returned room works fine.
//
// Side effect: whenever you connect two rooms, record it by pushing
// { from: roomA, to: roomB } onto the corridors array (declared above) —
// drawCorridor() below handles turning that into an actual drawn path.
function connectRooms(node) {
  if (node.left == null) {
    return node.room;
  }

  const leftRoom = connectRooms(node.left);
  const rightRoom = connectRooms(node.right);
  corridors.push({ from: leftRoom, to: rightRoom });

  return Math.random() < 0.5 ? leftRoom : rightRoom;
}

// --- Corridor routing (grid-based pathfinding) ---
// connectRooms() above only decides WHICH rooms get connected — this is
// what actually finds a route between them that guarantees the two things
// a straight/bent line can't: never cutting through an unrelated room,
// and never overlapping a corridor already placed. Same core idea as the
// maze robot's A* — a grid search that treats obstacles as impassable —
// just routing room-edge to room-edge instead of start to end, and using
// plain BFS instead of A* since every move costs the same, so there's no
// need for a heuristic to find the shortest path.
const GRID_CELL_SIZE = 4;

// Deliberately separate from rectCenter() further down this file — that
// one adds the canvas's MARGIN for drawing purposes, but the pathfinding
// grid is built directly from the rooms' own (unshifted) coordinates, so
// mixing the two would offset the search away from where the grid
// actually thinks the rooms are.
function roomCenter(room) {
  return { x: room.x + room.w / 2, y: room.y + room.h / 2 };
}

// Checks whether this cell OVERLAPS the room at all — matching
// buildRoomBlockedGrid()'s own floor/ceil range exactly, so a cell that
// grid considers "blocked because of room R" is always also recognized
// here as "belongs to room R" when R is the current from/to room. A
// center-point check doesn't line up with that: a cell along a room's
// edge can get marked blocked (it partly overlaps the room) while its
// own center falls just outside the room's exact bounds — sealing off
// that cell for every corridor, including the room's own.
function cellInsideRoom(row, col, room) {
  const cellLeft = col * GRID_CELL_SIZE;
  const cellTop = row * GRID_CELL_SIZE;
  const cellRight = cellLeft + GRID_CELL_SIZE;
  const cellBottom = cellTop + GRID_CELL_SIZE;
  return (
    cellRight > room.x &&
    cellLeft < room.x + room.w &&
    cellBottom > room.y &&
    cellTop < room.y + room.h
  );
}

function worldToCell(point) {
  return {
    row: Math.floor(point.y / GRID_CELL_SIZE),
    col: Math.floor(point.x / GRID_CELL_SIZE),
  };
}

function cellToWorld(cell) {
  return {
    x: cell.col * GRID_CELL_SIZE + GRID_CELL_SIZE / 2,
    y: cell.row * GRID_CELL_SIZE + GRID_CELL_SIZE / 2,
  };
}

// Marks every room's interior as blocked — built once per generation and
// reused for every corridor, rather than rebuilt from scratch each time.
function buildRoomBlockedGrid() {
  const rows = Math.ceil(DUNGEON_HEIGHT / GRID_CELL_SIZE);
  const cols = Math.ceil(DUNGEON_WIDTH / GRID_CELL_SIZE);
  const blocked = Array.from({ length: rows }, () => new Array(cols).fill(false));

  for (const room of collectAllRooms(root)) {
    const startRow = Math.floor(room.y / GRID_CELL_SIZE);
    const endRow = Math.ceil((room.y + room.h) / GRID_CELL_SIZE);
    const startCol = Math.floor(room.x / GRID_CELL_SIZE);
    const endCol = Math.ceil((room.x + room.w) / GRID_CELL_SIZE);
    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        if (row >= 0 && row < rows && col >= 0 && col < cols) blocked[row][col] = true;
      }
    }
  }

  return { blocked, rows, cols };
}

// A cell is walkable for THIS corridor if: it's not inside any room at
// all, OR it's inside specifically this corridor's own from/to room (has
// to be, since the path needs to start and end somewhere inside them).
// avoidCorridors additionally treats every previously-routed corridor's
// cells as blocked too, so new corridors path around old ones instead of
// crossing them.
function isWalkable(row, col, corridor, roomGrid, corridorGrid, avoidCorridors) {
  if (avoidCorridors && corridorGrid[row][col]) return false;
  if (!roomGrid.blocked[row][col]) return true;
  return cellInsideRoom(row, col, corridor.from) || cellInsideRoom(row, col, corridor.to);
}

// Plain breadth-first search, 4-directional (right-angle corridors, to
// match the dungeon's overall look) — returns an array of {row, col}
// cells from corridor.from to corridor.to, or null if there's truly no
// walkable route.
function findCorridorPath(corridor, roomGrid, corridorGrid, avoidCorridors) {
  const start = worldToCell(roomCenter(corridor.from));
  const goal = worldToCell(roomCenter(corridor.to));

  const visited = Array.from({ length: roomGrid.rows }, () => new Array(roomGrid.cols).fill(false));
  const cameFrom = new Map();
  const queue = [start];
  visited[start.row][start.col] = true;

  const directions = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.row === goal.row && current.col === goal.col) {
      const path = [current];
      let key = `${current.row},${current.col}`;
      while (cameFrom.has(key)) {
        const prev = cameFrom.get(key);
        path.push(prev);
        key = `${prev.row},${prev.col}`;
      }
      return path.reverse();
    }

    for (const [dRow, dCol] of directions) {
      const row = current.row + dRow;
      const col = current.col + dCol;
      if (row < 0 || row >= roomGrid.rows || col < 0 || col >= roomGrid.cols) continue;
      if (visited[row][col]) continue;
      if (!isWalkable(row, col, corridor, roomGrid, corridorGrid, avoidCorridors)) continue;

      visited[row][col] = true;
      cameFrom.set(`${row},${col}`, current);
      queue.push({ row, col });
    }
  }

  return null; // no walkable route at all
}

// Routes every corridor in order, marking each one's cells as taken
// before routing the next — that's what makes later corridors path
// around earlier ones instead of just around rooms. If a corridor
// genuinely can't reach its target without crossing another corridor
// (rare, but geometrically possible), it falls back to allowing that
// rather than silently leaving two rooms disconnected.
function routeAllCorridors() {
  const roomGrid = buildRoomBlockedGrid();
  const corridorGrid = Array.from({ length: roomGrid.rows }, () => new Array(roomGrid.cols).fill(false));

  for (const corridor of corridors) {
    let path = findCorridorPath(corridor, roomGrid, corridorGrid, true);
    if (!path) {
      path = findCorridorPath(corridor, roomGrid, corridorGrid, false);
    }
    corridor.path = path || [];
    for (const cell of corridor.path) {
      // Only mark OPEN-SPACE cells as taken. A cell inside some room is
      // always fair game for every corridor that touches that room (a
      // hub room with three corridors necessarily has three paths
      // crossing its own interior) — marking those too meant a second
      // corridor sharing a hub would find its own required starting cell
      // already "blocked," forcing it into the crossing-allowed fallback
      // for no real reason.
      if (!roomGrid.blocked[cell.row][cell.col]) {
        corridorGrid[cell.row][cell.col] = true;
      }
    }
  }
}

// Does one unit of dungeon-building work — one split if there's still
// anything queued, otherwise (once, the moment the queue empties) carving
// every room and connecting them all. Mirrors performBubbleSortStep() on
// the sorting page: shared by the manual Step button and the Generate
// auto-run below, and returns true once there's nothing left to do.
function performSplitStep() {
  if (splitStepCount >= MAX_SPLIT_STEPS) {
    setReadout(
      `Stopped after ${MAX_SPLIT_STEPS} splits without finishing — check trySplitNode().`,
    );
    return true;
  }

  if (splitQueue.length > 0) {
    const node = splitQueue.shift();
    const children = trySplitNode(node);
    splitQueue.push(...children);
    splitStepCount++;
    setReadout(
      `Splitting... ${splitQueue.length} node${splitQueue.length === 1 ? "" : "s"} left to check.`,
    );
    draw();
    return false;
  }

  if (!generationComplete) {
    carveAllRooms(root, Number(roomPaddingInput.value));
    corridors = [];
    connectRooms(root);
    routeAllCorridors();
    generationComplete = true;

    const roomCount = countLeaves(root);
    celebrate(
      `Dungeon generated: ${roomCount} rooms, ${corridors.length} corridors!`,
    );
    draw();
  }
  return true;
}

// --- Controls ---
let generating = false;
let generateTimeoutId = null;
let GENERATE_STEP_DELAY_MS = 200; // adjustable via the Speed slider
const generateButton = document.getElementById("generateButton");

function celebrate(message) {
  const readout = document.getElementById("dungeonReadout");
  readout.textContent = message;
  readout.classList.add("solved");
}

function setReadout(message) {
  const readout = document.getElementById("dungeonReadout");
  readout.textContent = message;
  readout.classList.remove("solved");
}

function autoGenerateStep() {
  if (performSplitStep()) {
    stopGenerating();
    return;
  }
  generateTimeoutId = setTimeout(autoGenerateStep, GENERATE_STEP_DELAY_MS);
}

function startGenerating() {
  generating = true;
  generateButton.textContent = "Stop";
  autoGenerateStep();
}

function stopGenerating() {
  generating = false;
  clearTimeout(generateTimeoutId);
  generateButton.textContent = "Generate";
}

document.getElementById("stepButton").addEventListener("click", () => {
  if (generating) return; // don't fight the auto-run
  performSplitStep();
});

generateButton.addEventListener("click", () => {
  if (generating) {
    stopGenerating();
  } else if (generationComplete) {
    setReadout("Already generated — press New Dungeon to try again.");
  } else {
    startGenerating();
  }
});

document.getElementById("newDungeonButton").addEventListener("click", () => {
  stopGenerating();
  resetDungeon();
});

// --- Setup panel ---
const maxDepthInput = document.getElementById("maxDepthInput");
const maxDepthValue = document.getElementById("maxDepthValue");
maxDepthInput.addEventListener("input", () => {
  maxDepthValue.textContent = maxDepthInput.value;
  maxDepth = Number(maxDepthInput.value);
  stopGenerating();
  resetDungeon();
});

const minLeafSizeInput = document.getElementById("minLeafSizeInput");
const minLeafSizeValue = document.getElementById("minLeafSizeValue");
minLeafSizeInput.addEventListener("input", () => {
  minLeafSizeValue.textContent = minLeafSizeInput.value;
  minLeafSize = Number(minLeafSizeInput.value);
  stopGenerating();
  resetDungeon();
});

const roomPaddingInput = document.getElementById("roomPaddingInput");
const roomPaddingValue = document.getElementById("roomPaddingValue");
roomPaddingInput.addEventListener("input", () => {
  roomPaddingValue.textContent = roomPaddingInput.value;
  // Only affects carveRoom(), which hasn't run yet unless generation is
  // already complete — no need to restart an in-progress split over this.
  if (generationComplete) {
    stopGenerating();
    resetDungeon();
  }
});

// Slider is in steps/sec (higher = faster, which reads more naturally
// than a raw millisecond delay) — GENERATE_STEP_DELAY_MS is just 1000 / that.
const speedInput = document.getElementById("speedInput");
const speedValue = document.getElementById("speedValue");
speedInput.addEventListener("input", () => {
  const stepsPerSecond = Number(speedInput.value);
  speedValue.textContent = stepsPerSecond;
  GENERATE_STEP_DELAY_MS = 1000 / stepsPerSecond;
});

// --- Canvas ---
const canvas = document.getElementById("dungeonCanvas");
const ctx = canvas.getContext("2d");
const MARGIN = 10;

const SCENE_THEME = {
  dark: {
    background: "#1c212b",
    splitLine: "#2f3542",
    room: "#00e5ff",
    corridor: "#ffcc33",
  },
  light: {
    background: "#ffffff",
    splitLine: "#ccd3dc",
    room: "#0077b6",
    corridor: "#e0a800",
  },
};

// Faint outlines for every BSP split, drawn behind everything else — lets
// you see how the space actually got divided, not just the end result.
function drawSplitLines(node, theme) {
  if (!node.left) {
    ctx.strokeStyle = theme.splitLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      MARGIN + node.rect.x,
      MARGIN + node.rect.y,
      node.rect.w,
      node.rect.h,
    );
    return;
  }
  drawSplitLines(node.left, theme);
  drawSplitLines(node.right, theme);
}

function drawRooms(node, theme) {
  if (!node.left) {
    if (node.room) {
      ctx.fillStyle = theme.room;
      ctx.fillRect(
        MARGIN + node.room.x,
        MARGIN + node.room.y,
        node.room.w,
        node.room.h,
      );
    }
    return;
  }
  drawRooms(node.left, theme);
  drawRooms(node.right, theme);
}

// Draws the actual path routeAllCorridors() found — a sequence of grid
// cells, not just a bent line between two centers, so it can weave around
// rooms and other corridors instead of cutting straight through them.
function drawCorridor(corridor, theme) {
  if (!corridor.path || corridor.path.length === 0) return;

  ctx.strokeStyle = theme.corridor;
  ctx.lineWidth = 4;
  ctx.beginPath();

  const first = cellToWorld(corridor.path[0]);
  ctx.moveTo(MARGIN + first.x, MARGIN + first.y);
  for (const cell of corridor.path.slice(1)) {
    const point = cellToWorld(cell);
    ctx.lineTo(MARGIN + point.x, MARGIN + point.y);
  }
  ctx.stroke();
}

function draw() {
  const theme = document.documentElement.classList.contains("light-theme")
    ? SCENE_THEME.light
    : SCENE_THEME.dark;

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!root) return;

  drawSplitLines(root, theme);
  for (const corridor of corridors) {
    drawCorridor(corridor, theme);
  }
  drawRooms(root, theme);
}

resetDungeon();
