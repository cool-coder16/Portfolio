// --- Grid & isometric geometry ---
// Terrain is a GRID_SIZE x GRID_SIZE grid of columns. Each column has an
// integer "height" (0 to MAX_HEIGHT, in block units) and gets drawn as a
// stack of that many blocks in an isometric ("2.5D") projection: a diamond
// on top, plus two visible side faces so it reads as a solid cube rather
// than a flat tile.
//
// TILE_W/TILE_H/BLOCK_H are recalculated (updateGeometryForSize() below)
// every time GRID_SIZE changes — tiles shrink as the grid grows and grow
// as it shrinks, which is what keeps the whole terrain roughly the same
// size on screen instead of spilling out of the canvas as the Size slider
// moves.
const BASE_GRID_SIZE = 18; // the grid size these base pixel sizes were tuned for
const BASE_TILE_W = 18;
const BASE_TILE_H = 9;
const BASE_BLOCK_H = 9;

let GRID_SIZE = BASE_GRID_SIZE;
let TILE_W = BASE_TILE_W; // half-width of a tile's top diamond, in pixels
let TILE_H = BASE_TILE_H; // half-height of a tile's top diamond, in pixels
let BLOCK_H = BASE_BLOCK_H; // pixels of vertical rise per height level
const MAX_HEIGHT = 8; // tallest possible column, in height levels
let NOISE_SCALE = 0.15; // smaller = smoother/hillier terrain, larger = bumpier

function updateGeometryForSize() {
  const scale = BASE_GRID_SIZE / GRID_SIZE;
  TILE_W = BASE_TILE_W * scale;
  TILE_H = BASE_TILE_H * scale;
  BLOCK_H = BASE_BLOCK_H * scale;
}

// The terrain's biomes. Deliberately split into two separate arrays
// instead of one array of {biome, level} objects:
//
// - biomeLevels[i] is the highest RAW height (0 to MAX_HEIGHT) that
//   position i in the stack covers, bottom-to-top (lowest elevation
//   first). These stay put — only editable through each row's number
//   input — because they belong to the POSITION, not to whichever biome
//   currently sits there.
// - biomeOrder[i] is which biome key currently occupies position i.
//   Dragging a row in the sidebar's Biomes panel reorders THIS array only.
//
// That split is what makes dragging Stone above Sand swap their colors
// without swapping their levels: Stone just takes over position 1's
// level (3) instead of carrying its own level (7) along with it.
const BIOME_DEFS = {
  water: { label: "Water", colorKey: "water" },
  sand: { label: "Sand", colorKey: "sand" },
  grass: { label: "Grass", colorKey: "grass" },
  stone: { label: "Stone", colorKey: "stone" },
  snow: { label: "Snow", colorKey: "snow" },
};
const DEFAULT_BIOME_ORDER = ["water", "sand", "grass", "stone", "snow"];
const DEFAULT_BIOME_LEVELS = [2, 3, 5, 7, 8];

let biomeOrder = [...DEFAULT_BIOME_ORDER];
let biomeLevels = [...DEFAULT_BIOME_LEVELS];

// Walks the stack bottom-to-top and returns the first position whose
// level is >= height. Falls back to the topmost position for anything
// taller than every level (e.g. if that position's own number got edited
// below MAX_HEIGHT).
function getBiomeBand(height) {
  for (let i = 0; i < biomeOrder.length; i++) {
    if (height <= biomeLevels[i]) return BIOME_DEFS[biomeOrder[i]];
  }
  return BIOME_DEFS[biomeOrder[biomeOrder.length - 1]];
}

const canvas = document.getElementById("terrainCanvas");
const ctx = canvas.getContext("2d");
const ORIGIN_X = canvas.width / 2;
const ORIGIN_Y = 110; // leaves headroom above for the tallest possible peak

const SCENE_THEME = {
  dark: {
    background: "#1c212b",
    water: "#2b6cb0",
    sand: "#d9c58a",
    grass: "#4caf50",
    stone: "#7d828a",
    snow: "#f0f3f5",
  },
  light: {
    background: "#ffffff",
    water: "#4fc3f7",
    sand: "#e6d3a3",
    grass: "#66bb6a",
    stone: "#9aa0a8",
    snow: "#ffffff",
  },
};

let heightMap = [];

// --- Perlin Noise (YOU write this) ---
// This is the heart of realistic-looking terrain: a function that turns any
// (x, y) coordinate into a smoothly-varying value, so nearby coordinates
// produce similar heights (hills, valleys) instead of static noise —
// Math.random() would give you TV static, not terrain, because it has no
// memory of what it returned next door.
//
// Classic 2D Perlin noise works like this:
//   1. (x, y) sits inside a unit grid cell with four integer "lattice"
//      corners: (x0,y0), (x1,y0), (x0,y1), (x1,y1), where x0 = Math.floor(x)
//      and x1 = x0 + 1 (same idea for y).
//   2. Every lattice point has a fixed, pseudo-random unit gradient vector
//      (hashGradient() below gives you one, from that point's integer
//      coordinates — the SAME point always hashes to the SAME vector, which
//      is what makes the noise deterministic instead of re-randomizing
//      every call).
//   3. For each of the 4 corners, take the dot product of its gradient
//      vector with the vector FROM that corner TO (x, y). That gives 4
//      numbers describing "how much this corner's gradient agrees with the
//      direction toward (x, y)."
//   4. Blend the 4 dot products together with bilinear interpolation, using
//      a "fade" curve — 6t^5 - 15t^4 + 10t^3 — on the fractional part of x
//      and y (instead of blending linearly), so the result accelerates and
//      decelerates smoothly and doesn't show visible seams at grid lines.
//
// Params: x, y — floating point (not necessarily integers).
// Returns: a value roughly in the range [-1, 1]. generateHeightMap() below
// takes care of turning that into an actual block height.
function fade(t) {
  return 6 * Math.pow(t, 5) - 15 * Math.pow(t, 4) + 10 * Math.pow(t, 3);
}

function hashGradient(ix, iy) {
  // Deterministic pseudo-random unit vector: hashes the two integers into
  // an angle, then returns the unit vector pointing that way. Same (ix, iy)
  // always produces the same vector, which is exactly what step 2 needs.
  let h = ix * 374761393 + iy * 668265263 + noiseSeed;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  const angle = (h % 360) * (Math.PI / 180);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

let noiseSeed = Math.floor(Math.random() * 100000);

function noise2D(x, y) {
  const x0 = Math.floor(x);
  const x1 = x0 + 1;
  const y0 = Math.floor(y);
  const y1 = y0 + 1;

  const points = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const dProducts = [];

  points.forEach((point) => {
    const gVector = hashGradient(point[0], point[1]);
    const cVector = { x: point[0] - x, y: point[1] - y };

    const dProduct = gVector.x * cVector.x + gVector.y * cVector.y;
    dProducts.push(dProduct);
  });

  const u = fade(x - x0);
  const v = fade(y - y0);

  const lerp1 = dProducts[0] + u * (dProducts[1] - dProducts[0]);
  const lerp2 = dProducts[3] + u * (dProducts[2] - dProducts[3]);
  const lerp3 = lerp1 + v * (lerp2 - lerp1);

  return lerp3;
}

// Samples noise2D() across the whole grid and remaps it from roughly
// [-1, 1] into an integer block height from 0 to MAX_HEIGHT.
function generateHeightMap() {
  heightMap = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    const rowHeights = [];
    for (let col = 0; col < GRID_SIZE; col++) {
      const n = noise2D(col * NOISE_SCALE, row * NOISE_SCALE);
      const normalized = (n + 1) / 2; // remap [-1, 1] -> [0, 1]
      rowHeights.push(Math.round(normalized * MAX_HEIGHT));
    }
    heightMap.push(rowHeights);
  }
}

// --- Isometric projection ---
// Standard 2:1 isometric tile math: moving one step in grid-col shifts the
// screen point right and slightly down; moving one step in grid-row shifts
// it left and slightly down. Together, that's what turns a square grid into
// the classic rotated-diamond layout. This returns the screen point for a
// column's BASE (ground level, height 0) — drawColumn() shifts it upward
// from there to account for the column's own height.
function isoBaseCenter(col, row) {
  return {
    x: ORIGIN_X + (col - row) * TILE_W,
    y: ORIGIN_Y + (col + row) * TILE_H,
  };
}

// Darkens (negative percent) or lightens (positive percent) a "#rrggbb"
// color, scaled relative to its own brightness rather than by a flat
// amount — multiplying each channel by (1 + percent) instead of adding
// 255 * percent. A flat subtraction crushes medium-brightness colors
// (like stone's gray) almost to black, since it doesn't have much room
// above 0 to begin with; scaling proportionally darkens every color by a
// consistent-looking amount instead. Used to fake directional lighting:
// the top face stays full brightness, the two side faces get
// progressively darker, which is what sells the "solid cube" look
// instead of three flat-looking diamonds.
function shadeColor(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.min(255, Math.max(0, Math.round(v)));
  const scale = 1 + percent;
  const r = clamp((num >> 16) * scale);
  const g = clamp(((num >> 8) & 0xff) * scale);
  const b = clamp((num & 0xff) * scale);
  return `rgb(${r}, ${g}, ${b})`;
}

function drawColumn(col, row, rawHeight, theme) {
  const band = getBiomeBand(rawHeight);
  const topColor = theme[band.colorKey];

  // Water always renders at a fixed, flat height, regardless of how deep
  // the underlying noise dips below it — otherwise every underwater column
  // would sit at its own random depth, showing up as little pits and steps
  // instead of one flat surface. Every other biome just renders at its own
  // raw height.
  //
  // Checking band.colorKey (what getBiomeBand() actually decided) instead
  // of comparing rawHeight against water's level directly matters once
  // water isn't guaranteed to be the lowest band: if water gets dragged to
  // a HIGHER position, its level becomes a big number, and a raw
  // `rawHeight <= waterLevel` check would flatten every column below that
  // — including ones an earlier, lower band already claimed — instead of
  // only the columns actually colored as water.
  const renderHeight =
    band.colorKey === "water"
      ? biomeLevels[biomeOrder.indexOf("water")]
      : rawHeight;

  const base = isoBaseCenter(col, row);
  const heightPixels = renderHeight * BLOCK_H;
  const top = { x: base.x, y: base.y - heightPixels };

  // Top diamond's four corners, plus the two base corners the side faces
  // need to reach down to (south and the two side corners double as both
  // the top face's corners and the side faces' top edge).
  const topN = { x: top.x, y: top.y - TILE_H };
  const topE = { x: top.x + TILE_W, y: top.y };
  const topS = { x: top.x, y: top.y + TILE_H };
  const topW = { x: top.x - TILE_W, y: top.y };
  const baseS = { x: base.x, y: base.y + TILE_H };
  const baseW = { x: base.x - TILE_W, y: base.y };
  const baseE = { x: base.x + TILE_W, y: base.y };

  const leftColor = shadeColor(topColor, -0.25);
  const rightColor = shadeColor(topColor, -0.45);

  // Left (west-facing) side
  fillFace([topW, topS, baseS, baseW], leftColor);

  // Right (east-facing) side
  fillFace([topS, topE, baseE, baseS], rightColor);

  // Top face, drawn last so it cleanly overlaps both side faces' top edges
  fillFace([topN, topE, topS, topW], topColor);
}

// Fills a face polygon and strokes it with the same color. Two adjacent
// tiles' edges land on the exact same coordinates, but canvas anti-aliases
// each fill independently — sub-pixel rounding can leave a faint seam
// between them. Stroking over the fill with the matching color "fattens"
// the edge by half a pixel, which is enough to paper over that gap.
function fillFace(points, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function getCurrentTheme() {
  return document.documentElement.classList.contains("light-theme")
    ? SCENE_THEME.light
    : SCENE_THEME.dark;
}

function draw() {
  const theme = getCurrentTheme();

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (heightMap.length === 0) return;

  // Painter's algorithm: draw back-to-front so nearer columns correctly
  // overlap farther ones. Screen depth is (row + col) — every cell along
  // that diagonal sits at the same screen height, and later diagonals sit
  // lower on screen (closer to the viewer), so drawing diagonal-by-diagonal
  // in increasing order is exactly back-to-front.
  const maxSum = (GRID_SIZE - 1) * 2;
  for (let sum = 0; sum <= maxSum; sum++) {
    const rowStart = Math.max(0, sum - (GRID_SIZE - 1));
    const rowEnd = Math.min(sum, GRID_SIZE - 1);
    for (let row = rowStart; row <= rowEnd; row++) {
      const col = sum - row;
      drawColumn(col, row, heightMap[row][col], theme);
    }
  }
}

document.getElementById("regenerateButton").addEventListener("click", () => {
  noiseSeed = Math.floor(Math.random() * 100000);
  generateHeightMap();
  draw();
});

// --- Setup panel ---
const sizeInput = document.getElementById("sizeInput");
const sizeValue = document.getElementById("sizeValue");
sizeInput.addEventListener("input", () => {
  GRID_SIZE = Number(sizeInput.value);
  sizeValue.textContent = `${GRID_SIZE}×${GRID_SIZE}`;
  updateGeometryForSize();
  generateHeightMap();
  draw();
});

const roughnessInput = document.getElementById("roughnessInput");
const roughnessValue = document.getElementById("roughnessValue");
roughnessInput.addEventListener("input", () => {
  NOISE_SCALE = Number(roughnessInput.value);
  roughnessValue.textContent = NOISE_SCALE.toFixed(2);
  generateHeightMap();
  draw();
});

// --- Biomes panel ---
// Renders one row per stack position i: a color swatch + name for
// whichever biome biomeOrder[i] currently is, and a number input bound to
// biomeLevels[i]. Dragging a row only moves entries around in biomeOrder
// — biomeLevels never moves, so swapping two rows swaps their colors
// without swapping their numbers.
//
// Drag-and-drop here is the plain HTML5 API (draggable="true" plus
// dragstart/dragover/drop events) — no library needed. The actual reorder
// only happens on "drop", not while dragging over rows — rebuilding the
// list mid-drag would delete the very element the browser is currently
// dragging, which cancels the drag.
let draggedFromIndex = null;

// Keeps biomeLevels strictly increasing bottom-to-top — position i's level
// must land strictly between its neighbors, so a higher position always
// has a higher number. Also used to set each input's own min/max, so the
// browser's native spinner arrows and typing both respect the same bounds
// instead of only catching out-of-range values after the fact.
function clampBiomeLevel(index, value) {
  const min = index === 0 ? 0 : biomeLevels[index - 1] + 1;
  const max =
    index === biomeLevels.length - 1 ? MAX_HEIGHT : biomeLevels[index + 1] - 1;
  return Math.min(max, Math.max(min, value));
}

// References to each row's number input, in position order — lets a level
// edit update its NEIGHBORS' min/max bounds directly (updateNeighborBounds
// below) instead of calling renderBiomeStack() again, which would tear
// down and rebuild every row, including the one currently focused, and
// kick focus out of the field the user is actively typing in.
let levelInputs = [];

function updateNeighborBounds(index) {
  if (index > 0) levelInputs[index - 1].max = biomeLevels[index] - 1;
  if (index < levelInputs.length - 1) {
    levelInputs[index + 1].min = biomeLevels[index] + 1;
  }
}

function renderBiomeStack() {
  const theme = getCurrentTheme();
  const list = document.getElementById("biomeStackList");
  list.innerHTML = "";
  levelInputs = [];

  for (let i = 0; i < biomeOrder.length; i++) {
    const biome = BIOME_DEFS[biomeOrder[i]];
    const index = i; // captured per-row, since `i` itself keeps changing

    const row = document.createElement("li");
    row.className = "biome-stack-row";
    row.draggable = true;

    row.addEventListener("dragstart", () => {
      draggedFromIndex = index;
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      draggedFromIndex = null;
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault(); // required to allow a drop here at all
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      if (draggedFromIndex === null || draggedFromIndex === index) return;
      // Only reorders WHICH biome sits at each position — biomeLevels is
      // untouched, so the numbers stay put and only the colors move.
      const [movedKey] = biomeOrder.splice(draggedFromIndex, 1);
      biomeOrder.splice(index, 0, movedKey);
      renderBiomeStack();
      draw();
    });

    const swatch = document.createElement("span");
    swatch.className = "biome-swatch";
    swatch.style.background = theme[biome.colorKey];

    const label = document.createElement("span");
    label.className = "biome-stack-name";
    label.textContent = biome.label;

    const input = document.createElement("input");
    input.type = "number";
    input.className = "biome-level-input";
    input.min = index === 0 ? 0 : biomeLevels[index - 1] + 1;
    input.max =
      index === biomeLevels.length - 1 ? MAX_HEIGHT : biomeLevels[index + 1] - 1;
    input.value = biomeLevels[index];
    input.addEventListener("input", () => {
      biomeLevels[index] = clampBiomeLevel(index, Number(input.value));
      input.value = biomeLevels[index]; // reflect the clamp if it kicked in
      updateNeighborBounds(index);
      // No need to regenerate the heightmap — the raw heights haven't
      // changed, only which band each one now falls into.
      draw();
    });

    levelInputs.push(input);
    row.append(swatch, label, input);
    list.appendChild(row);
  }
}

document.getElementById("biomeResetButton").addEventListener("click", () => {
  biomeOrder = [...DEFAULT_BIOME_ORDER];
  biomeLevels = [...DEFAULT_BIOME_LEVELS];
  renderBiomeStack();
  draw();
});

generateHeightMap();
renderBiomeStack();
draw();
