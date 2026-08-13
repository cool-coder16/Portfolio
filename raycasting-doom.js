// --- Map ---
// Cell values: 0 = floor, 1 = wall, 2 = stairs up, 3 = stairs down (both
// walkable — see updateStairsHint()/goUpStairs()/goDownStairs() below,
// which is what actually switches floors, on pressing E). Cells are 1
// world unit wide/tall — the player's x/y are floating-point positions IN
// that grid (e.g. x=2.5 is the exact center of column 2), not pixels.
// Every renderer below (the minimap and the 3D view) converts from these
// world units into its own pixel space; castRay() works entirely in
// world units too.
const CELL_FLOOR = 0;
const CELL_WALL = 1;
const CELL_STAIRS_UP = 2;
const CELL_STAIRS_DOWN = 3;

const MAP_ROWS = 12;
const MAP_COLS = 12;
const NUM_FLOORS = 10;
const TREASURES_PER_FLOOR = 3;

// Both torch count and torch size grow with floor index, so the climb
// gets visibly busier/bolder near the top instead of every floor feeling
// identical.
const TORCHES_BASE = 3;
const TORCH_SIZE_BASE = 0.3; // world units, floor 1
const TORCH_SIZE_GROWTH = 0.03; // world units added per floor

function torchesForFloor(index) {
  return TORCHES_BASE + Math.floor(index * 0.7);
}

function torchSizeForFloor(index) {
  return TORCH_SIZE_BASE + index * TORCH_SIZE_GROWTH;
}

// --- Map randomizer ---
// Fills a fresh grid with border walls, then scatters random single-cell
// wall blocks through the interior — skipping any cell adjacent to a
// "reserved" spot (the stairs, the floor's starting corner) so a floor
// can never wall off something the player needs to reach. This doesn't
// verify full reachability the way a real maze generator would;
// scattering isolated single-cell blocks over mostly-open floor
// essentially can't seal off a region by accident, so a lighter check is
// a reasonable trade for keeping this simple.
const RANDOM_WALL_BLOCKS = 10;
const RANDOM_PLACEMENT_ATTEMPTS = RANDOM_WALL_BLOCKS * 20;

function generateRandomMap(reservedCells) {
  const map = [];
  for (let row = 0; row < MAP_ROWS; row++) {
    const rowCells = [];
    for (let col = 0; col < MAP_COLS; col++) {
      const isBorder =
        row === 0 || row === MAP_ROWS - 1 || col === 0 || col === MAP_COLS - 1;
      rowCells.push(isBorder ? CELL_WALL : CELL_FLOOR);
    }
    map.push(rowCells);
  }

  const isReserved = (row, col) =>
    reservedCells.some(
      (cell) => Math.abs(cell.row - row) <= 1 && Math.abs(cell.col - col) <= 1,
    );

  let placed = 0;
  let attempts = 0;
  while (placed < RANDOM_WALL_BLOCKS && attempts < RANDOM_PLACEMENT_ATTEMPTS) {
    attempts++;
    const row = 1 + Math.floor(Math.random() * (MAP_ROWS - 2));
    const col = 1 + Math.floor(Math.random() * (MAP_COLS - 2));
    if (isReserved(row, col)) continue;
    map[row][col] = CELL_WALL;
    placed++;
  }

  return map;
}

function randomInteriorCell() {
  return {
    row: 1 + Math.floor(Math.random() * (MAP_ROWS - 2)),
    col: 1 + Math.floor(Math.random() * (MAP_COLS - 2)),
  };
}

// Where the player lands after using a staircase: the first open floor
// cell next to it, not the stairs cell itself — landing ON the stairs
// cell would immediately re-trigger updateStairsHint() and make it look
// like you could hit E to instantly go right back.
function findEntryNear(map, cell) {
  const neighbors = [
    { row: cell.row - 1, col: cell.col },
    { row: cell.row + 1, col: cell.col },
    { row: cell.row, col: cell.col - 1 },
    { row: cell.row, col: cell.col + 1 },
  ];
  for (const n of neighbors) {
    if (map[n.row]?.[n.col] === CELL_FLOOR) {
      return { x: n.col + 0.5, y: n.row + 0.5, angle: 0 };
    }
  }
  return { x: cell.col + 0.5, y: cell.row + 0.5, angle: 0 };
}

// Finds every spot a torch could mount: a WALL cell with at least one
// floor cell next to it (the face the torch pokes into the room), picked
// randomly from all such spots on the floor. The returned side/wallX
// match exactly how castRay()'s DDA identifies that same face — a ray
// entering from the west crosses the line x = mapX, landing on side 0
// with wallX = its hit-Y fraction, which is exactly what "west face,
// worldX = mapX, worldY = mapY + wallX" below produces — so a torch
// placed here renders (and gets hit-tested) through the exact same
// wallDecal-matching code path used for laser marks, just with its own
// lit/unlit color and state instead of always being red.
//
// approachDir matters for freestanding single-cell wall blocks (which
// this map generator produces a lot of): side alone (0 or 1) can't tell
// a west face from an east face — both are "a vertical line got crossed"
// — so without it, a torch mounted on one face would also incorrectly
// match (and render/be shootable from) rays hitting the opposite face,
// right through the wall between them. It's the same value castRay()'s
// own stepX/stepY carries at the moment of the hit — see castAllRays().
function pickTorchSpot(map) {
  const candidates = [];
  for (let row = 1; row < MAP_ROWS - 1; row++) {
    for (let col = 1; col < MAP_COLS - 1; col++) {
      if (map[row][col] !== CELL_WALL) continue;

      const faces = [
        { nRow: row - 1, nCol: col, side: 1, worldY: row, approachDir: 1 }, // north face, hit by a ray moving +y (south)
        { nRow: row + 1, nCol: col, side: 1, worldY: row + 1, approachDir: -1 }, // south face, hit moving -y (north)
        { nRow: row, nCol: col - 1, side: 0, worldX: col, approachDir: 1 }, // west face, hit moving +x (east)
        { nRow: row, nCol: col + 1, side: 0, worldX: col + 1, approachDir: -1 }, // east face, hit moving -x (west)
      ];

      for (const face of faces) {
        if (map[face.nRow]?.[face.nCol] !== CELL_FLOOR) continue;
        const along = 0.3 + Math.random() * 0.4; // stay off the corners
        const worldX = face.side === 0 ? face.worldX : col + along;
        const worldY = face.side === 1 ? face.worldY : row + along;
        candidates.push({
          mapX: col,
          mapY: row,
          side: face.side,
          approachDir: face.approachDir,
          wallX: along,
          worldX,
          worldY,
        });
      }
    }
  }
  if (candidates.length === 0) return null;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  return { ...chosen, lit: false };
}

// Picks `count` random open floor cells for treasures — skipping cells
// near anything reserved (stairs, the starting corner) the same way
// generateRandomMap() keeps walls off those spots, and removing each
// chosen cell from the candidate pool as it's picked so two treasures can
// never land on top of each other.
function pickTreasureSpots(map, count, reservedCells) {
  const candidates = [];
  for (let row = 1; row < MAP_ROWS - 1; row++) {
    for (let col = 1; col < MAP_COLS - 1; col++) {
      if (map[row][col] !== CELL_FLOOR) continue;
      const tooClose = reservedCells.some(
        (cell) => Math.abs(cell.row - row) <= 1 && Math.abs(cell.col - col) <= 1,
      );
      if (!tooClose) candidates.push({ row, col });
    }
  }

  const treasures = [];
  for (let i = 0; i < count && candidates.length > 0; i++) {
    const index = Math.floor(Math.random() * candidates.length);
    const cell = candidates.splice(index, 1)[0];
    treasures.push({ row: cell.row, col: cell.col, collected: false });
  }
  return treasures;
}

// Builds one fully-generated floor: walls, its up/down staircases (the
// bottom floor has no down-stairs, the top floor has no up-stairs), the
// entry points used when arriving via either staircase, a handful of
// wall-mounted torches (more of them, and bigger, on higher floors — see
// torchesForFloor()/torchSizeForFloor()), and a few treasures to collect.
function generateFloor(index) {
  const hasUp = index < NUM_FLOORS - 1;
  const hasDown = index > 0;

  const upCell = hasUp ? randomInteriorCell() : null;
  let downCell = null;
  if (hasDown) {
    do {
      downCell = randomInteriorCell();
    } while (
      upCell &&
      downCell.row === upCell.row &&
      downCell.col === upCell.col
    );
  }

  const reservedCells = [
    { row: 1, col: 1 },
    ...(upCell ? [upCell] : []),
    ...(downCell ? [downCell] : []),
  ];
  const map = generateRandomMap(reservedCells);
  if (upCell) map[upCell.row][upCell.col] = CELL_STAIRS_UP;
  if (downCell) map[downCell.row][downCell.col] = CELL_STAIRS_DOWN;

  const torches = [];
  const torchCount = torchesForFloor(index);
  for (let i = 0; i < torchCount; i++) {
    const spot = pickTorchSpot(map);
    if (spot) torches.push(spot);
  }

  const treasures = pickTreasureSpots(map, TREASURES_PER_FLOOR, reservedCells);

  return {
    map,
    upCell,
    downCell,
    entryFromBelow: downCell ? findEntryNear(map, downCell) : null,
    entryFromAbove: upCell ? findEntryNear(map, upCell) : null,
    torches,
    treasures,
    torchSize: torchSizeForFloor(index),
  };
}

let levels = [];
for (let i = 0; i < NUM_FLOORS; i++) levels.push(generateFloor(i));

let currentLevelIndex = 0;
let MAP = levels[currentLevelIndex].map;

// Highest floor (1-indexed) on which every torch has ever been lit,
// persisted so it survives a reload — same localStorage pattern the
// site's theme toggle already uses. Checked whenever a torch gets lit
// (see checkLaserHitsTorch()), since that's the only moment "all lit"
// could newly become true.
let bestFloor = Number(localStorage.getItem("raycastingBestFloor")) || 0;

function checkAllTorchesLit() {
  const level = levels[currentLevelIndex];
  const allLit = level.torches.length > 0 && level.torches.every((t) => t.lit);
  if (allLit && currentLevelIndex + 1 > bestFloor) {
    bestFloor = currentLevelIndex + 1;
    localStorage.setItem("raycastingBestFloor", String(bestFloor));
  }
}

function isWall(x, y) {
  const col = Math.floor(x);
  const row = Math.floor(y);
  if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return true;
  return MAP[row][col] === CELL_WALL;
}

function goUpStairs() {
  if (currentLevelIndex >= NUM_FLOORS - 1) return;
  currentLevelIndex++;
  enterCurrentLevel(levels[currentLevelIndex].entryFromBelow);
}

function goDownStairs() {
  if (currentLevelIndex <= 0) return;
  currentLevelIndex--;
  enterCurrentLevel(levels[currentLevelIndex].entryFromAbove);
}

function enterCurrentLevel(entry) {
  MAP = levels[currentLevelIndex].map;
  player.x = entry.x;
  player.y = entry.y;
  player.angle = entry.angle;
  floorLabel.textContent = currentLevelIndex + 1;
  stairsHintType = null;
}

// --- Player ---
const PLAYER_RADIUS = 0.2; // world units — keeps the player from clipping into wall corners
const MOVE_SPEED = 0.06; // world units per frame
const ROTATE_SPEED = 0.04; // radians per frame

let player = { x: 1.5, y: 1.5, angle: 0 }; // angle: 0 = facing +x, increases toward +y

// Checks a small ring of points around (x, y) — not just its exact
// center — so the player's own radius never overlaps a wall, even when
// approaching one at an angle instead of straight on.
function isBlocked(x, y) {
  return (
    isWall(x - PLAYER_RADIUS, y) ||
    isWall(x + PLAYER_RADIUS, y) ||
    isWall(x, y - PLAYER_RADIUS) ||
    isWall(x, y + PLAYER_RADIUS)
  );
}

// Moves each axis independently, keeping whichever axis's move doesn't
// hit a wall — this is what lets the player slide along a wall instead of
// stopping dead the instant either axis would collide.
function tryMove(dx, dy) {
  const nextX = player.x + dx;
  if (!isBlocked(nextX, player.y)) player.x = nextX;

  const nextY = player.y + dy;
  if (!isBlocked(player.x, nextY)) player.y = nextY;
}

const heldKeys = new Set();
window.addEventListener("keydown", (event) => heldKeys.add(event.code));
window.addEventListener("keyup", (event) => heldKeys.delete(event.code));
// If the window loses focus while a key is physically held (alt-tabbing
// away, a browser dialog stealing focus, clicking outside the page), the
// matching keyup fires somewhere this page never sees — without this,
// that key would stay stuck "held" forever, leaving the player drifting
// or spinning on its own with nothing actually pressed.
window.addEventListener("blur", () => heldKeys.clear());

// Which staircase (if any) the player is currently standing on — checked
// every frame, but ONLY switches floors when E is actually pressed (see
// the keydown listener near fireLaser() below), not just by walking onto
// the tile. Also drives the readout's contextual hint.
let stairsHintType = null;

function updateStairsHint() {
  const col = Math.floor(player.x);
  const row = Math.floor(player.y);
  const cell = MAP[row][col];
  stairsHintType =
    cell === CELL_STAIRS_UP ? "up" : cell === CELL_STAIRS_DOWN ? "down" : null;
}

// Collects any not-yet-collected treasure sitting in the player's current
// cell — a plain position check, no raycasting involved, since picking
// something up only needs to know where the player IS, not what they can
// see.
function updateTreasurePickup() {
  const col = Math.floor(player.x);
  const row = Math.floor(player.y);
  for (const treasure of levels[currentLevelIndex].treasures) {
    if (!treasure.collected && treasure.row === row && treasure.col === col) {
      treasure.collected = true;
    }
  }
}

function updatePlayer() {
  let moveStep = 0;
  if (heldKeys.has("ArrowUp") || heldKeys.has("KeyW")) moveStep += MOVE_SPEED;
  if (heldKeys.has("ArrowDown") || heldKeys.has("KeyS")) moveStep -= MOVE_SPEED;
  if (moveStep !== 0) {
    tryMove(
      Math.cos(player.angle) * moveStep,
      Math.sin(player.angle) * moveStep,
    );
  }

  if (heldKeys.has("ArrowLeft") || heldKeys.has("KeyA"))
    player.angle -= ROTATE_SPEED;
  if (heldKeys.has("ArrowRight") || heldKeys.has("KeyD"))
    player.angle += ROTATE_SPEED;

  updateStairsHint();
  updateTreasurePickup();
}

// --- Raycasting (YOU write this) ---
// This is the one function the entire view is built from: given where the
// player is standing and the direction a single ray points, how far does
// that ray travel before it hits a wall? Call it once per screen column
// (each at a slightly different angle) and you get an entire 3D-looking
// view for free — closer walls (small distance) get drawn tall, farther
// walls (big distance) get drawn short.
//
// The naive approach — step a tiny amount along the ray in a loop,
// checking isWall() each time — works, but either takes tiny steps (slow:
// thousands of checks per ray) or big steps (inaccurate: can skip past a
// thin wall entirely). DDA (Digital Differential Analysis) is the trick
// real raycasters use instead: rather than tiny fixed steps, jump exactly
// to the next grid LINE crossing each time — the next spot where the ray
// crosses from one cell into another — so it's both fast (one check per
// cell actually crossed) and exact (never skips a cell).
//
// How it works:
//   1. rayDirX = Math.cos(angle), rayDirY = Math.sin(angle) — the ray's
//      direction as a unit vector.
//   2. deltaDistX = Math.abs(1 / rayDirX) — how far the ray has to travel
//      (in world units, along the ray itself) to cross one full cell
//      width in x. (Math.abs(1 / rayDirY) for deltaDistY, same idea for
//      y.) Dividing by zero here just gives Infinity, which is exactly
//      right for a ray that's perfectly horizontal or vertical — it never
//      crosses a line in that axis at all.
//   3. stepX = rayDirX < 0 ? -1 : 1 (which direction, in whole grid
//      cells, the ray moves as it crosses x-lines — stepY the same for
//      y), and sideDistX/sideDistY = the distance from the player's
//      CURRENT position to the very first x-line/y-line crossing ahead of
//      it (a partial first step, since the player usually starts
//      mid-cell, not on a line).
//   4. Loop: compare sideDistX and sideDistY — whichever is smaller means
//      THAT line is the next one the ray reaches. Jump the map
//      coordinate one cell in that direction (mapX += stepX or
//      mapY += stepY), add that axis's deltaDist to its own sideDist (now
//      pointing at the FOLLOWING line in that axis), and remember which
//      axis you just stepped (side = 0 for an x-line/vertical wall, 1 for
//      a y-line/horizontal wall — useful later for shading, so vertical
//      and horizontal walls don't look identically flat).
//   5. After each jump, check MAP[mapY][mapX] (or isWall(mapX, mapY)) —
//      if it's a wall, stop.
//   6. Return the PERPENDICULAR distance, not the raw travel distance —
//      side 0: (sideDistX - deltaDistX), side 1: (sideDistY - deltaDistY).
//      Using the raw distance instead would make straight walls look
//      warped/bulged (the "fisheye" effect), since rays at the edge of
//      the view travel farther to reach a wall directly ahead than a ray
//      pointed straight at it, even for a flat wall equidistant from the
//      player in a straight line.
//
// Params: px, py — the player's position, in world units. angle — the
// ray's direction, in radians. map — the 2D wall grid (MAP above).
// Returns: { distance, side, mapX, mapY, stepX, stepY } — distance is the
// perpendicular distance to the wall that was hit; side is 0 or 1;
// mapX/mapY are the grid coordinates of the wall cell that got hit;
// stepX/stepY (each -1 or 1) record which DIRECTION the ray was
// crossing lines in when it hit — needed downstream (see
// pickTorchSpot()'s approachDir) to tell apart the two opposite faces of
// a freestanding wall block, since mapX/mapY/side alone can't.
function castRay(px, py, angle, map) {
  const rayDirVector = { x: Math.cos(angle), y: Math.sin(angle) };
  const deltaDirVector = {
    x: Math.abs(1 / rayDirVector.x),
    y: Math.abs(1 / rayDirVector.y),
  };
  const stepX = rayDirVector.x < 0 ? -1 : 1;
  const stepY = rayDirVector.y < 0 ? -1 : 1;

  let mapX = Math.floor(px);
  let mapY = Math.floor(py);

  const gapX = stepX === -1 ? px - mapX : mapX + 1 - px;
  const gapY = stepY === -1 ? py - mapY : mapY + 1 - py;

  let sideDistX = gapX * deltaDirVector.x;
  let sideDistY = gapY * deltaDirVector.y;

  while (true) {
    let dir;
    if (sideDistX <= sideDistY) {
      mapX += stepX;
      dir = 0;
    } else {
      mapY += stepY;
      dir = 1;
    }

    if (isWall(mapX, mapY)) {
      return {
        distance: dir === 0 ? sideDistX : sideDistY,
        side: dir,
        mapX,
        mapY,
        stepX,
        stepY,
      };
    } else {
      if (dir === 0) {
        sideDistX += deltaDirVector.x;
      } else {
        sideDistY += deltaDirVector.y;
      }
    }
  }
}

// Casts one ray per screen column of viewCanvas, fanned out across FOV
// centered on the player's facing angle. Both draw3DView() and
// drawMinimap() are handed this same array, so the minimap's ray fan
// always matches exactly what the 3D view is showing — not a second,
// separately-computed approximation of it.
const FOV = (66 * Math.PI) / 180;
const NUM_RAYS = 640; // one per pixel of viewCanvas's width

function castAllRays() {
  const rays = [];
  for (let i = 0; i < NUM_RAYS; i++) {
    const rayAngle = player.angle - FOV / 2 + (i / NUM_RAYS) * FOV;
    const hit = castRay(player.x, player.y, rayAngle, MAP);

    // The world-space point this ray actually struck, plus wallX — the
    // classic raycasting "how far along the wall tile did I hit"
    // coordinate (0 to 1), used to pin wall decals/torches to an exact
    // spot on a wall rather than just a whole cell. Whichever axis ISN'T
    // the one the wall runs along carries that information — a vertical
    // wall (side 0) is uniform in x, so its hit-y tells you where along
    // it you hit; a horizontal wall (side 1) is the mirror image.
    const rayDirX = Math.cos(rayAngle);
    const rayDirY = Math.sin(rayAngle);
    const hitX = player.x + rayDirX * hit.distance;
    const hitY = player.y + rayDirY * hit.distance;
    const wallX =
      hit.side === 0 ? hitY - Math.floor(hitY) : hitX - Math.floor(hitX);
    // Fisheye correction relative to the player's own forward axis.
    const correctedDistance = hit.distance * Math.cos(rayAngle - player.angle);
    // Which face of the (mapX, mapY) cell this ray actually hit — see the
    // big comment on pickTorchSpot() for why side alone is ambiguous.
    const approachDir = hit.side === 0 ? hit.stepX : hit.stepY;

    rays.push({
      angle: rayAngle,
      distance: hit.distance,
      correctedDistance,
      side: hit.side,
      mapX: hit.mapX,
      mapY: hit.mapY,
      approachDir,
      wallX,
      hitX,
      hitY,
    });
  }
  return rays;
}

// --- Rendering ---
const viewCanvas = document.getElementById("viewCanvas");
const viewCtx = viewCanvas.getContext("2d");
const minimapCanvas = document.getElementById("minimapCanvas");
const minimapCtx = minimapCanvas.getContext("2d");
const MINIMAP_CELL = minimapCanvas.width / MAP_COLS;
const floorLabel = document.getElementById("floorLabel");
const doomReadout = document.getElementById("doomReadout");
const torchCountLabel = document.getElementById("torchCount");
const treasureCountLabel = document.getElementById("treasureCount");
const bestFloorLabel = document.getElementById("bestFloorLabel");
const DEFAULT_READOUT_TEXT =
  "WASD or Arrow Keys to move and turn. Space or Click to fire. E to use a staircase.";
const WIN_READOUT_TEXT =
  "You reached the top floor! WASD or Arrow Keys to keep exploring.";

const SCENE_THEME = {
  dark: {
    ceiling: "#12161f",
    floor: "#1c212b",
    wall: "#00e5ff",
    background: "#12161f",
    wallCell: "#2a3140",
    stairUpCell: "#ffb703",
    stairDownCell: "#9d4edd",
    treasureCell: "#2ec4b6",
    ray: "rgba(0, 229, 255, 0.25)",
    player: "#00e5ff",
  },
  light: {
    ceiling: "#dfe6ee",
    floor: "#f4f6f9",
    wall: "#0077b6",
    background: "#ffffff",
    wallCell: "#ccd3dc",
    stairUpCell: "#e07a00",
    stairDownCell: "#7b2cbf",
    treasureCell: "#0d9488",
    ray: "rgba(0, 119, 182, 0.25)",
    player: "#0077b6",
  },
};

function getCurrentTheme() {
  return document.documentElement.classList.contains("light-theme")
    ? SCENE_THEME.light
    : SCENE_THEME.dark;
}

// Multiplies a "#rrggbb" color's channels by `brightness` (0 = black, >1
// allowed and brightens past the original color — used near lit torches)
// — used to fake distance fog (farther walls get darker), the classic
// "one wall direction is slightly darker than the other" raycaster
// shading, and torch glow, entirely with multiplication, no fixed
// subtraction — see minecraft-terrain.js's shadeColor() for why a flat
// subtraction crushes darker colors unevenly.
function applyBrightness(hex, brightness) {
  const num = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.min(255, Math.max(0, Math.round(v)));
  const r = clamp((num >> 16) * brightness);
  const g = clamp(((num >> 8) & 0xff) * brightness);
  const b = clamp((num & 0xff) * brightness);
  return `rgb(${r}, ${g}, ${b})`;
}

const MAX_RENDER_DISTANCE = 12; // world units — walls this far or farther fade to minimum brightness

// --- Torches (wall-mounted, dynamic lighting) ---
const TORCH_LIGHT_RADIUS = 4; // world units — how far a lit torch's glow reaches
const TORCH_LIGHT_STRENGTH = 0.9; // how much brightness a torch adds at distance 0

// Sums how much extra brightness every LIT torch on this floor contributes
// at a given world point (a wall's hit position) — falls off linearly
// with distance, floored at 0 so a far torch never DARKENS anything.
function computeLightBoost(x, y) {
  let boost = 0;
  for (const torch of levels[currentLevelIndex].torches) {
    if (!torch.lit) continue;
    const distance = Math.hypot(torch.worldX - x, torch.worldY - y);
    boost += Math.max(0, 1 - distance / TORCH_LIGHT_RADIUS) * TORCH_LIGHT_STRENGTH;
  }
  return boost;
}

// How close (in wallX units, 0 to 1 across one wall tile) a ray's hit
// point needs to be to a decal/torch's recorded wallX to count as
// "hitting" it — these are small marks, not full-tile textures.
const MARK_HALF_WIDTH = 0.06;
let wallDecals = []; // { levelIndex, mapX, mapY, side, wallX } — laser marks

// Ray-vs-1x1-cell intersection ("slab test"): returns how far along the
// ray (in world units) it enters and exits the unit square at
// [cellCol, cellCol+1] x [cellRow, cellRow+1], or null if it never
// crosses that square at all. Used to paint the stairs cells onto the
// actual floor — figuring out exactly where a specific FLOOR tile
// (rather than a wall) appears on screen needs the same "where does this
// ray cross this square" idea, just applied to the floor plane instead of
// hunting for the nearest wall.
function raySlabIntersect(px, py, dirX, dirY, cellRow, cellCol) {
  const minX = cellCol;
  const maxX = cellCol + 1;
  const minY = cellRow;
  const maxY = cellRow + 1;

  let tMinX;
  let tMaxX;
  if (dirX !== 0) {
    const t1 = (minX - px) / dirX;
    const t2 = (maxX - px) / dirX;
    tMinX = Math.min(t1, t2);
    tMaxX = Math.max(t1, t2);
  } else {
    if (px < minX || px > maxX) return null;
    tMinX = -Infinity;
    tMaxX = Infinity;
  }

  let tMinY;
  let tMaxY;
  if (dirY !== 0) {
    const t1 = (minY - py) / dirY;
    const t2 = (maxY - py) / dirY;
    tMinY = Math.min(t1, t2);
    tMaxY = Math.max(t1, t2);
  } else {
    if (py < minY || py > maxY) return null;
    tMinY = -Infinity;
    tMaxY = Infinity;
  }

  const near = Math.max(tMinX, tMinY);
  const far = Math.min(tMaxX, tMaxY);
  if (near > far || far < 0) return null;
  return { near: Math.max(0, near), far };
}

// The screen Y where a point on the floor at forward-axis distance `d`
// appears — the same relationship a wall's own base already relies on
// (a wall's bottom edge sits at halfHeight + wallHeight/2, which is
// exactly halfHeight + viewCanvas.height / (2 * d) for that wall's own
// distance), just solved for an arbitrary floor distance instead.
function floorScreenY(halfHeight, correctedDistance) {
  return halfHeight + viewCanvas.height / (2 * correctedDistance);
}

function draw3DView(rays, theme) {
  const halfHeight = viewCanvas.height / 2;
  const level = levels[currentLevelIndex];
  // Everything painted directly onto the floor plane (not wall-mounted)
  // shares one rendering path — stairs and uncollected treasures alike —
  // since "where does this ray cross this specific floor cell" is the
  // same raySlabIntersect() question regardless of what's sitting there.
  const floorMarkers = [
    level.upCell && { cell: level.upCell, color: theme.stairUpCell },
    level.downCell && { cell: level.downCell, color: theme.stairDownCell },
    ...level.treasures
      .filter((t) => !t.collected)
      .map((t) => ({ cell: t, color: theme.treasureCell })),
  ].filter(Boolean);

  for (let i = 0; i < rays.length; i++) {
    const ray = rays[i];
    const wallHeight = viewCanvas.height / ray.correctedDistance;

    const distanceBrightness = Math.max(
      0.15,
      1 - ray.correctedDistance / MAX_RENDER_DISTANCE,
    );
    const sideBrightness = ray.side === 1 ? 0.7 : 1;
    const lightBoost = computeLightBoost(ray.hitX, ray.hitY);
    const wallColor = applyBrightness(
      theme.wall,
      distanceBrightness * sideBrightness + lightBoost,
    );

    const wallTop = halfHeight - wallHeight / 2;
    viewCtx.fillStyle = theme.ceiling;
    viewCtx.fillRect(i, 0, 1, wallTop);

    viewCtx.fillStyle = wallColor;
    viewCtx.fillRect(i, wallTop, 1, wallHeight);

    viewCtx.fillStyle = theme.floor;
    viewCtx.fillRect(i, wallTop + wallHeight, 1, halfHeight - wallHeight / 2);

    // Floor markers (stairs, treasures), painted at their true position —
    // only the portion of this ray's path that's both inside the marker's
    // cell AND in front of whatever wall it eventually hits.
    const rayDirX = Math.cos(ray.angle);
    const rayDirY = Math.sin(ray.angle);
    const cosCorrection = Math.cos(ray.angle - player.angle);
    for (const marker of floorMarkers) {
      const hitBounds = raySlabIntersect(
        player.x,
        player.y,
        rayDirX,
        rayDirY,
        marker.cell.row,
        marker.cell.col,
      );
      if (!hitBounds || hitBounds.near >= ray.distance) continue;

      const nearY = floorScreenY(halfHeight, hitBounds.near * cosCorrection);
      const farDistance = Math.min(hitBounds.far, ray.distance);
      const farY = floorScreenY(halfHeight, farDistance * cosCorrection);

      viewCtx.fillStyle = marker.color;
      viewCtx.fillRect(i, Math.min(nearY, farY), 1, Math.abs(nearY - farY));
    }

    for (const decal of wallDecals) {
      if (decal.levelIndex !== currentLevelIndex) continue;
      if (
        decal.mapX !== ray.mapX ||
        decal.mapY !== ray.mapY ||
        decal.side !== ray.side ||
        decal.approachDir !== ray.approachDir
      )
        continue;
      if (Math.abs(ray.wallX - decal.wallX) > MARK_HALF_WIDTH) continue;

      viewCtx.fillStyle = "#e63946";
      viewCtx.fillRect(i, wallTop + wallHeight * 0.4, 1, wallHeight * 0.2);
    }

    // Torches render as small "cubes" sitting slightly IN FRONT of the
    // wall plane instead of flush against it — computed from a distance
    // a little closer than the wall's own (TORCH_STICKOUT nearer), which
    // makes the same viewCanvas.height/distance perspective math that
    // sizes walls draw it slightly larger/lower than a flat decal would
    // be at this distance, reading as "sticking out." The left-to-right
    // brightness ramp across its few columns fakes a lit corner, the same
    // trick a flat 2D shape needs to hint at a 3D cube.
    for (const torch of level.torches) {
      if (
        torch.mapX !== ray.mapX ||
        torch.mapY !== ray.mapY ||
        torch.side !== ray.side ||
        torch.approachDir !== ray.approachDir
      )
        continue;
      const offset = ray.wallX - torch.wallX;
      if (Math.abs(offset) > MARK_HALF_WIDTH) continue;

      const stickOutDistance = Math.max(
        0.15,
        ray.correctedDistance - TORCH_STICKOUT,
      );
      const cubeSize = (viewCanvas.height / stickOutDistance) * level.torchSize;
      const cubeTop = halfHeight - cubeSize / 2;

      // 0 at the torch's left edge, 1 at its right edge — used to darken
      // one side and brighten the other, like light catching one face of
      // a box.
      const t = (offset + MARK_HALF_WIDTH) / (2 * MARK_HALF_WIDTH);
      const edgeShade = 0.65 + 0.5 * t;

      const baseBrightness = torch.lit ? 1.4 : distanceBrightness * sideBrightness;
      viewCtx.fillStyle = applyBrightness(
        torch.lit ? "#ffb703" : "#6b5842",
        baseBrightness * edgeShade,
      );
      viewCtx.fillRect(i, cubeTop, 1, cubeSize);
    }
  }

  drawLaserProjectile(rays, halfHeight);
}

// --- Laser gun ---
const TORCH_STICKOUT = 0.15; // world units — how far off the wall face a torch appears to sit
const LASER_SPEED = 0.8; // world units per frame the projectile travels
const LASER_BOLT_SIZE = 0.1; // world units — physical size of the traveling bolt

let laserProjectile = null; // { originX, originY, angle, traveled, hitDistance, hitX, hitY, mapX, mapY, side, approachDir, wallX }

// Where the player is currently aiming: at the ray under the mouse
// cursor if it's over the canvas, straight ahead otherwise.
function getFireAngle() {
  if (mouseInCanvas) {
    return player.angle - FOV / 2 + (mouseCanvasX / viewCanvas.width) * FOV;
  }
  return player.angle;
}

// Checks the wall cell/side/wallX the laser just struck against every
// unlit torch on this floor — reusing the exact same matching rule
// draw3DView() uses to decide whether to render a torch on a given ray,
// so "the laser visibly touched the torch" and "the laser lit the torch"
// always agree.
function checkLaserHitsTorch(hit, wallX) {
  const approachDir = hit.side === 0 ? hit.stepX : hit.stepY;
  for (const torch of levels[currentLevelIndex].torches) {
    if (torch.lit) continue;
    if (
      torch.mapX !== hit.mapX ||
      torch.mapY !== hit.mapY ||
      torch.side !== hit.side ||
      torch.approachDir !== approachDir
    )
      continue;
    if (Math.abs(torch.wallX - wallX) > MARK_HALF_WIDTH) continue;
    torch.lit = true;
  }
  checkAllTorchesLit();
}

function fireLaser() {
  const angle = getFireAngle();
  const hit = castRay(player.x, player.y, angle, MAP);
  const hitX = player.x + Math.cos(angle) * hit.distance;
  const hitY = player.y + Math.sin(angle) * hit.distance;
  const wallX =
    hit.side === 0 ? hitY - Math.floor(hitY) : hitX - Math.floor(hitX);
  const approachDir = hit.side === 0 ? hit.stepX : hit.stepY;

  laserProjectile = {
    originX: player.x,
    originY: player.y,
    angle,
    traveled: 0,
    hitDistance: hit.distance,
    hitX,
    hitY,
    mapX: hit.mapX,
    mapY: hit.mapY,
    side: hit.side,
    approachDir,
    wallX,
  };

  checkLaserHitsTorch(hit, wallX);
}

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault(); // stop the page itself from scrolling
    fireLaser();
  } else if (event.code === "KeyE") {
    if (stairsHintType === "up") goUpStairs();
    else if (stairsHintType === "down") goDownStairs();
  }
});
viewCanvas.addEventListener("click", () => fireLaser());

// --- Mouse aim & crosshair ---
let mouseInCanvas = false;
let mouseCanvasX = 0;
let mouseCanvasY = 0;

viewCanvas.addEventListener("mousemove", (event) => {
  const rect = viewCanvas.getBoundingClientRect();
  const scaleX = viewCanvas.width / rect.width;
  const scaleY = viewCanvas.height / rect.height;
  mouseCanvasX = (event.clientX - rect.left) * scaleX;
  mouseCanvasY = (event.clientY - rect.top) * scaleY;
});
viewCanvas.addEventListener("mouseenter", () => {
  mouseInCanvas = true;
});
viewCanvas.addEventListener("mouseleave", () => {
  mouseInCanvas = false;
});

function drawCrosshair(theme) {
  if (!mouseInCanvas) return;
  const size = 8;
  viewCtx.strokeStyle = theme.player;
  viewCtx.lineWidth = 1.5;
  viewCtx.beginPath();
  viewCtx.moveTo(mouseCanvasX - size, mouseCanvasY);
  viewCtx.lineTo(mouseCanvasX + size, mouseCanvasY);
  viewCtx.moveTo(mouseCanvasX, mouseCanvasY - size);
  viewCtx.lineTo(mouseCanvasX, mouseCanvasY + size);
  viewCtx.stroke();
}

// Advances the traveling bolt by one frame's worth of distance. Once it
// reaches the wall it was always going to hit (hitDistance was decided
// back in fireLaser(), via castRay() — the animation is just how that
// already-determined outcome gets SHOWN), the permanent decal is added
// and the projectile clears itself.
function updateLaserProjectile() {
  if (!laserProjectile) return;
  laserProjectile.traveled += LASER_SPEED;
  if (laserProjectile.traveled >= laserProjectile.hitDistance) {
    wallDecals.push({
      levelIndex: currentLevelIndex,
      mapX: laserProjectile.mapX,
      mapY: laserProjectile.mapY,
      side: laserProjectile.side,
      approachDir: laserProjectile.approachDir,
      wallX: laserProjectile.wallX,
    });
    laserProjectile = null;
  }
}

// Projects an arbitrary world-space point into screen space, the same
// angle-and-distance idea castRay() uses for walls — the angle from the
// player to the point (relative to which way the player is currently
// facing) becomes a screen column, and its distance becomes an apparent
// size. Used for the traveling laser bolt: a point moving along its own
// FIXED trajectory (set once at fire time) that still needs to be
// re-projected freshly every frame, since the player's camera can keep
// moving/turning while the bolt is still in flight.
function projectWorldPoint(x, y) {
  const dx = x - player.x;
  const dy = y - player.y;
  const distance = Math.hypot(dx, dy);
  const angleToPoint = Math.atan2(dy, dx);

  let relativeAngle = angleToPoint - player.angle;
  while (relativeAngle > Math.PI) relativeAngle -= Math.PI * 2;
  while (relativeAngle < -Math.PI) relativeAngle += Math.PI * 2;

  const perpDist = distance * Math.cos(relativeAngle);
  if (perpDist < 0.05) return null;

  const screenX = ((relativeAngle + FOV / 2) / FOV) * NUM_RAYS;
  return { screenX, perpDist };
}

// Draws the traveling bolt as a small red square, depth-tested against
// the actual wall column it'd appear in front of (so it correctly
// disappears behind a nearer wall instead of always drawing on top).
function drawLaserProjectile(rays, halfHeight) {
  if (!laserProjectile) return;

  const x = laserProjectile.originX + Math.cos(laserProjectile.angle) * laserProjectile.traveled;
  const y = laserProjectile.originY + Math.sin(laserProjectile.angle) * laserProjectile.traveled;
  const proj = projectWorldPoint(x, y);
  if (!proj) return;

  const col = Math.round(proj.screenX);
  if (col < 0 || col >= rays.length) return;
  if (proj.perpDist >= rays[col].correctedDistance) return;

  const size = (viewCanvas.height / proj.perpDist) * LASER_BOLT_SIZE;
  viewCtx.fillStyle = "#e63946";
  viewCtx.fillRect(proj.screenX - size / 2, halfHeight - size / 2, size, size);
}

// Skips most rays when drawing the fan on the minimap — drawing all 640
// every frame is cheap to compute (already done for the 3D view) but
// draws a solid wedge that hides the map underneath it; a sparser fan
// still shows the shape clearly.
const MINIMAP_RAY_STEP = 8;

// Tints every walkable (non-wall) cell within a lit torch's light radius
// on the minimap — checking MAP[row][col] !== CELL_WALL before tinting
// is what keeps the glow from ever painting over a wall, rather than
// drawing a plain circle that would ignore the map shape entirely and
// bleed across wall cells the light doesn't actually reach.
function drawTorchGlow() {
  const cellRadius = Math.ceil(TORCH_LIGHT_RADIUS);
  for (const torch of levels[currentLevelIndex].torches) {
    if (!torch.lit) continue;

    const minRow = Math.max(0, Math.floor(torch.worldY - cellRadius));
    const maxRow = Math.min(MAP_ROWS - 1, Math.ceil(torch.worldY + cellRadius));
    const minCol = Math.max(0, Math.floor(torch.worldX - cellRadius));
    const maxCol = Math.min(MAP_COLS - 1, Math.ceil(torch.worldX + cellRadius));

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (MAP[row][col] === CELL_WALL) continue;

        const dist = Math.hypot(
          col + 0.5 - torch.worldX,
          row + 0.5 - torch.worldY,
        );
        if (dist > TORCH_LIGHT_RADIUS) continue;

        const alpha = Math.max(0, 1 - dist / TORCH_LIGHT_RADIUS) * 0.35;
        minimapCtx.fillStyle = `rgba(255, 183, 3, ${alpha})`;
        minimapCtx.fillRect(
          col * MINIMAP_CELL,
          row * MINIMAP_CELL,
          MINIMAP_CELL,
          MINIMAP_CELL,
        );
      }
    }
  }
}

function drawMinimap(rays, theme) {
  minimapCtx.fillStyle = theme.background;
  minimapCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);

  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      const cell = MAP[row][col];
      if (cell === CELL_WALL) minimapCtx.fillStyle = theme.wallCell;
      else if (cell === CELL_STAIRS_UP) minimapCtx.fillStyle = theme.stairUpCell;
      else if (cell === CELL_STAIRS_DOWN) minimapCtx.fillStyle = theme.stairDownCell;
      else continue;

      minimapCtx.fillRect(
        col * MINIMAP_CELL,
        row * MINIMAP_CELL,
        MINIMAP_CELL,
        MINIMAP_CELL,
      );
    }
  }

  drawTorchGlow();

  minimapCtx.strokeStyle = theme.ray;
  minimapCtx.lineWidth = 1;
  for (let i = 0; i < rays.length; i += MINIMAP_RAY_STEP) {
    const ray = rays[i];
    minimapCtx.beginPath();
    minimapCtx.moveTo(player.x * MINIMAP_CELL, player.y * MINIMAP_CELL);
    minimapCtx.lineTo(ray.hitX * MINIMAP_CELL, ray.hitY * MINIMAP_CELL);
    minimapCtx.stroke();
  }

  for (const torch of levels[currentLevelIndex].torches) {
    minimapCtx.fillStyle = torch.lit ? "#ffb703" : "#6b5842";
    minimapCtx.beginPath();
    minimapCtx.arc(
      torch.worldX * MINIMAP_CELL,
      torch.worldY * MINIMAP_CELL,
      3,
      0,
      Math.PI * 2,
    );
    minimapCtx.fill();
  }

  for (const treasure of levels[currentLevelIndex].treasures) {
    if (treasure.collected) continue;
    minimapCtx.fillStyle = theme.treasureCell;
    minimapCtx.beginPath();
    minimapCtx.arc(
      (treasure.col + 0.5) * MINIMAP_CELL,
      (treasure.row + 0.5) * MINIMAP_CELL,
      3,
      0,
      Math.PI * 2,
    );
    minimapCtx.fill();
  }

  if (laserProjectile) {
    const x = laserProjectile.originX + Math.cos(laserProjectile.angle) * laserProjectile.traveled;
    const y = laserProjectile.originY + Math.sin(laserProjectile.angle) * laserProjectile.traveled;
    minimapCtx.strokeStyle = "#e63946";
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.moveTo(laserProjectile.originX * MINIMAP_CELL, laserProjectile.originY * MINIMAP_CELL);
    minimapCtx.lineTo(x * MINIMAP_CELL, y * MINIMAP_CELL);
    minimapCtx.stroke();
  }

  const px = player.x * MINIMAP_CELL;
  const py = player.y * MINIMAP_CELL;
  minimapCtx.strokeStyle = theme.player;
  minimapCtx.lineWidth = 2;
  minimapCtx.beginPath();
  minimapCtx.moveTo(px, py);
  minimapCtx.lineTo(
    px + Math.cos(player.angle) * MINIMAP_CELL,
    py + Math.sin(player.angle) * MINIMAP_CELL,
  );
  minimapCtx.stroke();

  minimapCtx.fillStyle = theme.player;
  minimapCtx.beginPath();
  minimapCtx.arc(px, py, 4, 0, Math.PI * 2);
  minimapCtx.fill();
}

function updateReadout() {
  if (stairsHintType === "up") {
    doomReadout.textContent = "Press E to go up to the next floor.";
  } else if (stairsHintType === "down") {
    doomReadout.textContent = "Press E to go down to the previous floor.";
  } else if (currentLevelIndex === NUM_FLOORS - 1) {
    doomReadout.textContent = WIN_READOUT_TEXT;
  } else {
    doomReadout.textContent = DEFAULT_READOUT_TEXT;
  }
}

function updateStatsDisplay() {
  const level = levels[currentLevelIndex];
  const litCount = level.torches.filter((t) => t.lit).length;
  const collectedCount = level.treasures.filter((t) => t.collected).length;
  torchCountLabel.textContent = `${litCount}/${level.torches.length}`;
  treasureCountLabel.textContent = `${collectedCount}/${level.treasures.length}`;
  bestFloorLabel.textContent = bestFloor > 0 ? bestFloor : "—";
}

function draw() {
  const theme = getCurrentTheme();
  const rays = castAllRays();
  draw3DView(rays, theme); // draws the traveling laser bolt itself, at the end
  drawCrosshair(theme);
  drawMinimap(rays, theme);
  updateReadout();
  updateStatsDisplay();
}

// Regenerates every floor from scratch (fresh walls, torches, treasures —
// same procedure as page load) and drops the player back at floor 1.
// bestFloor is deliberately left untouched — it's a persistent
// high-water mark across playthroughs, not part of the current run, the
// same way a game's "best score" survives starting a new game.
document.getElementById("newGameButton").addEventListener("click", () => {
  levels = [];
  for (let i = 0; i < NUM_FLOORS; i++) levels.push(generateFloor(i));
  currentLevelIndex = 0;
  wallDecals = [];
  laserProjectile = null;
  enterCurrentLevel({ x: 1.5, y: 1.5, angle: 0 });
});

// --- Account sync ---
// Signing in itself happens through the site-wide modal auth.js injects
// on every page — this page only needs to reflect the result of that (a
// status line + Log Out) and sync its own save data. auth.js loads as an
// ES module, which runs AFTER this classic script has already finished
// executing — so window.PortfolioAuth doesn't exist yet at the top of
// this file. "portfolio-auth-ready" fires once it's safe to use.
window.addEventListener("portfolio-auth-ready", () => {
  const authStatus = document.getElementById("authStatus");
  const authUserEmail = document.getElementById("authUserEmail");

  window.PortfolioAuth.onAuthChange(async (user) => {
    if (user) {
      authStatus.classList.remove("auth-hidden");
      authUserEmail.textContent = user.email;
      await syncBestFloorWithAccount();
    } else {
      authStatus.classList.add("auth-hidden");
    }
  });

  document.getElementById("authLogoutButton").addEventListener("click", () => {
    window.PortfolioAuth.logOut();
  });
});

// Reconciles the local (localStorage) bestFloor against whatever's saved
// on the signed-in account — whichever is higher wins, and gets copied to
// the other side, so neither a fresh browser nor a fresh device ever
// loses progress the other one already knows about.
async function syncBestFloorWithAccount() {
  const data = await window.PortfolioAuth.getUserData();
  const cloudBestFloor = data?.raycastingBestFloor ?? 0;

  if (cloudBestFloor > bestFloor) {
    bestFloor = cloudBestFloor;
    localStorage.setItem("raycastingBestFloor", String(bestFloor));
  } else if (bestFloor > cloudBestFloor) {
    await window.PortfolioAuth.saveUserData({ raycastingBestFloor: bestFloor });
  }
  updateStatsDisplay();
}

// --- Game loop ---
// Unlike the site's other projects (which advance one discrete step per
// button click), a first-person view needs to redraw continuously while
// a key is held — requestAnimationFrame is the standard browser API for
// "call this again right before the next repaint," which keeps movement
// smooth and synced to the display's actual refresh rate.
function gameLoop() {
  updatePlayer();
  updateLaserProjectile();
  draw();
  requestAnimationFrame(gameLoop);
}

gameLoop();
